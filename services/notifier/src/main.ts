import { Consumer, Producer, stringDeserializer, stringSerializer } from "@platformatic/kafka";
import { TOPIC_ALERTS_FIRED, TOPIC_DIGEST_READY, TOPIC_NOTIFICATIONS_DLQ } from "@arth/market";
import { AlertFiredSchema, create, DigestReadySchema, FailedNotificationSchema, fromBinary, toBinary } from "@arth/proto";
import { createLogger, createRegistry, loadEnv, onShutdown, startOpsServer } from "@arth/svc";
import { initTelemetry, inSpan } from "@arth/svc/telemetry";
import { ensureTopics } from "@arth/svc/kafka";
import postgres from "postgres";
import { Counter, Histogram } from "prom-client";
import { z } from "zod";
import { ExpoSender, LogSender } from "./expo.js";
import { alertNotification, digestNotification } from "./format.js";
import type { FailedDelivery, Notification } from "./model.js";
import { Notifier } from "./notifier.js";
import { PgDirectory } from "./pgDirectory.js";

const env = loadEnv(
  z.object({
    KAFKA_BROKERS: z.string().default("localhost:7092"),
    DATABASE_URL: z.string().default("postgres://arth:arth@localhost:7432/arth"),
    PUSH_SENDER: z.enum(["expo", "log"]).default("log"),
    EXPO_PUSH_URL: z.string().url().default("https://exp.host/--/api/v2/push/send"),
    EXPO_ACCESS_TOKEN: z.string().optional(),
    CONSENT_VERSION: z.string().default("2026-11"),
    RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    RETRY_BASE_MS: z.coerce.number().int().min(10).default(500),
    RETRY_CAP_MS: z.coerce.number().int().min(100).default(30_000),
    CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
    GROUP_ID: z.string().default("notifier"),
    METRICS_PORT: z.coerce.number().int().default(9105),
  }),
);

const telemetry = await initTelemetry("notifier");
const log = createLogger("notifier", telemetry.capture);
const registry = createRegistry("notifier");
const outcomes = new Counter({ name: "arth_notify_total", help: "Notifications by kind and outcome", labelNames: ["kind", "outcome"], registers: [registry] });
const removedTokens = new Counter({ name: "arth_notify_tokens_removed_total", help: "Device tokens dropped as unregistered", registers: [registry] });
const deliverSeconds = new Histogram({
  name: "arth_notify_deliver_seconds",
  help: "Kafka receive to push accepted, retries included",
  labelNames: ["kind"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 15, 60],
  registers: [registry],
});

const brokers = env.KAFKA_BROKERS.split(",");
await ensureTopics(brokers, [
  { name: TOPIC_ALERTS_FIRED, partitions: 6 },
  { name: TOPIC_DIGEST_READY, partitions: 6 },
  { name: TOPIC_NOTIFICATIONS_DLQ, partitions: 3 },
]);

const sql = postgres(env.DATABASE_URL, { max: 4, idle_timeout: 30 });
const directory = new PgDirectory(sql, env.CONSENT_VERSION);
const producer = new Producer<string, Uint8Array, string, string>({
  clientId: "notifier",
  bootstrapBrokers: brokers,
  serializers: { key: stringSerializer, value: (v?: Uint8Array) => (v ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : undefined) },
  acks: -1,
});

async function deadLetter(f: FailedDelivery): Promise<void> {
  const msg = create(FailedNotificationSchema, { ...f, tsMs: BigInt(Date.now()) });
  await producer.send({ messages: [{ topic: TOPIC_NOTIFICATIONS_DLQ, key: f.userId, value: toBinary(FailedNotificationSchema, msg) }] });
}

const sender =
  env.PUSH_SENDER === "expo"
    ? new ExpoSender(env.EXPO_PUSH_URL, env.EXPO_ACCESS_TOKEN)
    : new LogSender((m) => log.info({ kind: m.data.kind, url: m.data.url, title: m.title }, "push (log sender)"));
const notifier = new Notifier({
  sender,
  directory,
  deadLetter,
  policy: { attempts: env.RETRY_ATTEMPTS, baseMs: env.RETRY_BASE_MS, capMs: env.RETRY_CAP_MS },
});

async function toNotification(topic: string, value: Uint8Array): Promise<Notification> {
  if (topic === TOPIC_ALERTS_FIRED) {
    const a = fromBinary(AlertFiredSchema, value);
    return alertNotification(a, await directory.instrumentName(a.symbol), value);
  }
  return digestNotification(fromBinary(DigestReadySchema, value), value);
}

let ready = true;
startOpsServer(env.METRICS_PORT, registry, () => ready);

const consumer = new Consumer<string, Buffer, Buffer, Buffer>({
  clientId: "notifier",
  groupId: env.GROUP_ID,
  bootstrapBrokers: brokers,
  deserializers: { key: stringDeserializer },
  maxWaitTime: 200,
  sessionTimeout: 30_000,
  heartbeatInterval: 3_000,
});
const stream = await consumer.consume({ topics: [TOPIC_ALERTS_FIRED, TOPIC_DIGEST_READY], autocommit: 1_000, mode: "committed" });

let inflight = 0;
stream.on("data", (msg) => {
  inflight++;
  if (inflight >= env.CONCURRENCY) stream.pause();
  const end = deliverSeconds.startTimer();
  const kind = msg.topic === TOPIC_ALERTS_FIRED ? "alert" : "digest";
  inSpan(telemetry.tracer, "notify.deliver", { "arth.notify.kind": kind }, async (span) => {
    const r = await notifier.deliver(await toNotification(msg.topic, msg.value));
    span.setAttribute("arth.notify.outcome", r.outcome);
    return r;
  })
    .then(
      (r) => {
        outcomes.inc({ kind, outcome: r.outcome });
        removedTokens.inc(r.removed);
        if (r.outcome === "sent") end({ kind });
        ready = true;
      },
      (err: unknown) => {
        outcomes.inc({ kind, outcome: "error" });
        log.error({ err, kind }, "delivery failed");
        ready = false;
      },
    )
    .finally(() => {
      inflight--;
      if (stream.isPaused() && inflight < env.CONCURRENCY) stream.resume();
    });
});
stream.on("error", (err) => log.error({ err }, "consumer stream error"));
log.info({ sender: sender.name, attempts: env.RETRY_ATTEMPTS }, "notifier started");

onShutdown(log, async () => {
  await stream.close();
  await consumer.close();
  await producer.close();
  await sql.end({ timeout: 5 });
  await telemetry.shutdown();
});
