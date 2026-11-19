import { describe, expect, it } from "vitest";
import { ema, istDay, rsi, sma, vwap, type Candle } from "../src/index.js";

// StockCharts "RSI" ChartSchool worksheet (QQQQ closes); 14-period Wilder RSI.
const STOCKCHARTS = [
  44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.614, 46.282, 46.282, 46.0028,
  46.0328, 46.4116, 46.2222, 45.6439, 46.2122, 46.2521, 45.7137, 46.4515, 45.7835, 45.3548, 44.0288, 44.1783, 44.2181, 44.5672, 43.4205,
  42.6628, 43.1314,
];

describe("indicators", () => {
  it("SMA matches hand-computed values", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("EMA seeds with the SMA and smooths with 2/(n+1)", () => {
    const out = ema([2, 4, 6, 8, 10], 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBeCloseTo(4, 10);
    expect(out[3]).toBeCloseTo(6, 10);
    expect(out[4]).toBeCloseTo(8, 10);
    expect(ema([22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29, 22.15], 10)[10]).toBeCloseTo(22.15 * (2 / 11) + 22.221 * (9 / 11), 10);
  });

  it("RSI reproduces the StockCharts Wilder worksheet", () => {
    const out = rsi(STOCKCHARTS, 14);
    expect(out[13]).toBeNull();
    expect(out[14]).toBeCloseTo(70.53, 1);
    expect(out[15]).toBeCloseTo(66.32, 1);
    expect(out[16]).toBeCloseTo(66.55, 1);
    expect(out[32]).toBeCloseTo(37.79, 1);
  });

  it("RSI is 100 with no losses and 50 when flat", () => {
    expect(rsi([1, 2, 3, 4], 3)[3]).toBe(100);
    expect(rsi([5, 5, 5, 5], 3)[3]).toBe(50);
  });

  it("VWAP weights the typical price by volume and resets each IST day", () => {
    const d1 = Date.parse("2026-11-18T04:00:00Z");
    const d2 = Date.parse("2026-11-19T04:00:00Z");
    const candles: Candle[] = [
      [d1, 10, 12, 9, 9, 100],
      [d1 + 60_000, 10, 13, 10, 13, 300],
      [d2, 50, 51, 49, 50, 10],
    ];
    const out = vwap(candles, istDay);
    expect(out[0]).toBeCloseTo(10, 10);
    expect(out[1]).toBeCloseTo((10 * 100 + 12 * 300) / 400, 10);
    expect(out[2]).toBeCloseTo(50, 10);
  });
});
