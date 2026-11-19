from __future__ import annotations

from pathlib import Path

from .config import Settings
from .providers.base import Provider
from .providers.cassette import CassetteProvider
from .providers.scripted import ScriptedProvider
from .rag.embed import Embedder, HashingEmbedder, VoyageEmbedder
from .rag.rank import LexicalReranker, LlmReranker, Reranker


def build_provider(cfg: Settings) -> Provider:
    choice = cfg.llm_provider
    if choice == "auto":
        choice = "anthropic" if cfg.has_anthropic_key else "openai" if cfg.openai_api_key else "scripted"
    inner: Provider
    if choice == "anthropic":
        from .providers.anthropic import AnthropicProvider

        inner = AnthropicProvider(cfg.anthropic_model, cfg.anthropic_effort)
    elif choice == "openai":
        from .providers.openai_compat import OpenAICompatProvider

        inner = OpenAICompatProvider(cfg.openai_base_url, cfg.openai_api_key, cfg.openai_model)
    elif choice == "scripted":
        inner = ScriptedProvider()
    else:
        raise ValueError(f"unknown LLM_PROVIDER {cfg.llm_provider}")
    if cfg.cassette_dir:
        return CassetteProvider(None if choice == "scripted" else inner, Path(cfg.cassette_dir), cfg.cassette_mode)
    return inner


def build_embedder(cfg: Settings) -> Embedder:
    if cfg.embedder == "voyage":
        if not cfg.voyage_api_key:
            raise ValueError("EMBEDDER=voyage needs VOYAGE_API_KEY")
        return VoyageEmbedder(cfg.voyage_api_key)
    return HashingEmbedder()


def build_reranker(cfg: Settings, provider: Provider | None) -> Reranker:
    if cfg.reranker == "llm" and provider is not None and not isinstance(provider, ScriptedProvider):
        return LlmReranker(provider)
    return LexicalReranker()
