const price = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" });
const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

export const formatPrice = (n: number) => price.format(n);

export function change(ltp: number, prevClose: number): { abs: number; pct: number } {
  const abs = ltp - prevClose;
  return { abs, pct: prevClose ? (abs / prevClose) * 100 : 0 };
}

export const formatPct = (n: number) => `${pct.format(n)}%`;
export const formatChange = (n: number) => `${n > 0 ? "+" : ""}${price.format(n)}`;
export const formatVolume = (n: number) => compact.format(n);
