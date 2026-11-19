from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import httpx
import pytest

from arth_ai import guard
from arth_ai.auth import user_token
from arth_ai.config import Settings
from arth_ai.digest import Clock, DigestScheduler, DigestService, build, digest_id
from arth_ai.events import MemoryPublisher, apply_erasure
from arth_ai.rag.memory import MemoryRetriever
from arth_ai.store import MemoryStore
from arth_ai.wire import DigestReady, decode_user_deleted

from .fakes import FakeApi, demo_portfolio

MON = date(2026, 11, 16)


def utc(ist_hh: int, ist_mm: int, d: date = MON) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=UTC) + timedelta(minutes=ist_hh * 60 + ist_mm - 330)


class Users:
    def __init__(self, users: list[uuid.UUID]) -> None:
        self.users = users

    async def push_users(self) -> list[uuid.UUID]:
        return list(self.users)


def test_build_picks_three_largest_absolute_moves(user: uuid.UUID) -> None:
    d = build(user, MON, demo_portfolio(), "final")
    assert [i["symbol"] for i in d["items"]] == ["ITC", "TCS", "HDFCBANK"]
    assert d["items"][0]["text"] == "ITC added ₹486.00 (+1.72%), 55% of today's movement."
    assert d["items"][2]["text"].startswith("HDFCBANK took off ₹195.00 (-0.59%)")
    assert abs(sum(i["share"] for i in d["items"]) - 1) < 1e-3
    assert d["title"] == "Your portfolio rose ₹496.00 today (+0.49%)"
    assert d["body"] == "ITC +1.72%, TCS +0.50%, HDFCBANK -0.59%"
    assert d["disclaimer"] == guard.DISCLAIMER and d["id"] == str(digest_id(user, MON))


def test_build_empty_and_flat(user: uuid.UUID) -> None:
    empty = build(user, MON, {"holdings": [], "dayChange": 0}, "final")
    assert empty["items"] == [] and "Import your holdings" in empty["body"]
    flat = demo_portfolio()
    for h in flat["holdings"]:
        h["dayChange"] = 0.0
    assert build(user, MON, {**flat, "dayChange": 0}, "final")["title"] == "No movement in your portfolio today"


@pytest.mark.parametrize(
    ("hh", "mm", "d", "state", "session"),
    [
        (9, 14, MON, "pre", date(2026, 11, 13)),
        (9, 15, MON, "open", MON),
        (15, 29, MON, "open", MON),
        (15, 30, MON, "closed", MON),
        (23, 59, MON, "closed", MON),
        (12, 0, date(2026, 11, 21), "pre", date(2026, 11, 20)),
        (12, 0, date(2026, 11, 22), "pre", date(2026, 11, 20)),
    ],
)
def test_clock(hh: int, mm: int, d: date, state: str, session: date) -> None:
    c = Clock.at(utc(hh, mm, d))
    assert (c.state, c.session) == (state, session)


async def test_final_digest_generated_once_then_cached(user: uuid.UUID) -> None:
    api, store = FakeApi(), MemoryStore()
    svc = DigestService(api, store, lambda: utc(16, 0))
    first, cached1 = await svc.today(user)
    api.data = {**api.data, "dayChange": 9999.0, "version": "v2"}
    second, cached2 = await svc.today(user)
    assert first is not None and second == first
    assert (cached1, cached2) == (False, True)
    assert api.calls.count("portfolio") == 1


async def test_live_digest_is_not_stored(user: uuid.UUID) -> None:
    api, store = FakeApi(), MemoryStore()
    d, cached = await DigestService(api, store, lambda: utc(11, 0)).today(user)
    assert d is not None and d["phase"] == "live" and not cached
    assert await store.digest_latest(user) is None


async def test_pre_open_serves_latest_or_none(user: uuid.UUID) -> None:
    api, store = FakeApi(), MemoryStore()
    assert await DigestService(api, store, lambda: utc(8, 0)).today(user) == (None, False)
    await DigestService(api, store, lambda: utc(16, 0, date(2026, 11, 13))).today(user)
    got, cached = await DigestService(api, store, lambda: utc(8, 0)).today(user)
    assert got is not None and got["forDate"] == "2026-11-13" and cached
    assert api.calls == ["portfolio"]


async def test_scheduler_publishes_once_per_user_per_day() -> None:
    a, b, empty = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    store, pub = MemoryStore(), MemoryPublisher()

    class PerUser(FakeApi):
        async def portfolio(self, user: uuid.UUID) -> dict[str, object]:
            self.calls.append("portfolio")
            return {"holdings": [], "dayChange": 0} if user == empty else demo_portfolio()

    now = [utc(15, 40)]
    svc = DigestService(PerUser(), store, lambda: now[0])
    sched = DigestScheduler(svc, store, Users([a, b, empty]), pub, lambda: now[0])
    assert await sched.tick() is None
    now[0] = utc(15, 45)
    r = await sched.tick()
    assert r is not None and (r.users, r.published, r.skipped, r.failed) == (3, 2, 1, 0)
    assert await sched.tick() is None
    sched.last_run = None
    again = await sched.tick()
    assert again is not None and again.published == 0 and again.skipped == 3
    assert sorted(k for _, k, _ in pub.sent) == sorted([str(a), str(b)])
    assert {t for t, _, _ in pub.sent} == {"digest.ready"}


async def test_scheduler_retries_after_publish_failure() -> None:
    u = uuid.uuid4()
    store = MemoryStore()

    class Broken:
        def __init__(self) -> None:
            self.fail = True
            self.sent = 0

        async def publish(self, topic: str, key: str, value: bytes) -> None:
            if self.fail:
                raise OSError("broker down")
            self.sent += 1

    pub = Broken()
    clock = lambda: utc(16, 0)  # noqa: E731
    sched = DigestScheduler(DigestService(FakeApi(), store, clock), store, Users([u]), pub, clock)
    r1 = await sched.tick()
    assert r1 is not None and r1.failed == 1 and sched.last_run is None
    pub.fail = False
    r2 = await sched.tick()
    assert r2 is not None and r2.published == 1 and pub.sent == 1
    assert await store.digest_notified(u, MON)


def test_digest_ready_wire_golden() -> None:
    # Same bytes @bufbuild/protobuf produces for DigestReady{userId:"u",digestId:"d",forDate:"2026-11-16",title:"T",body:"₹"}.
    raw = DigestReady("u", "d", "2026-11-16", "T", "₹").encode()
    assert raw.hex() == "0a01751201641a0a323032362d31312d31362201542a03e282b9"
    assert DigestReady("", "d", "", "", "").encode().hex() == "120164"


def test_user_deleted_decode() -> None:
    uid = "0b9d6a3e-1c11-4d3a-9e55-0d3a5d1f9c2a"
    raw = bytes([0x0A, len(uid)]) + uid.encode() + bytes([0x10, 0xE8, 0x07])
    ev = decode_user_deleted(raw)
    assert (ev.user_id, ev.ts_ms) == (uid, 1000)
    for bad in (b"", b"\x0a\x05ab", b"\x10"):
        with pytest.raises(ValueError):
            decode_user_deleted(bad)


async def test_erasure_removes_digests_and_chats(user: uuid.UUID) -> None:
    store = MemoryStore()
    await DigestService(FakeApi(), store, lambda: utc(16, 0)).today(user)
    await store.ensure_session(user, None, "hi")
    raw = bytes([0x0A, 36]) + str(user).encode()
    assert await apply_erasure(raw, store.delete_all) == user
    assert await store.digest_latest(user) is None and await store.sessions(user) == []
    assert await apply_erasure(b"\x0a\x03abc", store.delete_all) is None


async def test_digest_endpoints(cfg: Settings, user: uuid.UUID, retriever: MemoryRetriever) -> None:
    from arth_ai.cache import MemoryCache
    from arth_ai.main import Deps, create_app
    from arth_ai.providers.scripted import ScriptedProvider
    from arth_ai.transcribe import UnavailableTranscriber

    deps = Deps(cfg, ScriptedProvider(), FakeApi(), retriever, MemoryStore(), MemoryCache(), UnavailableTranscriber())
    app = create_app()
    app.state.deps = deps
    h = {"Authorization": f"Bearer {user_token(user, cfg)}"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/v1/digest/today", headers=h)
        assert r.status_code == 200 and set(r.json()) == {"digest", "cached"}
        assert (await c.get("/v1/digest/today")).status_code == 401
        assert (await c.get("/v1/digest/2026-01-01", headers=h)).status_code == 404
        assert (await c.get("/v1/digest/not-a-date", headers=h)).status_code == 422
        await deps.store.digest_put(user, MON, build(user, MON, demo_portfolio(), "final"))
        got = await c.get("/v1/digest/2026-11-16", headers=h)
        assert got.status_code == 200 and got.json()["digest"]["forDate"] == "2026-11-16"
        export = (await c.get("/v1/chat/export", headers=h)).json()
        assert "2026-11-16" in [d["forDate"] for d in export["digests"]]
