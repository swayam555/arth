import type { Candle } from "@arth/market";
import { bucketStart, mergeNewer, mergeOlder, mergeTick, volumeDelta } from "@/features/chart/candles";
import { compactVolume, computeOverlays, formatBarTime } from "@/features/chart/overlays";
import { MAX_BARS, MIN_BARS, clampViewport, indexAt, pan, priceRange, visibleRange, xOf, zoom } from "@/features/chart/viewport";

const IST_0930 = Date.UTC(2026, 10, 18, 4, 0); // 09:30 IST
const MIN = 60_000;

describe("bucketStart", () => {
  it("floors minutes on the epoch grid", () => {
    expect(bucketStart(IST_0930 + 4 * MIN + 59_000, "5m")).toBe(IST_0930);
    expect(bucketStart(IST_0930 + 59_999, "1m")).toBe(IST_0930);
    expect(bucketStart(IST_0930 + 14 * MIN, "15m")).toBe(IST_0930);
  });

  it("anchors hourly bars at 09:15 IST and daily bars at IST midnight", () => {
    expect(bucketStart(IST_0930, "1h")).toBe(IST_0930 - 15 * MIN);
    expect(bucketStart(IST_0930 + 50 * MIN, "1h")).toBe(IST_0930 + 45 * MIN);
    expect(bucketStart(IST_0930, "1d")).toBe(Date.UTC(2026, 10, 17, 18, 30));
  });
});

describe("candle merging", () => {
  const base: Candle[] = [
    [IST_0930, 100, 101, 99, 100.5, 10],
    [IST_0930 + MIN, 100.5, 102, 100, 101, 20],
  ];

  it("updates the forming bar, opens a new one, and ignores stale prints", () => {
    const a = mergeTick(base, 103, IST_0930 + MIN + 30_000, 5, "1m");
    expect(a[1]).toEqual([IST_0930 + MIN, 100.5, 103, 100, 103, 25]);
    const b = mergeTick(a, 99.5, IST_0930 + 2 * MIN, 7, "1m");
    expect(b).toHaveLength(3);
    expect(b[2]).toEqual([IST_0930 + 2 * MIN, 99.5, 99.5, 99.5, 99.5, 7]);
    expect(mergeTick(b, 50, IST_0930, 1, "1m")).toBe(b);
    expect(base[1]![4]).toBe(101);
  });

  it("prepends older pages without duplicates and lets fresh rows replace the tail", () => {
    const older: Candle[] = [
      [IST_0930 - MIN, 99, 100, 98, 99.5, 3],
      [IST_0930, 0, 0, 0, 0, 0],
    ];
    expect(mergeOlder(base, older).map((c) => c[0])).toEqual([IST_0930 - MIN, IST_0930, IST_0930 + MIN]);
    expect(mergeOlder(base, [[IST_0930, 1, 1, 1, 1, 1]])).toBe(base);
    const fresh: Candle[] = [[IST_0930 + MIN, 100.5, 104, 100, 104, 40]];
    expect(mergeNewer(base, fresh)).toEqual([base[0], fresh[0]]);
    expect(mergeNewer([], fresh)).toEqual(fresh);
  });

  it("turns cumulative volume into deltas and survives a session reset", () => {
    expect(volumeDelta(null, 500)).toBe(0);
    expect(volumeDelta(500, 650)).toBe(150);
    expect(volumeDelta(650, 40)).toBe(40);
  });
});

describe("viewport", () => {
  const W = 300;

  it("clamps bar count and offset", () => {
    expect(clampViewport({ offset: -5, count: 2 }, 100)).toEqual({ offset: 0, count: MIN_BARS });
    expect(clampViewport({ offset: 500, count: 9_999 }, 100)).toEqual({ offset: 100 - MIN_BARS, count: MAX_BARS });
  });

  it("pans by whole slots and maps x to index both ways", () => {
    const v = { offset: 0, count: 30 };
    expect(pan(v, 50, W, 200).offset).toBeCloseTo(5);
    expect(pan(v, -50, W, 200).offset).toBe(0);
    expect(xOf(199, v, 200, W)).toBe(W - 5);
    for (const i of [170, 185, 199]) expect(indexAt(xOf(i, v, 200, W), v, 200, W)).toBe(i);
    expect(visibleRange(v, 200)).toEqual({ from: 170, to: 199 });
    expect(visibleRange({ offset: 10.5, count: 30 }, 200)).toEqual({ from: 159, to: 189 });
  });

  it("zooms around the focal bar", () => {
    const v = { offset: 20, count: 60 };
    const focalX = 100;
    const before = indexAt(focalX, v, 500, W);
    const z = zoom(v, 2, focalX, W, 500);
    expect(z.count).toBe(30);
    expect(Math.abs(indexAt(focalX, z, 500, W) - before)).toBeLessThanOrEqual(1);
    expect(zoom(v, 0, focalX, W, 500)).toBe(v);
  });

  it("pads the price range and handles flat or empty windows", () => {
    const flat: Candle[] = [[0, 100, 100, 100, 100, 1]];
    const r = priceRange(flat, 0, 0);
    expect(r.min).toBeLessThan(100);
    expect(r.max).toBeGreaterThan(100);
    expect(priceRange([], 0, 0)).toEqual({ min: 0, max: 1 });
  });
});

describe("overlays and labels", () => {
  it("computes indicator series aligned to candles, with no VWAP on daily bars", () => {
    const candles: Candle[] = Array.from({ length: 60 }, (_, i) => [IST_0930 + i * MIN, 100 + i, 101 + i, 99 + i, 100 + i, 10]);
    const intraday = computeOverlays(candles, true);
    expect(intraday.sma20).toHaveLength(60);
    expect(intraday.sma20[18]).toBeNull();
    expect(intraday.sma20[19]).toBeCloseTo(109.5);
    expect(intraday.vwap[0]).toBeCloseTo(100);
    expect(computeOverlays(candles, false).vwap.every((v) => v === null)).toBe(true);
  });

  it("formats IST bar times and Indian volume units", () => {
    expect(formatBarTime(IST_0930, false)).toBe("09:30");
    expect(formatBarTime(Date.UTC(2026, 10, 17, 18, 30), true)).toBe("18 Nov");
    expect(compactVolume(2_50_00_000)).toMatch(/2\.5.*Cr/);
    expect(compactVolume(1_20_000)).toMatch(/1\.2.*L/);
    expect(compactVolume(950)).toBe("950");
  });
});
