import { sqliteCandleStore, type SqlDatabase } from "./candleStore";

export const candleCache = sqliteCandleStore(async () => {
  const SQLite = await import("expo-sqlite");
  return (await SQLite.openDatabaseAsync("candles.db")) as unknown as SqlDatabase;
});
