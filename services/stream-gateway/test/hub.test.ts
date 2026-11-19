import { BACKPRESSURE_BYTES, MAX_SUBSCRIPTIONS, MsgType, decodeMsgpack, type RedisTick } from "@arth/market";
import { describe, expect, it } from "vitest";
import { Hub, SendStatus, SLOW_CLIENT_CLOSE_MS, type QuoteSource, type Transport } from "../src/hub.js";

type Frame = [number, number, unknown];

class FakeTransport implements Transport {
  frames: Frame[] = [];
  bufferedBytes = 0;
  dropNext = false;
  closedWith: [number, string] | null = null;
  send(frame: Uint8Array) {
    if (this.dropNext) {
      this.dropNext = false;
      return SendStatus.Dropped;
    }
    this.frames.push(decodeMsgpack(frame) as Frame);
    return SendStatus.Ok;
  }
  buffered() {
    return this.bufferedBytes;
  }
  close(code: number, reason: string) {
    this.closedWith = [code, reason];
  }
  take(type?: number): Frame[] {
    const out = type === undefined ? this.frames : this.frames.filter((f) => f[0] === type);
    this.frames = [];
    return out;
  }
}

class FakeSource implements QuoteSource {
  watched = new Set<string>();
  stored = new Map<string, RedisTick>();
  watch(s: string) {
    this.watched.add(s);
  }
  unwatch(s: string) {
    this.watched.delete(s);
  }
  async load(s: string) {
    return this.stored.get(s) ?? null;
  }
}

const UNIVERSE = new Set(Array.from({ length: 400 }, (_, i) => (i < 3 ? ["TCS", "INFY", "SBIN"][i]! : `SYM${i}`)));
const tick = (ltp: number, ts: number, vol = 100): RedisTick => [ltp, vol, ltp + 1, ltp - 1, ts, 99, 98, [[ltp - 0.05, 10]], [[ltp + 0.05, 20]]];

function setup() {
  const source = new FakeSource();
  const hub = new Hub(source, UNIVERSE);
  const t = new FakeTransport();
  const s = hub.connect(t, "u1", 0);
  const send = (op: object, now = 0) => s.handleMessage(JSON.stringify(op), now);
  return { source, hub, t, s, send };
}

describe("Session", () => {
  it("acks subscriptions with per-session indexes and snapshots once data exists", () => {
    const { hub, t, send, source } = setup();
    hub.onTick("TCS", tick(4000, 1));
    send({ op: "sub", symbols: ["TCS", "INFY"] });
    const [ack] = t.take(MsgType.SubAck);
    expect(ack![2]).toEqual({ TCS: 0, INFY: 1 });
    expect(source.watched).toEqual(new Set(["TCS", "INFY"]));
    hub.flush(10);
    const [snap] = t.take(MsgType.Snapshot);
    expect(snap![2]).toEqual([[0, 4000, 100, 4001, 3999, 1, 99, 98]]);
    hub.onTick("INFY", tick(1500, 20));
    hub.flush(300);
    expect(t.take(MsgType.Snapshot)[0]![2]).toEqual([[1, 1500, 100, 1501, 1499, 20, 99, 98]]);
  });

  it("conflates many ticks per symbol into one delta row per flush", () => {
    const { hub, t, send } = setup();
    hub.onTick("TCS", tick(4000, 1));
    send({ op: "sub", symbols: ["TCS"] });
    hub.flush(0);
    t.take();
    for (let i = 1; i <= 50; i++) hub.onTick("TCS", tick(4000 + i, 1 + i, 100 + i));
    hub.flush(100);
    expect(t.frames).toHaveLength(0);
    hub.flush(250);
    const frames = t.take();
    expect(frames).toHaveLength(1);
    expect(frames[0]![0]).toBe(MsgType.Delta);
    expect(frames[0]![2]).toEqual([[0, 4050, 150, 4051, 4049, 51]]);
  });

  it("numbers frames contiguously so clients can detect gaps", () => {
    const { hub, t, send } = setup();
    send({ op: "sub", symbols: ["TCS"] });
    for (let i = 0; i < 5; i++) {
      hub.onTick("TCS", tick(100 + i, i));
      hub.flush(i * 250);
    }
    const seqs = t.take().map((f) => f[1]);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it("serves a full snapshot after a dropped frame and a resync request", () => {
    const { hub, t, send } = setup();
    hub.onTick("TCS", tick(100, 1));
    hub.onTick("INFY", tick(200, 1));
    send({ op: "sub", symbols: ["TCS", "INFY"] });
    hub.flush(0);
    t.take();
    hub.onTick("TCS", tick(101, 2));
    t.dropNext = true;
    hub.flush(250);
    expect(hub.stats.framesDropped).toBe(1);
    hub.onTick("TCS", tick(102, 3));
    hub.flush(500);
    const [after] = t.take();
    expect(after![1]).toBe(4);
    send({ op: "resync" }, 501);
    hub.flush(501);
    const [snap] = t.take();
    expect(snap![0]).toBe(MsgType.Snapshot);
    expect((snap![2] as unknown[]).map((r) => (r as number[]).slice(0, 2))).toEqual([
      [0, 102],
      [1, 200],
    ]);
  });

  it("skips flushes for a slow client without losing the latest value", () => {
    const { hub, t, send } = setup();
    send({ op: "sub", symbols: ["TCS"] });
    hub.onTick("TCS", tick(100, 1));
    hub.flush(0);
    t.take();
    t.bufferedBytes = BACKPRESSURE_BYTES + 1;
    for (let i = 1; i <= 4; i++) {
      hub.onTick("TCS", tick(100 + i, 1 + i));
      hub.flush(i * 250);
    }
    expect(t.frames).toHaveLength(0);
    expect(hub.stats.flushesSkipped).toBe(4);
    t.bufferedBytes = 0;
    hub.flush(1_250);
    expect(t.take()[0]![2]).toEqual([[0, 104, 100, 105, 103, 5]]);
  });

  it("disconnects a client that stays backpressured past the limit", () => {
    const { hub, t, send, source } = setup();
    send({ op: "sub", symbols: ["TCS"] });
    t.bufferedBytes = BACKPRESSURE_BYTES * 4;
    for (let now = 0; now <= SLOW_CLIENT_CLOSE_MS + 250; now += 250) {
      hub.onTick("TCS", tick(100, now));
      hub.flush(now);
    }
    expect(t.closedWith).toEqual([4008, "slow_consumer"]);
    expect(hub.sessions.size).toBe(0);
    expect(source.watched.size).toBe(0);
    expect(hub.stats.slowClosed).toBe(1);
  });

  it("ref-counts upstream watches across sessions", () => {
    const { hub, send, source } = setup();
    const t2 = new FakeTransport();
    const s2 = hub.connect(t2, "u2", 0);
    send({ op: "sub", symbols: ["TCS"] });
    s2.handleMessage(JSON.stringify({ op: "sub", symbols: ["TCS"] }), 0);
    expect(hub.subscriberCount("TCS")).toBe(2);
    send({ op: "unsub", symbols: ["TCS"] });
    expect(source.watched.has("TCS")).toBe(true);
    hub.disconnect(s2);
    expect(source.watched.has("TCS")).toBe(false);
  });

  it("rejects unknown symbols and caps subscriptions", () => {
    const { t, send, s } = setup();
    send({ op: "sub", symbols: ["TCS", "NOPE"] });
    const errs = t.take(MsgType.Error);
    expect(errs[0]![2]).toEqual({ code: "unknown_symbols", message: "NOPE" });
    const many = [...UNIVERSE].slice(0, 300);
    send({ op: "sub", symbols: many.slice(0, MAX_SUBSCRIPTIONS) });
    send({ op: "sub", symbols: many.slice(MAX_SUBSCRIPTIONS, 300) });
    expect(s.subscriptionCount).toBe(MAX_SUBSCRIPTIONS);
    expect(t.take(MsgType.Error).map((f) => (f[2] as { code: string }).code)).toContain("too_many_subscriptions");
  });

  it("validates ops and rate-limits floods", () => {
    const { t, s } = setup();
    s.handleMessage("not json", 0);
    s.handleMessage(JSON.stringify({ op: "sub", symbols: ["bad symbol"] }), 0);
    s.handleMessage(JSON.stringify({ op: "rate", ms: 5 }), 0);
    expect(s.interval).toBe(100);
    const codes = t.take(MsgType.Error).map((f) => (f[2] as { code: string }).code);
    expect(codes).toEqual(["bad_json", "bad_op"]);
    for (let i = 0; i < 100; i++) s.handleMessage(JSON.stringify({ op: "ping", t: i }), 1);
    expect(t.take(MsgType.Error)).toHaveLength(50);
    expect(t.closedWith).toEqual([4029, "rate_limited"]);
  });

  it("streams depth for one subscribed symbol", () => {
    const { hub, t, send } = setup();
    hub.onTick("TCS", tick(100, 7));
    send({ op: "sub", symbols: ["TCS"], depth: "TCS" });
    hub.flush(0);
    const [depth] = t.take(MsgType.Depth);
    expect(depth![2]).toEqual([0, [[99.95, 10]], [[100.05, 20]], 7]);
  });

  it("answers pings immediately", () => {
    const { t, send } = setup();
    send({ op: "ping", t: 1234 });
    expect(t.take()).toEqual([[MsgType.Pong, 1, 1234]]);
  });

  it("loads a cold quote from the source for the first subscriber", async () => {
    const { hub, t, send, source } = setup();
    source.stored.set("SBIN", tick(800, 9));
    send({ op: "sub", symbols: ["SBIN"] });
    await Promise.resolve();
    await Promise.resolve();
    hub.flush(1);
    expect(t.take(MsgType.Snapshot)[0]![2]).toEqual([[0, 800, 100, 801, 799, 9, 99, 98]]);
  });

  it("fans one tick out to 2,000 sessions x 50 symbols inside a frame budget", () => {
    const hub = new Hub(new FakeSource(), UNIVERSE);
    const syms = [...UNIVERSE].slice(0, 200);
    const sink = { send: () => SendStatus.Ok, buffered: () => 0, close: () => undefined };
    for (let i = 0; i < 2_000; i++) {
      const s = hub.connect(sink, `u${i}`, 0);
      s.handleMessage(JSON.stringify({ op: "sub", symbols: syms.slice(i % 150, (i % 150) + 50) }), 0);
    }
    for (const sym of syms) hub.onTick(sym, tick(100, 0));
    hub.flush(0);
    const t0 = performance.now();
    for (let round = 1; round <= 4; round++) {
      for (const sym of syms) hub.onTick(sym, tick(100 + round, round));
      hub.flush(round * 250);
    }
    const ms = (performance.now() - t0) / 4;
    console.log(`fan-out: 2,000 sessions x 50 symbols, ${ms.toFixed(1)} ms per 250 ms flush cycle (${hub.stats.framesSent} frames)`);
    expect(ms).toBeLessThan(250);
  });
});
