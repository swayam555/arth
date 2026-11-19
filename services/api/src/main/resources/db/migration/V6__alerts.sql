CREATE TABLE alerts (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    symbol        text          NOT NULL REFERENCES instruments (symbol),
    kind          text          NOT NULL CHECK (kind IN ('above', 'below', 'pct_move')),
    value         numeric(14,4) NOT NULL CHECK (value > 0),
    active        boolean       NOT NULL DEFAULT true,
    last_fired_at timestamptz,
    created_at    timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX alerts_user ON alerts (user_id, created_at DESC);
CREATE INDEX alerts_active_symbol ON alerts (symbol) WHERE active;
