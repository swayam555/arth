import type { Sql } from "postgres";
import type { Directory, Recipient } from "./model.js";

export class PgDirectory implements Directory {
  constructor(
    private readonly sql: Sql,
    private readonly consentVersion: string,
  ) {}

  async recipient(userId: string): Promise<Recipient> {
    const [consent] = await this.sql<{ granted: boolean }[]>`
      select granted from consents
      where user_id = ${userId} and purpose = 'push' and version = ${this.consentVersion}
      order by recorded_at desc limit 1`;
    if (!consent?.granted) return { pushConsent: false, tokens: [] };
    const rows = await this.sql<{ expo_push_token: string }[]>`
      select expo_push_token from devices where user_id = ${userId} order by last_seen_at desc limit 10`;
    return { pushConsent: true, tokens: rows.map((r) => r.expo_push_token) };
  }

  async instrumentName(symbol: string): Promise<string | null> {
    const [row] = await this.sql<{ name: string }[]>`select name from instruments where symbol = ${symbol}`;
    return row?.name ?? null;
  }

  async removeToken(userId: string, token: string): Promise<void> {
    await this.sql`delete from devices where user_id = ${userId} and expo_push_token = ${token}`;
  }
}
