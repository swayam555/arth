import type { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { sweep } from "../src/crossing.js";
import { Engine } from "../src/engine.js";
import { MemoryIndex } from "../src/memoryIndex.js";
import type { AlertDef, AlertIndex, AlertStore, Fired, Tick } from "../src/model.js";
import { RedisIndex } from "../src/redisIndex.js";
import { FakeRedis } from "./fakeRedis.js";

class FakeStore implements AlertStore {
  readonly rows = new Map<string, AlertDef & { active: boolean }>();
  failPublish = false;
  add(d: AlertDef): AlertDef {
    this.rows.set(d.id, { ...d, active: true });
    return d;
  }
  async active() {
    return [...this.rows.values()].filter((r) => r.active);
  }
  async get(id: string) {
    const r = this.rows.get(id);
    return r?.active ? r : null;
  }
  async fire(f: Fired, publish: (f: Fired) => Promise<void>) {
    const r = this.rows.get(f.id);
    if (!r?.active) return false;
    if (this.failPublish) throw new Error("kafka down");
    await publish(f);
    r.active = false;
    return true;
  }
}

const t = (symbol: string, ltp: number, tsMs = 0, prevClose = 100): Tick => ({ symbol, ltp, prevClose, tsMs });

function setup(index: AlertIndex) {
  const store = new FakeStore();
  const out: Fired[] = [];
  const engine = new Engine(index, store, async (f) => void out.push(f), 900);
  return { store, out, engine, index };
}

let n = 0;
const def = (over: Partial<AlertDef>): AlertDef => ({ id: `a${++n}`, userId: "u1", symbol: "TCS", kind: "above", value: 100, ...over });

describe("sweep", () => {
  it("merges overlapping moves and keeps both directions of a reversal", () => {
    expect(sweep(99, [101, 99])).toEqual({ up: [{ lo: 99, hi: 101 }], down: [{ lo: 99, hi: 101 }] });
    expect(sweep(10, [12, 11, 13])).toEqual({ up: [{ lo: 10, hi: 13 }], down: [{ lo: 11, hi: 12 }] });
    expect(sweep(5, [5, 5])).toEqual({ up: [], down: [] });
  });
});

for (const [name, make] of [
  ["memory", () => new MemoryIndex()],
  ["redis", () => new RedisIndex(new FakeRedis() as unknown as Redis)],
] as const) {
  describe(`engine over ${name} index`, () => {
    it("fires once per crossing, at the crossing tick, and never again", async () => {
      const { store, out, engine, index } = setup(make());
      const a = store.add(def({ value: 100 }));
      await index.upsert(a);
      await engine.process([t("TCS", 98, 1)]);
      expect(out).toHaveLength(0);
      await engine.process([t("TCS", 99.5, 2), t("TCS", 100, 3), t("TCS", 102, 4)]);
      expect(out).toEqual([expect.objectContaining({ id: a.id, triggerPrice: 100, tsMs: 3 })]);
      await engine.process([t("TCS", 99, 5), t("TCS", 103, 6)]);
      expect(out).toHaveLength(1);
      expect(await index.ids()).toEqual([]);
    });

    it("does not fire on the first tick it ever sees for a symbol", async () => {
      const { store, out, engine, index } = setup(make());
      await index.upsert(store.add(def({ value: 100 })));
      await engine.process([t("TCS", 150)]);
      expect(out).toHaveLength(0);
      await engine.process([t("TCS", 151)]);
      expect(out).toHaveLength(0);
    });

    it("catches a spike that reverts inside one batch, in both directions", async () => {
      const { store, out, engine, index } = setup(make());
      const up = store.add(def({ value: 100 }));
      const down = store.add(def({ kind: "below", value: 99.5 }));
      await index.upsert(up);
      await index.upsert(down);
      await engine.process([t("TCS", 99.8)]);
      await engine.process([t("TCS", 100.2), t("TCS", 99.4), t("TCS", 99.8)]);
      expect(out.map((f) => [f.id, f.triggerPrice]).sort()).toEqual([
        [up.id, 100.2],
        [down.id, 99.4],
      ]);
    });

    it("pct_move fires when the move from previous close widens past the threshold", async () => {
      const { store, out, engine, index } = setup(make());
      const a = store.add(def({ kind: "pct_move", value: 2 }));
      await index.upsert(a);
      await engine.process([t("TCS", 101)]);
      await engine.process([t("TCS", 101.5), t("TCS", 99)]);
      expect(out).toHaveLength(0);
      await engine.process([t("TCS", 97.9)]);
      expect(out).toEqual([expect.objectContaining({ id: a.id, triggerPrice: 97.9 })]);
    });

    it("skips alerts that were paused in Postgres and drops them from the index", async () => {
      const { store, out, engine, index } = setup(make());
      const a = store.add(def({ value: 100 }));
      await index.upsert(a);
      store.rows.get(a.id)!.active = false;
      await engine.process([t("TCS", 99)]);
      await engine.process([t("TCS", 101)]);
      expect(out).toHaveLength(0);
      expect(engine.stats.suppressed).toBe(1);
      expect(await index.ids()).toEqual([]);
    });

    it("a failed publish releases the claim so a retried batch still fires", async () => {
      const { store, out, engine, index } = setup(make());
      const a = store.add(def({ value: 100 }));
      await index.upsert(a);
      await engine.process([t("TCS", 99)]);
      store.failPublish = true;
      await expect(engine.process([t("TCS", 101)])).rejects.toThrow("kafka down");
      store.failPublish = false;
      await engine.process([t("TCS", 101)]);
      expect(out).toEqual([expect.objectContaining({ id: a.id })]);
    });

    it("cooldown blocks a re-armed alert from firing twice within the window", async () => {
      const { store, out, engine, index } = setup(make());
      const a = store.add(def({ value: 100 }));
      await index.upsert(a);
      await engine.process([t("TCS", 99)]);
      await engine.process([t("TCS", 101)]);
      store.rows.get(a.id)!.active = true;
      await engine.refresh(a.id);
      await engine.process([t("TCS", 99), t("TCS", 101)]);
      expect(out).toHaveLength(1);
      expect(engine.stats.suppressed).toBe(1);
    });

    it("resync heals stale entries and purgeUser erases one user's alerts", async () => {
      const { store, engine, index } = setup(make());
      const mine = store.add(def({ userId: "u1" }));
      const theirs = store.add(def({ userId: "u2", symbol: "INFY" }));
      await index.upsert({ ...def({}), id: "ghost" });
      expect(await engine.resync()).toEqual({ armed: 2, dropped: 1 });
      expect((await index.ids()).sort()).toEqual([mine.id, theirs.id].sort());
      expect(await engine.purgeUser("u2")).toBe(1);
      expect(await index.ids()).toEqual([mine.id]);
    });

    it("refresh moves an edited alert to its new threshold", async () => {
      const { store, out, engine, index } = setup(make());
      const a = store.add(def({ value: 100 }));
      await index.upsert(a);
      store.rows.get(a.id)!.value = 110;
      await engine.refresh(a.id);
      await engine.process([t("TCS", 99)]);
      await engine.process([t("TCS", 105)]);
      expect(out).toHaveLength(0);
      await engine.process([t("TCS", 110)]);
      expect(out).toHaveLength(1);
    });
  });
}
