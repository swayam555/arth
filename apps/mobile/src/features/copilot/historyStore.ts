import type { SqlDatabase } from "@/features/chart/candleStore";
import type { ChatMessage } from "./types";

export interface LocalSession {
  id: string;
  title: string;
  updatedAt: number;
}

/** On-device copy of copilot conversations so history opens instantly and offline. Server stays the source of truth. */
export interface HistoryStore {
  sessions(limit?: number): Promise<LocalSession[]>;
  messages(sessionId: string): Promise<ChatMessage[]>;
  append(sessionId: string, title: string, msgs: readonly ChatMessage[]): Promise<void>;
  replace(sessionId: string, title: string, updatedAt: number, msgs: readonly ChatMessage[]): Promise<void>;
  remove(sessionId: string): Promise<void>;
  clear(): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_messages (
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL, id TEXT NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, ord)
);`;

type MsgRow = { body: string };
type SessRow = { id: string; title: string; updated_at: number };

const persistable = (m: ChatMessage): ChatMessage => ({ ...m, status: m.status === "streaming" ? "stopped" : m.status, tools: undefined });

export function sqliteHistoryStore(open: () => Promise<SqlDatabase>): HistoryStore {
  let ready: Promise<SqlDatabase> | null = null;
  const db = () =>
    (ready ??= open().then(async (d) => {
      await d.execAsync(`PRAGMA foreign_keys = ON; ${SCHEMA}`);
      return d;
    }));

  const insert = async (d: SqlDatabase, sessionId: string, from: number, msgs: readonly ChatMessage[]) => {
    for (const [i, m] of msgs.entries()) {
      await d.runAsync(
        "INSERT OR REPLACE INTO chat_messages (session_id, ord, id, role, body, created_at) VALUES (?,?,?,?,?,?)",
        sessionId,
        from + i,
        m.id,
        m.role,
        JSON.stringify(persistable(m)),
        m.createdAt,
      );
    }
  };
  const upsertSession = (d: SqlDatabase, id: string, title: string, at: number) =>
    d.runAsync(
      "INSERT INTO chat_sessions (id, title, updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at",
      id,
      title,
      at,
    );

  return {
    async sessions(limit = 50) {
      const rows = await (await db()).getAllAsync<SessRow>(
        "SELECT id, title, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT ?",
        limit,
      );
      return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
    },
    async messages(sessionId) {
      const rows = await (await db()).getAllAsync<MsgRow>("SELECT body FROM chat_messages WHERE session_id = ? ORDER BY ord", sessionId);
      return rows.map((r) => JSON.parse(r.body) as ChatMessage);
    },
    async append(sessionId, title, msgs) {
      const d = await db();
      await d.withTransactionAsync(async () => {
        await upsertSession(d, sessionId, title, msgs.at(-1)?.createdAt ?? Date.now());
        const count = await d.getAllAsync<{ n: number }>("SELECT COUNT(*) AS n FROM chat_messages WHERE session_id = ?", sessionId);
        await insert(d, sessionId, count[0]?.n ?? 0, msgs);
      });
    },
    async replace(sessionId, title, updatedAt, msgs) {
      const d = await db();
      await d.withTransactionAsync(async () => {
        await upsertSession(d, sessionId, title, updatedAt);
        await d.runAsync("DELETE FROM chat_messages WHERE session_id = ?", sessionId);
        await insert(d, sessionId, 0, msgs);
      });
    },
    async remove(sessionId) {
      await (await db()).runAsync("DELETE FROM chat_sessions WHERE id = ?", sessionId);
    },
    async clear() {
      await (await db()).execAsync("DELETE FROM chat_messages; DELETE FROM chat_sessions;");
    },
  };
}

export const chatHistory = sqliteHistoryStore(async () => {
  const SQLite = await import("expo-sqlite");
  return (await SQLite.openDatabaseAsync("copilot.db")) as unknown as SqlDatabase;
});
