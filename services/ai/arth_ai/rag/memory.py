from __future__ import annotations

import hashlib
import math
from collections import Counter

from .embed import Embedder, cosine, tokens
from .rank import LexicalReranker, Reranker, rrf
from .types import Chunk, Doc, Hit, Kind, chunk_doc

CANDIDATES = 30


class MemoryRetriever:
    """Same hybrid pipeline as the Postgres retriever (keyword ∪ vector → RRF → rerank), over an in-process corpus."""

    def __init__(self, embedder: Embedder, reranker: Reranker | None = None) -> None:
        self._embedder = embedder
        self._reranker = reranker or LexicalReranker()
        self._chunks: list[Chunk] = []
        self._vecs: list[list[float]] = []
        self._tf: list[Counter[str]] = []
        self._hash = hashlib.sha256()
        self._seen: set[str] = set()

    async def add(self, docs: list[Doc]) -> None:
        for d in docs:
            key = f"{d.source}|{d.title}|{d.body}"
            if key in self._seen:
                continue
            self._seen.add(key)
            self._hash.update(key.encode())
            parts = chunk_doc(d)
            vecs = await self._embedder.embed([f"{h}\n{t}" for h, t in parts], "document")
            for (heading, text), v in zip(parts, vecs, strict=True):
                self._chunks.append(
                    Chunk(len(self._chunks) + 1, d.title, d.source, d.kind, d.url, d.published_at, d.symbols, heading, text)
                )
                self._vecs.append(v)
                self._tf.append(Counter(tokens(f"{d.title} {heading} {text}")))

    async def version(self) -> str:
        return self._hash.hexdigest()[:12]

    def _allowed(self, c: Chunk, kinds: tuple[Kind, ...], symbol: str | None) -> bool:
        return c.kind in kinds and (symbol is None or symbol in c.symbols or c.kind == "glossary")

    async def search(self, query: str, kinds: tuple[Kind, ...], symbol: str | None = None, k: int = 6) -> list[Hit]:
        idx = [i for i, c in enumerate(self._chunks) if self._allowed(c, kinds, symbol)]
        q = set(tokens(query))
        n = len(self._chunks) or 1
        df = Counter(t for tf in self._tf for t in q if t in tf)
        kw = []
        for i in idx:
            s = sum((1 + math.log(self._tf[i][t])) * math.log(1 + n / df[t]) for t in q if self._tf[i].get(t))
            if s > 0:
                kw.append((s, i))
        kw.sort(reverse=True)
        [qv] = await self._embedder.embed([query], "query")
        vec = sorted(((cosine(qv, self._vecs[i]), i) for i in idx), reverse=True)
        fused = rrf(
            {
                "keyword": [self._chunks[i] for _, i in kw[:CANDIDATES]],
                "vector": [self._chunks[i] for s, i in vec[:CANDIDATES] if s > 0.05],
            }
        )
        return await self._reranker.rerank(query, fused, k)


def hits_to_chunks(hits: list[Hit]) -> list[Chunk]:
    return [h.chunk for h in hits]
