from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Histogram

REGISTRY = CollectorRegistry()
TURNS = Counter("arth_ai_turns_total", "Chat turns by outcome", ["outcome"], registry=REGISTRY)
GUARD = Counter("arth_ai_guard_total", "Guard interventions", ["kind"], registry=REGISTRY)
GROUNDING = Counter("arth_ai_grounding_total", "Grounding check results", ["result"], registry=REGISTRY)
TOKENS = Counter("arth_ai_tokens_total", "LLM tokens", ["dir"], registry=REGISTRY)
TURN_SECONDS = Histogram(
    "arth_ai_turn_seconds", "Turn wall time", buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32), registry=REGISTRY
)
TTFT_SECONDS = Histogram(
    "arth_ai_ttft_seconds", "Time to first token", buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8), registry=REGISTRY
)
TOOL_SECONDS = Histogram(
    "arth_ai_tool_seconds", "Tool latency", ["tool"], buckets=(0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2), registry=REGISTRY
)
