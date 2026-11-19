from __future__ import annotations

import json
import time
from typing import Any, Protocol

import redis.asyncio as aioredis


class AnswerCache(Protocol):
    async def get(self, key: str) -> dict[str, Any] | None: ...
    async def set(self, key: str, value: dict[str, Any], ttl_s: int) -> None: ...
    async def ping(self) -> bool: ...


class MemoryCache:
    def __init__(self) -> None:
        self._d: dict[str, tuple[float, dict[str, Any]]] = {}

    async def get(self, key: str) -> dict[str, Any] | None:
        hit = self._d.get(key)
        if not hit or hit[0] < time.monotonic():
            self._d.pop(key, None)
            return None
        return hit[1]

    async def set(self, key: str, value: dict[str, Any], ttl_s: int) -> None:
        self._d[key] = (time.monotonic() + ttl_s, value)

    async def ping(self) -> bool:
        return True


class RedisCache:
    def __init__(self, client: aioredis.Redis) -> None:
        self._r = client

    async def get(self, key: str) -> dict[str, Any] | None:
        try:
            raw = await self._r.get(key)
        except aioredis.RedisError:
            return None
        return json.loads(raw) if raw else None

    async def set(self, key: str, value: dict[str, Any], ttl_s: int) -> None:
        try:
            await self._r.set(key, json.dumps(value, ensure_ascii=False), ex=ttl_s)
        except aioredis.RedisError:
            return

    async def ping(self) -> bool:
        try:
            return bool(await self._r.ping())
        except aioredis.RedisError:
            return False
