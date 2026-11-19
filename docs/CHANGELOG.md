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

## Phase 5 — AI Copilot (2026-11-19)

**Added**
- `services/ai` (FastAPI, Python 3.13, uv): `POST /v1/chat` streams SSE events (`meta`, `token`, `replace`, `status`, `block`, `citations`, `done`, `error`). There are also session list/messages/delete, a DPDP export and delete-all, `POST /v1/ai/transcribe` (Groq Whisper, consent-gated, 415/413/422 checks), `/healthz`, `/readyz` and Prometheus `/metrics` (`arth_ai_*`).
- An agent loop with tool calls. Seven tools (portfolio metrics, holdings, sector exposure, compare to the NIFTY 50 via NIFTYBEES, price history, filings and news search) read the user's data through new api `/internal/*` endpoints. Those endpoints use a short-lived service JWT with its own secret, issuer and audience (`InternalSecurityConfig`, `InternalController`).
- Generative UI blocks (`line_chart`, `allocation_donut`, `holdings_table`, `stock_chips`) built from tool output, never from model text.
- Providers behind one interface:
  - Anthropic, the default when a key is set (`claude-opus-5-5`).
  - An OpenAI-compatible provider that covers OpenAI, Groq and Ollama.
  - A deterministic scripted provider that answers only from tool facts.
  - A record/replay cassette wrapper.
- RAG over a 22-document seed corpus (filings summaries, tax and SEBI explainers, news, plus one planted prompt-injection post), with an optional RSS fetcher. Hybrid search uses lexical plus a hashing or Voyage embedder, merged with RRF, then reranked lexically or by LLM, with numbered citations. pgvector storage is used in Postgres mode, with Alembic migration `0001_copilot`.
- Guardrails:
  - A SEBI input guard that sends a refusal and reframe without calling any tool.
  - An output advice guard that replaces the answer.
  - Numeric grounding: every number must trace to a tool result. Otherwise there is one repair round and then the unsupported sentences are dropped (`grounded:false`).
  - Prompt-injection neutralisation of retrieved text.
  - PII masking (email, phone, PAN, Aadhaar, card) before anything is stored or sent.
  - A daily token budget (429).
  - Consent required (403).
  - A Redis answer cache keyed by the normalised question plus the portfolio version.
- `evals/`: 63 cases plus a 20-case tuned holdout and a 20-case frozen holdout, with a scorer for refusal recall/precision, groundedness, injection and PII (`python -m evals.run`).
- Compose `ai` service (384 MB limit) and an nginx `/v1/chat` + `/v1/ai` route with buffering off for SSE.
- Mobile Copilot tab:
  - Streaming chat over `expo/fetch` with an incremental SSE parser.
  - Markdown with tappable `[n]` citations and a citation sheet.
  - Native blocks: a Skia line chart with returns, a donut, a holdings table and stock chips, all deep-linking to the instrument screen.
  - Stop, new chat, and history (SQLite on device, server as the source of truth, stale sessions pruned).
  - A consent gate and a budget banner.
  - Hindi or English voice input (expo-audio → transcribe).
  - Disclaimer, cached, PII-masked and ungrounded notes.
  - Settings rows to export or delete chats.
  - Sign-out wipes the local chat copy.

**Fixed during the phase**
- The input guard missed "-ing" forms, multi-word forecast subjects and the 5+5 phone format. It also falsely blocked "When did I last buy ITC?". A `_FORECAST` check could be bypassed by an educational prefix. All of these were found by the first eval run (56/63 → 63/63).
- The output guard missed contractions ("I'd recommend buying") and flagged definitions of "target price".
- The scripted provider looped forever re-emitting a block after the tool round.
- FastAPI returned 422 for every request: `Annotated` dependencies defined inside the factory were read as query params.
- Citations were sent snake_case and the app expected camelCase. Prometheus metric names collided with the api's, so they now use the `arth_ai_` prefix.
- Mobile:
  - The SSE parser split an event in two when a `\r\n` straddled two network chunks.
  - The chat store crashed after a consent or budget error, because it patched a turn it had just removed. It now patches the draft by id, which also stops a stream that was stopped late from writing into a new chat.
  - Skia 2.x has no usable `MakeFromSVGString` path, so charts use `PathBuilder`.

**Verified**
- ai: pytest 58/58 (agent, API with a fake api and auth, guards, tools, news), ruff and mypy clean. Evals: 63/63 on `cases.json`. Frozen holdout v2: input-guard recall **0.20**, precision 1.00, so the regex guard is a pre-filter, not the safety boundary (details in `services/ai/evals/README.md`). The acceptance flows "Why is my portfolio down?" (tool numbers plus a chart block), buy/sell → refusal, and injected doc → no behaviour change pass end-to-end in the agent tests with the scripted provider.
- mobile: Jest 100/100, including the SSE parser at 1/3/7/64-char chunk splits and split UTF-8, the turn reducer, markdown, chart geometry, SQLite history via `node:sqlite`, and the store (consent/budget gates, offline, stop, prune, wipe). `tsc` and ESLint clean. `pnpm turbo run typecheck lint test`: 18/18 tasks green.
- Live boot: `AI_BACKEND=memory uvicorn arth_ai.main:app` reaches ready (`/readyz` → `provider: scripted`). `POST /v1/chat` without a token returns 401 and `/metrics` exposes the `arth_ai_*` series.
- api: `InternalController` and `InternalApiTest` compile (`gradlew compileJava compileTestJava`).

**Not yet verified**
- **No real LLM was called.** No Anthropic, OpenAI or Groq key was available, so every answer above came from the scripted provider. The Anthropic and OpenAI-compatible providers are unit-tested only through fakes, and voice transcription only through a fake transcriber.
- Docker was down and the disk had ~1.3 GB free, so none of these ran:
  - `InternalApiTest` (Testcontainers)
  - Alembic and pgvector against Postgres
  - the `arth/ai` image build
  - the compose `ai` profile
  - the nginx SSE route
- On a device or emulator: the chat UI, the Skia line chart, the native Copilot tab and microphone recording.

## Phase 6 — Alerts, push, digest (2026-11-20)

**Added**
- api: the `V6__alerts.sql` migration and `/v1/alerts` (list, create, toggle, delete) for `above`, `below` and `pct_move` alerts. A user can have at most 50 active alerts; a 51st returns 409 `alert_limit`. Every change publishes the alert id on the Redis channel `alerts:changed`. `POST /v1/me/devices/unregister` removes a push token. Alerts and devices are included in the DPDP export.
- `services/alert-engine`: consumes `ticks.raw` and keeps a sorted threshold index per symbol (Redis, with an in-memory version for tests). `crossing.ts` evaluates every step of a tick batch, so a spike that reverts inside one batch still counts as a crossing. Firing is idempotent because it needs two things to succeed: a Redis cooldown claim (900 s) and a conditional `UPDATE … WHERE active RETURNING`. The engine publishes `alerts.fired` and resyncs on `alerts:changed`.
- `services/notifier`: consumes `alerts.fired` and `digest.ready`. It checks push consent, sends through the Expo push API (or a log sender when there is no `EXPO_ACCESS_TOKEN`) with a collapse id, and retries failed tickets with full-jitter exponential backoff that honours `Retry-After`. It forgets devices that report `DeviceNotRegistered`. Anything still failing after the last attempt goes to `notifications.dlq` with the original payload.
- ai: `digest.py`. It models the NSE session clock in IST and picks the three largest absolute moves, each with its share of the day's movement. The text passes through the SEBI advice guard. The final digest has a deterministic uuid5 id and is generated at most once per user per session date (migration `0002_digests`). The scheduler runs at 15:45 IST and publishes `digest.ready` through aiokafka, at-least-once, with the collapse id folding duplicates. It reads the audience from push consent. Endpoints: `/v1/digest/today` and `/v1/digest/{date}`. A `user.deleted` consumer erases chats, usage and digests, committing offsets only after the erase.
- Mobile:
  - an alerts panel on the instrument screen, with validation against the live price (`alreadyAbove`/`alreadyBelow`, a % range) and the server's limit error;
  - an Alerts management screen (Settings → Notifications);
  - push registration gated on the push consent, with Android channels `alerts` (high) and `digest`;
  - notification taps routed through a strict deep-link parser (`arth://instrument/{SYM}`, `arth://digest/{date}` or `https://arth.app/…`), including cold start;
  - the device token unregistered on sign-out and wiped on erase;
  - a digest card on Portfolio and a digest detail screen;
  - English and Hindi strings for all of it.
- nginx serves `/.well-known/assetlinks.json` for Android App Links.

**Fixed during the phase**
- ESLint's `import/namespace` rule couldn't resolve `Notifications.AndroidImportance`; it is now a named import.
- A `pushToken.clear` returned a boolean where `void` was declared.
- The AlertsPanel test hung after passing because React Query's garbage-collection timer kept Jest alive. The test client now sets `gcTime: Infinity`. RNTL 14's `fireEvent` is async and must be awaited, or the press reads stale input state.

**Verified**
- Tests:
  - mobile Jest 114/114 (alert rules, the deep-link parser, unregister, and AlertsPanel rendering with a mocked API);
  - alert-engine 19 and notifier 11 (Vitest);
  - ai pytest 76, with ruff and mypy clean.
- `pnpm turbo run typecheck lint test`: 22/22 green.
- api: `compileJava compileTestJava` is clean.
- `expo config --type prebuild` resolves with the notifications plugin.
- The assetlinks fingerprint matches the debug keystore (checked with `keytool`).

**Not yet verified**
- Docker was down (Docker.raw disk full), so none of these have run:
  - the Testcontainers suites (`AlertApiTest`, the new `AuthFlowTest` device test);
  - migration `V6`, and ai migration `0002` plus the PgStore digest SQL, against Postgres;
  - the Redis threshold index against real Redis (it is tested against FakeRedis only);
  - aiokafka and the erasure consumer against Kafka;
  - the end-to-end path tick → alert → push → DLQ.
- The OpenAPI additions (alerts and device unregister) were written by hand in `openapi.json`. Regenerate them from springdoc when the api runs.
- Push delivery and taps on the emulator need an EAS `projectId` in `extra.eas.projectId`. Until one is set, `registerForPush` returns `unavailable`.
- `assetlinks.json` uses the debug keystore SHA-256 and must be replaced for release. The iOS `apple-app-site-association` file was not added because it needs an Apple Team ID.
- NSE holidays are not modelled (a holiday looks like a flat session). The digest scheduler assumes a single replica.

## Phase 7 — Hardening (2026-11-20)

**Added**
- **Offline and slow networks (mobile)**
  - `features/network` decides online state. Unknown reachability counts as online; only an explicit `false` is offline.
  - The flush rate follows the radio: 2 s on 2G, 1 s on 3G, and the default rate otherwise. The socket sends a new rate only when it changes, and sends it again after reconnecting.
  - React Query pauses while offline, refetches on reconnect, and treats returning to the foreground as focus.
- **Crash reporting (mobile)**
  - Sentry (`@sentry/react-native` 8.36) runs only when the user is signed in and has granted the `analytics` consent. It shuts down when that consent is withdrawn.
  - A PII scrubber removes the user, the request, extra fields, frame variables and network breadcrumbs, and masks emails, PAN, Aadhaar, phone numbers and JWTs.
  - Screenshots, the view hierarchy and default PII are turned off.
- **Node services**
  - `@arth/svc/telemetry` adds an OTel tracer, with OTLP export only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and Sentry with the same scrubber.
  - Error-level log lines that carry `err` are forwarded to Sentry.
  - The stream gateway wraps upgrade/auth and snapshot work in spans. The other services trace their batch handlers.
- **ai**
  - `telemetry.py` adds Sentry with a scrubber, plus OpenTelemetry FastAPI instrumentation.
  - Agent turns and tool calls are spans.
- **api**
  - Spring Boot OpenTelemetry starter (export is off by default), Sentry for Spring Boot 4 and Micrometer Prometheus at `/actuator/prometheus`.
  - `http.server.requests` has histograms and SLO buckets from 50 ms to 1 s.
- **Observability stack** (compose profile `obs`)
  - Prometheus 3.16, Grafana 13.2 and Jaeger 2.23.
  - A provisioned 31-panel "Arth overview" dashboard, committed as JSON and produced by `gen_dashboard.py`.
  - A shared `x-telemetry` env anchor carries the telemetry settings to every service.
- **Load tests:** k6 `infra/load/rest.js` (weighted REST mix with per-endpoint p95 thresholds) and `infra/load/ws.js` (1,000+ gateway sockets, first-frame and frame-gap thresholds, abnormal-close count).
- **Maestro flows:** login, add-to-watchlist, open-chart and ask-copilot, plus a shared sign-in subflow.
- **Tests and docs**
  - New Jest suites: session store, chat renderer (MessageView, Markdown, Blocks), crash reporting and scrubber, network policy, and four reconnect edge cases in `streamClient`.
  - Per-file coverage thresholds (75% statements, 60% branches, 50% functions, 80% lines) on the stores, socket, decoder and chat renderer.
  - `docs/OBSERVABILITY.md` explains how to run the stack and the load tests.

**Fixed during the phase**
- Sign-out and wipe loaded push and copilot modules through dynamic `import()`, and their `.catch` swallowed failures. Under Jest, the push token was never unregistered and the local copilot history was never wiped. The new session tests caught this, and both are now static imports (there was no import cycle).
- `NetSnapshot` didn't match `NetInfoState` (TS2345). It now picks `details` and narrows on `cellularGeneration`.
- The dashboard's token panel grouped by a non-existent `kind` label. The metric label is `dir`.
- An unawaited RNTL 14 `fireEvent` caused overlapping `act()` calls and broke later tests in the same file.

**Verified**
- mobile: Jest 147/147 in 20 suites, with every coverage threshold met. Measured coverage: decoder 100%; MessageView, Markdown and markdown 100%; sse 98%; historyStore 94%; streamClient 94%; reducer 92%; session 92%; store 82%; Blocks 81%; tickStore 78% (statements). `tsc` is clean.
- `pnpm turbo run typecheck lint test`: 22/22 green.
- ai: pytest 79 passed; ruff check, ruff format and mypy clean.
- api: `compileJava compileTestJava` is clean, and the unit tests pass (CasParser, CsvImport, Ledger, Xirr).
- `docker compose config -q` is valid with the obs profile, and the dashboard JSON parses.

**Not yet verified**
- None of the runtime checks have run. Docker is down (Docker.raw disk full, ~1.2 GB free on the host), k6 and Maestro are not installed, and there was no room for an emulator. That leaves:
  - the k6 REST and WS runs, so `docs/perf/BACKEND.md` has no Phase 7 numbers yet;
  - the Maestro flows on an emulator;
  - the 15-minute memory-growth (≤10%) check;
  - the Grafana and Jaeger UIs, and live OTLP/Sentry export;
  - the api's `/actuator/prometheus` output;
  - mobile Sentry on a device.
- pnpm ignored the `@sentry/cli` postinstall build script, so source-map upload for release builds is not set up yet.

## Phase 8 — Publish-readiness & resume deliverables (2026-11-20)

**Added**
- Brand assets generated by `infra/brand/gen_icons.py` (Pillow, 4× supersampled): app icon, adaptive foreground/background/monochrome, splash icon, favicon. They replace the Expo template defaults.
- `apps/mobile/eas.json` with `development` / `preview` (APK, channel `preview`) / `production` (AAB, auto-increment, channel `production`) profiles, plus a `submit` profile for Play internal testing as a draft. `expo-updates` installed, with `runtimeVersion.policy = appVersion` and `checkAutomatically: ON_LOAD`.
- `docs/legal/PRIVACY_POLICY.md`: privacy policy and DPDP notice. It covers per-purpose data, consent, the rights in §11–§14, retention, security, the SEBI disclaimer and children.
- `docs/release/RELEASE.md`: build profiles, EAS setup, local Gradle build, Play internal-testing checklist, store listing copy, and a 90-second demo script with recording commands.
- `README.md`: problem, market validation (with sourced links), architecture, GIF placeholders and how to record them, measured perf table, stack, and how to run.
- `docs/perf/REPORT.md`: every quotable number with a row ID and its source line, plus an explicit "Not measured" table.
- `docs/INTERVIEW_NOTES.md` (10 decisions) and `docs/RESUME_BULLETS.md` (each number cites a REPORT row).

**Fixed during the phase**
- The splash pointed at the template image, so the app showed the Expo logo. It now uses the generated `splash-icon.png`.

**Verified**
- `npx expo config --type public` resolves the new config.
- mobile: `tsc` clean; Jest 147/147.
- `pnpm turbo run typecheck lint test`: 22/22.
- ai pytest: 79 passed.
- Each number in README and RESUME_BULLETS was checked against `docs/perf/BACKEND.md` and this changelog.

**Not yet verified**
- The release APK hasn't been built and cold start hasn't been measured. That is Phase 8's acceptance item. With 1.0 GB of free disk, a Gradle release build won't fit, and no emulator run was possible.
- `eas init` hasn't run, so there is no `projectId` and no `updates.url`.
- Play Console steps haven't been done.
- The GIFs haven't been recorded.
- The market-validation figures come from secondary press reports, not from NSDL/CDSL primary data.
