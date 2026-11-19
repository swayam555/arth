export const ALERT_KINDS = ["above", "below", "pct_move"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const MAX_ACTIVE = 50;
export const PCT_MIN = 0.5;
export const PCT_MAX = 50;

export type AlertValueError = "invalid" | "pctRange" | "alreadyAbove" | "alreadyBelow";

/** Mirrors the API's checks, plus a guard against thresholds the price is already past (they would never cross). */
export function parseAlertValue(kind: AlertKind, raw: string, ltp: number | undefined): { value: number } | { error: AlertValueError } {
  const value = Number(raw.replace(/[,\s₹%]/g, ""));
  if (!raw.trim() || !Number.isFinite(value) || value <= 0) return { error: "invalid" };
  if (kind === "pct_move") return value < PCT_MIN || value > PCT_MAX ? { error: "pctRange" } : { value: Math.round(value * 100) / 100 };
  if (ltp && kind === "above" && value <= ltp) return { error: "alreadyAbove" };
  if (ltp && kind === "below" && value >= ltp) return { error: "alreadyBelow" };
  return { value: Math.round(value * 100) / 100 };
}

export function activeCount(alerts: readonly { active: boolean }[]): number {
  return alerts.reduce((n, a) => n + (a.active ? 1 : 0), 0);
}
