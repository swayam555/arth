from __future__ import annotations

import hashlib

import asyncpg

from .embed import Embedder, to_pgvector
from .rank import Reranker, rrf
from .types import Chunk, Doc, Hit, Kind, chunk_doc

CANDIDATES = 30

_FILTER = """
  d.kind = ANY($2::text[])
  AND ($3::text IS NULL OR $3 = ANY(d.symbols) OR d.kind = 'glossary')
"""

_KEYWORD = f"""
SELECT c.id, d.title, d.source, d.kind, d.url, d.published_at, d.symbols, c.heading, c.text
FROM ai.document_chunks c JOIN ai.documents d ON d.id = c.document_id,
     LATERAL (SELECT replace(plainto_tsquery('english', $1)::text, '&', '|') AS q) qq
WHERE qq.q <> '' AND c.tsv @@ to_tsquery('english', qq.q) AND {_FILTER}
ORDER BY ts_rank_cd(c.tsv, to_tsquery('english', qq.q)) DESC
LIMIT {CANDIDATES}
"""

_VECTOR = f"""
SELECT c.id, d.title, d.source, d.kind, d.url, d.published_at, d.symbols, c.heading, c.text
FROM ai.document_chunks c JOIN ai.documents d ON d.id = c.document_id
WHERE {_FILTER}
ORDER BY c.embedding <=> $1::vector
LIMIT {CANDIDATES}
"""


def _chunk(r: asyncpg.Record) -> Chunk:
    return Chunk(
        r["id"], r["title"], r["source"], r["kind"], r["url"], r["published_at"], tuple(r["symbols"]), r["heading"], r["text"]
    )


class PgRetriever:
    def __init__(self, pool: asyncpg.Pool, embedder: Embedder, reranker: Reranker) -> None:
        self._pool = pool
        self._embedder = embedder
        self._reranker = reranker

    async def version(self) -> str:
        v = await self._pool.fetchval("SELECT coalesce(max(id), 0)::text || ':' || count(*)::text FROM ai.documents")
        return str(v)

    async def search(self, query: str, kinds: tuple[Kind, ...], symbol: str | None = None, k: int = 6) -> list[Hit]:
        [qv] = await self._embedder.embed([query], "query")
        async with self._pool.acquire() as con:
            kw = await con.fetch(_KEYWORD, query, list(kinds), symbol)
            vec = await con.fetch(_VECTOR, to_pgvector(qv), list(kinds), symbol)
        fused = rrf({"keyword": [_chunk(r) for r in kw], "vector": [_chunk(r) for r in vec]})
        return await self._reranker.rerank(query, fused, k)

    async def upsert(self, docs: list[Doc]) -> int:
        added = 0
        for d in docs:
            digest = hashlib.sha256(f"{d.source}|{d.title}|{d.body}".encode()).hexdigest()
            parts = chunk_doc(d)
            vecs = await self._embedder.embed([f"{h}\n{t}" for h, t in parts], "document")
            async with self._pool.acquire() as con, con.transaction():
                doc_id = await con.fetchval(
                    """INSERT INTO ai.documents (source, kind, symbols, title, url, published_at, body, hash)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (hash) DO NOTHING RETURNING id""",
                    d.source,
                    d.kind,
                    list(d.symbols),
                    d.title,
                    d.url,
                    d.published_at,
                    d.body,
                    digest,
                )
                if doc_id is None:
                    continue
                await con.executemany(
                    """INSERT INTO ai.document_chunks (document_id, ord, heading, text, embedding)
                       VALUES ($1,$2,$3,$4,$5::vector)""",
                    [(doc_id, i, h, t, to_pgvector(v)) for i, ((h, t), v) in enumerate(zip(parts, vecs, strict=True))],
                )
                added += 1
        return added


__all__ = ["Hit", "PgRetriever"]
