import type { TxnBody } from "./queries";

export interface TxnDraft {
  symbol: string;
  side: "BUY" | "SELL";
  qty: string;
  price: string;
  date: string;
}

export type TxnErrors = Partial<Record<"symbol" | "qty" | "price" | "date", "invalidSymbol" | "invalidQty" | "invalidPrice" | "invalidDate">>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SYMBOL = /^[A-Z0-9&-]{1,20}$/;

export const todayIso = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

function validDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

const num = (s: string) => Number(s.replace(/,/g, "").trim());

/** Client-side checks mirror the API's; future dates, oversells and unknown symbols are left to the server. */
export function parseTxn(d: TxnDraft): { body?: TxnBody; errors: TxnErrors } {
  const errors: TxnErrors = {};
  const symbol = d.symbol.trim().toUpperCase();
  const qty = num(d.qty);
  const price = num(d.price);
  if (!SYMBOL.test(symbol)) errors.symbol = "invalidSymbol";
  if (!(qty > 0) || !Number.isFinite(qty)) errors.qty = "invalidQty";
  if (!(price > 0) || !Number.isFinite(price)) errors.price = "invalidPrice";
  if (!validDate(d.date.trim())) errors.date = "invalidDate";
  if (Object.keys(errors).length) return { errors };
  return { body: { symbol, side: d.side, qty, price, tradeDate: d.date.trim() }, errors };
}
