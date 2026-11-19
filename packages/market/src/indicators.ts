/** Candle tuple: [time ms, open, high, low, close, volume]. */
export type Candle = [t: number, o: number, h: number, l: number, c: number, v: number];

export type Series = (number | null)[];

export function sma(values: readonly number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` values, alpha = 2 / (period + 1). */
export function ema(values: readonly number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i]!;
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI: first average is a simple mean of `period` changes, then smoothed by (n-1)/n. */
export function rsi(closes: readonly number[], period = 14): Series {
  const out: Series = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = value();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = value();
  }
  return out;
}

/** Volume-weighted average of the typical price (h+l+c)/3, reset whenever `sessionKey` changes. */
export function vwap(candles: readonly Candle[], sessionKey: (t: number) => number): Series {
  const out: Series = new Array(candles.length).fill(null);
  let key = Number.NaN;
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < candles.length; i++) {
    const [t, , h, l, c, v] = candles[i]!;
    const k = sessionKey(t);
    if (k !== key) {
      key = k;
      pv = 0;
      vol = 0;
    }
    pv += ((h + l + c) / 3) * v;
    vol += v;
    out[i] = vol > 0 ? pv / vol : c;
  }
  return out;
}

const IST_MS = 330 * 60_000;
/** IST calendar day index, for resetting VWAP each trading session. */
export const istDay = (t: number): number => Math.floor((t + IST_MS) / 86_400_000);
