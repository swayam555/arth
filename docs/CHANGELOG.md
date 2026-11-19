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
