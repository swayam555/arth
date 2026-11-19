import { buildUniverse, isMarketOpen, roundTo } from "@arth/market";
import { describe, expect, it } from "vitest";
import { generateHistory, pastSessions } from "../src/backfill.js";

const NOW = Date.parse("2026-11-19T06:00:00Z");

describe("backfill", () => {
  it("picks the most recent weekday sessions before today, oldest first", () => {
    const s = pastSessions(NOW, 6);
    expect(s.map((d) => new Date(d + 330 * 60_000).toISOString().slice(0, 10))).toEqual([
      "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17", "2026-11-18",
    ]);
  });

  it("builds ≥10k valid minute candles inside market hours that end on the previous close", () => {
    const inst = buildUniverse().find((i) => i.symbol === "TCS")!;
    const candles = generateHistory(inst, pastSessions(NOW, 27));
    expect(candles.length).toBe(27 * 375);
    expect(candles.length).toBeGreaterThanOrEqual(10_000);
    expect(candles.at(-1)!.c).toBe(roundTo(inst.basePrice, inst.tickSize));
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;
      expect(isMarketOpen(c.bucketMs)).toBe(true);
      expect(c.h).toBeGreaterThanOrEqual(Math.max(c.o, c.c));
      expect(c.l).toBeLessThanOrEqual(Math.min(c.o, c.c));
      expect(c.v).toBeGreaterThan(0);
      if (i) expect(c.bucketMs).toBeGreaterThan(candles[i - 1]!.bucketMs);
    }
  });

  it("is deterministic per seed", () => {
    const inst = buildUniverse()[0]!;
    const s = pastSessions(NOW, 2);
    expect(generateHistory(inst, s, 1)).toEqual(generateHistory(inst, s, 1));
    expect(generateHistory(inst, s, 1)).not.toEqual(generateHistory(inst, s, 2));
  });
});
