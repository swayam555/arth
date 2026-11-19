/**
 * A price range a series of ticks swept through. `up` ranges are `(lo, hi]` (thresholds an upward move reached),
 * `down` ranges are `[lo, hi)` (thresholds a downward move reached).
 */
export interface Range {
  lo: number;
  hi: number;
}

export interface Sweep {
  up: Range[];
  down: Range[];
}

function merge(ranges: Range[]): Range[] {
  if (ranges.length < 2) return ranges;
  const sorted = [...ranges].sort((a, b) => a.lo - b.lo);
  const out: Range[] = [{ ...sorted[0]! }];
  for (const r of sorted.slice(1)) {
    const last = out[out.length - 1]!;
    if (r.lo <= last.hi) last.hi = Math.max(last.hi, r.hi);
    else out.push({ ...r });
  }
  return out;
}

/**
 * Every threshold crossed by moving from `prev` through `prices` in order. Each step is evaluated, so a spike that
 * reverts inside one batch (99 → 101 → 99) still counts as a crossing of 100 in both directions.
 */
export function sweep(prev: number, prices: readonly number[]): Sweep {
  const up: Range[] = [];
  const down: Range[] = [];
  let p = prev;
  for (const c of prices) {
    if (c > p) up.push({ lo: p, hi: c });
    else if (c < p) down.push({ lo: c, hi: p });
    p = c;
  }
  return { up: merge(up), down: merge(down) };
}

/** Distance from the previous close in percent, the axis `pct_move` alerts are indexed on. */
export function movePct(price: number, prevClose: number): number {
  return prevClose > 0 ? (Math.abs(price - prevClose) / prevClose) * 100 : 0;
}

export function inUp(r: Range, v: number): boolean {
  return v > r.lo && v <= r.hi;
}

export function inDown(r: Range, v: number): boolean {
  return v >= r.lo && v < r.hi;
}
