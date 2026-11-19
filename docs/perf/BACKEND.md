# Backend performance — measured

All numbers below were measured on one laptop. Nothing is extrapolated. When the load generator and the server share a machine, the result is a floor, not a ceiling.

**Machine:** AMD Ryzen 7 5700U (8C/16T), 7.2 GB RAM (~1.6 GB free during runs), Node 24.18.0. Kafka, Redis and Postgres ran in Docker (`infra/docker-compose.yml`, profile `core`).

**Date:** 2026-11-19.

## Pipeline under test

```
feed-simulator ──Kafka ticks.raw (12p, lz4)──▶ tick-aggregator ──Redis PUBLISH tick:{SYM} + HSET ltp:{SYM}──▶ stream-gateway (uWS) ──msgpack WS──▶ clients
                                                        └──▶ Postgres candles_1m + Kafka candles.1m
```

- Feed: 2,500 ticks/s across a 2,100-symbol universe, in 50 ms batches.
- Aggregator flush: 100 ms.
- Gateway: default per-session flush of 250 ms, global tick of 25 ms.

## Tick aggregator

| Metric | Value | Source |
|---|---|---|
| Ticks consumed (first ~36 s) | 89,695 | `arth_agg_ticks_total` |
| Conflated quotes published to Redis | 77,045 | `arth_agg_quotes_published_total` |
| Source ts → Redis publish, mean | 56 ms | `tick_age_seconds_sum / count` |
| Source ts → Redis publish, ≤ 200 ms | 100 % | histogram bucket `le=0.2` |
| Consumer lag | 0 | `arth_agg_consumer_lag` |
| 1m candles in Postgres after ~3 min | 6,257 rows, 2,100 symbols | `select count(*) from candles_1m` |
| Pure aggregation throughput | 100k ticks in 23 ms (~4.3 M ticks/s, single core) | `test/aggregator.test.ts` |

## Stream gateway

### Unit benchmark (in-process fake transport)

- 2,000 sessions × 50 symbols each, with every symbol ticking: **26.6 ms per 250 ms flush cycle**. The flush therefore uses about 11 % of one core per cycle.
- Source: `services/stream-gateway/test/hub.test.ts`.

### End-to-end load test

The test drives real sockets through the whole pipeline: Kafka, aggregator, Redis, uWS and `ws` clients. It uses `services/stream-gateway/scripts/load.ts`. Each client opens its own JWT-authenticated socket, subscribes to 50 random symbols, and measures latency from the source tick timestamp to client receipt.

| Clients | Duration | Frames/s | Delta rows/s | KB/s per client | p50 | p95 | p99 | max | Seq gaps | Errors |
|---|---|---|---|---|---|---|---|---|---|---|
| 200 | 30 s | 799 | 8,360 | 1.78 | 176 ms | 320 ms | 346 ms | 372 ms | 0 | 0 |
| 1,000 | 20 s | 3,985 | 40,960 | 1.80 | 177 ms | 313 ms | 350 ms | 369 ms | 0 | 0 |
| 300, all in Docker, via nginx `/ws` | 20 s | 1,155 | 12,118 | 1.78 | 183 ms | 322 ms | 360 ms | 448 ms | 0 | 0 |

In the Docker-compose run, every service ran in its container with its `mem_limit` (`docker compose --profile realtime up`). `docker stats` during the run showed: gateway 51 MiB, aggregator 68 MiB at 20 % CPU, feed 51 MiB, nginx 5 MiB.

- Gateway at 1,000 sockets: **132 MB RSS, 6.4 % CPU**, measured with `ps` right after the run.
- `arth_gw_flushes_skipped_total` = 0 and `arth_gw_frames_dropped_total` = 0. No client hit backpressure.

### Reading the latency

End-to-end latency is set by the conflation cadence, not by compute:

- The aggregator flushes every 100 ms, so it adds about 50 ms on average.
- The client flushes every 250 ms, so it adds about 125 ms on average.

Together that predicts roughly 175 ms. The measured p50 is 176–177 ms. A client that sends `{op:"rate", ms:100}` trades bandwidth for lower latency. p50 and p99 stay flat from 200 to 1,000 clients, which shows that fan-out is not the bottleneck at this scale.

## Reproduce

```bash
cd infra && docker compose --profile core up -d postgres redis kafka
pnpm --filter @arth/feed-simulator --filter @arth/tick-aggregator --filter @arth/stream-gateway build
node services/feed-simulator/dist/main.js &
node services/tick-aggregator/dist/main.js &
node services/stream-gateway/dist/main.js &
curl -s localhost:9102/metrics | grep arth_agg_
cd services/stream-gateway && CLIENTS=1000 SYMBOLS=50 SECONDS=20 npx tsx scripts/load.ts
```
