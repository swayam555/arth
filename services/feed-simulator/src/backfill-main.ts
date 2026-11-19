import { buildUniverse } from "@arth/market";
import { createLogger, loadEnv } from "@arth/svc";
import postgres from "postgres";
import { z } from "zod";
import { generateHistory, pastSessions } from "./backfill.js";

const env = loadEnv(
  z.object({
    DATABASE_URL: z.string().default("postgres://arth:arth@localhost:7432/arth"),
    BACKFILL_SYMBOLS: z.coerce.number().int().min(1).max(500).default(50),
    BACKFILL_SESSIONS: z.coerce.number().int().min(1).max(250).default(27),
    SEED: z.coerce.number().int().default(7),
  }),
);

const log = createLogger("backfill");
const sql = postgres(env.DATABASE_URL, { max: 1 });
const sessions = pastSessions(Date.now(), env.BACKFILL_SESSIONS);
const symbols = buildUniverse()
  .filter((i) => i.mcapBucket === "large")
  .slice(0, env.BACKFILL_SYMBOLS);

const t0 = performance.now();
let inserted = 0;
for (const inst of symbols) {
  const candles = generateHistory(inst, sessions, env.SEED);
  for (let i = 0; i < candles.length; i += 4_000) {
    const rows = candles.slice(i, i + 4_000).map((c) => ({ symbol: c.symbol, bucket: new Date(c.bucketMs), o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }));
    const r = await sql`INSERT INTO candles_1m ${sql(rows, "symbol", "bucket", "o", "h", "l", "c", "v")} ON CONFLICT DO NOTHING`;
    inserted += r.count;
  }
}
const from = new Date(sessions[0]!).toISOString();
for (const view of ["candles_5m", "candles_15m", "candles_1h", "candles_1d"]) {
  await sql.unsafe(`CALL refresh_continuous_aggregate('${view}', '${from}'::timestamptz - interval '1 day', now())`);
}
log.info(
  { symbols: symbols.length, sessions: sessions.length, inserted, seconds: Number(((performance.now() - t0) / 1_000).toFixed(1)) },
  "backfill complete",
);
await sql.end();
