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
