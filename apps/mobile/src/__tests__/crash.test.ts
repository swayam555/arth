import { initCrashReporting, reportError, stopCrashReporting } from "@/features/telemetry/crash";
import { maskPii, scrubBreadcrumb, scrubEvent } from "@/features/telemetry/scrub";

jest.mock("@sentry/react-native", () => ({ init: jest.fn(), captureException: jest.fn(), close: jest.fn() }));

const fakeSdk = () => ({ init: jest.fn(), captureException: jest.fn(), close: jest.fn(async () => undefined) });

describe("crash reporting", () => {
  it("is a no-op without a DSN", () => {
    const sdk = fakeSdk();
    expect(initCrashReporting(undefined, sdk)).toBe(false);
    reportError(new Error("x"), undefined, sdk);
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it("initialises with PII collection off and scrubs before send", () => {
    const sdk = fakeSdk();
    expect(initCrashReporting("https://k@o.ingest/1", sdk)).toBe(true);
    const opts = sdk.init.mock.calls[0][0];
    expect(opts).toMatchObject({ sendDefaultPii: false, attachScreenshot: false, attachViewHierarchy: false, tracesSampleRate: 0 });
    const out = opts.beforeSend({ message: "fail for a@b.in", user: { id: "u1" } });
    expect(out).toEqual({ message: "fail for [email]" });
    reportError(new Error("boom"), { area: "chart" }, sdk);
    expect(sdk.captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { area: "chart" } });
  });

  it("stops reporting when consent is withdrawn", async () => {
    const sdk = fakeSdk();
    initCrashReporting("https://k@o.ingest/1", sdk);
    await stopCrashReporting(sdk);
    expect(sdk.close).toHaveBeenCalledTimes(1);
    reportError(new Error("after"), undefined, sdk);
    expect(sdk.captureException).not.toHaveBeenCalled();
  });
});

describe("scrub", () => {
  it("masks Indian identifiers and tokens", () => {
    expect(maskPii("ABCDE1234F 9876543210 1234 5678 9012 Bearer abc.def eyJa.b.c")).toBe("[pan] [phone] [aadhaar] Bearer [token] [jwt]");
  });

  it("strips user, request, extras and frame vars", () => {
    const ev = scrubEvent({
      user: { email: "x@y.z" },
      request: { url: "/x?token=1" },
      extra: { pan: "ABCDE1234F" },
      exception: { values: [{ value: "PAN ABCDE1234F bad", stacktrace: { frames: [{ vars: { otp: "123456" } }] } }] },
      breadcrumbs: [{ category: "fetch", data: { url: "/x" } }, { category: "console", message: "hi a@b.in", data: { arg: 1 } }],
    });
    expect(ev).toEqual({
      exception: { values: [{ value: "PAN [pan] bad", stacktrace: { frames: [{}] } }] },
      breadcrumbs: [{ category: "console", message: "hi [email]" }],
    });
  });

  it("drops network breadcrumbs", () => {
    expect(scrubBreadcrumb({ category: "xhr", data: {} })).toBeNull();
  });
});
