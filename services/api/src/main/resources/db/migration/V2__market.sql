CREATE TABLE instruments (
    symbol       text PRIMARY KEY CHECK (symbol ~ '^[A-Z0-9&-]{1,20}$'),
    isin         text        NOT NULL UNIQUE CHECK (length(isin) = 12),
    name         text        NOT NULL,
    sector       text        NOT NULL,
    mcap_bucket  text        NOT NULL CHECK (mcap_bucket IN ('large', 'mid', 'small')),
    asset_class  text        NOT NULL CHECK (asset_class IN ('equity', 'etf')),
    lot_size     int         NOT NULL DEFAULT 1,
    tick_size    numeric(6, 2) NOT NULL,
    prev_close   numeric(12, 2) NOT NULL,
    circuit_pct  smallint    CHECK (circuit_pct IN (5, 10, 20))
);
CREATE INDEX instruments_symbol_trgm ON instruments USING gin (symbol gin_trgm_ops);
CREATE INDEX instruments_name_trgm ON instruments USING gin (lower(name) gin_trgm_ops);

CREATE TABLE watchlists (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name        text        NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
    position    int         NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX watchlists_user ON watchlists (user_id, position);

CREATE TABLE watchlist_items (
    watchlist_id uuid NOT NULL REFERENCES watchlists (id) ON DELETE CASCADE,
    symbol       text NOT NULL REFERENCES instruments (symbol),
    position     int  NOT NULL CHECK (position BETWEEN 0 AND 199),
    PRIMARY KEY (watchlist_id, symbol)
);

CREATE TABLE candles_1m (
    symbol  text          NOT NULL,
    bucket  timestamptz   NOT NULL,
    o       numeric(12, 2) NOT NULL,
    h       numeric(12, 2) NOT NULL,
    l       numeric(12, 2) NOT NULL,
    c       numeric(12, 2) NOT NULL,
    v       bigint        NOT NULL,
    PRIMARY KEY (symbol, bucket)
);
SELECT create_hypertable('candles_1m', by_range('bucket', INTERVAL '1 day'));
ALTER TABLE candles_1m SET (timescaledb.compress, timescaledb.compress_segmentby = 'symbol', timescaledb.compress_orderby = 'bucket DESC');
SELECT add_compression_policy('candles_1m', INTERVAL '7 days');
