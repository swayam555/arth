from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Protocol

Kind = Literal["filing", "news", "glossary"]


@dataclass(frozen=True)
class Doc:
    source: str
    kind: Kind
    title: str
    body: str
    symbols: tuple[str, ...] = ()
    url: str | None = None
    published_at: datetime | None = None


@dataclass(frozen=True)
class Chunk:
    id: int
    doc_title: str
    source: str
    kind: Kind
    url: str | None
    published_at: datetime | None
    symbols: tuple[str, ...]
    heading: str
    text: str


@dataclass
class Hit:
    chunk: Chunk
    rrf: float = 0.0
    score: float = 0.0
    ranks: dict[str, int] = field(default_factory=dict)


class Retriever(Protocol):
    async def search(self, query: str, kinds: tuple[Kind, ...], symbol: str | None = None, k: int = 6) -> list[Hit]: ...

    async def version(self) -> str: ...


def chunk_doc(doc: Doc, max_chars: int = 900) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    heading = doc.title
    buf: list[str] = []
    size = 0
    for para in [p.strip() for p in doc.body.split("\n\n") if p.strip()]:
        if para.startswith("## "):
            if buf:
                out.append((heading, "\n\n".join(buf)))
                buf, size = [], 0
            heading = para[3:].strip()
            continue
        if buf and size + len(para) > max_chars:
            out.append((heading, "\n\n".join(buf)))
            buf, size = [], 0
        buf.append(para)
        size += len(para)
    if buf:
        out.append((heading, "\n\n".join(buf)))
    return out
