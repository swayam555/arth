from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any, Protocol

import asyncpg

Json = dict[str, Any]


@dataclass
class StoredMessage:
    role: str
    content: str
    blocks: list[Json] = field(default_factory=list)
    citations: list[Json] = field(default_factory=list)
    meta: Json = field(default_factory=dict)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_json(self) -> Json:
        return {
            "role": self.role,
            "content": self.content,
            "blocks": self.blocks,
            "citations": self.citations,
            "meta": self.meta,
            "createdAt": self.created_at.isoformat(),
        }


class Store(Protocol):
    async def ensure_session(self, user: uuid.UUID, session: uuid.UUID | None, title: str) -> uuid.UUID: ...
    async def history(self, user: uuid.UUID, session: uuid.UUID, limit: int = 20) -> list[StoredMessage]: ...
    async def append(self, user: uuid.UUID, session: uuid.UUID, msgs: list[StoredMessage]) -> None: ...
    async def sessions(self, user: uuid.UUID) -> list[Json]: ...
    async def delete_session(self, user: uuid.UUID, session: uuid.UUID) -> bool: ...
    async def export(self, user: uuid.UUID) -> Json: ...
    async def delete_all(self, user: uuid.UUID) -> int: ...
    async def tokens_today(self, user: uuid.UUID) -> int: ...
    async def add_usage(self, user: uuid.UUID, input_tokens: int, output_tokens: int) -> None: ...
    async def ping(self) -> bool: ...


class NotFound(Exception):
    pass


@dataclass
class _Session:
    user: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[StoredMessage] = field(default_factory=list)


class MemoryStore:
    def __init__(self) -> None:
        self._s: dict[uuid.UUID, _Session] = {}
        self._usage: dict[tuple[uuid.UUID, date], tuple[int, int, int]] = {}

    async def ensure_session(self, user: uuid.UUID, session: uuid.UUID | None, title: str) -> uuid.UUID:
        if session is not None:
            s = self._s.get(session)
            if s is None or s.user != user:
                raise NotFound
            return session
        sid = uuid.uuid4()
        now = datetime.now(UTC)
        self._s[sid] = _Session(user, title[:80], now, now)
        return sid

    async def history(self, user: uuid.UUID, session: uuid.UUID, limit: int = 20) -> list[StoredMessage]:
        s = self._s.get(session)
        if s is None or s.user != user:
            raise NotFound
        return s.messages[-limit:]

    async def append(self, user: uuid.UUID, session: uuid.UUID, msgs: list[StoredMessage]) -> None:
        s = self._s[session]
        s.messages.extend(msgs)
        s.updated_at = datetime.now(UTC)

    async def sessions(self, user: uuid.UUID) -> list[Json]:
        rows = [(sid, s) for sid, s in self._s.items() if s.user == user]
        rows.sort(key=lambda r: r[1].updated_at, reverse=True)
        return [
            {
                "id": str(sid),
                "title": s.title,
                "createdAt": s.created_at.isoformat(),
                "updatedAt": s.updated_at.isoformat(),
                "messages": len(s.messages),
            }
            for sid, s in rows
        ]

    async def delete_session(self, user: uuid.UUID, session: uuid.UUID) -> bool:
        s = self._s.get(session)
        if s is None or s.user != user:
            return False
        del self._s[session]
        return True

    async def export(self, user: uuid.UUID) -> Json:
        out = []
        for sid, s in self._s.items():
            if s.user == user:
                out.append(
                    {
                        "id": str(sid),
                        "title": s.title,
                        "createdAt": s.created_at.isoformat(),
                        "messages": [m.to_json() for m in s.messages],
                    }
                )
        usage = [
            {"day": d.isoformat(), "inputTokens": i, "outputTokens": o, "requests": n}
            for (u, d), (i, o, n) in self._usage.items()
            if u == user
        ]
        return {"sessions": out, "usage": usage}

    async def delete_all(self, user: uuid.UUID) -> int:
        ids = [sid for sid, s in self._s.items() if s.user == user]
        for sid in ids:
            del self._s[sid]
        for k in [k for k in self._usage if k[0] == user]:
            del self._usage[k]
        return len(ids)

    async def tokens_today(self, user: uuid.UUID) -> int:
        i, o, _ = self._usage.get((user, datetime.now(UTC).date()), (0, 0, 0))
        return i + o

    async def add_usage(self, user: uuid.UUID, input_tokens: int, output_tokens: int) -> None:
        k = (user, datetime.now(UTC).date())
        i, o, n = self._usage.get(k, (0, 0, 0))
        self._usage[k] = (i + input_tokens, o + output_tokens, n + 1)

    async def ping(self) -> bool:
        return True


def _msg(r: asyncpg.Record) -> StoredMessage:
    return StoredMessage(
        r["role"], r["content"], json.loads(r["blocks"]), json.loads(r["citations"]), json.loads(r["meta"]), r["created_at"]
    )


class PgStore:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def ensure_session(self, user: uuid.UUID, session: uuid.UUID | None, title: str) -> uuid.UUID:
        if session is not None:
            ok = await self._pool.fetchval("SELECT 1 FROM ai.chat_sessions WHERE id=$1 AND user_id=$2", session, user)
            if not ok:
                raise NotFound
            return session
        sid: uuid.UUID = await self._pool.fetchval(
            "INSERT INTO ai.chat_sessions (user_id, title) VALUES ($1, $2) RETURNING id", user, title[:80]
        )
        return sid

    async def history(self, user: uuid.UUID, session: uuid.UUID, limit: int = 20) -> list[StoredMessage]:
        rows = await self._pool.fetch(
            """SELECT * FROM (SELECT role, content, blocks::text, citations::text, meta::text, created_at, id
                 FROM ai.chat_messages WHERE session_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT $3) t ORDER BY id""",
            session,
            user,
            limit,
        )
        if not rows and not await self._pool.fetchval("SELECT 1 FROM ai.chat_sessions WHERE id=$1 AND user_id=$2", session, user):
            raise NotFound
        return [_msg(r) for r in rows]

    async def append(self, user: uuid.UUID, session: uuid.UUID, msgs: list[StoredMessage]) -> None:
        async with self._pool.acquire() as con, con.transaction():
            await con.executemany(
                """INSERT INTO ai.chat_messages (session_id, user_id, role, content, blocks, citations, meta)
                   VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)""",
                [
                    (session, user, m.role, m.content, json.dumps(m.blocks), json.dumps(m.citations), json.dumps(m.meta))
                    for m in msgs
                ],
            )
            await con.execute("UPDATE ai.chat_sessions SET updated_at=now() WHERE id=$1", session)

    async def sessions(self, user: uuid.UUID) -> list[Json]:
        rows = await self._pool.fetch(
            """SELECT s.id, s.title, s.created_at, s.updated_at, count(m.id) AS n
               FROM ai.chat_sessions s LEFT JOIN ai.chat_messages m ON m.session_id = s.id
               WHERE s.user_id=$1 GROUP BY s.id ORDER BY s.updated_at DESC LIMIT 100""",
            user,
        )
        return [
            {
                "id": str(r["id"]),
                "title": r["title"],
                "createdAt": r["created_at"].isoformat(),
                "updatedAt": r["updated_at"].isoformat(),
                "messages": r["n"],
            }
            for r in rows
        ]

    async def delete_session(self, user: uuid.UUID, session: uuid.UUID) -> bool:
        res: str = await self._pool.execute("DELETE FROM ai.chat_sessions WHERE id=$1 AND user_id=$2", session, user)
        return res.endswith(" 1")

    async def export(self, user: uuid.UUID) -> Json:
        sessions = await self._pool.fetch(
            "SELECT id, title, created_at FROM ai.chat_sessions WHERE user_id=$1 ORDER BY created_at", user
        )
        msgs = await self._pool.fetch(
            "SELECT session_id, role, content, blocks::text, citations::text, meta::text, created_at FROM ai.chat_messages WHERE user_id=$1 ORDER BY id",
            user,
        )
        usage = await self._pool.fetch(
            "SELECT day, input_tokens, output_tokens, requests FROM ai.ai_usage WHERE user_id=$1 ORDER BY day", user
        )
        by: dict[uuid.UUID, list[Json]] = {}
        for m in msgs:
            by.setdefault(m["session_id"], []).append(_msg(m).to_json())
        return {
            "sessions": [
                {
                    "id": str(s["id"]),
                    "title": s["title"],
                    "createdAt": s["created_at"].isoformat(),
                    "messages": by.get(s["id"], []),
                }
                for s in sessions
            ],
            "usage": [
                {
                    "day": u["day"].isoformat(),
                    "inputTokens": u["input_tokens"],
                    "outputTokens": u["output_tokens"],
                    "requests": u["requests"],
                }
                for u in usage
            ],
        }

    async def delete_all(self, user: uuid.UUID) -> int:
        async with self._pool.acquire() as con, con.transaction():
            res: str = await con.execute("DELETE FROM ai.chat_sessions WHERE user_id=$1", user)
            await con.execute("DELETE FROM ai.ai_usage WHERE user_id=$1", user)
        return int(res.split()[-1])

    async def tokens_today(self, user: uuid.UUID) -> int:
        v = await self._pool.fetchval(
            "SELECT input_tokens + output_tokens FROM ai.ai_usage WHERE user_id=$1 AND day=(now() AT TIME ZONE 'utc')::date", user
        )
        return int(v or 0)

    async def add_usage(self, user: uuid.UUID, input_tokens: int, output_tokens: int) -> None:
        await self._pool.execute(
            """INSERT INTO ai.ai_usage (user_id, day, input_tokens, output_tokens, requests)
               VALUES ($1, (now() AT TIME ZONE 'utc')::date, $2, $3, 1)
               ON CONFLICT (user_id, day) DO UPDATE SET input_tokens = ai.ai_usage.input_tokens + EXCLUDED.input_tokens,
                 output_tokens = ai.ai_usage.output_tokens + EXCLUDED.output_tokens, requests = ai.ai_usage.requests + 1""",
            user,
            input_tokens,
            output_tokens,
        )

    async def ping(self) -> bool:
        try:
            return bool(await self._pool.fetchval("SELECT 1"))
        except (asyncpg.PostgresError, OSError):
            return False
