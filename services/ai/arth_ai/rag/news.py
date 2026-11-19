from __future__ import annotations

import asyncio
import html
import logging
import re
import xml.etree.ElementTree as ET
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

import httpx

from .types import Doc

log = logging.getLogger("arth_ai.news")
_TAG = re.compile(r"<[^>]+>")
_SYMBOL = re.compile(r"\b(?:NSE|BSE)\s*:\s*([A-Z][A-Z0-9&-]{1,19})\b")
MAX_FEED_BYTES = 2 * 1024 * 1024


def _text(s: str | None) -> str:
    return " ".join(html.unescape(_TAG.sub(" ", s or "")).split())


def _date(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=UTC)


def parse_feed(xml: bytes, source: str, known_symbols: frozenset[str] = frozenset()) -> list[Doc]:
    if b"<!DOCTYPE" in xml[:2048] or b"<!ENTITY" in xml:
        raise ValueError("feeds with DTDs are rejected")
    root = ET.fromstring(xml)
    atom = "{http://www.w3.org/2005/Atom}"
    items = root.findall(".//item") or root.findall(f".//{atom}entry")
    docs: list[Doc] = []
    for it in items[:50]:
        title = _text(it.findtext("title") or it.findtext(f"{atom}title"))
        body = _text(it.findtext("description") or it.findtext(f"{atom}summary") or it.findtext(f"{atom}content"))
        link = it.findtext("link") or (it.find(f"{atom}link").get("href") if it.find(f"{atom}link") is not None else None)  # type: ignore[union-attr]
        when = _date(it.findtext("pubDate") or it.findtext(f"{atom}updated") or it.findtext(f"{atom}published"))
        if not title:
            continue
        found = set(_SYMBOL.findall(f"{title} {body}"))
        found |= {w for w in re.findall(r"\b[A-Z][A-Z0-9&]{1,19}\b", f"{title} {body}") if w in known_symbols}
        docs.append(
            Doc(
                source=source,
                kind="news",
                title=title,
                body=body or title,
                symbols=tuple(sorted(found)),
                url=link,
                published_at=when,
            )
        )
    return docs


class RssNewsSource:
    """Polls the RSS/Atom feeds in NEWS_FEED_URLS and hands new items to the retriever. Off unless feeds are configured."""

    def __init__(
        self,
        urls: tuple[str, ...],
        sink: Callable[[list[Doc]], Awaitable[object]],
        interval_s: int,
        known_symbols: frozenset[str] = frozenset(),
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._urls, self._sink, self._interval, self._known = urls, sink, interval_s, known_symbols
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=3.0), follow_redirects=True)

    async def poll_once(self) -> int:
        total = 0
        for url in self._urls:
            try:
                r = await self._client.get(url, headers={"User-Agent": "arth-news/0.5"})
                r.raise_for_status()
                if len(r.content) > MAX_FEED_BYTES:
                    raise ValueError("feed too large")
                docs = parse_feed(r.content, httpx.URL(url).host, self._known)
            except (httpx.HTTPError, ET.ParseError, ValueError) as e:
                log.warning("news feed %s failed: %s", url, e)
                continue
            if docs:
                await self._sink(docs)
                total += len(docs)
        return total

    async def run(self) -> None:
        while True:
            await self.poll_once()
            await asyncio.sleep(self._interval)
