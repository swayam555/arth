import type { Candle } from "@arth/market";

export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const IST = 330 * MIN;
const HOUR_ORIGIN = 45 * MIN;

export const TF_MS: Record<Timeframe, number> = { "1m": MIN, "5m": 5 * MIN, "15m": 15 * MIN, "1h": HOUR, "1d": DAY };

/** Mirrors the server's time_bucket(): minutes on the epoch grid, hours from 09:15 IST, days at IST midnight. */
export function bucketStart(tsMs: number, tf: Timeframe): number {
  const size = TF_MS[tf];
  if (tf === "1d") return Math.floor((tsMs + IST) / DAY) * DAY - IST;
  if (tf === "1h") return Math.floor((tsMs - HOUR_ORIGIN) / HOUR) * HOUR + HOUR_ORIGIN;
  return Math.floor(tsMs / size) * size;
}

/** Folds one live print into the series; returns the same array when the tick is older than the last bucket. */
export function mergeTick(candles: readonly Candle[], price: number, tsMs: number, volumeDelta: number, tf: Timeframe): readonly Candle[] {
  const t = bucketStart(tsMs, tf);
  const last = candles[candles.length - 1];
  if (last && t < last[0]) return candles;
  if (last && t === last[0]) {
    const next = candles.slice();
    next[next.length - 1] = [t, last[1], Math.max(last[2], price), Math.min(last[3], price), price, last[5] + volumeDelta];
    return next;
  }
  return [...candles, [t, price, price, price, price, volumeDelta]];
}

/** Prepends an older page, dropping any overlap with what is already loaded. */
export function mergeOlder(current: readonly Candle[], older: readonly Candle[]): readonly Candle[] {
  if (!current.length) return older;
  const first = current[0]![0];
  const head = older.filter((c) => c[0] < first);
  return head.length ? [...head, ...current] : current;
}

/** Replaces the overlapping tail with fresher server rows (the cache may hold a partially-built last bucket). */
export function mergeNewer(current: readonly Candle[], fresh: readonly Candle[]): readonly Candle[] {
  if (!fresh.length) return current;
  const from = fresh[0]![0];
  const keep = current.filter((c) => c[0] < from);
  return [...keep, ...fresh];
}

/** Cumulative day volume to per-print delta; a drop means a new session started. */
export function volumeDelta(prev: number | null, next: number): number {
  if (prev === null) return 0;
  return next >= prev ? next - prev : next;
}
