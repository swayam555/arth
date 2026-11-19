import { create, toBinary, TickSchema } from "@arth/proto";
import type { Quote } from "@arth/market";

export function encodeTick(q: Quote): Uint8Array {
  return toBinary(
    TickSchema,
    create(TickSchema, {
      symbol: q.symbol,
      ltp: q.ltp,
      volume: BigInt(q.volume),
      bids: q.bids.map((l) => ({ price: l.price, quantity: BigInt(l.qty) })),
      asks: q.asks.map((l) => ({ price: l.price, quantity: BigInt(l.qty) })),
      tsMs: BigInt(q.tsMs),
      seq: BigInt(q.seq),
      prevClose: q.prevClose,
      open: q.open,
      high: q.high,
      low: q.low,
    }),
  );
}
