# Setup: requirements and keys

## Prerequisites

| Tool | Version | For |
|---|---|---|
| Node + pnpm | Node ≥ 22, pnpm 10+ | monorepo, realtime services, app |
| Java | 21 | `services/api` (Spring Boot) |
| uv | latest | `services/ai` (Python 3.13) |
| Docker | ~4 GB RAM for `core` + `realtime`, more with `ai` / `obs` | full stack |
| Android Studio / emulator | API 34+ | running the app |

## Where each key goes

There are two env files. Copy each example and fill in only what you need.

| File | Copy from | Read by |
|---|---|---|
| `infra/.env` | `infra/.env.example` | `docker compose -f infra/docker-compose.yml` |
| `apps/mobile/.env` | `apps/mobile/.env.example` | Expo (`EXPO_PUBLIC_*` is baked into the app bundle; never put secrets there) |

### AI keys (all optional)

The default model is `claude-opus-5-5` (override with `ANTHROPIC_MODEL`). `LLM_PROVIDER=auto` picks Anthropic when its key is set, otherwise the scripted provider.


| Variable | Where to get it | What it turns on | Without it |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com | Real copilot answers (Claude, default provider) | Scripted provider: the full agent loop runs, with canned answers |
| `GROQ_API_KEY` | console.groq.com | Voice questions (Whisper) | Voice input is unavailable; typed questions still work |
| `VOYAGE_API_KEY` + `EMBEDDER=voyage` | voyageai.com | Higher-quality RAG embeddings | Local hashing embedder |

### Other keys (all optional)

| Variable | What it does |
|---|---|
| `PUSH_SENDER=expo` + `EXPO_ACCESS_TOKEN` | Real push via Expo (also needs `eas init`, see `docs/release/RELEASE.md`) |
| `JWT_SECRET`, `INTERNAL_JWT_SECRET` | Change for any deployment that isn't your laptop |
| `SENTRY_DSN` (server) / `EXPO_PUBLIC_SENTRY_DSN` (app) | Crash reporting; the app sends nothing until analytics consent |
| `OTEL_EXPORT=true` | Traces to Jaeger (`--profile obs`) |

### App env (`apps/mobile/.env`)

| Variable | Emulator default |
|---|---|
| `EXPO_PUBLIC_API_URL` | `http://10.0.2.2:7080` |
| `EXPO_PUBLIC_WS_URL` | `ws://10.0.2.2:7080/ws` |
| `EXPO_PUBLIC_SENTRY_DSN` | empty |

On a physical phone, replace `10.0.2.2` with your laptop's LAN IP.

## Run

```sh
cp infra/.env.example infra/.env && cp apps/mobile/.env.example apps/mobile/.env
pnpm install && pnpm build
docker compose -f infra/docker-compose.yml --profile core --profile realtime --profile ai up -d --build
cd apps/mobile && npx expo run:android
```

Log in with any 10-digit number; the OTP is printed in `docker logs arth-api-1` (or set `OTP_FIXED_CODE`).
