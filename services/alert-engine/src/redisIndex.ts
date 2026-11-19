import type { Redis } from "ioredis";
import type { AlertDef, AlertIndex, AlertKind } from "./model.js";

const DEFS = "alerts:def";
const IDS = "alerts:ids";
const LAST = "alerts:last";
const zkey = (kind: AlertKind, symbol: string) => `alerts:${kind}:${symbol}`;
const ukey = (userId: string) => `alerts:user:${userId}`;
const ckey = (id: string) => `alerts:fired:${id}`;

/**
 * Alerts live in one sorted set per (kind, symbol) scored by threshold, so a tick batch costs one ZRANGEBYSCORE per
 * swept range regardless of how many alerts exist. Definitions sit in a hash; a per-user set supports erasure.
 */
export class RedisIndex implements AlertIndex {
  constructor(private readonly redis: Redis) {}

  async upsert(def: AlertDef): Promise<void> {
    const prev = await this.redis.hget(DEFS, def.id);
    const m = this.redis.multi();
    if (prev) {
      const p = JSON.parse(prev) as AlertDef;
      m.zrem(zkey(p.kind, p.symbol), def.id);
    }
    m.hset(DEFS, def.id, JSON.stringify(def))
      .zadd(zkey(def.kind, def.symbol), def.value, def.id)
      .sadd(ukey(def.userId), def.id)
      .sadd(IDS, def.id);
    await m.exec();
  }

  async remove(id: string): Promise<void> {
    const raw = await this.redis.hget(DEFS, id);
    if (!raw) return;
    const d = JSON.parse(raw) as AlertDef;
    await this.redis.multi().zrem(zkey(d.kind, d.symbol), id).srem(ukey(d.userId), id).srem(IDS, id).hdel(DEFS, id).exec();
  }

  async removeUser(userId: string): Promise<number> {
    const ids = await this.redis.smembers(ukey(userId));
    for (const id of ids) await this.remove(id);
    await this.redis.del(ukey(userId));
    return ids.length;
  }

  async ids(): Promise<string[]> {
    return this.redis.smembers(IDS);
  }

  async query(symbol: string, kind: AlertKind, dir: "up" | "down", ranges: { lo: number; hi: number }[]): Promise<AlertDef[]> {
    const z = zkey(kind, symbol);
    const res = await Promise.all(
      ranges.map((r) =>
        dir === "up" ? this.redis.zrangebyscore(z, `(${r.lo}`, `${r.hi}`) : this.redis.zrangebyscore(z, `${r.lo}`, `(${r.hi}`),
      ),
    );
    const ids = [...new Set(res.flat())];
    if (!ids.length) return [];
    const raws = await this.redis.hmget(DEFS, ...ids);
    return raws.flatMap((r) => (r ? [JSON.parse(r) as AlertDef] : []));
  }

  async claim(id: string, ttlSec: number): Promise<boolean> {
    return (await this.redis.set(ckey(id), "1", "EX", ttlSec, "NX")) === "OK";
  }

  async release(id: string): Promise<void> {
    await this.redis.del(ckey(id));
  }

  async lastPrices(symbols: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!symbols.length) return out;
    const vals = await this.redis.hmget(LAST, ...symbols);
    symbols.forEach((s, i) => {
      const v = vals[i];
      if (v != null) out.set(s, Number(v));
    });
    return out;
  }

  async setLastPrices(prices: Map<string, number>): Promise<void> {
    if (!prices.size) return;
    await this.redis.hset(LAST, Object.fromEntries([...prices].map(([s, p]) => [s, String(p)])));
  }
}
