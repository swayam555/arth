from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import asyncpg

from . import metrics
from .wire import TOPIC_USER_DELETED, decode_user_deleted

log = logging.getLogger("arth_ai.events")


class KafkaPublisher:
    def __init__(self, brokers: str) -> None:
        from aiokafka import AIOKafkaProducer

        self._p = AIOKafkaProducer(bootstrap_servers=brokers, acks="all", enable_idempotence=True, linger_ms=5)

    async def start(self) -> None:
        await self._p.start()

    async def stop(self) -> None:
        await self._p.stop()

    async def publish(self, topic: str, key: str, value: bytes) -> None:
        await self._p.send_and_wait(topic, value, key=key.encode())


class MemoryPublisher:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str, bytes]] = []

    async def publish(self, topic: str, key: str, value: bytes) -> None:
        self.sent.append((topic, key, value))


class PgAudience:
    """Users whose latest push consent for the current notice version is a grant."""

    def __init__(self, pool: asyncpg.Pool, version: str) -> None:
        self._pool = pool
        self._version = version

    async def push_users(self) -> list[uuid.UUID]:
        rows = await self._pool.fetch(
            """SELECT user_id FROM (
                 SELECT DISTINCT ON (user_id) user_id, granted FROM public.consents
                 WHERE purpose='push' AND version=$1 ORDER BY user_id, recorded_at DESC, id DESC) c
               WHERE granted""",
            self._version,
        )
        return [r["user_id"] for r in rows]


async def apply_erasure(raw: bytes, erase: Callable[[uuid.UUID], Awaitable[int]]) -> uuid.UUID | None:
    try:
        ev = decode_user_deleted(raw)
        user = uuid.UUID(ev.user_id)
    except ValueError:
        metrics.ERASURES.labels(result="bad_event").inc()
        log.warning("dropping malformed user.deleted event")
        return None
    await erase(user)
    metrics.ERASURES.labels(result="ok").inc()
    return user


class ErasureConsumer:
    """Consumes user.deleted and erases the user's chats, usage and digests. Offsets commit only after the erase."""

    def __init__(self, brokers: str, erase: Callable[[uuid.UUID], Awaitable[int]], group: str = "ai-erasure") -> None:
        from aiokafka import AIOKafkaConsumer

        self._c: Any = AIOKafkaConsumer(
            TOPIC_USER_DELETED, bootstrap_servers=brokers, group_id=group, enable_auto_commit=False, auto_offset_reset="earliest"
        )
        self._erase = erase

    async def run(self) -> None:
        await self._c.start()
        try:
            async for msg in self._c:
                while True:
                    try:
                        await apply_erasure(msg.value, self._erase)
                        break
                    except (asyncpg.PostgresError, OSError):
                        metrics.ERASURES.labels(result="retry").inc()
                        log.exception("erasure failed; retrying")
                        await asyncio.sleep(2)
                await self._c.commit()
        finally:
            await self._c.stop()
