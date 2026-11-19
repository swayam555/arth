const IST_OFFSET_MIN = 330;
export const OPEN_MIN = 9 * 60 + 15;
export const CLOSE_MIN = 15 * 60 + 30;

export function istMinuteOfDay(tsMs: number): number {
  const m = Math.floor(tsMs / 60_000) + IST_OFFSET_MIN;
  return ((m % 1440) + 1440) % 1440;
}

export function istDayOfWeek(tsMs: number): number {
  return new Date(tsMs + IST_OFFSET_MIN * 60_000).getUTCDay();
}

export function isMarketOpen(tsMs: number): boolean {
  const dow = istDayOfWeek(tsMs);
  if (dow === 0 || dow === 6) return false;
  const m = istMinuteOfDay(tsMs);
  return m >= OPEN_MIN && m < CLOSE_MIN;
}

/** Intraday volatility multiplier: high at the open and close, lowest around midday (a U shape). */
export function intradayVolFactor(tsMs: number, alwaysOpen = false): number {
  const m = istMinuteOfDay(tsMs);
  const span = CLOSE_MIN - OPEN_MIN;
  const x = alwaysOpen ? (m % span) / span : Math.min(Math.max((m - OPEN_MIN) / span, 0), 1);
  return 0.6 + 4.8 * (x - 0.5) ** 2;
}
