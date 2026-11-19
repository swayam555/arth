import { allocate, livePortfolio, topSlices, type Holding, type Summary } from "@/features/portfolio/live";
import { parseTxn, todayIso } from "@/features/portfolio/txnForm";
import { formatSignedInr, formatQty } from "@/features/portfolio/labels";
import type { LiveQuote } from "@/features/market/tickStore";

const holding = (symbol: string, qty: number, avg: number, ltp: number, prevClose: number, sector = "IT", mcap = "large"): Holding => ({
  symbol,
  name: symbol,
  sector,
  mcapBucket: mcap,
  assetClass: "equity",
  qty,
  avgCost: avg,
  invested: qty * avg,
  ltp,
  prevClose,
  value: qty * ltp,
  dayChange: (ltp - prevClose) * qty,
  dayChangePct: ((ltp - prevClose) / prevClose) * 100,
  pnl: qty * (ltp - avg),
  pnlPct: ((ltp - avg) / avg) * 100,
  weight: 0,
  live: false,
});

function summaryOf(holdings: Holding[]): Summary {
  const value = holdings.reduce((s, h) => s + h.value, 0);
  const invested = holdings.reduce((s, h) => s + h.invested, 0);
  return {
    holdings,
    value,
    invested,
    dayChange: 0,
    dayChangePct: 0,
    pnl: value - invested,
    pnlPct: 0,
    realized: 250,
    xirr: 0.12,
    version: 3,
    txnCount: 4,
    allocation: { sector: [], mcap: [], asset: [] },
    gainers: [],
    losers: [],
  };
}

const q = (ltp: number, prevClose: number): LiveQuote => ({ ltp, prevClose, volume: 1, high: ltp, low: ltp, open: prevClose, tsMs: 1, dir: 0 }) as LiveQuote;

describe("livePortfolio", () => {
  const base = summaryOf([holding("TCS", 10, 3000, 4000, 3900), holding("SBIN", 100, 700, 800, 820, "Banking", "large"), holding("IRFC", 50, 100, 120, 118, "Finance", "mid")]);

  it("returns the server summary untouched without quotes", () => {
    expect(livePortfolio(base, {})).toBe(base);
  });

  it("reprices holdings, totals, allocation and movers from ticks", () => {
    const live = livePortfolio(base, { TCS: q(4100, 3900), SBIN: q(790, 820) });
    const tcs = live.holdings.find((h) => h.symbol === "TCS")!;
    expect(tcs.value).toBe(41_000);
    expect(tcs.dayChange).toBe(2_000);
    expect(tcs.pnl).toBe(11_000);
    expect(tcs.live).toBe(true);
    expect(live.value).toBe(41_000 + 79_000 + 6_000);
    expect(live.dayChange).toBe(2_000 - 3_000 + 100);
    expect(live.pnl).toBe(live.value - base.invested);
    expect(live.realized).toBe(250);
    expect(live.xirr).toBe(0.12);
    expect(live.holdings.reduce((s, h) => s + h.weight, 0)).toBeCloseTo(1, 10);
    expect(live.allocation.sector[0]).toMatchObject({ key: "Banking", value: 79_000 });
    expect(live.allocation.mcap.map((s) => s.key)).toEqual(["large", "mid"]);
    expect(live.gainers.map((h) => h.symbol)).toEqual(["TCS", "IRFC"]);
    expect(live.losers.map((h) => h.symbol)).toEqual(["SBIN"]);
  });

  it("ignores zero prices and keeps server prevClose when the tick has none", () => {
    const live = livePortfolio(base, { TCS: q(0, 3900), IRFC: q(121, 0) });
    expect(live.holdings.find((h) => h.symbol === "TCS")!.value).toBe(40_000);
    const irfc = live.holdings.find((h) => h.symbol === "IRFC")!;
    expect(irfc.prevClose).toBe(118);
    expect(irfc.dayChange).toBe(150);
  });
});

describe("allocation helpers", () => {
  it("groups and sorts slices by value", () => {
    const hs = [holding("A", 1, 1, 10, 10, "X"), holding("B", 1, 1, 30, 30, "Y"), holding("C", 1, 1, 60, 60, "X")];
    expect(allocate(hs, (h) => h.sector, 100)).toEqual([
      { key: "X", value: 70, weight: 0.7 },
      { key: "Y", value: 30, weight: 0.3 },
    ]);
  });

  it("folds the tail into Other", () => {
    const slices = [5, 4, 3, 2, 1].map((v, i) => ({ key: `s${i}`, value: v, weight: v / 15 }));
    const top = topSlices(slices, 3, "Other");
    expect(top.map((s) => s.key)).toEqual(["s0", "s1", "Other"]);
    expect(top[2]!.value).toBe(6);
    expect(top.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 10);
    expect(topSlices(slices.slice(0, 2), 3, "Other")).toHaveLength(2);
  });
});

describe("trade form", () => {
  it("normalises a valid draft", () => {
    expect(parseTxn({ symbol: " tcs ", side: "SELL", qty: "1,000", price: "3,950.5", date: "2026-11-02" })).toEqual({
      body: { symbol: "TCS", side: "SELL", qty: 1000, price: 3950.5, tradeDate: "2026-11-02" },
      errors: {},
    });
  });

  it("flags every bad field", () => {
    const { body, errors } = parseTxn({ symbol: "bad sym!", side: "BUY", qty: "0", price: "abc", date: "2026-02-30" });
    expect(body).toBeUndefined();
    expect(errors).toEqual({ symbol: "invalidSymbol", qty: "invalidQty", price: "invalidPrice", date: "invalidDate" });
  });

  it("formats today as a local ISO date", () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("money formatting", () => {
  it("signs rupee amounts and trims quantities", () => {
    expect(formatSignedInr(1500)).toBe("+₹1,500");
    expect(formatSignedInr(-125000)).toBe("−₹1,25,000");
    expect(formatQty(10)).toBe("10");
    expect(formatQty(1.25)).toBe("1.25");
  });
});
