CREATE TABLE portfolio_imports (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind         text        NOT NULL CHECK (kind IN ('csv', 'cas')),
    provider     text,
    file_sha256  text        NOT NULL,
    rows_ok      int         NOT NULL,
    rows_failed  int         NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, file_sha256)
);

CREATE TABLE portfolio_txns (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid           NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    symbol      text           NOT NULL REFERENCES instruments (symbol),
    side        text           NOT NULL CHECK (side IN ('BUY', 'SELL')),
    qty         numeric(18, 4) NOT NULL CHECK (qty > 0),
    price       numeric(14, 4) NOT NULL CHECK (price >= 0),
    trade_date  date           NOT NULL,
    source      text           NOT NULL CHECK (source IN ('manual', 'csv', 'cas')),
    import_id   uuid           REFERENCES portfolio_imports (id) ON DELETE SET NULL,
    created_at  timestamptz    NOT NULL DEFAULT now()
);
CREATE INDEX portfolio_txns_user ON portfolio_txns (user_id, trade_date, created_at);

CREATE TABLE portfolio_versions (
    user_id     uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    version     bigint      NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
