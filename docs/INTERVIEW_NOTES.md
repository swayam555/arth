# Interview notes: the 10 hardest decisions

Each note gives the decision, the alternatives, why I chose what I did, and what it cost. The numbers come from `docs/perf/REPORT.md`.

## 1. Conflate twice and accept ~175 ms instead of chasing per-tick latency
Ticks are conflated twice before they reach the app:
- once per symbol in the aggregator, every 100 ms;
- once per connection in the gateway, every 250 ms.

**Alternative:** forward every tick. A phone can't render 2,500 updates/s, and on mobile radios every wakeup costs battery.

**Cost:** a p50 of 177 ms, which is predictable from the two flush intervals (R7). In return, bandwidth is 1.80 KB/s per client (R9), and latency stays flat from 200 to 1,000 sockets (R11). A client that wants lower latency can ask for it with `{op:"rate"}`. On 2G/3G the app drops to 1–2 s flushes.

## 2. One WebSocket per app, with subscriptions driven by the viewport
The FlashList reports which rows are visible, and only those symbols (plus overscan) are subscribed. Every subscribe gets a snapshot, and every frame carries a per-connection `seq`.

**Alternatives:**
- subscribe to the whole watchlist;
- open a socket per screen.

**Why:** a gap in `seq` triggers a resync instead of showing silently stale prices, and a 200-row list costs only what is on screen. The socket logic is a transport-agnostic state machine, so it can be unit-tested with a fake socket (streamClient at 94 % coverage, M3).

## 3. Keep ticks out of React state
Ticks go to a zustand store with per-symbol selectors. Each row is a `memo` component that reads only its own slice, and `renderItem`, `keyExtractor` and `getItemType` are module-level functions. A tick re-renders one row and never its parents. Charts are drawn with Skia and Reanimated derived values on the UI thread.

**Trade-off:** the code is harder to follow than plain `useState`, and FPS is still unmeasured because no emulator or device run has happened. REPORT.md says so.

## 4. MessagePack deltas instead of JSON or Protobuf on the client wire
Kafka uses versioned Protobuf, because services evolve independently. The app wire uses MessagePack: it needs no codegen on React Native, it is compact, and the decoder is 100 % covered.

**Alternative:** Protobuf end to end. That means one fewer format, but a heavier JS runtime and a schema rollout for every client change.

## 5. uWebSockets.js for the gateway, and its operational price
uWS gives a 132 MB RSS and 6.4 % CPU at 1,000 sockets (R10), with built-in backpressure signals. The operational price:
- its ESM entry is broken, so it is loaded through `createRequire`;
- it needs glibc ≥ 2.38, so the image is `node:24-trixie-slim`;
- esbuild has to leave it external.

Backpressure policy:
- while the send buffer is over 64 KB, skip that flush and keep only the latest value;
- close the socket with 4008 after 20 s stuck.

## 6. Treat the LLM as untrusted in both directions
The copilot's guard layers:
- read-only tools scoped to the user, called through a service JWT;
- retrieved documents wrapped as `<untrusted_document>`;
- numbers in an answer checked against the turn's tool results (`grounding.py`), and unsupported ones stripped;
- chart blocks filled from tool data, never from numbers the model typed;
- a SEBI output guard with a refusal template.

The regex input guard scored recall 0.20 on a frozen holdout (A2). I kept the result and documented it, rather than tuning against the holdout. That weak number is the argument for defence in depth.

## 7. Evals before prompts
Tests alone missed several bugs: "-ing" verb forms, the 5+5 phone format, an educational-prefix bypass, and a false block on "When did I last buy ITC?". The first eval run found all of them and scored 56/63. After the fixes it scored 63/63 (A1). A scripted provider runs the full agent loop without a key, so CI doesn't depend on a paid API.

## 8. DPDP as an architecture constraint, not a settings page
How consent and erasure are built:
- **Consent:** there is one consent per purpose (`core`, `ai_copilot`, `push`, `analytics`). Each change is an append-only row and is enforced at the server (copilot 403, push unregister), not only in the UI.
- **Erasure:** it is an event. `user.deleted` goes out on Kafka, and the ai service commits the offset only after its own erase, so a crash replays the delete instead of losing it. PII is masked before storage and before any LLM call. Sentry is scrubbed, and it is off until analytics consent is given.

## 9. Alert firing that is idempotent under redelivery
Kafka delivers at least once, and the alert engine can restart. Firing needs two things to succeed:
- a Redis cooldown claim;
- a conditional `UPDATE … WHERE active RETURNING`.

The crossing check evaluates every step of a tick batch, so a spike that reverts inside one batch still fires.

**Alternative:** exactly-once Kafka transactions. They are heavier, and they still wouldn't cover the push provider.

## 10. Refresh-token families and an in-memory access token
Tokens are handled like this:
- the access token is short-lived and held only in memory;
- the refresh token is in the OS secure store and rotates on every use;
- reusing a refresh token revokes the whole token family;
- the API client does single-flight refresh, so 10 parallel 401s cause one refresh, not ten rotations, which would otherwise look like reuse.

When the app is offline, it restores the cached user instead of signing out.

**Cost:** more states to test. There are 7 session tests, covering expiry, offline, consent routing and sign-out wipe.

## What I'd do next
In order:
1. Measure cold start, FPS and memory on a ₹12k Android phone.
2. Run k6 and Maestro.
3. Replace the debug-keystore assetlinks.
4. Make the digest scheduler HA (it is single-replica today).
5. Model NSE holidays.
