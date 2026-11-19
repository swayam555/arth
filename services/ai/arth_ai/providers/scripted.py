from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from typing import Any

from .base import Block, Done, LlmEvent, LlmRequest, Message, TextDelta, Usage

_NOT_SYMBOLS = {
    "NIFTY",
    "SENSEX",
    "LTCG",
    "STCG",
    "XIRR",
    "PE",
    "SIP",
    "ETF",
    "NSE",
    "BSE",
    "SEBI",
    "IPO",
    "AMFI",
    "GST",
    "TDS",
    "PAN",
    "EMAIL",
    "PHONE",
    "AADHAAR",
    "I",
    "A",
    "T",
    "P",
    "E",
    "MY",
    "IT",
    "OK",
    "US",
    "USD",
    "INR",
    "AI",
    "EPS",
    "NAV",
    "YTD",
}
_COMMON = {
    "tcs": "TCS",
    "infosys": "INFY",
    "infy": "INFY",
    "reliance": "RELIANCE",
    "hdfc bank": "HDFCBANK",
    "hdfcbank": "HDFCBANK",
    "icici": "ICICIBANK",
    "sbi": "SBIN",
    "itc": "ITC",
    "wipro": "WIPRO",
    "niftybees": "NIFTYBEES",
}
_RANGES = [
    (r"\b(week|7\s*days|1w)\b", "1w"),
    (r"\b(6|six)\s*months?\b|\b6m\b|\bhalf[\s-]year", "6m"),
    (r"\b(3|three)\s*months?\b|\bquarter\b|\b3m\b", "3m"),
    (r"\b(year|12\s*months|1y|ytd|annual)\b|\bsaal\b", "1y"),
    (r"\b(month|30\s*days|1m)\b|\bmahine\b", "1m"),
]


def inr(x: float) -> str:
    neg, x = x < 0, abs(x)
    whole, frac = f"{x:.2f}".split(".")
    head, tail = whole[:-3], whole[-3:]
    groups: list[str] = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    body = ",".join([*groups, tail]) if groups else tail
    return f"{'-' if neg else ''}₹{body}.{frac}"


def pct(x: float | None) -> str:
    return "n/a" if x is None else f"{x:+.2f}%"


def detect_range(q: str) -> str:
    for pat, r in _RANGES:
        if re.search(pat, q, re.IGNORECASE):
            return r
    return "1m"


def detect_symbol(q: str) -> str | None:
    for m in re.finditer(r"\b[A-Z][A-Z&-]{1,14}\b", q):
        if m.group(0) not in _NOT_SYMBOLS:
            return m.group(0)
    low = q.lower()
    for name, sym in _COMMON.items():
        if re.search(rf"\b{name}\b", low):
            return sym
    return None


def _intent(q: str) -> str:
    low = q.lower()
    if re.search(r"\b(what\s+(is|are|does)|explain|meaning|define|kya\s+hota|matlab|how\s+is\b.*\btax)", low):
        return "explain"
    if re.search(r"\b(news|filing|announce\w*|results?|dividend|guidance|buyback|board|update)\b", low):
        return "news"
    if re.search(r"\b(nifty|index|benchmark|beat|outperform|underperform|compare)\b", low):
        return "compare"
    if re.search(r"\b(sector|allocation|concentrat\w*|diversif\w*|exposure|mcap|market\s*cap|split)\b", low):
        return "allocation"
    if re.search(r"\b(gainers?|losers?|winners?|top|biggest|largest|worst|best|holdings?|stocks?\s+do\s+i)\b", low):
        return "holdings"
    if detect_symbol(q) and re.search(r"\b(price|chart|done|move\w*|perform\w*|trend|history)\b", low):
        return "price"
    return "overview"


def _user_text(m: Message) -> str:
    c = m["content"]
    return c if isinstance(c, str) else " ".join(b.get("text", "") for b in c if b.get("type") == "text")


def _last_question(messages: list[Message]) -> str:
    for m in reversed(messages):
        if m["role"] == "user":
            t = _user_text(m).strip()
            if t:
                return t
    return ""


def _tool_results(messages: list[Message]) -> dict[str, tuple[Any, bool]]:
    names: dict[str, str] = {}
    out: dict[str, tuple[Any, bool]] = {}
    for m in messages:
        if not isinstance(m["content"], list):
            continue
        for b in m["content"]:
            if b.get("type") == "tool_use":
                names[b["id"]] = b["name"]
            elif b.get("type") == "tool_result" and b["tool_use_id"] in names:
                try:
                    data = json.loads(b["content"]) if not b.get("is_error") else b["content"]
                except (TypeError, ValueError):
                    data = b["content"]
                out[names[b["tool_use_id"]]] = (data, bool(b.get("is_error")))
    return out


def _since_last_question(messages: list[Message]) -> list[Message]:
    for i in range(len(messages) - 1, -1, -1):
        m = messages[i]
        if m["role"] == "user" and _user_text(m).strip():
            return messages[i:]
    return messages


def _plain(text: str) -> str:
    text = re.sub(r"</?untrusted_document[^>]*>", "", text).strip()
    lines = [ln for ln in text.splitlines() if ln.strip() and "SYNTHETIC DEMO" not in ln and "[removed:" not in ln]
    return " ".join(lines[1:] if len(lines) > 1 else lines)


def _sentences(text: str, n: int) -> str:
    parts = re.split(r"(?<=[.!?])\s+", text)
    return " ".join(parts[:n]).strip()


class ScriptedProvider:
    """Offline, deterministic stand-in for an LLM. It plans tools from keywords and writes answers only from tool results,
    so the agent's guardrails (grounding, SEBI, injection, citations) can be exercised without a model or network."""

    name = "scripted"

    def __init__(self, chunk: int = 24) -> None:
        self._chunk = chunk
        self._ids = 0

    def _id(self) -> str:
        self._ids += 1
        return f"toolu_scripted_{self._ids:04d}"

    def _use(self, name: str, inp: dict[str, Any]) -> Block:
        return {"type": "tool_use", "id": self._id(), "name": name, "input": inp}

    def _plan(self, q: str) -> list[Block]:
        rng, sym, intent = detect_range(q), detect_symbol(q), _intent(q)
        if intent == "explain":
            term = re.sub(
                r"(?i)^(what\s+(is|are|does)|explain|define|meaning\s+of)\s+(an?\s+|the\s+)?|\?|kya\s+hota\s+hai|matlab", "", q
            ).strip()
            return [self._use("explain_term", {"term": term or q})]
        if intent == "news":
            inp: dict[str, Any] = {"query": q}
            if sym:
                inp["symbol"] = sym
            return [self._use("search_news", inp)]
        if intent == "compare":
            return [self._use("compare_to_index", {"range": rng})]
        if intent == "allocation":
            dim = (
                "mcap"
                if re.search(r"(?i)cap|large|mid|small", q)
                else "asset"
                if re.search(r"(?i)asset|etf|equity", q)
                else "sector"
            )
            return [
                self._use("get_sector_exposure", {"dimension": dim}),
                self._use("get_holdings", {"sort_by": "weight", "limit": 3}),
            ]
        if intent == "holdings":
            by = (
                "day_change"
                if re.search(r"(?i)today|day", q)
                else "pnl"
                if re.search(r"(?i)gain|los|win|worst|best|profit", q)
                else "weight"
            )
            return [self._use("get_holdings", {"sort_by": by, "limit": 5})]
        if intent == "price" and sym:
            return [self._use("get_price_history", {"symbol": sym, "range": rng})]
        return [self._use("get_portfolio_metrics", {"range": rng})]

    def _answer(self, q: str, res: dict[str, tuple[Any, bool]]) -> tuple[str, list[Block]]:
        errors = [str(d) for d, err in res.values() if err]
        if errors:
            return f"I couldn't get that data just now ({errors[0]}). Please try again in a moment.", []
        if "explain_term" in res or "search_news" in res or "search_filings" in res:
            data = (res.get("explain_term") or res.get("search_news") or res.get("search_filings"))[0]  # type: ignore[index]
            hits = data.get("results", [])
            if not hits:
                return "I couldn't find anything in Arth's documents about that.", []
            lead = "" if "explain_term" in res else "Here is what the most relevant documents say. "
            parts = [
                f"{_sentences(_plain(h['text']), 2 if i == 0 else 1)} [{h['cite']}]"
                for i, h in enumerate(hits[:2])
                if _plain(h["text"])
            ]
            return lead + " ".join(parts), []
        if "compare_to_index" in res:
            d = res["compare_to_index"][0]
            if not d.get("available"):
                return "There isn't enough price history yet to compare your portfolio with the NIFTY 50 over that range.", []
            word = "ahead of" if d["differencePct"] >= 0 else "behind"
            text = (
                f"From {d['from']} to {d['to']}, your portfolio returned {pct(d['portfolioReturnPct'])} while the "
                f"{d['index']} returned {pct(d['indexReturnPct'])}. That puts you {abs(d['differencePct']):.2f} percentage "
                f"points {word} the index."
            )
            return text, [
                self._use(
                    "render_block", {"kind": "line_chart", "title": "Portfolio vs NIFTY 50", "range": d["range"], "symbols": []}
                )
            ]
        if "get_sector_exposure" in res:
            d = res["get_sector_exposure"][0]
            top = d["slices"][:3]
            lines = ", ".join(f"{s['key']} {s['weightPct']:.2f}%" for s in top)
            text = f"By {d['dimension']}, your largest slices are {lines}."
            if "get_holdings" in res:
                h = res["get_holdings"][0]["holdings"]
                if h:
                    text += f" Your single largest holding is {h[0]['symbol']} at {h[0]['weightPct']:.2f}% of the portfolio."
            return text, [
                self._use(
                    "render_block",
                    {"kind": "allocation_donut", "title": f"Allocation by {d['dimension']}", "dimension": d["dimension"]},
                )
            ]
        if "get_holdings" in res:
            d = res["get_holdings"][0]
            rows = d["holdings"]
            if not rows:
                return "You don't have any holdings yet. Add a transaction to get started.", []
            items = "; ".join(
                f"{r['symbol']} {inr(r['value'])} ({pct(r['pnlPct'])} overall, {pct(r['dayChangePct'])} today)" for r in rows
            )
            return (
                f"You hold {d['count']} positions. The ones you asked about: {items}.",
                [
                    self._use(
                        "render_block", {"kind": "holdings_table", "title": "Holdings", "sort_by": "weight", "limit": len(rows)}
                    )
                ],
            )
        if "get_price_history" in res:
            d = res["get_price_history"][0]
            if not d.get("available", True):
                return f"I don't have price history for {d['symbol']}.", []
            text = (
                f"{d['name']} moved from {inr(d['first'])} to {inr(d['last'])} ({pct(d['changePct'])}) over {d['range']}, "
                f"with a high of {inr(d['high'])} and a low of {inr(d['low'])}."
            )
            return text, [
                self._use(
                    "render_block", {"kind": "line_chart", "title": d["symbol"], "range": d["range"], "symbols": [d["symbol"]]}
                )
            ]
        if "get_portfolio_metrics" in res:
            d = res["get_portfolio_metrics"][0]
            if not d.get("holdingsCount"):
                return "Your portfolio is empty. Add a transaction and I can describe it.", []
            text = (
                f"Your portfolio is worth {inr(d['value'])} against {inr(d['invested'])} invested, an unrealised P&L of "
                f"{inr(d['pnl'])} ({pct(d['pnlPct'])}). Today it moved {inr(d['dayChange'])} ({pct(d['dayChangePct'])})."
            )
            if d.get("rangeReturnPct") is not None:
                text += f" Over the last {d['range']}, excluding new money, it changed by {inr(d['rangeChange'])} ({pct(d['rangeReturnPct'])})."
            if d.get("xirrPct") is not None:
                text += f" Your XIRR is {d['xirrPct']:.2f}%."
            return text, [
                self._use(
                    "render_block", {"kind": "line_chart", "title": "Portfolio vs NIFTY 50", "range": d["range"], "symbols": []}
                )
            ]
        return (
            "I can describe your portfolio, holdings, allocation, performance against the NIFTY 50, prices, filings, news and market terms.",
            [],
        )

    async def stream(self, req: LlmRequest) -> AsyncIterator[LlmEvent]:
        turn = _since_last_question(req.messages)
        q = _last_question(req.messages)
        res = _tool_results(turn)
        usage = Usage(input_tokens=sum(len(json.dumps(m, default=str)) for m in req.messages) // 4 + len(req.system) // 4)
        if not res:
            content: list[Block] = self._plan(q)
            stop = "tool_use"
        elif "render_block" in res:
            content, stop = [], "end_turn"
        else:
            text, more = self._answer(q, {k: v for k, v in res.items() if k != "render_block"})
            for i in range(0, len(text), self._chunk):
                yield TextDelta(text[i : i + self._chunk])
            content = [{"type": "text", "text": text}, *more]
            stop = "tool_use" if more else "end_turn"
        usage.output_tokens = sum(len(json.dumps(b)) for b in content) // 4
        yield Done(content, stop, usage)
