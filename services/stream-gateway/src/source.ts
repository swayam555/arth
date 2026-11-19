import { ltpKey, tickChannel, type RedisTick } from "@arth/market";
import type { Logger } from "@arth/svc";
import type { Redis } from "ioredis";
import type { QuoteSource } from "./hub.js";

/**
 * Redis-backed quotes: per-symbol SUBSCRIBE (so N gateway replicas each pull only what their clients watch)
 * and a cold read of the `ltp:{SYM}` hash so a new subscriber gets a snapshot before the next tick.
 */
export function redisQuoteSource(redis: Redis, subscriber: Redis, log: Logger): QuoteSource {
  return {
    watch(symbol) {
      subscriber.subscribe(tickChannel(symbol)).catch((err: unknown) => log.warn({ err, symbol }, "subscribe failed"));
    },
    unwatch(symbol) {
      subscriber.unsubscribe(tickChannel(symbol)).catch((err: unknown) => log.warn({ err, symbol }, "unsubscribe failed"));
    },
    async load(symbol) {
      const h = await redis.hgetall(ltpKey(symbol));
      if (!h.ltp) return null;
      const tick: RedisTick = [
        Number(h.ltp),
        Number(h.volume ?? 0),
        Number(h.high ?? h.ltp),
        Number(h.low ?? h.ltp),
        Number(h.ts ?? 0),
        Number(h.prevClose ?? h.ltp),
        Number(h.open ?? h.ltp),
        [],
        [],
      ];
      return tick;
    },
  };
}
