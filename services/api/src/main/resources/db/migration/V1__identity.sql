CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_e164  text        NOT NULL UNIQUE,
    name        text,
    locale      text        NOT NULL DEFAULT 'en',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expo_push_token  text        NOT NULL,
    platform         text        NOT NULL CHECK (platform IN ('android', 'ios')),
    last_seen_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, expo_push_token)
);

CREATE TABLE consents (
    id          bigserial PRIMARY KEY,
    user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose     text        NOT NULL CHECK (purpose IN ('core', 'ai_copilot', 'push', 'analytics')),
    granted     boolean     NOT NULL,
    version     text        NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_user_purpose ON consents (user_id, purpose, recorded_at DESC);

CREATE TABLE refresh_tokens (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    family_id    uuid        NOT NULL,
    token_hash   bytea       NOT NULL UNIQUE,
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family ON refresh_tokens (family_id);

CREATE TABLE idempotency_keys (
    user_id       uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    key           text        NOT NULL,
    request_hash  bytea       NOT NULL,
    status        int         NOT NULL,
    body          bytea,
    content_type  text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
);
