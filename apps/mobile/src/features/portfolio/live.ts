import type { Schemas } from "@arth/api-client";
import type { LiveQuote } from "@/features/market/tickStore";

export type Summary = Schemas["Summary"];
export type Holding = Schemas["Holding"];
export type Slice = Schemas["Slice"];

const MOVERS = 3;

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (num: number, den: number) => (den ? round2((num / den) * 100) : 0);

/**
 * Reprices a server summary with streamed quotes. Quantities, cost and realised P&L come from the server;
 * only price-driven fields move, so the screen ticks without refetching.
 */
export function livePortfolio(summary: Summary, quotes: Readonly<Record<string, LiveQuote | undefined>>): Summary {
  let touched = false;
  const holdings = summary.holdings.map((h) => {
    const q = quotes[h.symbol];
    if (!q || q.ltp <= 0) return h;
    touched = true;
    const prevClose = q.prevClose > 0 ? q.prevClose : h.prevClose;
    const value = round2(q.ltp * h.qty);
    const dayChange = round2((q.ltp - prevClose) * h.qty);
    const pnl = round2(value - h.invested);
    return {
      ...h,
      ltp: q.ltp,
      prevClose,
      value,
      dayChange,
      dayChangePct: pct(q.ltp - prevClose, prevClose),
      pnl,
      pnlPct: pct(pnl, h.invested),
      live: true,
    };
  });
  if (!touched) return summary;

  const value = round2(holdings.reduce((s, h) => s + h.value, 0));
  const dayChange = round2(holdings.reduce((s, h) => s + h.dayChange, 0));
  const weighted = holdings.map((h) => ({ ...h, weight: value ? h.value / value : 0 }));
  const byDay = [...weighted].sort((a, b) => b.dayChangePct - a.dayChangePct);

  return {
    ...summary,
    holdings: weighted,
    value,
    dayChange,
    dayChangePct: pct(dayChange, value - dayChange),
    pnl: round2(value - summary.invested),
    pnlPct: pct(value - summary.invested, summary.invested),
    allocation: {
      sector: allocate(weighted, (h) => h.sector, value),
      mcap: allocate(weighted, (h) => h.mcapBucket, value),
      asset: allocate(weighted, (h) => h.assetClass, value),
    },
    gainers: byDay.filter((h) => h.dayChangePct > 0).slice(0, MOVERS),
    losers: byDay.filter((h) => h.dayChangePct < 0).reverse().slice(0, MOVERS),
  };
}

export function allocate(holdings: readonly Holding[], key: (h: Holding) => string, total: number): Slice[] {
  const sums = new Map<string, number>();
  for (const h of holdings) sums.set(key(h), (sums.get(key(h)) ?? 0) + h.value);
  return [...sums]
    .map(([k, v]) => ({ key: k, value: round2(v), weight: total ? v / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

/** Groups the tail of a long allocation into one "Other" slice so the donut stays legible. */
export function topSlices(slices: readonly Slice[], max: number, otherLabel: string): Slice[] {
  if (slices.length <= max) return [...slices];
  const head = slices.slice(0, max - 1);
  const tail = slices.slice(max - 1);
  return [...head, { key: otherLabel, value: round2(tail.reduce((s, x) => s + x.value, 0)), weight: tail.reduce((s, x) => s + x.weight, 0) }];
}
