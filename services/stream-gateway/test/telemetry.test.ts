import { describe, expect, it } from "vitest";
import { createLogger } from "@arth/svc";
import { initTelemetry, maskPii, scrubEvent } from "@arth/svc/telemetry";

describe("telemetry", () => {
  it("is a no-op without exporter or DSN", async () => {
    const t = await initTelemetry("test", {});
    expect(t.tracing).toBe(false);
    expect(t.sentry).toBe(false);
    expect(() => t.capture(new Error("x"))).not.toThrow();
    const span = t.tracer.startSpan("noop");
    expect(span.isRecording()).toBe(false);
    span.end();
    await t.shutdown();
  });

  it("masks PII and tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln";
    const out = maskPii(`user a.b@c.in phone +91 9876543210 pan ABCDE1234F aadhaar 1234 5678 9012 proto bearer.${jwt}`);
    for (const leak of ["a.b@c.in", "9876543210", "ABCDE1234F", "1234 5678 9012", jwt]) expect(out).not.toContain(leak);
  });

  it("strips request payloads, user, locals and breadcrumb data", () => {
    const e = scrubEvent({
      message: "auth failed for 9876543210",
      user: { id: "u" },
      request: { data: "{}", headers: { authorization: "Bearer x" }, cookies: "c", query_string: "q" },
      exception: { values: [{ value: "x@y.com", stacktrace: { frames: [{ vars: { token: "t" } }] } }] },
      breadcrumbs: [{ message: "x@y.com", data: { body: 1 } }],
    });
    expect(JSON.stringify(e)).not.toMatch(/9876543210|x@y\.com|Bearer|token|body/);
    expect(e.user).toBeUndefined();
  });

  it("records spans and shuts down cleanly when an exporter is configured", async () => {
    const t = await initTelemetry("test", { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9/" });
    expect(t.tracing).toBe(true);
    const span = t.tracer.startSpan("ws.upgrade");
    expect(span.isRecording()).toBe(true);
    span.end();
    await expect(t.shutdown()).resolves.toBeUndefined();
  });

  it("forwards error-level log errors to the reporter only", () => {
    const seen: [unknown, Record<string, string>][] = [];
    const log = createLogger("test", (err, tags) => seen.push([err, tags]));
    const boom = new Error("boom");
    log.warn({ err: boom }, "just a warning");
    log.error({ err: boom }, "flush failed");
    log.error("no err object");
    expect(seen).toEqual([[boom, { log: "flush failed" }]]);
  });
});
