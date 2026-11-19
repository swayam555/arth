from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _int(name: str, default: int) -> int:
    raw = _env(name)
    return int(raw) if raw else default


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=lambda: _env("DATABASE_URL", "postgresql://arth:arth@localhost:7432/arth"))
    redis_url: str = field(default_factory=lambda: _env("REDIS_URL", "redis://localhost:7379"))
    api_base_url: str = field(default_factory=lambda: _env("ARTH_API_URL", "http://localhost:8080"))
    jwt_secret: str = field(default_factory=lambda: _env("JWT_SECRET", "dev-only-secret-change-me-dev-only-secret-change-me"))
    jwt_issuer: str = field(default_factory=lambda: _env("JWT_ISSUER", "arth-api"))
    internal_secret: str = field(
        default_factory=lambda: _env("INTERNAL_JWT_SECRET", "dev-only-internal-secret-change-me-dev-only-x")
    )
    llm_provider: str = field(default_factory=lambda: _env("LLM_PROVIDER", "auto"))
    anthropic_model: str = field(default_factory=lambda: _env("ANTHROPIC_MODEL", "claude-opus-5-5"))
    anthropic_effort: str = field(default_factory=lambda: _env("ANTHROPIC_EFFORT", "medium"))
    openai_base_url: str = field(default_factory=lambda: _env("OPENAI_BASE_URL", "https://api.openai.com/v1"))
    openai_api_key: str = field(default_factory=lambda: _env("OPENAI_API_KEY"))
    openai_model: str = field(default_factory=lambda: _env("OPENAI_MODEL", "gpt-5"))
    cassette_dir: str = field(default_factory=lambda: _env("LLM_CASSETTE_DIR"))
    cassette_mode: str = field(default_factory=lambda: _env("LLM_CASSETTE_MODE", "replay"))
    embedder: str = field(default_factory=lambda: _env("EMBEDDER", "hashing"))
    voyage_api_key: str = field(default_factory=lambda: _env("VOYAGE_API_KEY"))
    reranker: str = field(default_factory=lambda: _env("RERANKER", "lexical"))
    groq_api_key: str = field(default_factory=lambda: _env("GROQ_API_KEY"))
    daily_token_budget: int = field(default_factory=lambda: _int("DAILY_TOKEN_BUDGET", 200_000))
    answer_cache_ttl_s: int = field(default_factory=lambda: _int("ANSWER_CACHE_TTL_S", 600))
    max_tool_rounds: int = field(default_factory=lambda: _int("MAX_TOOL_ROUNDS", 5))
    news_feed_urls: tuple[str, ...] = field(
        default_factory=lambda: tuple(u for u in _env("NEWS_FEED_URLS").split(",") if u.strip())
    )
    news_poll_s: int = field(default_factory=lambda: _int("NEWS_POLL_S", 900))
    backend: str = field(default_factory=lambda: _env("AI_BACKEND", "pg"))

    @property
    def has_anthropic_key(self) -> bool:
        return bool(_env("ANTHROPIC_API_KEY") or _env("ANTHROPIC_AUTH_TOKEN"))


@lru_cache(maxsize=1)
def settings() -> Settings:
    return Settings()
