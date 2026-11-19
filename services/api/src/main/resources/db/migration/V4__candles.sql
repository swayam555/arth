-- Continuous aggregates over candles_1m. Real-time aggregation (materialized_only = false) merges the
-- not-yet-materialized tail so the newest bucket is always current.
CREATE MATERIALIZED VIEW candles_5m WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT symbol, time_bucket(INTERVAL '5 minutes', bucket) AS bucket,
       first(o, bucket) AS o, max(h) AS h, min(l) AS l, last(c, bucket) AS c, sum(v)::bigint AS v
FROM candles_1m GROUP BY symbol, time_bucket(INTERVAL '5 minutes', bucket) WITH NO DATA;

CREATE MATERIALIZED VIEW candles_15m WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT symbol, time_bucket(INTERVAL '15 minutes', bucket) AS bucket,
       first(o, bucket) AS o, max(h) AS h, min(l) AS l, last(c, bucket) AS c, sum(v)::bigint AS v
FROM candles_1m GROUP BY symbol, time_bucket(INTERVAL '15 minutes', bucket) WITH NO DATA;

CREATE MATERIALIZED VIEW candles_1h WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT symbol, time_bucket(INTERVAL '1 hour', bucket, 'Asia/Kolkata', origin => '2000-01-01 09:15:00+05:30') AS bucket,
       first(o, bucket) AS o, max(h) AS h, min(l) AS l, last(c, bucket) AS c, sum(v)::bigint AS v
FROM candles_1m GROUP BY symbol, time_bucket(INTERVAL '1 hour', bucket, 'Asia/Kolkata', origin => '2000-01-01 09:15:00+05:30') WITH NO DATA;

CREATE MATERIALIZED VIEW candles_1d WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT symbol, time_bucket(INTERVAL '1 day', bucket, 'Asia/Kolkata') AS bucket,
       first(o, bucket) AS o, max(h) AS h, min(l) AS l, last(c, bucket) AS c, sum(v)::bigint AS v
FROM candles_1m GROUP BY symbol, time_bucket(INTERVAL '1 day', bucket, 'Asia/Kolkata') WITH NO DATA;

SELECT add_continuous_aggregate_policy('candles_5m', start_offset => INTERVAL '2 days', end_offset => INTERVAL '5 minutes', schedule_interval => INTERVAL '1 minute');
SELECT add_continuous_aggregate_policy('candles_15m', start_offset => INTERVAL '2 days', end_offset => INTERVAL '15 minutes', schedule_interval => INTERVAL '5 minutes');
SELECT add_continuous_aggregate_policy('candles_1h', start_offset => INTERVAL '7 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '15 minutes');
SELECT add_continuous_aggregate_policy('candles_1d', start_offset => INTERVAL '30 days', end_offset => INTERVAL '1 day', schedule_interval => INTERVAL '1 hour');
