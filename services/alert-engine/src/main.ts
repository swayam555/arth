import { Consumer, Producer, stringDeserializer, stringSerializer } from "@platformatic/kafka";
import { CHANNEL_ALERTS_CHANGED, TOPIC_ALERTS_FIRED, TOPIC_TICKS_RAW, TOPIC_USER_DELETED } from "@arth/market";
import { createLogger, createRegistry, loadEnv, onShutdown, startOpsServer } from "@arth/svc";
import { ensureTopics } from "@arth/svc/kafka";
import { Redis } from "ioredis";
import postgres from "postgres";
import { Counter, Gauge, Histogram } from "prom-client";
import { z } from "zod";
import { decodeTick, decodeUserDeleted, encodeFired } from "./codec.js";
import { Engine } from "./engine.js";
import { MemoryIndex } from "./memoryIndex.js";
import type { Fired, Tick } from "./model.js";
import { PgStore } from "./pgStore.js";
import { RedisIndex } from "./redisIndex.js";

const env = loadEnv(
  z.object({
    KAFKA_BROKERS: z.string().default("localhost:7092"),
    REDIS_URL: z.string().default("redis://localhost:7379"),
    DATABASE_URL: z.string().default("postgres://arth:arth@localhost:7432/arth"),
    INDEX: z.enum(["redis", "memory"]).default("redis"),
    EVAL_MS: z.coerce.number().int().min(10).max(1_000).default(50),
    COOLDOWN_SEC: z.coerce.number().int().min(1).default(900),
    RESYNC_MS: z.coerce.number().int().min(5_000).default(60_000),
    GROUP_ID: z.string().default("alert-engine"),
    METRICS_PORT: z.coerce.number().int().default(9104),
  }),
);

const log = createLogger("alert-engine");
const registry = createRegistry("alert-engine");
const ticks = new Counter({ name: "arth_alerts_ticks_total", help: "Ticks evaluated", registers: [registry] });
const firedC = new Counter({ name: "arth_alerts_fired_total", help: "Alerts fired", labelNames: ["kind"], registers: [registry] });
const suppressed = new Counter({ name: "arth_alerts_suppressed_total", help: "Candidates dropped by cooldown or a paused/deleted alert", registers: [registry] });
const armed = new Gauge({ name: "arth_alerts_armed", help: "Active alerts in the index after the last resync", registers: [registry] });
const evalSeconds = new Histogram({
  name: "arth_alerts_eval_seconds",
  help: "Time to evaluate one tick batch",
  buckets: [0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
  registers: [registry],
});
const fireLatency = new Histogram({
  name: "arth_alerts_fire_latency_seconds",
  help: "Tick source timestamp to AlertFired published",
  buckets: [0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});

const brokers = env.KAFKA_BROKERS.split(",");
await ensureTopics(brokers, [
  { name: TOPIC_TICKS_RAW, partitions: 12 },
  { name: TOPIC_ALERTS_FIRED, partitions: 6 },
  { name: TOPIC_USER_DELETED, partitions: 3 },
]);

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, enableAutoPipelining: true });
const sub = new Redis(env.REDIS_URL);
const sql = postgres(env.DATABASE_URL, { max: 4, idle_timeout: 30 });
const producer = new Producer<string, Uint8Array, string, string>({
  clientId: "alert-engine",
  bootstrapBrokers: brokers,
  serializers: { key: stringSerializer, value: (v?: Uint8Array) => (v ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : undefined) },
  acks: -1,
});

async function publish(f: Fired): Promise<void> {
  await producer.send({ messages: [{ topic: TOPIC_ALERTS_FIRED, key: f.userId, value: encodeFired(f) }] });
}

const engine = new Engine(env.INDEX === "redis" ? new RedisIndex(redis) : new MemoryIndex(), new PgStore(sql), publish, env.COOLDOWN_SEC);

async function resync(): Promise<void> {
  try {
    const r = await engine.resync();
    armed.set(r.armed);
    log.info(r, "index resynced");
  } catch (err) {
    log.error({ err }, "resync failed");
  }
}
await resync();

sub.on("message", (_ch: string, id: string) => {
  engine.refresh(id).catch((err: unknown) => log.error({ err, id }, "refresh failed"));
});
await sub.subscribe(CHANNEL_ALERTS_CHANGED);

let ready = true;
startOpsServer(env.METRICS_PORT, registry, () => ready);

const consumer = new Consumer<string, Buffer, Buffer, Buffer>({
  clientId: "alert-engine",
  groupId: env.GROUP_ID,
  bootstrapBrokers: brokers,
  deserializers: { key: stringDeserializer },
  maxWaitTime: 50,
  sessionTimeout: 15_000,
  heartbeatInterval: 3_000,
});
const stream = await consumer.consume({ topics: [TOPIC_TICKS_RAW, TOPIC_USER_DELETED], autocommit: 1_000, mode: "latest" });

let buffer: Tick[] = [];
stream.on("data", (msg) => {
  try {
    if (msg.topic === TOPIC_USER_DELETED) {
      const uid = decodeUserDeleted(msg.value);
      engine.purgeUser(uid).then(
        (n) => log.info({ removed: n }, "user alerts purged"),
        (err: unknown) => log.error({ err }, "purge failed"),
      );
    } else buffer.push(decodeTick(msg.value));
  } catch (err) {
    log.debug({ err }, "bad message");
  }
});
stream.on("error", (err) => log.error({ err }, "consumer stream error"));

let running = false;
async function evaluate(): Promise<void> {
  if (running || !buffer.length) return;
  running = true;
  const batch = buffer;
  buffer = [];
  const end = evalSeconds.startTimer();
  const before = engine.stats.suppressed;
  try {
    const fired = await engine.process(batch);
    ticks.inc(batch.length);
    const now = Date.now();
    for (const f of fired) {
      firedC.inc({ kind: f.kind });
      fireLatency.observe(Math.max(0, now - f.tsMs) / 1_000);
    }
    suppressed.inc(engine.stats.suppressed - before);
    ready = true;
  } catch (err) {
    log.error({ err }, "evaluate failed; batch re-queued");
    buffer = batch.concat(buffer);
    ready = false;
  } finally {
    end();
    running = false;
  }
}

const evalTimer = setInterval(() => void evaluate(), env.EVAL_MS);
const resyncTimer = setInterval(() => void resync(), env.RESYNC_MS);
log.info({ evalMs: env.EVAL_MS, index: env.INDEX, cooldownSec: env.COOLDOWN_SEC }, "alert engine started");

onShutdown(log, async () => {
  clearInterval(evalTimer);
  clearInterval(resyncTimer);
  await stream.close();
  await evaluate();
  await consumer.close();
  await producer.close();
  await sql.end({ timeout: 5 });
  sub.disconnect();
  redis.disconnect();
});
