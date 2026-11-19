from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, timezone
from typing import Any, Literal, Protocol

from . import guard, metrics
from .api_client import PortfolioApi
from .providers.scripted import inr, pct

Json = dict[str, Any]
IST = timezone(timedelta(hours=5, minutes=30), "IST")
OPEN, CLOSE, SEND_AT = time(9, 15), time(15, 30), time(15, 45)
_NS = uuid.UUID("7b1c8a52-5f0e-4f7a-9a43-2f1d6c0e9b11")

Phase = Literal["live", "final"]
log = logging.getLogger("arth_ai.digest")


def ist_now(now: datetime | None = None) -> datetime:
    return (now or datetime.now(UTC)).astimezone(IST)


def previous_session(d: date) -> date:
    d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


@dataclass(frozen=True)
class Clock:
    """NSE cash-market hours in IST. Exchange holidays are not modelled; a holiday looks like a flat session."""

    state: Literal["pre", "open", "closed"]
    session: date

    @staticmethod
    def at(now: datetime | None = None) -> Clock:
        t = ist_now(now)
        d = t.date()
        if d.weekday() >= 5 or t.time() < OPEN:
            return Clock("pre", previous_session(d))
        return Clock("open" if t.time() < CLOSE else "closed", d)


def digest_id(user: uuid.UUID, for_date: date) -> uuid.UUID:
    return uuid.uuid5(_NS, f"{user}:{for_date.isoformat()}")


def build(user: uuid.UUID, for_date: date, portfolio: Json, phase: Phase) -> Json:
    holdings = [h for h in portfolio.get("holdings", []) if abs(float(h.get("dayChange") or 0)) >= 0.005]
    holdings.sort(key=lambda h: abs(float(h["dayChange"])), reverse=True)
    moved = sum(abs(float(h["dayChange"])) for h in holdings)
    items: list[Json] = []
    for h in holdings[:3]:
        dc = float(h["dayChange"])
        share = abs(dc) / moved if moved else 0.0
        verb = "added" if dc > 0 else "took off"
        items.append(
            {
                "symbol": h["symbol"],
                "name": h.get("name") or h["symbol"],
                "dayChange": round(dc, 2),
                "dayChangePct": round(float(h.get("dayChangePct") or 0), 2),
                "share": round(share, 4),
                "text": f"{h['symbol']} {verb} {inr(abs(dc))} ({pct(h.get('dayChangePct'))}), "
                f"{round(share * 100)}% of today's movement.",
            }
        )
    day = float(portfolio.get("dayChange") or 0)
    day_pct = portfolio.get("dayChangePct")
    if not items:
        title = "No movement in your portfolio today" if portfolio.get("holdings") else "Your daily digest"
        body = (
            "None of your holdings moved today." if portfolio.get("holdings") else "Import your holdings to get a daily digest."
        )
    else:
        word = "rose" if day > 0 else "fell" if day < 0 else "was flat"
        title = f"Your portfolio {word} {inr(abs(day))} today ({pct(day_pct)})" if day else "Your portfolio was flat today"
        body = ", ".join(f"{i['symbol']} {pct(i['dayChangePct'])}" for i in items)
    out = {
        "id": str(digest_id(user, for_date)),
        "forDate": for_date.isoformat(),
        "phase": phase,
        "title": title,
        "body": body,
        "dayChange": round(day, 2),
        "dayChangePct": None if day_pct is None else round(float(day_pct), 2),
        "value": round(float(portfolio.get("value") or 0), 2),
        "items": items,
        "dataVersion": str(portfolio.get("version", "")),
        "generatedAt": datetime.now(UTC).isoformat(),
        "disclaimer": guard.DISCLAIMER,
    }
    for line in (title, body, *(i["text"] for i in items)):
        if guard.check_output(line).blocked:
            raise AssertionError(f"digest text tripped the advice guard: {line}")
    return out


class DigestStore(Protocol):
    async def digest_get(self, user: uuid.UUID, for_date: date) -> Json | None: ...
    async def digest_latest(self, user: uuid.UUID) -> Json | None: ...
    async def digest_put(self, user: uuid.UUID, for_date: date, digest: Json) -> bool: ...
    async def digest_mark_notified(self, user: uuid.UUID, for_date: date) -> None: ...
    async def digest_notified(self, user: uuid.UUID, for_date: date) -> bool: ...


class Audience(Protocol):
    async def push_users(self) -> list[uuid.UUID]: ...


class Publisher(Protocol):
    async def publish(self, topic: str, key: str, value: bytes) -> None: ...


class DigestService:
    def __init__(self, api: PortfolioApi, store: DigestStore, now: Callable[[], datetime] | None = None) -> None:
        self._api = api
        self._store = store
        self._now = now or (lambda: datetime.now(UTC))

    async def today(self, user: uuid.UUID) -> tuple[Json | None, bool]:
        clock = Clock.at(self._now())
        if clock.state == "open":
            metrics.DIGESTS.labels(outcome="live").inc()
            return build(user, clock.session, await self._api.portfolio(user), "live"), False
        if clock.state == "closed":
            return await self.final(user, clock.session)
        latest = await self._store.digest_latest(user)
        metrics.DIGESTS.labels(outcome="cached" if latest else "none").inc()
        return latest, latest is not None

    async def final(self, user: uuid.UUID, for_date: date) -> tuple[Json, bool]:
        """Returns (digest, served_from_cache). Generated at most once per user per session date."""
        hit = await self._store.digest_get(user, for_date)
        if hit is not None:
            metrics.DIGESTS.labels(outcome="cached").inc()
            return hit, True
        d = build(user, for_date, await self._api.portfolio(user), "final")
        if await self._store.digest_put(user, for_date, d):
            metrics.DIGESTS.labels(outcome="generated").inc()
            return d, False
        stored = await self._store.digest_get(user, for_date)
        return (stored or d), True

    async def by_date(self, user: uuid.UUID, for_date: date) -> Json | None:
        return await self._store.digest_get(user, for_date)


@dataclass
class RunReport:
    for_date: date
    users: int = 0
    published: int = 0
    skipped: int = 0
    failed: int = 0


class DigestScheduler:
    """Once per trading day after SEND_AT IST: finalise each push-consenting user's digest and publish digest.ready.

    Delivery is at-least-once: the digest row is stored first, the event is published, then the row is marked notified.
    A crash between publish and mark re-sends on the next tick; the notifier's collapse id (digest-{date}) folds the
    duplicate on the device.
    """

    def __init__(
        self,
        service: DigestService,
        store: DigestStore,
        audience: Audience,
        publisher: Publisher,
        now: Callable[[], datetime] | None = None,
        concurrency: int = 4,
        topic: str = "digest.ready",
    ) -> None:
        self._svc = service
        self._store = store
        self._audience = audience
        self._pub = publisher
        self._now = now or (lambda: datetime.now(UTC))
        self._sem = asyncio.Semaphore(concurrency)
        self._topic = topic
        self.last_run: date | None = None

    def due(self) -> date | None:
        t = ist_now(self._now())
        if t.weekday() >= 5 or t.time() < SEND_AT or self.last_run == t.date():
            return None
        return t.date()

    async def tick(self) -> RunReport | None:
        d = self.due()
        if d is None:
            return None
        report = await self.run(d)
        if report.failed == 0:
            self.last_run = d
        return report

    async def run(self, for_date: date) -> RunReport:
        from .wire import DigestReady

        report = RunReport(for_date)
        users = await self._audience.push_users()
        report.users = len(users)

        async def one(u: uuid.UUID) -> None:
            async with self._sem:
                try:
                    if await self._store.digest_notified(u, for_date):
                        report.skipped += 1
                        return
                    d, _ = await self._svc.final(u, for_date)
                    if not d["items"]:
                        report.skipped += 1
                        await self._store.digest_mark_notified(u, for_date)
                        return
                    msg = DigestReady(str(u), d["id"], d["forDate"], d["title"], d["body"])
                    await self._pub.publish(self._topic, str(u), msg.encode())
                    await self._store.digest_mark_notified(u, for_date)
                    report.published += 1
                except Exception:
                    report.failed += 1
                    log.exception("digest for %s failed", u)

        await asyncio.gather(*(one(u) for u in users))
        metrics.DIGEST_RUNS.labels(result="ok" if report.failed == 0 else "partial").inc()
        log.info("digest run %s: %s", for_date, report)
        return report

    async def loop(self, every_s: float = 60.0, sleep: Callable[[float], Awaitable[None]] = asyncio.sleep) -> None:
        while True:
            try:
                await self.tick()
            except Exception:
                log.exception("digest tick failed")
            await sleep(every_s)
