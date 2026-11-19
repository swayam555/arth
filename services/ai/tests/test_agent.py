from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest

from arth_ai import guard
from arth_ai.agent import Agent, BudgetExceeded, ConsentRequired, Event
from arth_ai.cache import MemoryCache
from arth_ai.config import Settings
from arth_ai.providers.base import Done, LlmEvent, LlmRequest, ProviderError, TextDelta, Usage
from arth_ai.rag.memory import MemoryRetriever
from arth_ai.store import MemoryStore, NotFound

from .fakes import FakeApi
from .sse import final_text


async def turn(agent: Agent, user: uuid.UUID, q: str, session: uuid.UUID | None = None) -> list[Event]:
    p = await agent.prepare(user, q, session)
    return [ev async for ev in agent.run(p)]


def names(evs: list[Event]) -> list[str]:
    return [n for n, _ in evs]


async def test_overview_answer_is_grounded_with_block(agent: Agent, user: uuid.UUID, store: MemoryStore) -> None:
    evs = await turn(agent, user, "How is my portfolio doing this month?")
    assert names(evs)[0] == "meta" and names(evs)[-1] == "done"
    assert "status" in names(evs) and "block" in names(evs)
    done = evs[-1][1]
    assert done["grounded"] and not done["cached"] and done["disclaimer"] == guard.DISCLAIMER
    assert "₹" in final_text(evs) and "replace" not in names(evs)
    sid = uuid.UUID(evs[0][1]["sessionId"])
    hist = await store.history(user, sid)
    assert [m.role for m in hist] == ["user", "assistant"] and hist[1].blocks


async def test_advice_is_refused_without_tools(agent: Agent, user: uuid.UUID, api: FakeApi) -> None:
    evs = await turn(agent, user, "Should I sell TCS now?")
    assert evs[-1][1]["refused"] and guard.REFUSAL in final_text(evs)
    assert "status" not in names(evs) and api.calls == []


async def test_second_identical_question_hits_cache(agent: Agent, user: uuid.UUID) -> None:
    first = await turn(agent, user, "Show my holdings by weight")
    second = await turn(agent, user, "show my holdings by weight!")
    assert second[-1][1]["cached"] and "status" not in names(second)
    assert final_text(first) == final_text(second)


async def test_cache_busts_when_portfolio_changes(agent: Agent, user: uuid.UUID, api: FakeApi) -> None:
    await turn(agent, user, "Show my holdings by weight")
    api.data = {**api.data, "version": "v2"}
    again = await turn(agent, user, "Show my holdings by weight")
    assert not again[-1][1]["cached"]


async def test_consent_and_budget(cfg: Settings, retriever: MemoryRetriever, user: uuid.UUID) -> None:
    from arth_ai.providers.scripted import ScriptedProvider

    no_consent = Agent(cfg, ScriptedProvider(), FakeApi({"core": True}), retriever, MemoryStore(), MemoryCache())
    with pytest.raises(ConsentRequired):
        await no_consent.prepare(user, "hi", None)
    store = MemoryStore()
    await store.add_usage(user, cfg.daily_token_budget, 1)
    broke = Agent(cfg, ScriptedProvider(), FakeApi(), retriever, store, MemoryCache())
    with pytest.raises(BudgetExceeded):
        await broke.prepare(user, "hi", None)


async def test_unknown_session_and_cross_user(agent: Agent, user: uuid.UUID) -> None:
    with pytest.raises(NotFound):
        await agent.prepare(user, "hi", uuid.uuid4())
    evs = await turn(agent, user, "What is XIRR?")
    sid = uuid.UUID(evs[0][1]["sessionId"])
    with pytest.raises(NotFound):
        await agent.prepare(uuid.uuid4(), "hi", sid)


async def test_pii_is_masked_before_storage(agent: Agent, user: uuid.UUID, store: MemoryStore) -> None:
    evs = await turn(agent, user, "my email is me@example.com, what is LTCG?")
    assert evs[0][1]["piiMasked"] == ["email"]
    dump = str(await store.export(user))
    assert "me@example.com" not in dump and "[EMAIL]" in dump


async def test_injected_document_does_not_leak(agent: Agent, user: uuid.UUID) -> None:
    evs = await turn(agent, user, "Any news or forum post about TCS?")
    text = final_text(evs).lower()
    assert "ignore" not in text and "buy now" not in text
    cites = next(d for n, d in evs if n == "citations")["items"]
    assert set(cites[0]) == {"n", "chunkId", "title", "source", "kind", "url", "publishedAt", "snippet"}
    assert evs[-1][1]["grounded"]


async def test_follow_up_uses_history(agent: Agent, user: uuid.UUID, store: MemoryStore) -> None:
    first = await turn(agent, user, "What is XIRR?")
    sid = uuid.UUID(first[0][1]["sessionId"])
    second = await turn(agent, user, "Show my holdings by weight", sid)
    assert not second[-1][1]["cached"]
    assert len(await store.history(user, sid)) == 4


class Liar:
    """A fake LLM that calls one tool and then invents a number and gives advice."""

    name = "liar"

    def __init__(self, text: str) -> None:
        self.text = text
        self.calls = 0

    async def stream(self, req: LlmRequest) -> AsyncIterator[LlmEvent]:
        self.calls += 1
        last = req.messages[-1]["content"]
        if isinstance(last, str) and not last.startswith("These figures"):
            yield Done(
                [{"type": "tool_use", "id": "t1", "name": "get_portfolio_metrics", "input": {"range": "1m"}}],
                "tool_use",
                Usage(10, 5),
            )
            return
        yield TextDelta(self.text)
        yield Done([{"type": "text", "text": self.text}], "end_turn", Usage(20, 10))


def _agent(cfg: Settings, provider: Any, retriever: MemoryRetriever) -> Agent:
    return Agent(cfg, provider, FakeApi(), retriever, MemoryStore(), MemoryCache())


async def test_ungrounded_llm_answer_is_repaired(cfg: Settings, retriever: MemoryRetriever, user: uuid.UUID) -> None:
    liar = Liar("Your XIRR is 18.34%. Next year it should return 31.7%.")
    evs = await turn(_agent(cfg, liar, retriever), user, "how am I doing")
    assert evs[-1][1]["grounded"] is False
    assert final_text(evs) == "Your XIRR is 18.34%."
    assert liar.calls == 3


async def test_advice_in_output_is_replaced(cfg: Settings, retriever: MemoryRetriever, user: uuid.UUID) -> None:
    evs = await turn(
        _agent(cfg, Liar("Your XIRR is 18.34%. You should consider buying more TCS."), retriever), user, "how am I doing"
    )
    assert final_text(evs).startswith(guard.REFUSAL)


class Refuser:
    name = "refuser"

    async def stream(self, req: LlmRequest) -> AsyncIterator[LlmEvent]:
        yield TextDelta("Sure, here")
        yield Done([], "refusal", Usage(5, 2))


class Flaky:
    name = "flaky"

    def __init__(self) -> None:
        self.calls = 0

    async def stream(self, req: LlmRequest) -> AsyncIterator[LlmEvent]:
        self.calls += 1
        if self.calls == 1:
            raise ProviderError("overloaded", retryable=True)
        yield Done([{"type": "text", "text": "Hello."}], "end_turn", Usage(1, 1))
        return


async def test_model_refusal_replaced(cfg: Settings, retriever: MemoryRetriever, user: uuid.UUID) -> None:
    evs = await turn(_agent(cfg, Refuser(), retriever), user, "how am I doing")
    assert final_text(evs) == guard.REFUSAL


async def test_retryable_provider_error_retried(cfg: Settings, retriever: MemoryRetriever, user: uuid.UUID) -> None:
    flaky = Flaky()
    evs = await turn(_agent(cfg, flaky, retriever), user, "hello there")
    assert flaky.calls == 2 and names(evs)[-1] == "done"


async def test_portfolio_outage_is_an_error_event(cfg: Settings, retriever: MemoryRetriever, user: uuid.UUID) -> None:
    from arth_ai.providers.scripted import ScriptedProvider

    a = Agent(cfg, ScriptedProvider(), FakeApi(fail=True), retriever, MemoryStore(), MemoryCache())
    evs = await turn(a, user, "how am I doing")
    assert evs[-1] == ("error", {"code": "portfolio_unavailable", "message": "Portfolio service error (503)."})


async def test_block_round_does_not_repeat_answer(agent: Agent, user: uuid.UUID) -> None:
    evs = await turn(agent, user, "Show my holdings by weight")
    text = final_text(evs)
    assert text.count("You hold 3 positions") == 1
    assert names(evs).count("block") == 1
