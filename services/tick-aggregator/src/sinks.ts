import { ltpKey, tickChannel } from "@arth/market";
import { CandleSchema, create, toBinary } from "@arth/proto";
import type { Redis } from "ioredis";
import { pack } from "msgpackr";
import type { Sql } from "postgres";
import { toRedisTick, type Candle, type TickIn } from "./aggregator.js";

/** One pipeline per flush: refresh the `ltp:{SYM}` hash and fan the tick out on `tick:{SYM}`. */
export async function publishQuotes(redis: Redis, ticks: TickIn[]): Promise<void> {
  if (!ticks.length) return;
  const p = redis.pipeline();
  for (const t of ticks) {
    p.hset(ltpKey(t.symbol), {
      ltp: t.ltp,
      open: t.open,
      high: t.high,
      low: t.low,
      prevClose: t.prevClose,
      volume: t.volume,
      ts: t.tsMs,
    });
    p.publish(tickChannel(t.symbol), pack(toRedisTick(t)));
  }
  const results = await p.exec();
  const failed = results?.find(([err]) => err);
  if (failed) throw failed[0];
}

/** Idempotent upsert: a replayed or late-split candle widens the stored bar instead of duplicating it. */
export async function storeCandles(sql: Sql, candles: Candle[]): Promise<void> {
  if (!candles.length) return;
  const rows = candles.map((c) => ({
    symbol: c.symbol,
    bucket: new Date(c.bucketMs),
    o: c.o,
    h: c.h,
    l: c.l,
    c: c.c,
    v: c.v,
  }));
  await sql`
    insert into candles_1m ${sql(rows)}
    on conflict (symbol, bucket) do update set
      h = greatest(candles_1m.h, excluded.h),
      l = least(candles_1m.l, excluded.l),
      c = excluded.c,
      v = greatest(candles_1m.v, excluded.v)`;
}

export function encodeCandle(c: Candle): Uint8Array {
  return toBinary(
    CandleSchema,
    create(CandleSchema, {
      symbol: c.symbol,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
      volume: BigInt(c.v),
      bucketStartMs: BigInt(c.bucketMs),
    }),
  );
}
