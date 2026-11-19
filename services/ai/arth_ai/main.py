from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Annotated, Any

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel, Field

from . import metrics
from .agent import Agent, BudgetExceeded, ConsentRequired, Event
from .api_client import ApiError, HttpPortfolioApi, PortfolioApi
from .auth import AuthError, user_from_bearer
from .cache import AnswerCache, MemoryCache, RedisCache
from .config import Settings, settings
from .providers.base import Provider
from .rag.memory import MemoryRetriever
from .rag.news import RssNewsSource
from .rag.seed import load_corpus
from .rag.types import Retriever
from .store import MemoryStore, NotFound, PgStore, Store
from .transcribe import ALLOWED_TYPES, MAX_AUDIO_BYTES, GroqTranscriber, TranscribeError, Transcriber, UnavailableTranscriber
from .wiring import build_embedder, build_provider, build_reranker

log = logging.getLogger("arth_ai")


@dataclass
class Deps:
    cfg: Settings
    provider: Provider
    api: PortfolioApi
    retriever: Retriever
    store: Store
    cache: AnswerCache
    transcriber: Transcriber
    background: list[asyncio.Task[None]] = field(default_factory=list)

    @property
    def agent(self) -> Agent:
        return Agent(self.cfg, self.provider, self.api, self.retriever, self.store, self.cache)


async def build_deps(cfg: Settings) -> tuple[Deps, contextlib.AsyncExitStack]:
    stack = contextlib.AsyncExitStack()
    provider = build_provider(cfg)
    embedder = build_embedder(cfg)
    reranker = build_reranker(cfg, provider)
    api = HttpPortfolioApi(cfg)
    stack.push_async_callback(api.aclose)
    transcriber: Transcriber = GroqTranscriber(cfg.groq_api_key) if cfg.groq_api_key else UnavailableTranscriber()
    retriever: Retriever
    store: Store
    cache: AnswerCache
    sink: Any
    if cfg.backend == "memory":
        mem = MemoryRetriever(embedder, reranker)
        await mem.add(load_corpus())
        retriever, store, cache, sink = mem, MemoryStore(), MemoryCache(), mem.add
    else:
        import asyncpg
        import redis.asyncio as aioredis

        from .rag.pg import PgRetriever

        pool = await asyncpg.create_pool(cfg.database_url, min_size=1, max_size=8, command_timeout=10)
        stack.push_async_callback(pool.close)
        client = aioredis.from_url(cfg.redis_url, socket_timeout=1.0, socket_connect_timeout=1.0)
        stack.push_async_callback(client.aclose)
        pg = PgRetriever(pool, embedder, reranker)
        if (await pg.version()).endswith(":0"):
            log.info("seeded %d corpus documents", await pg.upsert(load_corpus()))
        retriever, store, cache, sink = pg, PgStore(pool), RedisCache(client), pg.upsert
    deps = Deps(cfg, provider, api, retriever, store, cache, transcriber)
    if cfg.news_feed_urls:
        news = RssNewsSource(cfg.news_feed_urls, sink, cfg.news_poll_s)
        deps.background.append(asyncio.create_task(news.run()))
    return deps, stack


def get_deps(request: Request) -> Deps:
    d: Deps = request.app.state.deps
    return d


def get_user(request: Request, authorization: Annotated[str | None, Header()] = None) -> uuid.UUID:
    try:
        return user_from_bearer(authorization, get_deps(request).cfg)
    except AuthError as e:
        raise HTTPException(401, {"code": str(e)}) from e


DepsDep = Annotated[Deps, Depends(get_deps)]
UserDep = Annotated[uuid.UUID, Depends(get_user)]


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    sessionId: uuid.UUID | None = None


def create_app(deps: Deps | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if deps is not None:
            app.state.deps = deps
            yield
            return
        built, stack = await build_deps(settings())
        app.state.deps = built
        log.info("arth-ai ready: provider=%s backend=%s", built.provider.name, built.cfg.backend)
        try:
            yield
        finally:
            for t in built.background:
                t.cancel()
            await stack.aclose()

    app = FastAPI(title="Arth AI copilot", version="0.5.0", lifespan=lifespan)

    def sse(ev: Event) -> bytes:
        name, data = ev
        return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n".encode()

    @app.post("/v1/chat")
    async def chat(body: ChatIn, user: UserDep, d: DepsDep) -> StreamingResponse:
        agent = d.agent
        try:
            prepared = await agent.prepare(user, body.message, body.sessionId)
        except ConsentRequired as e:
            raise HTTPException(403, {"code": "consent_required", "purpose": "ai_copilot"}) from e
        except BudgetExceeded as e:
            metrics.TURNS.labels(outcome="budget").inc()
            raise HTTPException(429, {"code": "daily_budget_exceeded"}) from e
        except NotFound as e:
            raise HTTPException(404, {"code": "session_not_found"}) from e
        except ApiError as e:
            raise HTTPException(502, {"code": "portfolio_unavailable"}) from e

        async def events() -> AsyncIterator[bytes]:
            async for ev in agent.run(prepared):
                yield sse(ev)

        return StreamingResponse(
            events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        )

    @app.get("/v1/chat/sessions")
    async def sessions(user: UserDep, d: DepsDep) -> dict[str, Any]:
        return {"items": await d.store.sessions(user)}

    @app.get("/v1/chat/sessions/{sid}/messages")
    async def messages(sid: uuid.UUID, user: UserDep, d: DepsDep) -> dict[str, Any]:
        try:
            msgs = await d.store.history(user, sid, 200)
        except NotFound as e:
            raise HTTPException(404, {"code": "session_not_found"}) from e
        return {"items": [m.to_json() for m in msgs]}

    @app.delete("/v1/chat/sessions/{sid}", status_code=204)
    async def delete_session(sid: uuid.UUID, user: UserDep, d: DepsDep) -> None:
        if not await d.store.delete_session(user, sid):
            raise HTTPException(404, {"code": "session_not_found"})

    @app.get("/v1/chat/export")
    async def export(user: UserDep, d: DepsDep) -> JSONResponse:
        return JSONResponse(
            await d.store.export(user), headers={"Content-Disposition": 'attachment; filename="arth-copilot-export.json"'}
        )

    @app.delete("/v1/chat/data")
    async def delete_data(user: UserDep, d: DepsDep) -> dict[str, int]:
        return {"deletedSessions": await d.store.delete_all(user)}

    @app.post("/v1/ai/transcribe")
    async def transcribe(
        user: UserDep, d: DepsDep, audio: Annotated[UploadFile, File()], language: Annotated[str | None, Form()] = None
    ) -> dict[str, str]:
        if not (await d.api.consents(user)).get("ai_copilot"):
            raise HTTPException(403, {"code": "consent_required", "purpose": "ai_copilot"})
        ctype = (audio.content_type or "").split(";")[0].strip()
        if ctype not in ALLOWED_TYPES:
            raise HTTPException(415, {"code": "unsupported_audio"})
        data = await audio.read(MAX_AUDIO_BYTES + 1)
        if len(data) > MAX_AUDIO_BYTES:
            raise HTTPException(413, {"code": "audio_too_large"})
        if language and language not in {"en", "hi"}:
            raise HTTPException(422, {"code": "unsupported_language"})
        try:
            text = await d.transcriber.transcribe(data, audio.filename or "audio.m4a", ctype, language)
        except TranscribeError as e:
            raise HTTPException(e.status, {"code": e.code}) from e
        return {"text": text}

    @app.get("/healthz", response_class=PlainTextResponse)
    async def healthz() -> str:
        return "ok\n"

    @app.get("/readyz")
    async def readyz(d: DepsDep) -> JSONResponse:
        checks = {"store": await d.store.ping(), "cache": await d.cache.ping()}
        return JSONResponse(
            {"ready": all(checks.values()), **checks, "provider": d.provider.name},
            status_code=200 if all(checks.values()) else 503,
        )

    @app.get("/metrics")
    async def prom() -> PlainTextResponse:
        return PlainTextResponse(generate_latest(metrics.REGISTRY).decode(), media_type=CONTENT_TYPE_LATEST)

    return app


app = create_app()
