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

## Phase 5 (AI Copilot) — DONE (committed); no LLM key, Docker down, device unverified
- Tests: ai pytest 58 + evals 63/63 (frozen holdout recall 0.20, see services/ai/evals/README.md), mobile 100. api internal test compiles only.
- Run ai locally: `cd services/ai && uv sync && AI_BACKEND=memory .venv/bin/uvicorn arth_ai.main:app --port 8090` (scripted provider without keys). In compose: `--profile ai`. Keys: ANTHROPIC_API_KEY (default provider), GROQ_API_KEY (voice), VOYAGE_API_KEY (embeddings, optional).
- To verify when resources allow: InternalApiTest, alembic upgrade on PG, compose ai + nginx SSE (`curl -N`), real-provider turn, device chat + mic.

## Phase 6 (Alerts/push/digest) — DONE (committed); Docker down, emulator push unverified
- Tests: mobile 114, alert-engine 19, notifier 11, ai 76; api compiles (AlertApiTest + AuthFlowTest device test not run).
- To verify: compose realtime+ai stack → create alert → feed crosses → notifier log/Expo push → tap opens instrument; kill Expo creds → DLQ; digest at 15:45 IST once per user. Needs EAS projectId for real push. Regenerate openapi.json from springdoc.
- Gotchas: RNTL 14 fireEvent is async (await it); React Query tests need gcTime: Infinity or Jest hangs.

## Phase 7 (Hardening) — DONE in code (committed); k6/Maestro/memory runs pending
- Tests: mobile 147 (coverage thresholds in jest.config.js), ai 79, turbo 22/22, api unit tests. Runbook: docs/OBSERVABILITY.md.
- To verify: compose core+realtime+ai+obs with OTEL_ENDPOINT=http://jaeger:4318 OTEL_EXPORT=true → Grafana :7300, Jaeger :7686; k6 rest/ws → record in docs/perf/BACKEND.md; Maestro on emulator; 15-min memory soak.
- Gotcha: dynamic import() fails under Jest without --experimental-vm-modules, so use static imports.

## Phase 8 (Publish-readiness) — DONE in docs/config (committed); release APK + cold start unmeasured
- Added: icons (infra/brand/gen_icons.py), eas.json + expo-updates, docs/legal/PRIVACY_POLICY.md, docs/release/RELEASE.md, README.md, docs/perf/REPORT.md, INTERVIEW_NOTES, RESUME_BULLETS.
- Rule: README/RESUME numbers must cite a REPORT.md row; add new measurements to REPORT first.
- To verify (needs ~6 GB free disk + emulator): `cd apps/mobile && npx expo prebuild -p android && cd android && ./gradlew assembleRelease`, install the APK, `adb shell am start -W -n in.arth.app/.MainActivity` ×10 → record median TotalTime in REPORT.md; then `eas init` + `eas update:configure`.

## Remaining (all phases): device/emulator runs, Docker-backed integration tests, k6, Maestro, memory soak, real LLM key
