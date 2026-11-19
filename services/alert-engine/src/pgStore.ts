import type { Sql } from "postgres";
import type { AlertDef, AlertKind, AlertStore, Fired } from "./model.js";

interface Row {
  id: string;
  user_id: string;
  symbol: string;
  kind: AlertKind;
  value: string;
}

const toDef = (r: Row): AlertDef => ({ id: r.id, userId: r.user_id, symbol: r.symbol, kind: r.kind, value: Number(r.value) });

export class PgStore implements AlertStore {
  constructor(private readonly sql: Sql) {}

  async active(): Promise<AlertDef[]> {
    const rows = await this.sql<Row[]>`select id, user_id, symbol, kind, value from alerts where active`;
    return rows.map(toDef);
  }

  async get(id: string): Promise<AlertDef | null> {
    const rows = await this.sql<Row[]>`select id, user_id, symbol, kind, value from alerts where id = ${id} and active`;
    return rows[0] ? toDef(rows[0]) : null;
  }

  async fire(f: Fired, publish: (f: Fired) => Promise<void>): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`update alerts set active = false, last_fired_at = now() where id = ${f.id} and active returning id`;
      if (!rows.length) return false;
      await publish(f);
      return true;
    });
  }
}
