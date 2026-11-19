# Arth — progress

Source of truth for scope: docs/PLAN.md. History: docs/CHANGELOG.md.

## Phase 1 (Foundation) — DONE (committed), one acceptance item carried over
- Verified: api 7/7 Testcontainers tests, mobile 18/18 Jest, typecheck + lint clean, compose `core` healthy, full auth/consent/export flow via nginx.
- Carried over: emulator run of the app (RAM). Do it at the start of Phase 2 with the compose stack stopped or before services are heavy:
  `cd apps/mobile && npx expo run:android` (set `reactNativeArchitectures=x86_64` in android/gradle.properties to cut build time/RAM), AVD `dukaan_lowram` or a new one.
- Run: `docker compose -f infra/docker-compose.yml --profile core up -d --build` then `pnpm dev`. OTP code is printed in `docker logs arth-api-1` (or set OTP_FIXED_CODE).

## Phase 2 (Streaming) — DONE (committed 5e07730); emulator FPS gate unverified
## Phase 3 (Charts) — DONE (committed); emulator FPS + device depth unverified (disk ~1.2 GB free, Docker stopped)
- Tests: api 17, market 35, feed-sim 8, aggregator 7, gateway 13, mobile 67. `pnpm turbo run typecheck lint test` green.
- Gotchas: Skia PathBuilder (immutable SkPath); no class-level @Validated on controllers; RNTL 14 renderHook/act are async; hoist useCandles deps in tests (inline → infinite reload/OOM).

## Phase 4 (Portfolio) — DONE (committed); emulator UI unverified
- Tests: api 40, mobile 76, rest unchanged. Samples in samples/ (Zerodha tradebook + custom CSV).
- Units: pct fields are percents (4dp); weight/xirr are fractions; xirr absent with <2 flows.

## Next: Phase 5 — AI Copilot (see docs/PLAN.md)
