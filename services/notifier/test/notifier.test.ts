import { AlertFiredSchema, AlertKind, create, DigestReadySchema } from "@arth/proto";
import { describe, expect, it } from "vitest";
import { ExpoSender, LogSender } from "../src/expo.js";
import { alertNotification, digestNotification } from "../src/format.js";
import { PushTransportError, type Directory, type FailedDelivery, type PushMessage, type PushResult, type PushSender } from "../src/model.js";
import { Notifier } from "../src/notifier.js";
import { backoffMs } from "../src/retry.js";

class FakeDirectory implements Directory {
  removed: string[] = [];
  constructor(
    public consent = true,
    public tokens = ["ExponentPushToken[a]", "ExponentPushToken[b]"],
  ) {}
  async recipient() {
    return { pushConsent: this.consent, tokens: this.consent ? this.tokens.filter((t) => !this.removed.includes(t)) : [] };
  }
  async instrumentName() {
    return "Tata Consultancy Services";
  }
  async removeToken(_u: string, t: string) {
    this.removed.push(t);
  }
}

class Scripted implements PushSender {
  readonly name = "scripted";
  calls: PushMessage[][] = [];
  constructor(private readonly steps: ((m: PushMessage[]) => PushResult[])[]) {}
  async send(m: PushMessage[]) {
    this.calls.push(m);
    const step = this.steps[Math.min(this.calls.length - 1, this.steps.length - 1)]!;
    return step(m);
  }
}

const fired = create(AlertFiredSchema, {
  alertId: "a1",
  userId: "u1",
  symbol: "TCS",
  kind: AlertKind.ABOVE,
  threshold: 4100,
  triggerPrice: 4102.5,
  tsMs: 1n,
});
const note = alertNotification(fired, "Tata Consultancy Services", new Uint8Array([1, 2]));

function make(sender: PushSender, dir = new FakeDirectory()) {
  const dlq: FailedDelivery[] = [];
  const waits: number[] = [];
  const n = new Notifier({
    sender,
    directory: dir,
    deadLetter: async (f) => void dlq.push(f),
    policy: { attempts: 4, baseMs: 100, capMs: 1_000 },
    sleep: async (ms) => void waits.push(ms),
    rand: () => 0.5,
  });
  return { n, dlq, waits, dir };
}

const ok = (m: PushMessage[]): PushResult[] => m.map((x) => ({ status: "ok", to: x.to }));

describe("formatting", () => {
  it("states facts with a deep link and no trading verbs", () => {
    expect(note.title).toBe("Price alert: TCS (Tata Consultancy Services)");
    expect(note.body).toBe("TCS crossed above ₹4,100.00. Last traded ₹4,102.50.");
    expect(note.url).toBe("arth://instrument/TCS?alert=a1");
    const pct = alertNotification({ ...fired, kind: AlertKind.PCT_MOVE, threshold: 3 }, null, new Uint8Array());
    expect(pct.body).toMatch(/^TCS moved more than 3% from yesterday's close/);
    for (const b of [note.body, pct.body]) expect(b).not.toMatch(/\b(buy|sell|hold|should)\b/i);
    const d = digestNotification(create(DigestReadySchema, { userId: "u1", forDate: "2026-11-19", title: "t", body: "b" }), new Uint8Array());
    expect(d.url).toBe("arth://digest/2026-11-19");
  });
});

describe("notifier", () => {
  it("sends to every device of a consenting user", async () => {
    const s = new LogSender();
    const { n } = make(s);
    expect(await n.deliver(note)).toEqual({ outcome: "sent", attempts: 1, removed: 0 });
    expect(s.sent.map((m) => m.to)).toEqual(["ExponentPushToken[a]", "ExponentPushToken[b]"]);
    expect(s.sent[0]!.data).toEqual({ url: "arth://instrument/TCS?alert=a1", kind: "alert" });
  });

  it("sends nothing without push consent or devices", async () => {
    const s = new LogSender();
    expect((await make(s, new FakeDirectory(false)).n.deliver(note)).outcome).toBe("no_consent");
    expect((await make(s, new FakeDirectory(true, [])).n.deliver(note)).outcome).toBe("no_devices");
    expect(s.sent).toHaveLength(0);
  });

  it("forgets unregistered devices without retrying them", async () => {
    const s = new Scripted([
      (m) => m.map((x) => (x.to.endsWith("[a]") ? { status: "error", to: x.to, error: "DeviceNotRegistered", retryable: false, deviceGone: true } : { status: "ok", to: x.to })),
    ]);
    const { n, dir, dlq } = make(s);
    expect(await n.deliver(note)).toEqual({ outcome: "sent", attempts: 1, removed: 1 });
    expect(dir.removed).toEqual(["ExponentPushToken[a]"]);
    expect(dlq).toEqual([]);
  });

  it("retries transport failures with jittered backoff, honouring Retry-After", async () => {
    const s = new Scripted([
      () => {
        throw new PushTransportError("expo 503");
      },
      () => {
        throw new PushTransportError("expo 429", 2_000);
      },
      ok,
    ]);
    const { n, waits } = make(s);
    expect(await n.deliver(note)).toEqual({ outcome: "sent", attempts: 3, removed: 0 });
    expect(waits).toEqual([50, 2_000]);
  });

  it("retries only the devices that were rate limited", async () => {
    const s = new Scripted([
      (m) => m.map((x) => (x.to.endsWith("[b]") ? { status: "error", to: x.to, error: "MessageRateExceeded", retryable: true, deviceGone: false } : { status: "ok", to: x.to })),
      ok,
    ]);
    const { n } = make(s);
    await n.deliver(note);
    expect(s.calls.map((c) => c.map((m) => m.to))).toEqual([["ExponentPushToken[a]", "ExponentPushToken[b]"], ["ExponentPushToken[b]"]]);
  });

  it("dead-letters with the original payload after the last attempt", async () => {
    const s = new Scripted([
      () => {
        throw new PushTransportError("expo unreachable: ECONNRESET");
      },
    ]);
    const { n, dlq, waits } = make(s);
    expect(await n.deliver(note)).toEqual({ outcome: "dead_lettered", attempts: 4, removed: 0 });
    expect(dlq).toEqual([{ userId: "u1", kind: "alert", payload: new Uint8Array([1, 2]), reason: "expo unreachable: ECONNRESET", attempts: 4 }]);
    expect(waits).toEqual([50, 100, 200]);
  });

  it("backoff is capped", () => {
    expect(backoffMs(10, { attempts: 5, baseMs: 100, capMs: 1_000 }, () => 0.999)).toBe(999);
  });
});

describe("expo sender", () => {
  const msg: PushMessage = { to: "ExponentPushToken[a]", title: "t", body: "b", data: { url: "arth://x", kind: "alert" }, collapseId: "c" };

  it("maps tickets and posts the Expo message shape", async () => {
    let sent: unknown;
    const fake: typeof fetch = async (_u, init) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({ data: [{ status: "ok", id: "x" }, { status: "error", details: { error: "DeviceNotRegistered" } }] });
    };
    const r = await new ExpoSender("http://expo.test", "tok", fake).send([msg, { ...msg, to: "ExponentPushToken[b]" }]);
    expect(r).toEqual([
      { status: "ok", to: "ExponentPushToken[a]" },
      { status: "error", to: "ExponentPushToken[b]", error: "DeviceNotRegistered", retryable: false, deviceGone: true },
    ]);
    expect((sent as { channelId: string; collapseId: string }[])[0]).toMatchObject({ channelId: "alerts", collapseId: "c", priority: "high" });
  });

  it("turns 429/5xx and network errors into retryable transport errors", async () => {
    const rl: typeof fetch = async () => new Response("slow down", { status: 429, headers: { "retry-after": "3" } });
    await expect(new ExpoSender("http://expo.test", undefined, rl).send([msg])).rejects.toMatchObject({ retryAfterMs: 3_000 });
    const down: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(new ExpoSender("http://expo.test", undefined, down).send([msg])).rejects.toBeInstanceOf(PushTransportError);
  });

  it("splits batches at 100 messages", async () => {
    const sizes: number[] = [];
    const fake: typeof fetch = async (_u, init) => {
      const b = JSON.parse(String(init?.body)) as unknown[];
      sizes.push(b.length);
      return Response.json({ data: b.map(() => ({ status: "ok" })) });
    };
    const r = await new ExpoSender("http://expo.test", undefined, fake).send(Array.from({ length: 230 }, () => msg));
    expect(sizes).toEqual([100, 100, 30]);
    expect(r).toHaveLength(230);
  });
});
