/** The subset of Redis the alert index uses, with real score-bound semantics ("(" = exclusive). */
export class FakeRedis {
  private readonly h = new Map<string, Map<string, string>>();
  private readonly s = new Map<string, Set<string>>();
  private readonly z = new Map<string, Map<string, number>>();
  private readonly kv = new Map<string, { v: string; until: number }>();
  now = () => Date.now();

  private hash(k: string) {
    let m = this.h.get(k);
    if (!m) this.h.set(k, (m = new Map()));
    return m;
  }
  private set_(k: string) {
    let m = this.s.get(k);
    if (!m) this.s.set(k, (m = new Set()));
    return m;
  }
  private zset(k: string) {
    let m = this.z.get(k);
    if (!m) this.z.set(k, (m = new Map()));
    return m;
  }

  async hget(k: string, f: string) {
    return this.h.get(k)?.get(f) ?? null;
  }
  async hmget(k: string, ...fs: string[]) {
    return fs.map((f) => this.h.get(k)?.get(f) ?? null);
  }
  async hset(k: string, f: string | Record<string, string>, v?: string) {
    const m = this.hash(k);
    if (typeof f === "string") m.set(f, v!);
    else for (const [a, b] of Object.entries(f)) m.set(a, b);
    return 1;
  }
  async hdel(k: string, f: string) {
    return this.h.get(k)?.delete(f) ? 1 : 0;
  }
  async sadd(k: string, m: string) {
    this.set_(k).add(m);
    return 1;
  }
  async srem(k: string, m: string) {
    return this.s.get(k)?.delete(m) ? 1 : 0;
  }
  async smembers(k: string) {
    return [...(this.s.get(k) ?? [])];
  }
  async zadd(k: string, score: number, m: string) {
    this.zset(k).set(m, score);
    return 1;
  }
  async zrem(k: string, m: string) {
    return this.z.get(k)?.delete(m) ? 1 : 0;
  }
  async zrangebyscore(k: string, min: string, max: string) {
    const lo = (v: number) => (min.startsWith("(") ? v > Number(min.slice(1)) : v >= Number(min));
    const hi = (v: number) => (max.startsWith("(") ? v < Number(max.slice(1)) : v <= Number(max));
    return [...(this.z.get(k) ?? [])].filter(([, v]) => lo(v) && hi(v)).sort((a, b) => a[1] - b[1]).map(([m]) => m);
  }
  async del(k: string) {
    const had = this.kv.delete(k) || this.s.delete(k) || this.h.delete(k) || this.z.delete(k);
    return had ? 1 : 0;
  }
  async set(k: string, v: string, ex: "EX", ttl: number, nx: "NX") {
    void ex;
    void nx;
    const cur = this.kv.get(k);
    if (cur && cur.until > this.now()) return null;
    this.kv.set(k, { v, until: this.now() + ttl * 1_000 });
    return "OK";
  }
  multi() {
    const ops: (() => Promise<unknown>)[] = [];
    const self = this;
    const chain = new Proxy({} as Record<string, unknown>, {
      get(_t, name: string) {
        if (name === "exec") return async () => Promise.all(ops.map(async (op) => [null, await op()]));
        return (...args: unknown[]) => {
          ops.push(() => (self as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name]!(...args));
          return chain;
        };
      },
    });
    return chain;
  }
}
