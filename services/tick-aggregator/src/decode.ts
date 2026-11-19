import { fromBinary, TickSchema } from "@arth/proto";
import type { TickIn } from "./aggregator.js";

export function decodeTick(buf: Uint8Array): TickIn {
  const t = fromBinary(TickSchema, buf);
  return {
    symbol: t.symbol,
    ltp: t.ltp,
    volume: Number(t.volume),
    high: t.high,
    low: t.low,
    open: t.open,
    prevClose: t.prevClose,
    tsMs: Number(t.tsMs),
    seq: Number(t.seq),
    bids: t.bids.map((l) => [l.price, Number(l.quantity)]),
    asks: t.asks.map((l) => [l.price, Number(l.quantity)]),
  };
}
