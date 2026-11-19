# Arth — Build Plan

Every phase ends with: tests green, app/services runnable, a commit, and a `docs/CHANGELOG.md` entry. Versions are checked against the registry at the start of each phase (baseline seen 2026-11-18: Expo SDK 58.0.x, React Native 0.88.1, FlashList 2.3.3, Skia 2.14.0, Reanimated 4.7.2, Worklets 0.13.1, MMKV 4.3.2).

## Phase 1 — Foundation
**Build:** pnpm + Turborepo monorepo · `infra/docker-compose.yml` with profiles (Postgres 17 + Timescale + pgvector, Redis, Kafka KRaft, Nginx w/ self-signed TLS) · `packages/proto` with codegen · Spring Boot api: Flyway schema, OTP auth (dev SMS provider), JWT + rotating refresh, `/v1/me`, consents, OpenAPI → `packages/api-client` · Expo app (dev client, Expo Router typed routes, New Arch, Hermes): phone → OTP → consent → tabs shell, secure-store tokens, biometric lock, theme (dark/light), i18n en/hi · GitHub Actions: typecheck, lint, test (JS, Java, Python).
**Accept:**
- `docker compose --profile core up` healthy; `pnpm dev` starts Metro + local services.
- api integration tests (Testcontainers) cover OTP verify, refresh rotation, reuse detection → family revoked.
- App on emulator: log in with OTP, accept consent, see tabs, toggle theme/language, relaunch → biometric prompt.
- CI workflow passes locally via `act`-equivalent scripts (`pnpm ci`).

## Phase 2 — Streaming pipeline (the core)
**Build:** feed-simulator (2,000+ symbols, GBM + vol smile + bursts + circuits, configurable rate) · tick-aggregator · stream-gateway (uWS, conflation, backpressure, seq, snapshot/resync) · instruments seed + search API · watchlists CRUD + drag-reorder · app: FlashList v2 watchlist + explorer, per-symbol zustand store, worklet decoder, viewability subscriptions, robust socket client, tick flash.
**Accept:**
- Simulator sustains ≥2,000 ticks/s into Kafka; aggregator lag stays < 1 s.
- Gateway unit tests: conflation keeps latest only; slow client gets dropped-to-latest, not unbounded buffer; gap → resync snapshot.
- App: 200-symbol watchlist at ~2,000 ticks/s upstream — profiler shows only changed visible rows re-render (screenshots in `docs/perf/`); UI ≥55 FPS and no JS block > 50 ms measured on emulator (perf monitor + Hermes trace).
- Scrolling changes subscriptions (verified in gateway logs/metrics); kill/restart gateway → client reconnects with backoff and resyncs.
- **Gate:** don't start Phase 3 until the FPS budget holds on the emulator.

## Phase 3 — Charts
**Build:** candle history API (Timescale continuous aggregates, cursor pagination) + historical backfill generator (≥10k 1m candles per symbol for seeded symbols) · Skia candlestick + volume renderer, viewport culling, path cache, pinch/pan (Gesture Handler), UI-thread crosshair with OHLC tooltip · SMA/EMA/RSI/VWAP (pure TS, unit-tested) · SQLite candle cache with paginated backfill on pan-left · live last candle from the stream · top-5 market depth panel.
**Accept:** indicator unit tests vs. reference values · pan/zoom across 10k candles ≥55 FPS on emulator · offline reopen of a chart renders from SQLite cache · depth updates live.

## Phase 4 — Portfolio
**Build:** CAS PDF parser (CDSL/NSDL/CAMS, password-protected; PAN/email masked) with fixture statements · CSV import with column mapping + validation report · manual add/edit · live P&L, XIRR (Newton + bisection fallback), allocation by sector/mcap/asset, top movers, historical value chart · `portfolio.updated` events.
**Accept:** parser tests on synthetic CAS fixtures · XIRR matches spreadsheet reference within 1e-6 · import → holdings visible with live P&L in app · event published and consumed (verified by test consumer).

## Phase 5 — AI Copilot
**Build:** FastAPI service, `LLMProvider` (Claude default + OpenAI/Gemini/Ollama), tools via api `/internal`, SSE streaming, generative UI blocks, RAG ingestion (seed corpus + scheduled fetcher) with hybrid search + rerank + citations, SEBI guard + disclaimer, injection defense, PII masking, token budgets, Redis answer cache · app: streaming chat with incremental markdown, native blocks (line chart, donut, table, stock chips → deep link), citation sheet, chat history in SQLite, Hinglish voice input.
**Accept:** ≥40 eval cases; scorer reports groundedness and refusal correctness (target: 100% refusal on advice cases, 0 unsupported numbers on grounded cases — real results recorded, not assumed) · "Why is my portfolio down this week?" answers with tool-computed numbers + a chart block on device · buy/sell question → refusal template · injected document does not change behavior.

## Phase 6 — Alerts, push, digest
**Build:** alerts CRUD + app UI · alert-engine (per-symbol Redis index, dedupe/cooldown) · notifier (Expo push, retry, DLQ) · daily digest job ("3 things that moved your portfolio today"), cached, in-app card + push · deep links `arth://instrument/{symbol}`, `arth://digest/{date}`, universal-link config.
**Accept:** alert fires exactly once per crossing (tests) · push arrives on emulator and tap opens the instrument · failed sends land in DLQ · digest generated once per user/day and served from cache.

## Phase 7 — Hardening
**Build:** offline/reconnect edge cases (airplane mode, background ↔ foreground, 2G rate mode) · Sentry (app + services) · OTel traces across api/ai/gateway · Prometheus + Grafana dashboard · k6 REST + WS load tests · Maestro flows (login, add to watchlist, open chart, ask copilot) · Jest/RNTL coverage on stores, socket, decoder, chat renderer.
**Accept:** all Maestro flows pass on emulator · `docs/perf/REPORT.md` and `docs/perf/BACKEND.md` filled with measured numbers and the hardware they came from · memory stable within 10% over 15 min streaming (emulator) · Grafana dashboard JSON committed.

## Phase 8 — Publish-readiness & resume deliverables
**Build:** icon/splash, store listing copy, privacy policy + DPDP notice, EAS profiles (dev/preview/prod) + EAS Update channel, release build (local `eas build --local` or Gradle), Play internal-testing checklist, demo video script · README (problem, market validation, architecture, GIF placeholders + how to record, stack, run, perf table) · `docs/INTERVIEW_NOTES.md` (10 hardest decisions) · `docs/RESUME_BULLETS.md` (numbers only from reports).
**Accept:** release APK installs and cold-starts on emulator (time recorded) · every number in README/RESUME_BULLETS traces to a report line.

## Risks / open items
- **Device budgets:** cold start < 2 s and FPS on a ₹12k Android need a physical phone; emulator numbers will be clearly labeled until one is connected via `adb`.
- **RAM:** ~7.5 GB host / 4 GB Docker → services run in compose profiles; full stack together may need the Docker memory limit raised.
- **Market data & filings:** synthetic ticks (by design); filings corpus seeded from public summaries — no paid feeds.
- **Push on iOS / APNs** needs an Apple developer account; Android/FCM path is the one verified.
- **LLM keys:** Claude API key needed for the default provider; Ollama fallback keeps dev offline-capable but slower on this hardware.
