from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from arth_ai import telemetry
from arth_ai.rag.memory import MemoryRetriever
from arth_ai.tools import TurnContext, run_tool

from .fakes import FakeApi


def test_scrub_masks_pii_and_drops_request_payloads() -> None:
    event = {
        "message": "lookup failed for a@b.com",
        "user": {"id": "x"},
        "request": {"data": {"q": "secret"}, "headers": {"Authorization": "Bearer t"}, "url": "http://ai/v1/chat"},
        "logentry": {"message": "pan %s", "formatted": "pan ABCDE1234F", "params": ["ABCDE1234F"]},
        "exception": {"values": [{"value": "phone 9876543210 bad", "stacktrace": {"frames": [{"vars": {"q": "x"}}]}}]},
        "breadcrumbs": {"values": [{"message": "to a@b.com", "data": {"body": "x"}}]},
    }
    out = telemetry.scrub_event(event)
    flat = repr(out)
    for leaked in ("a@b.com", "ABCDE1234F", "9876543210", "secret", "Bearer", "vars"):
        assert leaked not in flat
    assert out["request"] == {"url": "http://ai/v1/chat"} and "user" not in out


def test_init_is_noop_without_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    assert telemetry.init_sentry() is False
    assert telemetry.init_tracing(FastAPI()) is False


async def test_tool_span_is_child_of_turn(retriever: MemoryRetriever) -> None:
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("t")
    parent = tracer.start_span("copilot.turn")
    ctx = TurnContext(uuid.uuid4(), FakeApi(), retriever, trace_parent=trace.set_span_in_context(parent))
    import arth_ai.tools as tools

    original = tools._tracer
    tools._tracer = tracer
    try:
        res = await run_tool(ctx, {"type": "tool_use", "id": "t1", "name": "no_such_tool", "input": {}})
    finally:
        tools._tracer = original
    parent.end()
    assert res["is_error"] is True
    spans = {s.name: s for s in exporter.get_finished_spans()}
    child = spans["tool no_such_tool"]
    assert child.parent is not None and child.parent.span_id == parent.get_span_context().span_id
    assert child.attributes is not None and child.attributes["arth.tool.error"] is True
