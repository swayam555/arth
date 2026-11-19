import { ema, istDay, rsi, sma, vwap, type Candle, type Series } from "@arth/market";

export interface OverlaySet {
  sma20: Series;
  ema50: Series;
  vwap: Series;
  rsi14: Series;
}

export function computeOverlays(candles: readonly Candle[], intraday: boolean): OverlaySet {
  const closes = candles.map((c) => c[4]);
  return {
    sma20: sma(closes, 20),
    ema50: ema(closes, 50),
    vwap: intraday ? vwap(candles, istDay) : new Array<number | null>(candles.length).fill(null),
    rsi14: rsi(closes, 14),
  };
}

const IST_MIN = 330;

/** "14:35" for intraday bars, "18 Nov" for daily; pure arithmetic so it runs inside a worklet. */
export function formatBarTime(t: number, daily: boolean): string {
  "worklet";
  const minutes = Math.floor(t / 60_000) + IST_MIN;
  if (!daily) {
    const m = ((minutes % 1440) + 1440) % 1440;
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    return `${hh < 10 ? "0" : ""}${hh}:${mm < 10 ? "0" : ""}${mm}`;
  }
  const days = Math.floor(minutes / 1440);
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${MONTHS[month - 1]}`;
}

export function compactVolume(v: number): string {
  "worklet";
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(2)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${Math.round(v)}`;
}
