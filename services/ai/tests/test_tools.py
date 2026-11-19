from __future__ import annotations

import json
import uuid

from arth_ai.rag.memory import MemoryRetriever
from arth_ai.tools import TOOLS, TurnContext, run_tool

from .fakes import FakeApi


def _ctx(api: FakeApi, retriever: MemoryRetriever) -> TurnContext:
    return TurnContext(uuid.uuid4(), api, retriever)


async def _call(ctx: TurnContext, name: str, inp: dict) -> tuple[object, bool]:  # type: ignore[type-arg]
    r = await run_tool(ctx, {"type": "tool_use", "id": "t1", "name": name, "input": inp})
    return (r["content"] if r["is_error"] else json.loads(r["content"])), r["is_error"]


def test_tool_schemas_are_strict() -> None:
    names = {t.name for t in TOOLS}
    assert {"get_portfolio_metrics", "get_holdings", "compare_to_index", "render_block", "search_news"} <= names
    for t in TOOLS:
        if t.name != "render_block":
            assert t.input_schema["additionalProperties"] is False


async def test_metrics_and_caching(api: FakeApi, retriever: MemoryRetriever) -> None:
    ctx = _ctx(api, retriever)
    out, err = await _call(ctx, "get_portfolio_metrics", {"range": "1m"})
    assert not err and isinstance(out, dict)
    assert out["holdingsCount"] == 3 and out["xirrPct"] == 18.34 and out["rangeReturnPct"] is not None
    await _call(ctx, "get_holdings", {"sort_by": "pnl"})
    assert api.calls.count("portfolio") == 1


async def test_holdings_sorting_and_bad_input(api: FakeApi, retriever: MemoryRetriever) -> None:
    ctx = _ctx(api, retriever)
    out, _ = await _call(ctx, "get_holdings", {"sort_by": "weight", "limit": 2})
    assert isinstance(out, dict) and [h["symbol"] for h in out["holdings"]] == ["TCS", "HDFCBANK"]
    assert out["holdings"][0]["weightPct"] == 40.0
    msg, err = await _call(ctx, "get_holdings", {"sort_by": "vibes"})
    assert err and "sort_by" in str(msg)
    msg, err = await _call(ctx, "nope", {})
    assert err and "unknown tool" in str(msg)
    msg, err = await _call(ctx, "get_price_history", {"symbol": "TCS; DROP", "range": "1m"})
    assert err


async def test_compare_to_index(api: FakeApi, retriever: MemoryRetriever) -> None:
    out, _ = await _call(_ctx(api, retriever), "compare_to_index", {"range": "1m"})
    assert isinstance(out, dict) and out["available"]
    assert out["differencePct"] == round(out["portfolioReturnPct"] - out["indexReturnPct"], 2)


async def test_search_cites_and_wraps(api: FakeApi, retriever: MemoryRetriever) -> None:
    ctx = _ctx(api, retriever)
    out, _ = await _call(ctx, "search_news", {"query": "TCS forum post", "symbol": "TCS"})
    assert isinstance(out, dict) and out["results"]
    for r in out["results"]:
        assert r["text"].startswith("<untrusted_document")
        assert "ignore all previous instructions" not in r["text"].lower()
    assert [c.n for c in ctx.citations] == list(range(1, len(ctx.citations) + 1))


async def test_render_block_fills_from_server_data(api: FakeApi, retriever: MemoryRetriever) -> None:
    ctx = _ctx(api, retriever)
    _, err = await _call(ctx, "render_block", {"kind": "holdings_table", "title": "Top", "sort_by": "weight", "limit": 2})
    assert not err and ctx.blocks[0]["rows"][0]["symbol"] == "TCS"
    _, err = await _call(ctx, "render_block", {"kind": "line_chart", "title": "vs index", "range": "1m", "symbols": []})
    assert not err and len(ctx.blocks[1]["series"]) == 2
    _, err = await _call(ctx, "render_block", {"kind": "iframe"})
    assert err


async def test_api_errors_become_tool_errors(retriever: MemoryRetriever) -> None:
    msg, err = await _call(_ctx(FakeApi(fail=True), retriever), "get_holdings", {"sort_by": "weight"})
    assert err and "503" in str(msg)
