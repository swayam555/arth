import { buildUniverse, tickChannel, type RedisTick } from "@arth/market";
import { createLogger, createRegistry, loadEnv, onShutdown, verifyHs256 } from "@arth/svc";
import { Redis } from "ioredis";
import { unpack } from "msgpackr";
import { Counter, Gauge, Histogram } from "prom-client";
import { createRequire } from "node:module";
import type * as UWS from "uWebSockets.js";
import { z } from "zod";
import { Hub, SendStatus, type Session } from "./hub.js";
import { redisQuoteSource } from "./source.js";

// The v20.71.0 ESM wrapper points at a file that is not shipped; load the CJS entry instead.
const uWS = createRequire(import.meta.url)("uWebSockets.js") as typeof UWS;

const env = loadEnv(
  z.object({
    PORT: z.coerce.number().int().default(7090),
    REDIS_URL: z.string().default("redis://localhost:7379"),
    JWT_SECRET: z.string().min(32).default("dev-only-secret-change-me-dev-only-secret-change-me"),
    JWT_ISSUER: z.string().default("arth-api"),
    UNIVERSE_SIZE: z.coerce.number().int().min(100).max(10_000).default(2_100),
    MAX_CONNECTIONS_PER_USER: z.coerce.number().int().min(1).default(3),
    TICK_MS: z.coerce.number().int().min(5).max(100).default(25),
  }),
);

const log = createLogger("stream-gateway");
const registry = createRegistry("stream-gateway");
const connections = new Gauge({ name: "arth_gw_connections", help: "Open WebSocket sessions", registers: [registry] });
const watched = new Gauge({ name: "arth_gw_watched_symbols", help: "Symbols with at least one subscriber", registers: [registry] });
const subscriptions = new Gauge({ name: "arth_gw_subscriptions", help: "Symbol subscriptions across sessions", registers: [registry] });
const rejected = new Counter({ name: "arth_gw_upgrades_rejected_total", help: "Rejected upgrades", labelNames: ["reason"], registers: [registry] });
const fanoutAge = new Histogram({
  name: "arth_gw_delta_age_seconds",
  help: "Source tick timestamp to WebSocket send, per delta row",
  buckets: [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 2],
  registers: [registry],
});

const universe = new Set(buildUniverse(env.UNIVERSE_SIZE).map((i) => i.symbol));
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const hub = new Hub(redisQuoteSource(redis, subscriber, log), universe, (ms) => fanoutAge.observe(Math.max(0, ms) / 1_000));

subscriber.on("messageBuffer", (channel: Buffer, message: Buffer) => {
  const symbol = channel.toString("latin1").slice(tickChannel("").length);
  try {
    hub.onTick(symbol, unpack(message) as RedisTick);
  } catch (err) {
    log.warn({ err, symbol }, "bad tick payload");
  }
});

for (const name of ["framesSent", "bytesSent", "flushesSkipped", "framesDropped", "slowClosed", "rateLimited"] as const) {
  const metric = `arth_gw_${name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}_total`;
  new Counter({
    name: metric,
    help: `Hub stat ${name}`,
    registers: [registry],
    collect() {
      this.reset();
      this.inc(hub.stats[name]);
    },
  });
}

interface SocketData {
  userId: string;
  session?: Session;
}

const perUser = new Map<string, number>();

function bearer(req: UWS.HttpRequest): string | null {
  const auth = req.getHeader("authorization");
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  for (const p of req.getHeader("sec-websocket-protocol").split(",")) {
    const v = p.trim();
    if (v.startsWith("bearer.")) return v.slice(7);
  }
  return null;
}

function reject(res: UWS.HttpResponse, status: string, reason: string): void {
  rejected.inc({ reason });
  res.cork(() => res.writeStatus(status).end(reason));
}

let draining = false;
let ready = false;

const app = uWS
  .App()
  .ws<SocketData>("/ws", {
    compression: uWS.DISABLED,
    maxPayloadLength: 16 * 1024,
    idleTimeout: 60,
    sendPingsAutomatically: true,
    maxBackpressure: 1024 * 1024,
    upgrade: (res, req, context) => {
      if (draining) return reject(res, "503 Service Unavailable", "draining");
      const token = bearer(req);
      if (!token) return reject(res, "401 Unauthorized", "missing_token");
      let userId: string;
      try {
        userId = verifyHs256(token, env.JWT_SECRET, env.JWT_ISSUER).sub;
      } catch {
        return reject(res, "401 Unauthorized", "invalid_token");
      }
      if ((perUser.get(userId) ?? 0) >= env.MAX_CONNECTIONS_PER_USER) return reject(res, "429 Too Many Requests", "too_many_connections");
      const protocol = req.getHeader("sec-websocket-protocol").includes("arth.v1") ? "arth.v1" : "";
      res.upgrade<SocketData>(
        { userId },
        req.getHeader("sec-websocket-key"),
        protocol,
        req.getHeader("sec-websocket-extensions"),
        context,
      );
    },
    open: (ws) => {
      const data = ws.getUserData();
      perUser.set(data.userId, (perUser.get(data.userId) ?? 0) + 1);
      data.session = hub.connect(
        {
          send: (frame) => {
            const r = ws.send(frame, true);
            return r === 1 ? SendStatus.Ok : r === 0 ? SendStatus.Backpressure : SendStatus.Dropped;
          },
          buffered: () => ws.getBufferedAmount(),
          close: (code, reason) => ws.end(code, reason),
        },
        data.userId,
      );
      connections.inc();
    },
    message: (ws, message) => {
      ws.getUserData().session?.handleMessage(new Uint8Array(message.slice(0)));
    },
    close: (ws) => {
      const data = ws.getUserData();
      if (data.session) {
        data.session.closed = true;
        hub.disconnect(data.session);
      }
      const n = (perUser.get(data.userId) ?? 1) - 1;
      if (n <= 0) perUser.delete(data.userId);
      else perUser.set(data.userId, n);
      connections.dec();
    },
  })
  .get("/healthz", (res) => {
    res.end("ok\n");
  })
  .get("/readyz", (res) => {
    const ok = ready && !draining && redis.status === "ready" && subscriber.status === "ready";
    res.writeStatus(ok ? "200 OK" : "503 Service Unavailable").end(ok ? "ready\n" : "not ready\n");
  })
  .get("/metrics", (res) => {
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
    });
    let subs = 0;
    for (const s of hub.sessions) subs += s.subscriptionCount;
    subscriptions.set(subs);
    watched.set(hub.watchedSymbols);
    registry.metrics().then((body) => {
      if (!aborted) res.cork(() => res.writeHeader("content-type", registry.contentType).end(body));
    });
  });

let listenSocket: UWS.us_listen_socket | null = null;
app.listen(env.PORT, (token) => {
  if (!token) {
    log.fatal({ port: env.PORT }, "failed to listen");
    process.exit(1);
  }
  listenSocket = token;
  ready = true;
  log.info({ port: env.PORT, universe: universe.size }, "gateway listening");
});

const timer = setInterval(() => hub.flush(Date.now()), env.TICK_MS);

onShutdown(log, async () => {
  draining = true;
  clearInterval(timer);
  for (const s of [...hub.sessions]) s.close(1001, "going_away");
  if (listenSocket) uWS.us_listen_socket_close(listenSocket);
  subscriber.disconnect();
  redis.disconnect();
});
