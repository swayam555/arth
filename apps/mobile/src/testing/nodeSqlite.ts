import { DatabaseSync } from "node:sqlite";
import type { SqlDatabase } from "@/features/chart/candleStore";

/** An in-memory SQLite with the expo-sqlite async surface, so storage code runs against a real engine in Jest. */
export function nodeSqlite(): SqlDatabase {
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
