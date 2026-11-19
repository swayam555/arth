import { Consumer, Producer, stringDeserializer, stringSerializer } from "@platformatic/kafka";
import { TOPIC_CANDLES_1M, TOPIC_TICKS_RAW } from "@arth/market";
import { createLogger, createRegistry, loadEnv, onShutdown, startOpsServer } from "@arth/svc";
import { ensureTopics } from "@arth/svc/kafka";
import { Redis } from "ioredis";
import postgres from "postgres";
import { Counter, Gauge, Histogram } from "prom-client";
import { z } from "zod";
import { Aggregator } from "./aggregator.js";
import { decodeTick } from "./decode.js";
import { encodeCandle, publishQuotes, storeCandles } from "./sinks.js";

const env = loadEnv(
  z.object({
    KAFKA_BROKERS: z.string().default("localhost:7092"),
    REDIS_URL: z.string().default("redis://localhost:7379"),
    DATABASE_URL: z.string().default("postgres://arth:arth@localhost:7432/arth"),
    FLUSH_MS: z.coerce.number().int().min(20).max(1_000).default(100),
    GROUP_ID: z.string().default("tick-aggregator"),
    METRICS_PORT: z.coerce.number().int().default(9102),
  }),
);

const log = createLogger("tick-aggregator");
const registry = createRegistry("tick-aggregator");
const consumed = new Counter({ name: "arth_agg_ticks_total", help: "Ticks consumed", registers: [registry] });
const dropped = new Counter({
  name: "arth_agg_ticks_dropped_total",
  help: "Ticks dropped as duplicates or undecodable",
  labelNames: ["reason"],
  registers: [registry],
});
const published = new Counter({ name: "arth_agg_quotes_published_total", help: "Conflated quotes published to Redis", registers: [registry] });
const candlesClosed = new Counter({ name: "arth_agg_candles_total", help: "1m candles closed", registers: [registry] });
const tickAge = new Histogram({
  name: "arth_agg_tick_age_seconds",
  help: "Source timestamp to Redis publish, per flushed quote",
  buckets: [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 2, 5],
  registers: [registry],
});
const flushSeconds = new Histogram({
  name: "arth_agg_flush_seconds",
  help: "Time to flush one batch to Redis/Postgres/Kafka",
  buckets: [0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1],
  registers: [registry],
});
const lagGauge = new Gauge({ name: "arth_agg_consumer_lag", help: "Kafka consumer lag (messages) summed over partitions", registers: [registry] });

const brokers = env.KAFKA_BROKERS.split(",");
await ensureTopics(brokers, [
  { name: TOPIC_TICKS_RAW, partitions: 12 },
  { name: TOPIC_CANDLES_1M, partitions: 12 },
]);

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, enableAutoPipelining: false });
const sql = postgres(env.DATABASE_URL, { max: 2, idle_timeout: 30 });
const producer = new Producer<string, Uint8Array, string, string>({
  clientId: "tick-aggregator",
  bootstrapBrokers: brokers,
  serializers: { key: stringSerializer, value: (v?: Uint8Array) => (v ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : undefined) },
  acks: 1,
  compression: "lz4",
});
const consumer = new Consumer<string, Buffer, Buffer, Buffer>({
  clientId: "tick-aggregator",
  groupId: env.GROUP_ID,
  bootstrapBrokers: brokers,
  deserializers: { key: stringDeserializer },
  maxWaitTime: 50,
  sessionTimeout: 15_000,
  heartbeatInterval: 3_000,
});

const agg = new Aggregator();
let ready = false;
let lastDuplicates = 0;
startOpsServer(env.METRICS_PORT, registry, () => ready);

const stream = await consumer.consume({ topics: [TOPIC_TICKS_RAW], autocommit: 1_000, mode: "latest" });
consumer.on("consumer:lag", (lag) => {
  let total = 0n;
  for (const parts of lag.values()) for (const l of parts) if (l > 0n) total += l;
  lagGauge.set(Number(total));
});
consumer.startLagMonitoring({ topics: [TOPIC_TICKS_RAW] }, 5_000);

stream.on("data", (msg) => {
  try {
    agg.ingest(decodeTick(msg.value));
    consumed.inc();
  } catch (err) {
    dropped.inc({ reason: "decode" });
    log.debug({ err }, "bad tick");
  }
});
stream.on("error", (err) => log.error({ err }, "consumer stream error"));

let flushing = false;
async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  const end = flushSeconds.startTimer();
  try {
    const now = Date.now();
    const { latest, closed } = agg.drain(now);
    await publishQuotes(redis, latest);
    for (const t of latest) tickAge.observe(Math.max(0, now - t.tsMs) / 1_000);
    published.inc(latest.length);
    if (closed.length) {
      await storeCandles(sql, closed);
      await producer.send({
        messages: closed.map((c) => ({ topic: TOPIC_CANDLES_1M, key: c.symbol, value: encodeCandle(c) })),
      });
      candlesClosed.inc(closed.length);
    }
    if (agg.duplicates > lastDuplicates) {
      dropped.inc({ reason: "duplicate" }, agg.duplicates - lastDuplicates);
      lastDuplicates = agg.duplicates;
    }
    ready = true;
  } catch (err) {
    log.error({ err }, "flush failed");
  } finally {
    end();
    flushing = false;
  }
}

const timer = setInterval(() => void flush(), env.FLUSH_MS);
log.info({ flushMs: env.FLUSH_MS, group: env.GROUP_ID }, "aggregator started");

onShutdown(log, async () => {
  clearInterval(timer);
  consumer.stopLagMonitoring();
  await stream.close();
  await flush();
  await consumer.close();
  await producer.close();
  await sql.end({ timeout: 5 });
  redis.disconnect();
});
