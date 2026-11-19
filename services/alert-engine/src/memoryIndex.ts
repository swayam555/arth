import { inDown, inUp } from "./crossing.js";
import type { AlertDef, AlertIndex, AlertKind } from "./model.js";

/** Same contract as the Redis index; used by tests and by `INDEX=memory` single-replica runs. */
export class MemoryIndex implements AlertIndex {
  private readonly defs = new Map<string, AlertDef>();
  private readonly claims = new Map<string, number>();
  private readonly last = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  async upsert(def: AlertDef): Promise<void> {
    this.defs.set(def.id, { ...def });
  }

  async remove(id: string): Promise<void> {
    this.defs.delete(id);
  }

  async removeUser(userId: string): Promise<number> {
    let n = 0;
    for (const [id, d] of this.defs) if (d.userId === userId && this.defs.delete(id)) n++;
    return n;
  }

  async ids(): Promise<string[]> {
    return [...this.defs.keys()];
  }

  async query(symbol: string, kind: AlertKind, dir: "up" | "down", ranges: { lo: number; hi: number }[]): Promise<AlertDef[]> {
    const test = dir === "up" ? inUp : inDown;
    return [...this.defs.values()].filter((d) => d.symbol === symbol && d.kind === kind && ranges.some((r) => test(r, d.value)));
  }

  async claim(id: string, ttlSec: number): Promise<boolean> {
    const until = this.claims.get(id);
    if (until !== undefined && until > this.now()) return false;
    this.claims.set(id, this.now() + ttlSec * 1_000);
    return true;
  }

  async release(id: string): Promise<void> {
    this.claims.delete(id);
  }

  async lastPrices(symbols: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const s of symbols) {
      const p = this.last.get(s);
      if (p !== undefined) out.set(s, p);
    }
    return out;
  }

  async setLastPrices(prices: Map<string, number>): Promise<void> {
    for (const [s, p] of prices) this.last.set(s, p);
  }
}
