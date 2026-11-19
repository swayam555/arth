from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import httpx
import pytest

from arth_ai.auth import user_token
from arth_ai.cache import MemoryCache
from arth_ai.config import Settings
from arth_ai.main import Deps, create_app
from arth_ai.providers.scripted import ScriptedProvider
from arth_ai.rag.memory import MemoryRetriever
from arth_ai.store import MemoryStore
from arth_ai.transcribe import UnavailableTranscriber

from .fakes import FakeApi
from .sse import final_text, parse_sse


@pytest.fixture
async def client(cfg: Settings, retriever: MemoryRetriever, api: FakeApi) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app()
    app.state.deps = Deps(cfg, ScriptedProvider(), api, retriever, MemoryStore(), MemoryCache(), UnavailableTranscriber())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c


def auth(cfg: Settings, user: uuid.UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {user_token(user, cfg)}"}


async def test_requires_valid_token(client: httpx.AsyncClient, cfg: Settings) -> None:
    assert (await client.post("/v1/chat", json={"message": "hi"})).status_code == 401
    bad = {"Authorization": "Bearer " + user_token(uuid.uuid4(), Settings(jwt_secret="x" * 40))}
    assert (await client.post("/v1/chat", json={"message": "hi"}, headers=bad)).status_code == 401


async def test_chat_streams_sse(client: httpx.AsyncClient, cfg: Settings, user: uuid.UUID) -> None:
    r = await client.post("/v1/chat", json={"message": "How concentrated is my portfolio?"}, headers=auth(cfg, user))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    evs = parse_sse(r.text)
    assert evs[0][0] == "meta" and evs[-1][0] == "done"
    assert any(n == "block" and d["kind"] == "allocation_donut" for n, d in evs)
    assert "IT 40.00%" in final_text(evs)


async def test_chat_validation_and_consent(client: httpx.AsyncClient, cfg: Settings, user: uuid.UUID, api: FakeApi) -> None:
    h = auth(cfg, user)
    assert (await client.post("/v1/chat", json={"message": ""}, headers=h)).status_code == 422
    assert (await client.post("/v1/chat", json={"message": "x" * 2001}, headers=h)).status_code == 422
    r = await client.post("/v1/chat", json={"message": "hi", "sessionId": str(uuid.uuid4())}, headers=h)
    assert r.status_code == 404
    api.consent_map = {"core": True, "ai_copilot": False}
    r = await client.post("/v1/chat", json={"message": "hi"}, headers=h)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "consent_required"


async def test_sessions_export_and_delete(client: httpx.AsyncClient, cfg: Settings, user: uuid.UUID) -> None:
    h = auth(cfg, user)
    evs = parse_sse((await client.post("/v1/chat", json={"message": "What is LTCG?"}, headers=h)).text)
    sid = evs[0][1]["sessionId"]
    items = (await client.get("/v1/chat/sessions", headers=h)).json()["items"]
    assert [s["id"] for s in items] == [sid]
    msgs = (await client.get(f"/v1/chat/sessions/{sid}/messages", headers=h)).json()["items"]
    assert [m["role"] for m in msgs] == ["user", "assistant"] and msgs[1]["citations"]
    other = auth(cfg, uuid.uuid4())
    assert (await client.get(f"/v1/chat/sessions/{sid}/messages", headers=other)).status_code == 404
    assert (await client.delete(f"/v1/chat/sessions/{sid}", headers=other)).status_code == 404
    ex = await client.get("/v1/chat/export", headers=h)
    assert "attachment" in ex.headers["content-disposition"] and len(ex.json()["sessions"]) == 1
    assert (await client.delete("/v1/chat/data", headers=h)).json() == {"deletedSessions": 1}
    assert (await client.get("/v1/chat/sessions", headers=h)).json()["items"] == []


async def test_transcribe_guards(client: httpx.AsyncClient, cfg: Settings, user: uuid.UUID) -> None:
    h = auth(cfg, user)
    bad_type = await client.post("/v1/ai/transcribe", headers=h, files={"audio": ("a.txt", b"x", "text/plain")})
    assert bad_type.status_code == 415
    r = await client.post("/v1/ai/transcribe", headers=h, files={"audio": ("a.m4a", b"\x00" * 100, "audio/mp4")})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "transcription_not_configured"
    r = await client.post(
        "/v1/ai/transcribe", headers=h, files={"audio": ("a.m4a", b"\x00", "audio/mp4")}, data={"language": "fr"}
    )
    assert r.status_code == 422


async def test_ops_endpoints(client: httpx.AsyncClient, cfg: Settings, user: uuid.UUID) -> None:
    assert (await client.get("/healthz")).text == "ok\n"
    ready = await client.get("/readyz")
    assert ready.status_code == 200 and ready.json()["provider"] == "scripted"
    await client.post("/v1/chat", json={"message": "Should I buy ITC?"}, headers=auth(cfg, user))
    m = (await client.get("/metrics")).text
    assert 'arth_ai_turns_total{outcome="refused"}' in m and "arth_ai_guard_total" in m
