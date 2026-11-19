import { AlertFiredSchema, AlertKind as PbKind, create, fromBinary, TickSchema, toBinary, UserDeletedSchema } from "@arth/proto";
import type { AlertKind, Fired, Tick } from "./model.js";

const KIND: Record<AlertKind, PbKind> = { above: PbKind.ABOVE, below: PbKind.BELOW, pct_move: PbKind.PCT_MOVE };

export function decodeTick(buf: Uint8Array): Tick {
  const t = fromBinary(TickSchema, buf);
  return { symbol: t.symbol, ltp: t.ltp, prevClose: t.prevClose, tsMs: Number(t.tsMs) };
}

export function encodeFired(f: Fired): Uint8Array {
  return toBinary(
    AlertFiredSchema,
    create(AlertFiredSchema, {
      alertId: f.id,
      userId: f.userId,
      symbol: f.symbol,
      kind: KIND[f.kind],
      threshold: f.value,
      triggerPrice: f.triggerPrice,
      tsMs: BigInt(f.tsMs),
    }),
  );
}

export function decodeUserDeleted(buf: Uint8Array): string {
  return fromBinary(UserDeletedSchema, buf).userId;
}
