# Changelog

## Phase 1 — Foundation (2026-11-19)

**Added**
- pnpm 12 + Turborepo monorepo; `packages/proto` (buf + protoc-gen-es) shared by TS services and the Java api; `packages/api-client` generated from the api's OpenAPI spec (openapi-typescript + openapi-fetch).
- `infra/docker-compose.yml` with `core` / `realtime` / `ai` / `obs` profiles: TimescaleDB 2.32 (PG 17, pgvector), Redis 8.8, Kafka 4.3 (KRaft), api, nginx 1.31 with a self-signed TLS cert generated on first start. Ports 74xx so it coexists with other local stacks; per-container memory limits sized for a 4 GB Docker VM.
- api (Spring Boot 4.1, Java 21): Flyway schema (users, devices, append-only consents, refresh-token families, idempotency keys); OTP login for +91 mobiles (hashed codes in Redis, 5-attempt cap, resend cooldown, pluggable SMS provider); HS256 access JWT (15 min) + rotating opaque refresh tokens with reuse detection that revokes the whole family; Redis Lua token-bucket rate limit; `/v1/me` profile, DPDP consents, JSON export, account erasure (publishes `user.deleted`); RFC 9457 problem responses; springdoc OpenAPI.
- Mobile (Expo SDK 58, RN 0.88, New Architecture, Expo Router typed routes): phone → OTP → DPDP consent → tabs; access token in memory, refresh token in SecureStore; single-flight refresh with replay of the original request on 401; biometric lock (re-locks after 60 s in background); dark/light/system theme and English/Hindi, both persisted in MMKV; Settings with consent toggles, data export (share sheet), account deletion, privacy notice.
- GitHub Actions: JS typecheck/lint/test, api Testcontainers suite, and a check that the committed OpenAPI spec is current.

**Fixed during the phase**
- A zero resend cooldown created a Redis key with no expiry, so a second OTP request for the same number returned 429 forever (caught by `AuthFlowTest`).
- openapi-fetch runs `onResponse` middleware last-registered-first; the error middleware was turning 401s into exceptions before the refresh middleware saw them (caught by `refresh.test.ts`).
- openapi-fetch captured `fetch` at client creation; it now binds late so interceptors and tests see every call.
- The generated OpenAPI spec embedded the random test port and unordered keys, so the CI "spec is current" check could never pass; server is now `/` and keys are sorted.
- `turbo` was referenced by root scripts but not installed.

**Verified**
- api: 7/7 integration tests green against real Postgres/Redis/Kafka containers (OTP login, attempt cap, non-Indian numbers rejected, refresh rotation, reuse → family revoked, 401 without token, consents/export/delete).
- Compose `core` profile from a clean build: all services healthy; through nginx (HTTP 7080 and TLS 7443) OTP request → code from api log → verify → `/v1/me` → PUT consents → export JSON → refresh rotation all returned 2xx; `/actuator` is 404 at the edge.
- mobile: 18/18 Jest tests (phone normalisation, consent defaults, refresh single-flight / offline / revoked / 401 replay); `tsc --noEmit` and ESLint clean.

**Not yet verified:** the emulator run (login → consent → tabs → theme/language → biometric on relaunch). The host had ~0.8 GB free RAM with Docker's 4 GB VM up and other projects' builds running, so a native RN build plus an emulator did not fit. Carried into Phase 2, whose FPS gate needs the emulator anyway.

## Phase 2 — Streaming pipeline (2026-11-19)

**Added**
- `packages/market`: the instrument universe (2,100 deterministic NSE-style symbols), the msgpack wire protocol (`wire.ts`: Snapshot/Delta/SubAck/Depth/Pong/Error frames with per-session sequence numbers), and the shared limits (250 subscriptions, 100–2,000 ms flush rate, 64 KB backpressure threshold).
- `services/feed-simulator`: a seeded GBM tick generator (intraday volatility curve, random volume bursts, circuit-band clamps, tick-size rounding, IST session roll), publishing lz4-compressed batches to Kafka `ticks.raw` (12 partitions).
- `services/tick-aggregator`: per-symbol conflation every 100 ms → Redis `PUBLISH tick:{SYM}` + `HSET ltp:{SYM}`; 1-minute candles → Postgres `candles_1m` + Kafka `candles.1m`; Prometheus metrics for tick age, flush time and consumer lag.
- `services/stream-gateway` (uWebSockets.js): JWT upgrade auth (header or `bearer.` subprotocol), a per-user connection cap, per-symbol Redis SUBSCRIBE ref-counted across sessions, a cold snapshot from `ltp:` on the first subscription, per-session conflated deltas with a client-selectable rate, a skip-flush-on-backpressure rule that keeps the latest value and closes the socket with 4008 after 20 s, an op rate limit (4029), and drain-on-shutdown.
- api: `/v1/instruments` (search, sectors, detail with the cached quote) and `/v1/watchlists` (CRUD, reorder, set items, max 200 items per list).
- Mobile: a `StreamClient` with equal-jitter backoff, token refresh on expiry or 401, gap detection → resync, ping/RTT with stale detection, pause in background, and offline/online handling; a hand-written msgpack decoder; a tick store with per-row selectors; viewport-driven subscriptions (visible rows ± overscan, 1.5 s linger); a watchlist tab with FlashList rows and a stream status pill; search; manage-lists and edit-list screens (rename, reorder with up/down buttons, remove); English and Hindi strings for all of them.
- `infra/scripts/seed-watchlist.mjs` fills a user's first list with N symbols (used for the 200-row scenario).
- `docs/perf/BACKEND.md` with the measured pipeline numbers.

**Fixed during the phase**
- kafkajs is unmaintained and has no lz4 codec; both services moved to `@platformatic/kafka`, which supports lz4 natively.
- The uWebSockets.js v20.71.0 ESM wrapper points at a file that is not shipped; the gateway loads the CJS entry through `createRequire`.
- uWS needs a newer glibc than bookworm ships, so the service images moved to `node:24.18.0-trixie-slim`.
- The esbuild bundles mark native/dynamic packages as external; `copy-externals.mjs` copies them into the image.
- `MarketApiTest` built request URLs without encoding them.
- The mobile viewport hook wrote a ref during render and did not resubscribe when the list data changed; the edit screen copied props into state inside an effect (both caught by `expo lint`).
- A stream-client test built a JWT `exp` in milliseconds instead of seconds.

**Verified**
- Tests: mobile 48/48 (Jest), market 30, tick-aggregator 7, stream-gateway 13, feed-simulator 5 (Vitest); `tsc` and `expo lint` clean.
- Backend load test (see `docs/perf/BACKEND.md`): 1,000 sockets × 50 symbols through Kafka → aggregator → Redis → uWS gave p50 177 ms / p99 350 ms from source tick to client, with 0 sequence gaps and 0 dropped frames, at 132 MB RSS and 6.4 % CPU for the gateway; the same pipeline in Docker behind nginx gave p50 183 ms / p99 360 ms at 300 clients.
- Mobile decoder on a 50-row delta (1,232 B): 17.4 µs per frame, against 21.0 µs for `@msgpack/msgpack` (Jest on Node, not on a device).

**Not yet verified:** the emulator FPS gate (200-symbol watchlist, ≥55 FPS, no JS block > 50 ms), the subscription change on scroll and the reconnect after a gateway restart, all of which need the app running on the emulator. The x86_64 debug APK was still compiling native code (Skia) when this entry was written, on a host with ~0.5 GB free RAM. The results go into `docs/perf/REPORT.md` when measured. The api Testcontainers suite (`MarketApiTest`) was not rerun after the final api changes, for the same RAM reason.

## Phase 3 — Charts (2026-11-19)

**Added**
- `packages/market/indicators.ts`: SMA, EMA, Wilder RSI and session-anchored VWAP in pure TS, checked against hand-computed reference values.
- api: the `V4__candles.sql` migration adds TimescaleDB continuous aggregates `candles_5m/15m/1h/1d` over `candles_1m`, with real-time aggregation so the newest bar is never stale. `GET /v1/instruments/{symbol}/candles?tf&before&limit` uses cursor pagination (oldest-first page plus `nextBefore`) and validates `tf` and `limit` (1–1000) with a 400.
- `feed-simulator` backfill: a seeded GBM history over past IST sessions (≥10k 1m candles per symbol over 27 sessions), bulk-inserted, followed by a refresh of the aggregates (`pnpm --filter @arth/feed-simulator backfill`).
- Mobile chart (`features/chart`):
  - **Rendering:** a Skia candlestick, volume, overlay and RSI renderer. Paths are built on the UI thread from shared values, only bars in the viewport are drawn, and the paths are memoised per viewport.
  - **Gestures:** pan with decay, pinch-zoom around the focal point, and a long-press crosshair with an OHLC tooltip and haptics, all handled on the UI thread.
  - **Data:** a SQLite candle cache (expo-sqlite) is read first, then the network, and the cache is pruned to 2,000 bars. Older pages load when you pan to the left edge, and live ticks are folded into the last bar.
- An instrument screen (tap a watchlist row) with stats, a timeframe switcher and overlay chips (both persisted), a top-5 market-depth panel streamed over the gateway's depth channel, and English and Hindi strings. Signing out also clears the candle cache.

**Fixed during the phase**
- Skia 2.x paths are immutable; the renderer moved to `Skia.PathBuilder` and `.build()`.
- The class-level `@Validated` on controllers turned `@Min`/`@Max` violations into 500s. Removing it lets Spring's built-in method validation return 400, which is covered by a regression test.
- React Compiler lint rules: writes to shared values now use `.set()`. The candle hook resets its state during render when the symbol or timeframe changes (no setState in an effect), and `hasOlder` is now state rather than a ref read during render.

**Verified**
- Tests:
  - api: 17/17 Testcontainers tests, including the new `CandleApiTest`. It covers 1m pagination, the 5m rollup values, 400 on a bad tf or limit, 404 and 401.
  - Vitest: market 35/35, feed-simulator 8/8, tick-aggregator 7/7, stream-gateway 13/13.
  - mobile: 67/67 Jest tests, covering chart math, the viewport, overlays, the SQLite and memory candle stores, and the `useCandles` hook (cache→network, older pages, live ticks, and an offline fallback to the cache).
  - `tsc` and lint are clean in all 8 packages.
- The offline-reopen path (cache renders when the network fails) is verified by `useCandles.test.tsx` against the real SQLite store logic on `node:sqlite`, not on a device.

**Not yet verified:** pan/zoom across 10k candles at ≥55 FPS on the emulator, and live depth on a device. The host was at 1.2 GB of free disk and about 1 GB of free RAM, with Docker stopped. The Android build outputs were deleted to free disk space, so an APK rebuild did not fit. The backfill run time against Postgres was not measured, for the same reason. These go into `docs/perf/REPORT.md` when measured.

## Phase 4 — Portfolio (2026-11-19)

**Added**
- api `portfolio` package and the `V5__portfolio.sql` migration (transactions, import batches, holdings view inputs):
  - **Ledger:** weighted-average-cost lots, realised P&L on sells, and oversell, future-date and unknown-symbol rejection. Each user has a transaction cap (`txn_limit`).
  - **XIRR:** Newton's method with a bisection fallback. Current value counts as a terminal inflow. The field is omitted when there are fewer than two cash flows.
  - **Endpoints:**
    - `GET /v1/portfolio` returns holdings, allocation by sector, mcap and asset class, movers, and XIRR.
    - `GET /v1/portfolio/history?days` reprices daily from `candles_1d`, falling back to prev_close.
    - Transaction CRUD.
  - **CSV import:** auto-detects the Zerodha tradebook layout and accepts a manual column mapping (DD/MM/YYYY and ISO dates). It supports a dry-run preview and a duplicate-file guard (SHA-256 → `duplicate_import`).
  - **CAS PDF import (pdfbox 3.0.8):** CDSL, NSDL and CAMS layouts, with password-protected files (`cas_password`). PAN and email are masked in the report and never stored.
  - **Kafka and DPDP:** `portfolio.updated` events go to Kafka. Transactions and imports are included in the DPDP data export and deleted on account delete.
- Mobile Portfolio tab:
  - **Live repricing:** holdings are repriced from streaming ticks (`livePortfolio`), which recomputes value, day change, P&L, weights, allocation and movers on every tick.
  - **Charts:** a Skia allocation donut (sector, mcap and asset class), and a value-vs-invested history chart (30, 90 or 365 days).
  - **Screens:** a holdings list linking to the instrument chart, a transaction list and editor (validated, with server errors shown inline), and an import screen. Import offers CSV with a mapping editor and automatic preview, or a CAS PDF with a password, followed by a preview report and commit.
  - SEBI disclaimer, and English and Hindi strings.
- `samples/`: a Zerodha-format tradebook and a custom-header CSV for trying the import.

**Fixed during the phase**
- The history query fell back to prev_close for symbols with no daily candle.
- Asset-class expectations now use lowercase values.
- A self-invoked `@Transactional` was replaced with `TransactionTemplate`, because the proxy was bypassed.
- The Donut arc starts are computed with `reduce`, because the React Compiler lint rejects reassignment inside useMemo.

**Verified**
- Tests:
  - api: 40/40 Testcontainers tests. New: `XirrTest`, `LedgerTest`, `CsvImportTest`, `CasParserTest` (synthetic encrypted CDSL/NSDL/CAMS PDFs) and `PortfolioApiTest` (multipart import end to end, duplicate guard, export and delete).
  - mobile: 76/76 Jest tests. New: repricing, allocation, movers and the transaction form validation.
  - `pnpm turbo run typecheck lint test` is green in all 8 packages.
  - `expo export --platform android` bundles (5.3 MB Hermes bytecode).

**Not yet verified:** the portfolio screens on an emulator or device, including the document picker with a real CAS PDF. Low RAM and disk on the host carry this over from earlier phases.
