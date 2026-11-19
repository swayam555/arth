import { createServer, type Server } from "node:http";
import { pino, type Logger } from "pino";
import { Registry, collectDefaultMetrics } from "prom-client";
import type { z } from "zod";

export function loadEnv<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv = process.env): z.infer<T> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid environment: ${issues}`);
  }
  return parsed.data;
}

/** `onError` receives the `err` of every error/fatal log line, which is how services report to Sentry. */
export function createLogger(service: string, onError?: (err: unknown, tags: Record<string, string>) => void): Logger {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? "info",
    base: { service },
    hooks: onError
      ? {
          logMethod(args, method, level) {
            const first = args[0] as unknown;
            if (level >= 50 && first && typeof first === "object" && "err" in first) {
              const msg = args.find((a, i) => i > 0 && typeof a === "string");
              onError((first as { err: unknown }).err, typeof msg === "string" ? { log: msg } : {});
            }
            method.apply(this, args);
          },
        }
      : undefined,
  });
}

export function createRegistry(service: string): Registry {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });
  return registry;
}

/** Serves /healthz (liveness), /readyz (from `ready()`) and /metrics (Prometheus text). */
export function startOpsServer(port: number, registry: Registry, ready: () => boolean): Server {
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200).end("ok\n");
    } else if (req.url === "/readyz") {
      const ok = ready();
      res.writeHead(ok ? 200 : 503).end(ok ? "ready\n" : "not ready\n");
    } else if (req.url === "/metrics") {
      registry.metrics().then(
        (body) => res.writeHead(200, { "content-type": registry.contentType }).end(body),
        (err: unknown) => res.writeHead(500).end(String(err)),
      );
    } else {
      res.writeHead(404).end();
    }
  });
  server.listen(port);
  return server;
}

export function onShutdown(log: Logger, fn: () => Promise<void>): void {
  let closing = false;
  const handler = (signal: string) => {
    if (closing) return;
    closing = true;
    log.info({ signal }, "shutting down");
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    fn().then(
      () => process.exit(0),
      (err: unknown) => {
        log.error({ err }, "shutdown failed");
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
}

export type { Logger } from "pino";
export { verifyHs256, signHs256, JwtError, type JwtClaims } from "./jwt.js";
