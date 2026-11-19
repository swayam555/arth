import { inDown, inUp, movePct, sweep, type Range } from "./crossing.js";
import type { AlertDef, AlertIndex, AlertKind, AlertStore, Fired, Tick } from "./model.js";

export interface EngineStats {
  evaluated: number;
  candidates: number;
  fired: number;
  suppressed: number;
}

interface Candidate {
  def: AlertDef;
  price: number;
  tsMs: number;
}

/**
 * Evaluates batches of ticks against the index. A batch is grouped per symbol in arrival order, the swept price ranges
 * are merged, and the index is queried once per symbol/kind/direction. A candidate fires only if it wins the
 * cooldown claim and the conditional update in Postgres, which makes firing idempotent across replays and replicas.
 */
export class Engine {
  readonly stats: EngineStats = { evaluated: 0, candidates: 0, fired: 0, suppressed: 0 };
  private readonly last = new Map<string, number>();

  constructor(
    private readonly index: AlertIndex,
    private readonly store: AlertStore,
    private readonly publish: (f: Fired) => Promise<void>,
    private readonly cooldownSec = 900,
  ) {}

  async process(ticks: readonly Tick[]): Promise<Fired[]> {
    if (!ticks.length) return [];
    this.stats.evaluated += ticks.length;
    const bySymbol = new Map<string, Tick[]>();
    for (const t of ticks) {
      const list = bySymbol.get(t.symbol);
      if (list) list.push(t);
      else bySymbol.set(t.symbol, [t]);
    }
    const unknown = [...bySymbol.keys()].filter((s) => !this.last.has(s));
    if (unknown.length) for (const [s, p] of await this.index.lastPrices(unknown)) this.last.set(s, p);

    const candidates = new Map<string, Candidate>();
    const updates = new Map<string, number>();
    await Promise.all(
      [...bySymbol].map(async ([symbol, series]) => {
        const lastTick = series[series.length - 1]!;
        updates.set(symbol, lastTick.ltp);
        const prev = this.last.get(symbol);
        if (prev === undefined) {
          series = series.slice(1);
          if (!series.length) return;
        }
        const start = prev ?? series[0]!.ltp;
        const prices = series.map((t) => t.ltp);
        const s = sweep(start, prices);
        const pc = lastTick.prevClose;
        const pct = sweep(movePct(start, pc), prices.map((p) => movePct(p, pc)));
        const found = await Promise.all([
          this.find(symbol, "above", "up", s.up),
          this.find(symbol, "below", "down", s.down),
          this.find(symbol, "pct_move", "up", pct.up),
        ]);
        for (const def of found.flat()) {
          if (candidates.has(def.id)) continue;
          const hit = series.find((t, i) => crossedAt(def, i === 0 ? start : series[i - 1]!.ltp, t.ltp, pc));
          const t = hit ?? lastTick;
          candidates.set(def.id, { def, price: t.ltp, tsMs: t.tsMs });
        }
      }),
    );

    const fired: Fired[] = [];
    for (const c of candidates.values()) {
      this.stats.candidates++;
      if (!(await this.index.claim(c.def.id, this.cooldownSec))) {
        this.stats.suppressed++;
        continue;
      }
      const f: Fired = { ...c.def, triggerPrice: c.price, tsMs: c.tsMs };
      try {
        const ok = await this.store.fire(f, this.publish);
        await this.index.remove(c.def.id);
        if (ok) {
          fired.push(f);
          this.stats.fired++;
        } else {
          this.stats.suppressed++;
        }
      } catch (err) {
        await this.index.release(c.def.id);
        throw err;
      }
    }
    for (const [s, p] of updates) this.last.set(s, p);
    await this.index.setLastPrices(updates);
    return fired;
  }

  /** Re-reads one alert after the api announced a change. */
  async refresh(id: string): Promise<void> {
    const def = await this.store.get(id);
    if (def) await this.index.upsert(def);
    else await this.index.remove(id);
  }

  /** Full resync from Postgres: heals anything a missed pub/sub message left stale. */
  async resync(): Promise<{ armed: number; dropped: number }> {
    const active = await this.store.active();
    const keep = new Set(active.map((a) => a.id));
    let dropped = 0;
    for (const id of await this.index.ids()) {
      if (!keep.has(id)) {
        await this.index.remove(id);
        dropped++;
      }
    }
    for (const a of active) await this.index.upsert(a);
    return { armed: active.length, dropped };
  }

  async purgeUser(userId: string): Promise<number> {
    return this.index.removeUser(userId);
  }

  private find(symbol: string, kind: AlertKind, dir: "up" | "down", ranges: Range[]): Promise<AlertDef[]> {
    return ranges.length ? this.index.query(symbol, kind, dir, ranges) : Promise.resolve([]);
  }
}

function crossedAt(def: AlertDef, from: number, to: number, prevClose: number): boolean {
  switch (def.kind) {
    case "above":
      return to > from && inUp({ lo: from, hi: to }, def.value);
    case "below":
      return to < from && inDown({ lo: to, hi: from }, def.value);
    case "pct_move": {
      const a = movePct(from, prevClose);
      const b = movePct(to, prevClose);
      return b > a && inUp({ lo: a, hi: b }, def.value);
    }
  }
}
