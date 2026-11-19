# Arth — performance and quality report

Every number in `README.md` and `docs/RESUME_BULLETS.md` comes from a line in this file, and each line names its source. Anything not yet measured is listed under [Not measured](#not-measured), and those numbers appear nowhere else.

**Machine:** AMD Ryzen 7 5700U (8C/16T), 7.2 GB RAM, Node 24.18.0. Backend runs on 2026-11-19 (`docs/perf/BACKEND.md`).

## Realtime pipeline (source: `docs/perf/BACKEND.md`)

| # | Metric | Value | Source line |
|---|---|---|---|
| R1 | Feed rate | 2,500 ticks/s across 2,100 symbols | BACKEND.md "Feed" |
| R2 | Aggregation throughput, single core | 100k ticks in 23 ms (~4.3 M ticks/s) | BACKEND.md aggregator table, `test/aggregator.test.ts` |
| R3 | Source tick → Redis publish, mean | 56 ms (100 % under 200 ms) | BACKEND.md aggregator table |
| R4 | Aggregator consumer lag under load | 0 | BACKEND.md aggregator table |
| R5 | Gateway hub flush, 2,000 sessions × 50 symbols | 26.6 ms per 250 ms cycle | BACKEND.md hub benchmark |
| R6 | End-to-end, 1,000 sockets × 50 symbols, 20 s | 3,985 frames/s, 40,960 delta rows/s | BACKEND.md load table |
| R7 | Source tick → client latency at 1,000 sockets | p50 177 ms · p95 313 ms · p99 350 ms · max 369 ms | BACKEND.md load table |
| R8 | Integrity at 1,000 sockets | 0 sequence gaps, 0 errors | BACKEND.md load table |
| R9 | Bandwidth per client | 1.80 KB/s | BACKEND.md load table |
| R10 | Gateway footprint at 1,000 sockets | 132 MB RSS, 6.4 % CPU | BACKEND.md "Gateway at 1,000 sockets" |
| R11 | 200 sockets, 30 s | p50 176 ms · p99 346 ms | BACKEND.md load table |
| R12 | Full Docker stack behind nginx `/ws`, 300 sockets | p50 183 ms · p99 360 ms, 0 gaps | BACKEND.md load table |

The ~175 ms p50 comes from conflation by design, not from queueing. The aggregator flushes every 100 ms, which adds about 50 ms on average, and the gateway flushes every 250 ms, which adds about 125 ms. Together they predict about 175 ms (BACKEND.md "Reading the latency"). p50 stays flat from 200 to 1,000 sockets (R7, R11), so fan-out is not the bottleneck at this scale.

## Mobile

| # | Metric | Value | Source |
|---|---|---|---|
| M1 | Android JS bundle (Hermes bytecode) | 5.3 MB | `expo export --platform android`, CHANGELOG Phase 4 |
| M2 | Jest tests | 147 in 20 suites | CHANGELOG Phase 7 |
| M3 | Per-file coverage gates on 12 critical modules | decoder 100 %, sse 98 %, historyStore 94 %, streamClient 94 %, reducer 92 %, session 92 % | `apps/mobile/jest.config.js`, CHANGELOG Phase 7 |

## AI copilot

| # | Metric | Value | Source |
|---|---|---|---|
| A1 | Eval suite (`services/ai/evals/cases.json`) | 63/63 (the first run was 56/63; the fixes are listed in the CHANGELOG) | CHANGELOG Phase 5 |
| A2 | Frozen holdout: regex input-guard recall / precision | 0.20 / 1.00 | `services/ai/evals/README.md`, CHANGELOG Phase 5 |
| A3 | pytest | 79 passed | CHANGELOG Phase 7 |

A2 is reported because it is a weak number. It is the reason the regex guard is only a pre-filter, with the system prompt, output guard and read-only user-scoped tools acting as the real boundary.

## Backend tests

| # | Suite | Count | Source |
|---|---|---|---|
| T1 | api (Spring Boot, Testcontainers) | 40 | CHANGELOG Phase 4 |
| T2 | market / feed-simulator / tick-aggregator / stream-gateway | 35 / 8 / 7 / 13 | CHANGELOG Phase 3 |
| T3 | alert-engine / notifier | 19 / 11 | CHANGELOG Phase 6 |

## Not measured

These have not been measured yet. They need a free emulator or device, or a running Docker stack. Until they are run, nothing here is quoted anywhere.

| Metric | Budget (PLAN.md) | How to measure |
|---|---|---|
| Release APK cold start | < 2 s on a mid-range phone | `adb shell am start -W -n in.arth.app/.MainActivity` → `TotalTime`, median of 10 runs after `am force-stop` |
| Watchlist scroll FPS (200 live rows) | ≥ 55 fps | `adb shell dumpsys gfxinfo in.arth.app reset`, scroll 30 s with Maestro, then `dumpsys gfxinfo` → janky frames %, 90th percentile frame time |
| Chart pan/pinch FPS (10k candles) | ≥ 55 fps | Same, on the instrument screen |
| 15-minute memory soak | No growth trend after warm-up | `adb shell dumpsys meminfo in.arth.app` every 60 s while streaming |
| k6 REST and WS | Thresholds in `infra/load/*.js` | `k6 run infra/load/rest.js` and `infra/load/ws.js` against the compose stack |
| Copilot time to first token, real provider | — | Needs `ANTHROPIC_API_KEY` |
