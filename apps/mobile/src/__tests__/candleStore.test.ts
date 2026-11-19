import type { Candle } from "@arth/market";
import { DatabaseSync } from "node:sqlite";
import { memoryCandleStore, sqliteCandleStore, type CandleStore, type SqlDatabase } from "@/features/chart/candleStore";

function nodeSqlite(): SqlDatabase {
  const db = new DatabaseSync(":memory:");
  return {
    execAsync: async (sql) => void db.exec(sql),
    runAsync: async (sql, ...params) => db.prepare(sql).run(...params),
    getAllAsync: async <T,>(sql: string, ...params: (string | number)[]) => db.prepare(sql).all(...params) as T[],
    withTransactionAsync: async (task) => {
      db.exec("BEGIN");
      try {
        await task();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

const bars = (n: number, from = 0): Candle[] => Array.from({ length: n }, (_, i) => [(from + i) * 60_000, 1 + i, 2 + i, i, 1.5 + i, 10 * i]);

describe.each<[string, () => CandleStore]>([
  ["sqlite", () => sqliteCandleStore(async () => nodeSqlite())],
  ["memory", () => memoryCandleStore()],
])("%s candle store", (_, make) => {
  it("returns the newest rows oldest-first, scoped by symbol and timeframe", async () => {
    const s = make();
    await s.put("TCS", "1m", bars(400));
    await s.put("TCS", "5m", bars(3));
    await s.put("INFY", "1m", bars(2));
    const latest = await s.latest("TCS", "1m", 300);
    expect(latest).toHaveLength(300);
    expect(latest[0]![0]).toBe(100 * 60_000);
    expect(latest[299]).toEqual(bars(400)[399]);
    expect(await s.latest("TCS", "5m", 300)).toHaveLength(3);
  });

  it("upserts overlapping bars and prunes to the newest N", async () => {
    const s = make();
    await s.put("TCS", "1m", bars(10));
    await s.put("TCS", "1m", [[9 * 60_000, 9, 99, 9, 50, 1]]);
    expect((await s.latest("TCS", "1m", 1))[0]).toEqual([9 * 60_000, 9, 99, 9, 50, 1]);
    await s.prune("TCS", "1m", 4);
    expect((await s.latest("TCS", "1m", 100)).map((c) => c[0] / 60_000)).toEqual([6, 7, 8, 9]);
    await s.prune("NOPE", "1m", 4);
    await s.clear();
    expect(await s.latest("TCS", "1m", 100)).toEqual([]);
  });
});
