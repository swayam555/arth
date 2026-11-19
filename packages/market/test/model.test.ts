import { describe, expect, it } from "vitest";
import { buildUniverse, circuitBand, initialState, intradayVolFactor, isMarketOpen, mulberry32, step, toQuote } from "../src/index.js";

describe("universe", () => {
  const u = buildUniverse();

  it("has at least 2,000 unique symbols and ISINs", () => {
    expect(u.length).toBeGreaterThanOrEqual(2_000);
    expect(new Set(u.map((i) => i.symbol)).size).toBe(u.length);
    expect(new Set(u.map((i) => i.isin)).size).toBe(u.length);
  });

  it("is deterministic", () => {
    expect(buildUniverse().slice(0, 300)).toEqual(u.slice(0, 300));
  });

  it("keeps ISINs at 12 characters and symbols at ≤20", () => {
    for (const i of u) {
      expect(i.isin).toHaveLength(12);
      expect(i.symbol.length).toBeLessThanOrEqual(20);
    }
  });
});

describe("session", () => {
  it("knows NSE hours in IST", () => {
    expect(isMarketOpen(Date.parse("2026-11-19T04:00:00Z"))).toBe(true);
    expect(isMarketOpen(Date.parse("2026-11-19T03:40:00Z"))).toBe(false);
    expect(isMarketOpen(Date.parse("2026-11-21T05:00:00Z"))).toBe(false);
  });

  it("has a U-shaped volatility curve", () => {
    const open = intradayVolFactor(Date.parse("2026-11-19T03:46:00Z"));
    const mid = intradayVolFactor(Date.parse("2026-11-19T06:52:00Z"));
    const close = intradayVolFactor(Date.parse("2026-11-19T09:58:00Z"));
    expect(open).toBeGreaterThan(mid * 2);
    expect(close).toBeGreaterThan(mid * 2);
  });
});

describe("model", () => {
  const u = buildUniverse();

  it("never leaves the circuit band and stays on the tick grid", () => {
    const rng = mulberry32(1);
    const small = u.find((i) => i.circuitPct === 5)!;
    const s = initialState({ ...small, annualVol: 5 }, rng);
    const [lo, hi] = circuitBand(s);
    let t = Date.parse("2026-11-19T04:00:00Z");
    for (let i = 0; i < 20_000; i++) {
      step(s, 500, (t += 500), rng, { burstProbability: 0.01 });
      expect(s.ltp).toBeGreaterThanOrEqual(lo);
      expect(s.ltp).toBeLessThanOrEqual(hi);
      expect(Math.abs(s.ltp / s.inst.tickSize - Math.round(s.ltp / s.inst.tickSize))).toBeLessThan(1e-6);
    }
    expect(s.high).toBeLessThanOrEqual(hi);
    expect(s.low).toBeGreaterThanOrEqual(lo);
  });

  it("builds 5-level depth with bids below and asks above LTP", () => {
    const rng = mulberry32(2);
    const s = initialState(u[0]!, rng);
    const q = toQuote(s, Date.now(), rng);
    expect(q.bids).toHaveLength(5);
    expect(q.asks).toHaveLength(5);
    expect(q.bids.every((l) => l.price < q.ltp)).toBe(true);
    expect(q.asks.every((l) => l.price > q.ltp)).toBe(true);
  });

  it("produces realistic daily volatility for a large cap", () => {
    const rng = mulberry32(3);
    const moves: number[] = [];
    for (let d = 0; d < 200; d++) {
      const s = initialState(u[0]!, rng);
      let t = Date.parse("2026-11-19T03:45:00Z");
      for (let i = 0; i < 375 * 6; i++) step(s, 10_000, (t += 10_000), rng, { burstProbability: 0 });
      moves.push(Math.log(s.ltp / s.open));
    }
    const sd = Math.sqrt(moves.reduce((a, m) => a + m * m, 0) / moves.length);
    expect(sd).toBeGreaterThan(0.005);
    expect(sd).toBeLessThan(0.04);
  });
});
