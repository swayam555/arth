from __future__ import annotations

import pytest

from arth_ai.rag.news import parse_feed

RSS = b"""<?xml version="1.0"?><rss><channel>
<item><title>TCS wins large deal</title><link>https://ex.in/a</link><description>&lt;p&gt;NSE:TCS signs a deal.&lt;/p&gt;</description>
<pubDate>Tue, 18 Nov 2026 09:30:00 +0530</pubDate></item>
<item><title>Banks rally</title><link>https://ex.in/b</link><description>HDFCBANK and SBIN gained.</description></item>
</channel></rss>"""

ATOM = b"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Infosys update</title><link href="https://ex.in/c"/><summary>INFY guidance.</summary><updated>2026-11-18T10:00:00Z</updated></entry>
</feed>"""


def test_rss() -> None:
    docs = parse_feed(RSS, "ex", frozenset({"HDFCBANK", "SBIN"}))
    assert [d.title for d in docs] == ["TCS wins large deal", "Banks rally"]
    assert docs[0].symbols == ("TCS",) or list(docs[0].symbols) == ["TCS"]
    assert "<p>" not in docs[0].body and docs[0].published_at is not None
    assert set(docs[1].symbols) == {"HDFCBANK", "SBIN"} and docs[0].kind == "news"


def test_atom() -> None:
    docs = parse_feed(ATOM, "ex", frozenset({"INFY"}))
    assert docs[0].url == "https://ex.in/c" and list(docs[0].symbols) == ["INFY"]


def test_rejects_entities() -> None:
    evil = b'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x "boom">]><rss><channel><item><title>&x;</title></item></channel></rss>'
    with pytest.raises(ValueError):
        parse_feed(evil, "ex")
