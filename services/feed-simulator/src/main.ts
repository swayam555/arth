import { Producer, stringSerializer } from "@platformatic/kafka";
import { TOPIC_CANDLES_1M, TOPIC_TICKS_RAW, isMarketOpen } from "@arth/market";
import { createLogger, createRegistry, loadEnv, onShutdown, startOpsServer } from "@arth/svc";
import { ensureTopics } from "@arth/svc/kafka";
import { Counter, Gauge, Histogram } from "prom-client";
import { z } from "zod";
import { encodeTick } from "./encode.js";
import { Feed } from "./feed.js";

const env = loadEnv(
  z.object({
    KAFKA_BROKERS: z.string().default("localhost:7092"),
    TICK_RATE: z.coerce.number().int().min(1).max(50_000).default(2_500),
    UNIVERSE_SIZE: z.coerce.number().int().min(100).max(10_000).default(2_100),
    ALWAYS_OPEN: z.stringbool().default(true),
    SEED: z.coerce.number().int().default(7),
    BATCH_MS: z.coerce.number().int().min(10).max(1_000).default(50),
    METRICS_PORT: z.coerce.number().int().default(9101),
  }),
);

const log = createLogger("feed-simulator");
const registry = createRegistry("feed-simulator");
const produced = new Counter({ name: "arth_feed_ticks_total", help: "Ticks produced to Kafka", registers: [registry] });
const sendSeconds = new Histogram({
  name: "arth_feed_send_seconds",
  help: "Kafka send latency per batch",
  buckets: [0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1],
  registers: [registry],
});
const targetRate = new Gauge({ name: "arth_feed_target_rate", help: "Configured ticks per second", registers: [registry] });
targetRate.set(env.TICK_RATE);

const brokers = env.KAFKA_BROKERS.split(",");
const created = await ensureTopics(brokers, [
  { name: TOPIC_TICKS_RAW, partitions: 12 },
  { name: TOPIC_CANDLES_1M, partitions: 12 },
]);
if (created.length) log.info({ created }, "created topics");

const feed = new Feed({ universeSize: env.UNIVERSE_SIZE, seed: env.SEED, alwaysOpen: env.ALWAYS_OPEN });
const producer = new Producer<string, Uint8Array, string, string>({
  clientId: "feed-simulator",
  bootstrapBrokers: brokers,
  serializers: { key: stringSerializer, value: (v?: Uint8Array) => (v ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : undefined) },
  acks: 1,
  compression: "lz4",
  retries: 5,
});

let running = true;
let ready = false;
startOpsServer(env.METRICS_PORT, registry, () => ready);
onShutdown(log, async () => {
  running = false;
  await producer.close();
});

log.info({ rate: env.TICK_RATE, universe: feed.size, alwaysOpen: env.ALWAYS_OPEN }, "feed started");

let carry = 0;
let last = Date.now();
let windowStart = last;
let windowCount = 0;
while (running) {
  const now = Date.now();
  const elapsed = Math.min(now - last, 1_000);
  last = now;
  if (!env.ALWAYS_OPEN && !isMarketOpen(now)) {
    ready = true;
    await new Promise((r) => setTimeout(r, 1_000));
    continue;
  }
  carry += (env.TICK_RATE * elapsed) / 1_000;
  const count = Math.floor(carry);
  carry -= count;
  if (count > 0) {
    const quotes = feed.next(now, count);
    const end = sendSeconds.startTimer();
    try {
      await producer.send({ messages: quotes.map((q) => ({ topic: TOPIC_TICKS_RAW, key: q.symbol, value: encodeTick(q) })) });
      ready = true;
      produced.inc(count);
      windowCount += count;
    } catch (err) {
      log.warn({ err }, "send failed; dropping batch");
    } finally {
      end();
    }
  }
  if (now - windowStart >= 10_000) {
    log.info({ ticksPerSec: Math.round((windowCount * 1_000) / (now - windowStart)) }, "throughput");
    windowStart = now;
    windowCount = 0;
  }
  const spent = Date.now() - now;
  await new Promise((r) => setTimeout(r, Math.max(0, env.BATCH_MS - spent)));
}
