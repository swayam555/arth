from __future__ import annotations

import uuid

import pytest

from arth_ai.agent import Agent
from arth_ai.cache import MemoryCache
from arth_ai.config import Settings
from arth_ai.providers.scripted import ScriptedProvider
from arth_ai.rag.embed import HashingEmbedder
from arth_ai.rag.memory import MemoryRetriever
from arth_ai.rag.rank import LexicalReranker
from arth_ai.rag.seed import load_corpus
from arth_ai.store import MemoryStore

from .fakes import FakeApi


@pytest.fixture
def cfg() -> Settings:
    return Settings(backend="memory", llm_provider="scripted", cassette_dir="", groq_api_key="", news_feed_urls=())


@pytest.fixture
def user() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture
async def retriever() -> MemoryRetriever:
    r = MemoryRetriever(HashingEmbedder(), LexicalReranker())
    await r.add(load_corpus())
    return r


@pytest.fixture
def api() -> FakeApi:
    return FakeApi()


@pytest.fixture
def store() -> MemoryStore:
    return MemoryStore()


@pytest.fixture
def cache() -> MemoryCache:
    return MemoryCache()


@pytest.fixture
def agent(cfg: Settings, api: FakeApi, retriever: MemoryRetriever, store: MemoryStore, cache: MemoryCache) -> Agent:
    return Agent(cfg, ScriptedProvider(), api, retriever, store, cache)
