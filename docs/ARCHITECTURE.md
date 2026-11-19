# Arth — Architecture

Real-time market terminal + AI portfolio copilot for Indian retail investors. The React Native app is the centerpiece; the backend exists to feed it realistic, high-rate data and grounded AI answers.

## 1. System diagram

```mermaid
flowchart LR
  subgraph Client
    APP["Expo RN app<br/>FlashList · Skia · Reanimated · worklets"]
  end
  subgraph Edge
    NGX["Nginx<br/>TLS · HTTP/2 · WS upgrade · rate limit · LB"]
  end
  subgraph Realtime
    SIM["feed-simulator<br/>MarketDataSource"]
    K[("Kafka (KRaft)")]
    AGG[tick-aggregator]
    R[("Redis<br/>LTP/depth · pub/sub · alert index<br/>rate limits · AI cache")]
    GW["stream-gateway ×2<br/>conflation · backpressure"]
    ALR[alert-engine]
    NTF["notifier<br/>Expo/FCM push · retry · DLQ"]
  end
  subgraph Core
    API["api-service<br/>Spring Boot 4.1 · Java 21"]
    AI["ai-service<br/>FastAPI · agent · RAG · digest · evals"]
    PG[("PostgreSQL 17<br/>TimescaleDB + pgvector")]
  end
  LLM[["LLMProvider<br/>Claude (default) · OpenAI · Gemini · Ollama"]]

  APP -- HTTPS --> NGX --> API
  APP -- "WSS (MessagePack)" --> NGX --> GW
  APP -- "SSE (chat)" --> NGX --> AI
  SIM -- ticks.raw --> K
  K -- ticks.raw --> AGG
  AGG -- "LTP/depth + publish" --> R
  AGG -- candles --> PG
  AGG -- candles.1m --> K
  R -- "pub/sub tick:{sym}" --> GW
  K -- ticks.raw --> ALR
  ALR -- alerts.fired --> K
  K -- alerts.fired --> NTF
  NTF -- push --> APP
  API --> PG
  API --> R
  API -- portfolio.updated --> K
  AI -- "service JWT /internal" --> API
  AI --> PG
  AI --> R
  AI --> LLM
  K -- "news.ingested, portfolio.updated" --> AI
```

## 2. Services

| Service | Stack | Responsibility |
|---|---|---|
| feed-simulator | Node 24 / TS | GBM with intraday U-shaped volatility, volume bursts, NSE hours 09:15–15:30 IST (with a `--always-open` dev flag), circuit limits (5/10/20%), 2,000+ symbols, configurable ticks/s. `MarketDataSource` interface; `SimulatedSource` + `BrokerSourceStub` (Upstox/Kite-shaped). |
| tick-aggregator | Node / TS (@platformatic/kafka) | Consume `ticks.raw` (key = symbol). Maintain 1m OHLCV in memory, write `ltp:{sym}` / `depth:{sym}` hashes, publish `tick:{sym}`, batch-insert closed candles into Timescale, emit `candles.1m`. |
| stream-gateway | Node + uWebSockets.js | WS server. Per-connection subscription set; Redis pub/sub fan-out (pattern-free, ref-counted channel subs per instance); 250 ms conflation; backpressure (skip the flush while buffered > 64 KB, keep only the latest value, close with 4008 after 20 s stuck); per-connection `seq`; snapshot on subscribe/resync. Stateless → horizontally scalable. |
| api-service | Spring Boot 4.1, Java 21, Flyway | OTP auth, JWT access + rotating refresh (reuse detection), users/devices, watchlists, instruments search, portfolio (CAS PDF / CSV / manual), XIRR, alerts CRUD, cursor-paginated candle history, Redis token-bucket rate limit, idempotency keys, DPDP consent/export/delete, springdoc OpenAPI. |
| alert-engine | Node / TS | Alerts indexed per symbol in Redis (sorted sets on threshold); evaluate on ticks; dedupe (fire-once + cooldown key); emit `alerts.fired`. |
| notifier | Node / TS | Consume `alerts.fired` + `digest.ready`; send via Expo Push (FCM/APNs under the hood); exponential retry; DLQ `notifications.dlq`. |
| ai-service | Python 3.12, FastAPI, uv | Agent loop + tools, SSE streaming, RAG ingestion/search, guardrails, digest scheduler, eval runner, voice transcription proxy. |
| nginx | nginx | TLS (self-signed in dev), HTTP/2, `/ws` upgrade, gzip, per-IP `limit_req`, round-robin over 2× api + 2× gateway. |
| observability | OTel Collector, Prometheus, Grafana | ticks/s, consumer lag, WS connections, p95s, LLM tokens/cost; JSON logs everywhere. |

**Decision — gateway language:** the prompt allows Go or Node/uWebSockets. Realtime services are Node/TS so they share the generated proto types with the app and with each other, and uWebSockets.js is C++ underneath (comparable connection density to Go). No Go toolchain is needed.

## 3. Data flow: one tick, end to end

1. Simulator emits `Tick` (protobuf) → `ticks.raw`, partitioned by symbol.
2. Aggregator updates candle + Redis hash, `PUBLISH tick:RELIANCE <msgpack>`.
3. Each gateway instance subscribed to that channel (because ≥1 of its clients subscribed) puts the tick into each interested connection's conflation map (overwrite).
4. Every 250 ms the gateway flushes one binary `DELTA` frame per connection (skipped if the socket is backpressured; the map keeps only the latest).
5. App: WS `onmessage` → `ArrayBuffer` → `decodeMsgpack` from `@arth/market` (dependency-free, worklet-safe) → index→symbol mapping → one `tickStore.apply()` per frame, i.e. at most 4 store writes/s at the default rate.
6. Only rows whose symbol changed re-render (per-symbol selector; untouched quotes keep object identity); the flash runs on the UI thread via a Reanimated shared value and is skipped under Reduce Motion.
7. Latency is measured per frame as client receive time minus the newest row's source `ts` (`stream.stats.lastLatencyMs`).

**Decision — decode on the JS thread (for now):** a 50-row delta frame (1.2 KB) decodes in ~17 µs (Jest/Node, `decoder.test.ts`), and frames arrive every 250 ms. Moving that to a worklet runtime would add a thread hop per frame to save well under 0.1 % of the JS frame budget. The decoder has no dependencies so it can move to a worklet if the emulator trace ever shows otherwise.

## 4. Wire protocol (app ⇄ stream-gateway)

Types live in `packages/market/src/wire.ts` and are shared by the gateway, the load test and the app.

- Auth: WebSocket subprotocols `["arth.v1", "bearer.<accessJWT>"]` (browsers and RN cannot set headers on the upgrade). Rejections are plain HTTP: 401 (missing or invalid token), 429 (more than 3 sockets per user), 503 (draining).
- Client → server: small JSON text frames: `{op:"sub",symbols:[…],depth?:"SYM"}`, `{op:"unsub",symbols:[…]}`, `{op:"resync"}`, `{op:"ping",t}`, `{op:"rate",ms}` (clamped to 100–2,000 ms). At most 250 subscriptions per socket; floods are rate-limited and then closed with 4029.
- Server → client: binary MessagePack `[type, seq, payload]`
  - `0 SNAPSHOT`: `[[idx, ltp, volume, high, low, tsMs, prevClose, open], …]`
  - `1 DELTA`: `[[idx, ltp, volume, high, low, tsMs], …]`, one row per changed symbol per flush.
  - `2 SUB_ACK`: `{SYM: idx}`. Indexes are per connection, which keeps delta rows small.
  - `3 DEPTH`: `[idx, bids[5][2], asks[5][2], tsMs]`, only for the one symbol in depth mode.
  - `4 PONG`: echoes `t`.
  - `5 ERROR`: `{code, message}`.
- `seq` is per connection and contiguous. On a gap the client sends `resync` and the server replies with a full `SNAPSHOT`.
- Reconnect: backoff with equal jitter (500 ms × 2ⁿ, capped at 30 s). The token is refreshed first if it expires within 30 s, or if the last upgrade failed with 401. The client then resends its full desired set and gets `SUB_ACK` + `SNAPSHOT`. A socket that has been silent for 45 s despite 20 s pings is treated as dead.

## 5. Kafka topics (Protobuf, versioned `.proto` in `packages/proto`)

| Topic | Key | Partitions | Message |
|---|---|---|---|
| `ticks.raw` | symbol | 12 | `Tick{symbol, ltp, volume, bids[5], asks[5], ts_ms, seq}` |
| `candles.1m` | symbol | 12 | `Candle{symbol, open, high, low, close, volume, bucket_start_ms}` |
| `alerts.fired` | user_id | 6 | `AlertFired{alert_id, user_id, symbol, condition, trigger_price, ts_ms}` |
| `digest.ready` | user_id | 3 | `DigestReady{user_id, digest_id, title}` |
| `notifications.dlq` | user_id | 1 | `FailedNotification{payload, reason, attempts}` |
| `portfolio.updated` | user_id | 6 | `PortfolioUpdated{user_id, version, ts_ms}` |
| `news.ingested` | doc_id | 6 | `NewsIngested{doc_id, symbols[], source, url, published_ms}` |
| `user.deleted` | user_id | 6 | `UserDeleted{user_id, ts_ms}`. Every service that keeps per-user state (alert-engine index, ai chat cache, notifier device list) purges on receipt (DPDP erasure). |

Generated code: TS (`ts-proto`) for Node services, Java (`protoc` via Gradle plugin) for api, Python (`betterproto`) for ai.

## 6. REST contracts

**api-service** (OpenAPI 3.1 via springdoc → `packages/api-client` via `openapi-typescript` + `openapi-fetch`). Errors are RFC 7807 problem+json. All non-GET writes accept `Idempotency-Key`.

| Area | Endpoints |
|---|---|
| Auth | `POST /v1/auth/otp/request` · `POST /v1/auth/otp/verify` · `POST /v1/auth/refresh` · `POST /v1/auth/logout` |
| Me / DPDP | `GET/PATCH /v1/me` · `POST /v1/me/devices` · `GET/PUT /v1/me/consents` · `GET /v1/me/export` · `DELETE /v1/me` |
| Instruments | `GET /v1/instruments?q=&cursor=&limit=` · `GET /v1/instruments/{symbol}` · `GET /v1/instruments/{symbol}/candles?tf=1m\|5m\|15m\|1d&before=&limit=` (cursor = bucket time) |
| Watchlists | `GET/POST /v1/watchlists` · `PATCH/DELETE /v1/watchlists/{id}` · `PUT /v1/watchlists/{id}/items` (ordered list, ≤200) · `PUT /v1/watchlists/order` |
| Portfolio | `POST /v1/portfolio/import/cas` (multipart + password) · `POST /v1/portfolio/import/csv` · `GET/POST /v1/portfolio/holdings` · `PATCH/DELETE /v1/portfolio/holdings/{id}` · `GET /v1/portfolio/summary` · `GET /v1/portfolio/allocation?by=sector\|mcap\|asset` · `GET /v1/portfolio/history?range=` |
| Alerts | `GET/POST /v1/alerts` · `PATCH/DELETE /v1/alerts/{id}` |
| Internal | `/internal/v1/users/{id}/holdings`, `/metrics`, `/exposure`, `/compare` (service JWT, not exposed by nginx) |

**ai-service:** `POST /v1/chat/sessions` · `GET /v1/chat/sessions/{id}` · `POST /v1/chat/sessions/{id}/messages` → SSE events `token`, `tool` (status), `block`, `citation`, `done`, `error` · `GET /v1/digest/today` · `POST /v1/voice/transcribe` (Whisper-compatible, Groq default).

## 7. Data model (PostgreSQL 17 + TimescaleDB + pgvector)

```mermaid
erDiagram
  users ||--o{ devices : has
  users ||--o{ consents : gives
  users ||--o{ watchlists : owns
  watchlists ||--o{ watchlist_items : contains
  instruments ||--o{ watchlist_items : ""
  users ||--o{ holdings : owns
  users ||--o{ transactions : made
  instruments ||--o{ holdings : ""
  users ||--o{ alerts : sets
  instruments ||--o{ candles_1m : ""
  documents ||--o{ document_chunks : split_into
  users ||--o{ chat_sessions : starts
  chat_sessions ||--o{ chat_messages : has
  users ||--o{ digests : receives
```

- `users(id uuid, phone_e164 unique, name, locale, created_at, deleted_at)`
- `devices(id, user_id, expo_push_token, platform, last_seen_at)`
- `consents(user_id, purpose enum[core, ai_copilot, push, analytics], granted bool, version, at)` — append-only log
- `instruments(symbol pk, isin, name, sector, mcap_bucket, asset_class, lot_size, tick_size, prev_close)`
- `watchlists(id, user_id, name, position)` · `watchlist_items(watchlist_id, symbol, position)` — check ≤200 per list
- `holdings(id, user_id, symbol, qty, avg_cost, source enum[cas,csv,manual], imported_at)`
- `transactions(id, user_id, symbol, side, qty, price, traded_on)` — for XIRR
- `alerts(id, user_id, symbol, kind enum[above,below,pct_move], value, active, last_fired_at)`
- `candles_1m(symbol, bucket timestamptz, o,h,l,c numeric, v bigint)` — hypertable, compression after 7 days; continuous aggregates `candles_5m`, `candles_15m`, `candles_1d`
- `documents(id, source, url, title, symbols text[], published_at, kind enum[filing,result,news])`
- `document_chunks(id, document_id, ord, text, tsv tsvector GIN, embedding vector(1024) HNSW)`
- `chat_sessions(id, user_id, title, created_at)` · `chat_messages(id, session_id, role, content, blocks jsonb, citations jsonb, tokens_in, tokens_out)`
- `digests(id, user_id, for_date, items jsonb, data_version)` unique(user_id, for_date)
- support: `refresh_tokens(id, user_id, family_id, hash, revoked_at)`, `idempotency_keys(key, user_id, response, expires_at)`, `ai_usage(user_id, day, tokens)`

Schema ownership: api-service owns `public` (Flyway); ai-service owns schema `ai` (documents/chunks/chat/digests/usage, Alembic).

## 8. AI copilot

- **Agent loop:** `LLMProvider.stream(messages, tools)` → run tool calls (parallel when independent, max 6 steps) → stream final tokens. Providers: `AnthropicProvider` (default), `OpenAIProvider`, `GeminiProvider`, `OllamaProvider`, selected by env.
- **Tools:** `get_holdings`, `get_portfolio_metrics(range)`, `get_price_history(symbol, range)`, `get_sector_exposure`, `compare_to_index(index, range)`, `search_filings(query, symbols)`, `search_news(query, symbols, since)`, `explain_term(term)`. Portfolio tools call api-service `/internal` with a service JWT scoped to the user.
- **Grounding check:** every number in the final answer must appear in (or be derivable by rounding from) a tool result in this turn; a post-check flags unsupported numbers and triggers one regeneration, else strips the claim.
- **Generative UI:** the model calls a `render_block` pseudo-tool (`line_chart`, `allocation_donut`, `holdings_table`, `stock_chips`); args are validated with Pydantic, data is filled from tool results (not model-typed numbers), and sent as `block` SSE events rendered natively.
- **RAG:** ingest (seed corpus of public NSE announcements/results summaries + news, plus a scheduled fetcher behind a `NewsSource` interface) → clean → chunk (~400 tokens, 60 overlap, heading-aware) → embed → pgvector + `tsvector`. Query: FTS top-30 ∪ vector top-30 → reciprocal rank fusion → rerank (cross-encoder `bge-reranker` locally, LLM rerank fallback) → top-6 with citations (doc id, title, url, date).
- **Prompt-injection defense:** retrieved text wrapped in `<untrusted_document>` tags, system prompt declares them data-only, instruction-like spans flagged by a heuristic classifier and neutralized; tools are read-only and user-scoped, so even a successful injection cannot exfiltrate other users' data.
- **Compliance guard (SEBI):** (1) system prompt; (2) output guard = regex/lexicon pre-filter + small LLM classifier on the final answer for advice/targets; (3) on hit → refusal template with educational reframing; (4) disclaimer rendered on every assistant message.
- **DPDP:** AI features gated on the `ai_copilot` consent; PAN/email/phone masked before any LLM call; delete cascades to chats, digests, usage.
- **Budgets & cache:** per-user daily token budget (`ai_usage`), Redis response cache keyed `(user, normalized question, portfolio version, corpus version)`.
- **Evals:** `services/ai/evals/*.jsonl` (≥40 cases: numeric grounding, refusals, injection, citations, Hinglish) + scorer producing groundedness and refusal precision/recall; runs in CI against a recorded-fixture provider and live on demand.

## 9. Mobile app

```
apps/mobile/src/
  app/          Expo Router (typed routes): (auth)/ consent (tabs)/{index,settings} search watchlists watchlist/[id] privacy
  features/
    market/     streamClient.ts (socket state machine, transport-agnostic, unit-tested with a fake socket)
                stream.ts (app singleton) · hooks.ts (AppState/NetInfo wiring, viewport subscriptions)
                decoder.ts · tickStore.ts (zustand, per-symbol selectors) · QuoteRow · StatusPill · format.ts
    watchlists/ queries.ts (TanStack Query, optimistic mutations with rollback)
    auth/ consent/ settings/
  data/         api client (openapi-fetch + single-flight refresh), queryClient, MMKV prefs
  ui/           theme (dark/light), Text, Button, Chip, IconButton, TextField, ListRow, Screen
  i18n/         en, hi
```

Watchlist reordering uses up/down buttons instead of drag-and-drop. They work with TalkBack and Switch Access without a separate accessible path, and the server contract (`PUT /v1/watchlists/{id}/items` with the full ordered list) is the same either way.

Key guarantees: rows are `memo` components reading only their symbol's slice; `renderItem`/`keyExtractor`/`getItemType` are stable module-level functions; no tick ever touches React state above the row. Chart drawing and crosshair are Skia + Reanimated derived values on the UI thread; only visible candles (+1 screen of overscan) are turned into paths, cached per (timeframe, viewport window).

## 9a. Realtime services: build and runtime notes

- Kafka client: `@platformatic/kafka`, not kafkajs. kafkajs is unmaintained and has no lz4 codec; `@platformatic/kafka` is maintained, typed, and supports lz4 natively.
- uWebSockets.js v20.71 ships an ESM wrapper that points at a missing file, so the gateway loads the CJS entry through `createRequire`.
- uWS needs glibc ≥ 2.38, so the Node service image uses `node:24-trixie-slim` (`infra/node-service.Dockerfile`).
- Services are bundled with esbuild. Native or optional-dependency packages (uWS, `@platformatic/kafka` and its codecs) are left external, and `infra/scripts/copy-externals.mjs` copies their dependency closure into the image.

## 10. Security

JWT access (15 min) + rotating refresh tokens with family-based reuse detection, stored in `expo-secure-store` · biometric app lock · OTP through a pluggable `SmsProvider` (dev provider logs the code; rate-limited per phone) · service-to-service JWT for `/internal` · nginx + Redis rate limits · secrets only in `.env` (`.env.example` committed).

## 11. Environment constraints (this dev machine)

16 cores, ~7.5 GB RAM, Docker Desktop VM capped at ~4 GB, Android emulator with KVM available, no physical Android device attached. Consequences:

- Compose uses one Kafka broker, small JVM heaps, and a `profile` split (`core`, `realtime`, `ai`, `obs`) so not everything has to run at once; the load test runs the realtime profile only.
- Mobile perf numbers will be measured on the emulator and labelled as such; the mid-range-device budget needs a physical Redmi/Realme-class phone, and the report will say which numbers are still pending a device run.
- Backend load numbers are reported with the exact hardware and container limits.
