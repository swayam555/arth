"""Guardrail-pipeline evals. Measures the deterministic guards (no LLM quality is measured here).

Run from services/ai:  .venv/bin/python -m evals.run
"""

from __future__ import annotations

import asyncio
import json
import platform
import statistics
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from arth_ai import grounding, guard, injection, pii
from arth_ai.agent import Agent
from arth_ai.cache import MemoryCache
from arth_ai.config import Settings
from arth_ai.providers.scripted import ScriptedProvider
from arth_ai.rag.embed import HashingEmbedder
from arth_ai.rag.memory import MemoryRetriever
from arth_ai.rag.rank import LexicalReranker
from arth_ai.rag.seed import load_corpus
from arth_ai.store import MemoryStore
from tests.fakes import FakeApi

HERE = Path(__file__).parent


def _row(category: str, case: Any, ok: bool, got: Any) -> dict[str, Any]:
    return {"category": category, "case": case, "pass": ok, "got": got}


async def _agent_rows(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cfg = Settings(backend="memory", llm_provider="scripted", cassette_dir="", groq_api_key="", news_feed_urls=())
    retriever = MemoryRetriever(HashingEmbedder(), LexicalReranker())
    await retriever.add(load_corpus())
    api = FakeApi()
    agent = Agent(cfg, ScriptedProvider(), api, retriever, MemoryStore(), MemoryCache())
    rows = []
    for c in cases:
        api.calls.clear()
        events = [e async for e in agent.run(await agent.prepare(uuid.uuid4(), c["q"], None))]
        text = "".join(d["text"] for n, d in events if n == "token")
        for n, d in events:
            if n == "replace":
                text = d["text"]
        refused = guard.REFUSAL in text
        blocks = [d["kind"] for n, d in events if n == "block"]
        cites = [d for n, d in events if n == "citations" and d.get("items")]
        ok = (c["expect"] == "refused") == refused
        if c["expect"] == "refused":
            ok = ok and not api.calls
        if "block" in c:
            ok = ok and c["block"] in blocks
        if c.get("citations"):
            ok = ok and bool(cites)
        ok = ok and events[-1][0] == "done"
        rows.append(_row("agent", c["q"], ok, {"refused": refused, "blocks": blocks, "apiCalls": len(api.calls)}))
    return rows


def _holdout(h: dict[str, list[str]]) -> dict[str, Any]:
    missed = [q for q in h["input_block"] if not guard.check_input(q).blocked]
    false_blocks = [q for q in h["input_allow"] if guard.check_input(q).blocked]
    tp = len(h["input_block"]) - len(missed)
    return {
        "cases": len(h["input_block"]) + len(h["input_allow"]),
        "recall": round(tp / len(h["input_block"]), 3),
        "precision": round(tp / (tp + len(false_blocks)), 3) if tp + len(false_blocks) else 1.0,
        "missedAdvice": missed,
        "falseBlocks": false_blocks,
    }


def main() -> None:
    cases = json.loads((HERE / "cases.json").read_text())
    rows: list[dict[str, Any]] = []
    timings: list[float] = []
    for q in cases["input_block"]:
        t = time.perf_counter()
        v = guard.check_input(q)
        timings.append(time.perf_counter() - t)
        rows.append(_row("input_block", q, v.blocked, v.reason))
    for q in cases["input_allow"]:
        t = time.perf_counter()
        v = guard.check_input(q)
        timings.append(time.perf_counter() - t)
        rows.append(_row("input_allow", q, not v.blocked, v.reason))
    for a in cases["output_block"]:
        rows.append(_row("output_block", a, guard.check_output(a).blocked, None))
    for a in cases["output_allow"]:
        rows.append(_row("output_allow", a, not guard.check_output(a).blocked, None))
    for g in cases["grounding"]:
        r = grounding.check(g["answer"], set(map(float, g["known"])))
        rows.append(_row("grounding", g["answer"], r.grounded == g["grounded"], list(r.unsupported)))
    for i in cases["injection"]:
        _, n = injection.neutralize(i["text"])
        rows.append(_row("injection", i["text"], (n > 0) == i["flag"], n))
    for p in cases["pii"]:
        m = pii.mask(p["text"])
        rows.append(_row("pii", p["text"], sorted(m.found) == sorted(p["kinds"]), list(m.found)))
    rows.extend(asyncio.run(_agent_rows(cases["agent"])))

    by_cat: dict[str, dict[str, int]] = {}
    for r in rows:
        s = by_cat.setdefault(r["category"], {"pass": 0, "total": 0})
        s["total"] += 1
        s["pass"] += int(r["pass"])
    blocked_ok = by_cat["input_block"]["pass"]
    false_blocks = by_cat["input_allow"]["total"] - by_cat["input_allow"]["pass"]
    summary = {
        "ranAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "python": platform.python_version(),
        "cases": len(rows),
        "passed": sum(r["pass"] for r in rows),
        "byCategory": by_cat,
        "inputGuard": {
            "recall": round(blocked_ok / by_cat["input_block"]["total"], 3),
            "precision": round(blocked_ok / (blocked_ok + false_blocks), 3) if blocked_ok + false_blocks else 1.0,
            "medianMicros": round(statistics.median(timings) * 1e6, 1),
        },
        "failures": [r for r in rows if not r["pass"]],
    }
    summary["holdout"] = {k: _holdout(v) for k, v in json.loads((HERE / "holdout.json").read_text()).items()}
    (HERE / "results.json").write_text(json.dumps({"summary": summary, "rows": rows}, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "failures"}, indent=2))
    for name, h in summary["holdout"].items():
        print("holdout", name, json.dumps(h, ensure_ascii=False))
    for f in summary["failures"]:
        print("FAIL", f["category"], "|", f["case"], "|", f["got"])


if __name__ == "__main__":
    main()
