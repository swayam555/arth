import type { Candle } from "@arth/market";
import type { Timeframe } from "./candles";

/** Read-through cache of candle history so a chart paints from disk before the network answers. */
export interface CandleStore {
  latest(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]>;
  put(symbol: string, tf: Timeframe, candles: readonly Candle[]): Promise<void>;
  prune(symbol: string, tf: Timeframe, keep: number): Promise<void>;
  clear(): Promise<void>;
}

/** The subset of expo-sqlite's async API the store uses, so tests can drive it with node:sqlite. */
export interface SqlDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: (string | number)[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...params: (string | number)[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

type Row = { t: number; o: number; h: number; l: number; c: number; v: number };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS candles (
  symbol TEXT NOT NULL, tf TEXT NOT NULL, t INTEGER NOT NULL,
  o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL NOT NULL,
  PRIMARY KEY (symbol, tf, t)
) WITHOUT ROWID;`;

const CHUNK = 150;

export function sqliteCandleStore(open: () => Promise<SqlDatabase>): CandleStore {
  let ready: Promise<SqlDatabase> | null = null;
  const db = () =>
    (ready ??= open().then(async (d) => {
      await d.execAsync(`PRAGMA journal_mode = WAL; ${SCHEMA}`);
      return d;
    }));

  return {
    async latest(symbol, tf, limit) {
      const rows = await (await db()).getAllAsync<Row>(
        "SELECT t, o, h, l, c, v FROM candles WHERE symbol = ? AND tf = ? ORDER BY t DESC LIMIT ?",
        symbol,
        tf,
        limit,
      );
      return rows.reverse().map((r) => [r.t, r.o, r.h, r.l, r.c, r.v]);
    },
    async put(symbol, tf, candles) {
      if (!candles.length) return;
      const d = await db();
      await d.withTransactionAsync(async () => {
        for (let i = 0; i < candles.length; i += CHUNK) {
          const part = candles.slice(i, i + CHUNK);
          const params: (string | number)[] = [];
          for (const [t, o, h, l, c, v] of part) params.push(symbol, tf, t, o, h, l, c, v);
          await d.runAsync(`INSERT OR REPLACE INTO candles (symbol, tf, t, o, h, l, c, v) VALUES ${part.map(() => "(?,?,?,?,?,?,?,?)").join(",")}`, ...params);
        }
      });
    },
    async prune(symbol, tf, keep) {
      await (await db()).runAsync(
        "DELETE FROM candles WHERE symbol = ? AND tf = ? AND t < (SELECT t FROM candles WHERE symbol = ? AND tf = ? ORDER BY t DESC LIMIT 1 OFFSET ?)",
        symbol,
        tf,
        symbol,
        tf,
        keep - 1,
      );
    },
    async clear() {
      await (await db()).execAsync("DELETE FROM candles;");
    },
  };
}

export function memoryCandleStore(): CandleStore {
  const data = new Map<string, Map<number, Candle>>();
  const key = (s: string, tf: string) => `${s}|${tf}`;
  const sorted = (s: string, tf: Timeframe) => [...(data.get(key(s, tf))?.values() ?? [])].sort((a, b) => a[0] - b[0]);
  return {
    async latest(symbol, tf, limit) {
      return sorted(symbol, tf).slice(-limit);
    },
    async put(symbol, tf, candles) {
      const k = key(symbol, tf);
      const m = data.get(k) ?? new Map<number, Candle>();
      for (const c of candles) m.set(c[0], [...c] as Candle);
      data.set(k, m);
    },
    async prune(symbol, tf, keep) {
      const all = sorted(symbol, tf);
      const m = data.get(key(symbol, tf));
      if (!m) return;
      for (const c of all.slice(0, Math.max(0, all.length - keep))) m.delete(c[0]);
    },
    async clear() {
      data.clear();
    },
  };
}
