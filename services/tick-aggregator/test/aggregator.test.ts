import { describe, expect, it } from "vitest";
import { Aggregator, BUCKET_MS, type TickIn } from "../src/aggregator.js";

const T0 = Date.UTC(2026, 10, 18, 4, 0, 0);

function tick(symbol: string, seq: number, tsMs: number, ltp: number, volume: number): TickIn {
  return { symbol, seq, tsMs, ltp, volume, high: ltp, low: ltp, open: ltp, prevClose: 100, bids: [[ltp - 0.05, 10]], asks: [[ltp + 0.05, 12]] };
}

describe("Aggregator", () => {
  it("conflates to the newest tick per symbol between drains", () => {
    const a = new Aggregator();
    a.ingest(tick("TCS", 1, T0, 100, 10));
    a.ingest(tick("TCS", 2, T0 + 10, 101, 20));
    a.ingest(tick("INFY", 1, T0 + 20, 50, 5));
    const { latest } = a.drain(T0 + 100);
    expect(latest.map((t) => [t.symbol, t.ltp])).toEqual([
      ["TCS", 101],
      ["INFY", 50],
    ]);
    expect(a.drain(T0 + 200).latest).toEqual([]);
  });

  it("drops duplicate and stale sequence numbers", () => {
    const a = new Aggregator();
    expect(a.ingest(tick("TCS", 5, T0, 100, 10))).toBe(true);
    expect(a.ingest(tick("TCS", 5, T0, 100, 10))).toBe(false);
    expect(a.ingest(tick("TCS", 3, T0, 99, 9))).toBe(false);
    expect(a.duplicates).toBe(2);
  });

  it("builds OHLCV candles and closes them when the next bucket starts", () => {
    const a = new Aggregator();
    a.ingest(tick("TCS", 1, T0 + 1_000, 100, 1_000));
    a.ingest(tick("TCS", 2, T0 + 20_000, 104, 1_400));
    a.ingest(tick("TCS", 3, T0 + 40_000, 97, 1_900));
    a.ingest(tick("TCS", 4, T0 + 59_000, 101, 2_000));
    expect(a.drain(T0 + 59_500).closed).toEqual([]);
    a.ingest(tick("TCS", 5, T0 + BUCKET_MS + 500, 102, 2_300));
    const { closed } = a.drain(T0 + BUCKET_MS + 600);
    expect(closed).toEqual([{ symbol: "TCS", bucketMs: T0, o: 100, h: 104, l: 97, c: 101, v: 1_000 }]);
    expect(a.openCandle("TCS")).toMatchObject({ bucketMs: T0 + BUCKET_MS, o: 102, v: 300 });
  });

  it("closes idle candles by wall clock after the grace period", () => {
    const a = new Aggregator(2_000);
    a.ingest(tick("TCS", 1, T0 + 5_000, 100, 10));
    expect(a.drain(T0 + BUCKET_MS + 1_000).closed).toHaveLength(0);
    expect(a.drain(T0 + BUCKET_MS + 2_500).closed).toHaveLength(1);
    a.ingest(tick("TCS", 2, T0 + BUCKET_MS + 3_000, 101, 40));
    a.ingest(tick("TCS", 3, T0 + 2 * BUCKET_MS + 1, 102, 55));
    const { closed } = a.drain(T0 + 2 * BUCKET_MS + 10);
    expect(closed).toEqual([{ symbol: "TCS", bucketMs: T0 + BUCKET_MS, o: 101, h: 101, l: 101, c: 101, v: 30 }]);
  });

  it("lets a late tick update the quote without reopening a closed candle", () => {
    const a = new Aggregator(0);
    a.ingest(tick("TCS", 1, T0 + 1_000, 100, 10));
    a.ingest(tick("TCS", 2, T0 + BUCKET_MS + 1, 101, 20));
    a.drain(T0 + BUCKET_MS + 2);
    expect(a.ingest(tick("TCS", 3, T0 + 59_999, 150, 25))).toBe(true);
    const { latest, closed } = a.drain(T0 + BUCKET_MS + 3);
    expect(latest[0]!.ltp).toBe(150);
    expect(closed).toEqual([]);
    expect(a.openCandle("TCS")!.h).toBe(101);
    expect(a.late).toBe(1);
  });

  it("restarts volume accounting when the session volume resets", () => {
    const a = new Aggregator();
    a.ingest(tick("TCS", 1, T0, 100, 5_000));
    a.ingest(tick("TCS", 2, T0 + BUCKET_MS, 100, 40));
    expect(a.openCandle("TCS")!.v).toBe(40);
  });

  it("aggregates 100k ticks well inside the flush budget", () => {
    const a = new Aggregator();
    const syms = Array.from({ length: 2_000 }, (_, i) => `S${i}`);
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) a.ingest(tick(syms[i % syms.length]!, i + 1, T0 + i, 100 + (i % 7), i));
    a.drain(T0 + 100_000);
    const ms = performance.now() - t0;
    console.log(`aggregator: 100k ticks in ${ms.toFixed(1)} ms (${Math.round(100_000 / (ms / 1_000))} ticks/s)`);
    expect(ms).toBeLessThan(1_000);
  });
});
