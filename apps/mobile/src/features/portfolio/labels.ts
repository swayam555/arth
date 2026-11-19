import type { TFunction } from "i18next";

export type AllocationBy = "sector" | "mcap" | "asset";

export function sliceLabel(t: TFunction, by: AllocationBy, key: string): string {
  if (by === "mcap") return t(`portfolio.mcap.${key}`, { defaultValue: key });
  if (by === "asset") return t(`portfolio.asset.${key}`, { defaultValue: key.toUpperCase() });
  return key;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatInr = (n: number, precise = false) => (precise ? inr2 : inr).format(n);
export const formatSignedInr = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${inr.format(Math.abs(n))}`;
export const formatQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, ""));
