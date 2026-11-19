# Resume bullets

Each number carries the row ID of its source line in `docs/perf/REPORT.md`. Pick 3 or 4.

**Arth — real-time market terminal + AI portfolio copilot** (React Native/Expo, TypeScript, Spring Boot 4, FastAPI, Kafka, Redis, PostgreSQL/TimescaleDB/pgvector)

- Built an end-to-end market-data pipeline (Kafka → Node aggregator → Redis pub/sub → uWebSockets gateway → RN app). It streams 2,500 ticks/s to 1,000 concurrent sockets at 3,985 frames/s with p99 350 ms from source to client and 0 sequence gaps, using 132 MB RSS and 6.4 % CPU on the gateway. *(R1, R6, R7, R8, R10)*
- Designed a two-stage conflation and backpressure protocol (MessagePack deltas, per-connection sequence numbers, snapshot on resync, adaptive flush on 2G/3G). It cut client bandwidth to 1.80 KB/s at 50 live symbols and kept p50 flat (176 → 177 ms) from 200 to 1,000 sockets. *(R9, R11, R7)*
- Wrote a single-core tick aggregator that processes 100k ticks in 23 ms and holds 0 consumer lag, with a mean source-to-Redis latency of 56 ms. *(R2, R4, R3)*
- Shipped an AI portfolio copilot with tool calling over the user's own holdings, hybrid RAG with citations, generative chart blocks and a SEBI no-advice guard. Took the eval suite from 56/63 to 63/63, and published a frozen-holdout guard recall of 0.20 to justify defence in depth over regex filtering. *(A1, A2)*
- Implemented DPDP-compliant consent per purpose, JSON data export, and cross-service erasure over Kafka. PII is masked before storage and before any LLM call. *(no number)*
- Held the Android Hermes bundle at 5.3 MB, and gated 12 critical mobile modules with per-file coverage thresholds (147 Jest tests; stream client 94 %, decoder 100 %). *(M1, M2, M3)*

Don't add cold-start, FPS or memory numbers until they appear in REPORT.md.
