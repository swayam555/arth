from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from importlib import resources

from .types import Doc


def load_corpus() -> list[Doc]:
    raw = json.loads(resources.files("arth_ai.rag").joinpath("corpus.json").read_text(encoding="utf-8"))
    return [
        Doc(
            source=d["source"],
            kind=d["kind"],
            title=d["title"],
            body=d["body"],
            symbols=tuple(d["symbols"]),
            url=d["url"],
            published_at=datetime.fromisoformat(d["published_at"]).replace(tzinfo=UTC) if d["published_at"] else None,
        )
        for d in raw
    ]


async def _main() -> None:
    import asyncpg

    from ..config import settings
    from ..wiring import build_embedder, build_reranker
    from .pg import PgRetriever

    cfg = settings()
    pool = await asyncpg.create_pool(cfg.database_url, min_size=1, max_size=2)
    try:
        retriever = PgRetriever(pool, build_embedder(cfg), build_reranker(cfg, None))
        added = await retriever.upsert(load_corpus())
        print(f"seeded {added} new documents")
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(_main())
