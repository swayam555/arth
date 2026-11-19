import type { Span, Tracer } from "@opentelemetry/api";
import { SpanStatusCode, trace } from "@opentelemetry/api";

export interface TelemetryEnv {
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  ARTH_VERSION?: string;
}

export interface Telemetry {
  tracer: Tracer;
  tracing: boolean;
  sentry: boolean;
  capture(err: unknown, tags?: Record<string, string>): void;
  shutdown(): Promise<void>;
}

const PII: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[pan]"],
  [/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "[aadhaar]"],
  [/(?:\+91[\s-]?)?\b[6-9]\d{9}\b/g, "[phone]"],
  [/\bbearer\.[\w-]+\.[\w-]+\.[\w-]+/gi, "bearer.[jwt]"],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]"],
];

export function maskPii(text: string): string {
  return PII.reduce((s, [re, sub]) => s.replace(re, sub), text);
}

interface ScrubbableEvent {
  message?: string;
  user?: unknown;
  request?: { data?: unknown; headers?: unknown; cookies?: unknown; query_string?: unknown };
  exception?: { values?: { value?: string; stacktrace?: { frames?: { vars?: unknown }[] } }[] };
  breadcrumbs?: { message?: string; data?: unknown }[];
}

/** Sentry beforeSend: no request payloads, headers, user or local variables leave the process; messages are masked. */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  delete event.user;
  if (event.request) {
    delete event.request.data;
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.query_string;
  }
  if (event.message) event.message = maskPii(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = maskPii(ex.value);
    for (const f of ex.stacktrace?.frames ?? []) delete f.vars;
  }
  for (const b of event.breadcrumbs ?? []) {
    if (b.message) b.message = maskPii(b.message);
    delete b.data;
  }
  return event;
}

/**
 * Tracing exports OTLP/HTTP only when OTEL_EXPORTER_OTLP_ENDPOINT is set and Sentry reports only when SENTRY_DSN is set;
 * otherwise both are no-ops and the service carries no exporter or network cost.
 */
export async function initTelemetry(service: string, env: TelemetryEnv = process.env): Promise<Telemetry> {
  const closers: (() => Promise<void>)[] = [];
  let tracing = false;
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const [{ NodeTracerProvider }, { BatchSpanProcessor }, { OTLPTraceExporter }, { resourceFromAttributes }] = await Promise.all([
      import("@opentelemetry/sdk-trace-node"),
      import("@opentelemetry/sdk-trace-base"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/resources"),
    ]);
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({ "service.name": service, "service.version": env.ARTH_VERSION ?? "dev" }),
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "")}/v1/traces`, timeoutMillis: 2_000 }))],
    });
    provider.register();
    closers.push(() => provider.shutdown());
    tracing = true;
  }
  let report: Telemetry["capture"] = () => undefined;
  if (env.SENTRY_DSN) {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT ?? "dev",
      release: `${service}@${env.ARTH_VERSION ?? "dev"}`,
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
      tracesSampleRate: 0,
      enableOpenTelemetrySetup: false,
      beforeSend: (e) => scrubEvent(e),
      beforeBreadcrumb: (b) => (b.message ? { ...b, message: maskPii(b.message), data: undefined } : { ...b, data: undefined }),
    });
    report = (err, tags) => {
      Sentry.captureException(err, tags ? { tags } : undefined);
    };
    closers.push(async () => {
      await Sentry.close(2000);
    });
  }
  return {
    tracer: trace.getTracer(service),
    tracing,
    sentry: Boolean(env.SENTRY_DSN),
    capture: report,
    shutdown: async () => {
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 3_000);
        timer.unref();
      });
      await Promise.race([Promise.allSettled(closers.map((c) => c())), deadline]);
      clearTimeout(timer);
    },
  };
}

/** Runs `fn` inside a span, recording a thrown error on it. */
export async function inSpan<T>(tracer: Tracer, name: string, attrs: Record<string, string | number | boolean>, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes: attrs }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
