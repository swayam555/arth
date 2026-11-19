from __future__ import annotations

import math
from collections import Counter
from typing import Protocol

from .embed import tokens
from .types import Chunk, Hit

RRF_K = 60


def rrf(lists: dict[str, list[Chunk]]) -> list[Hit]:
    hits: dict[int, Hit] = {}
    for name, chunks in lists.items():
        for rank, c in enumerate(chunks, start=1):
            h = hits.setdefault(c.id, Hit(c))
            h.rrf += 1.0 / (RRF_K + rank)
            h.ranks[name] = rank
    return sorted(hits.values(), key=lambda h: h.rrf, reverse=True)


class Reranker(Protocol):
    name: str

    async def rerank(self, query: str, hits: list[Hit], k: int) -> list[Hit]: ...


class LexicalReranker:
    """BM25-style term overlap over the fused candidates, blended with the fusion score."""

    name = "lexical"

    async def rerank(self, query: str, hits: list[Hit], k: int) -> list[Hit]:
        if not hits:
            return []
        q = set(tokens(query))
        docs = [Counter(tokens(f"{h.chunk.heading} {h.chunk.doc_title} {h.chunk.text}")) for h in hits]
        n = len(docs)
        avg = sum(sum(d.values()) for d in docs) / n or 1.0
        df = Counter(t for d in docs for t in q if t in d)
        top_rrf = max(h.rrf for h in hits) or 1.0
        for h, d in zip(hits, docs, strict=True):
            length = sum(d.values()) or 1
            bm25 = 0.0
            for t in q:
                tf = d.get(t, 0)
                if tf:
                    idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
                    bm25 += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * length / avg))
            title_bonus = 0.5 * len(q & set(tokens(h.chunk.heading + " " + h.chunk.doc_title)))
            h.score = bm25 + title_bonus + 2.0 * h.rrf / top_rrf
        return sorted(hits, key=lambda h: h.score, reverse=True)[:k]


class LlmReranker:
    """Asks the configured LLM to order the fused candidates; falls back to lexical order on any failure."""

    name = "llm"

    def __init__(self, provider: object) -> None:
        self._provider = provider
        self._fallback = LexicalReranker()

    async def rerank(self, query: str, hits: list[Hit], k: int) -> list[Hit]:
        import json
        import re

        from ..providers.base import Done, LlmRequest, Provider, text_of

        base = await self._fallback.rerank(query, hits, len(hits))
        provider: Provider = self._provider  # type: ignore[assignment]
        listing = "\n\n".join(f"[{i}] {h.chunk.heading}: {h.chunk.text[:400]}" for i, h in enumerate(base))
        req = LlmRequest(
            system="You rank passages for relevance. Reply with only a JSON array of passage numbers, most relevant first.",
            messages=[{"role": "user", "content": [{"type": "text", "text": f"Query: {query}\n\nPassages:\n{listing}"}]}],
            tools=[],
            max_tokens=200,
        )
        try:
            final = None
            async for ev in provider.stream(req):
                if isinstance(ev, Done):
                    final = ev
            m = re.search(r"\[[\d,\s]*\]", text_of(final.content) if final else "")
            order = [int(i) for i in json.loads(m.group(0))] if m else []
        except Exception:
            return base[:k]
        seen = [i for i in dict.fromkeys(order) if 0 <= i < len(base)]
        rest = [i for i in range(len(base)) if i not in seen]
        return [base[i] for i in seen + rest][:k]
