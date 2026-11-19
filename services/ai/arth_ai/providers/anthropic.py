from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import anthropic

from .base import Block, Done, LlmEvent, LlmRequest, ProviderError, TextDelta, Usage

_JSON_RETRIES = 2


def _block(b: Any) -> Block | None:
    match b.type:
        case "text":
            return {"type": "text", "text": b.text}
        case "tool_use":
            return {"type": "tool_use", "id": b.id, "name": b.name, "input": dict(b.input or {})}
        case "thinking":
            return {"type": "thinking", "thinking": b.thinking, "signature": b.signature}
        case "redacted_thinking":
            return {"type": "redacted_thinking", "data": b.data}
    return None


def _wire_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in messages:
        content = []
        for b in m["content"]:
            if b["type"] == "tool_result":
                content.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": b["tool_use_id"],
                        "content": b["content"],
                        "is_error": bool(b.get("is_error")),
                    }
                )
            else:
                content.append(b)
        out.append({"role": m["role"], "content": content})
    return out


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, model: str, effort: str = "medium", client: anthropic.AsyncAnthropic | None = None) -> None:
        self._client = client or anthropic.AsyncAnthropic(max_retries=2)
        self._model = model
        self._effort = effort

    async def stream(self, req: LlmRequest) -> AsyncIterator[LlmEvent]:
        tools: list[dict[str, Any]] = [
            {"name": t.name, "description": t.description, "input_schema": t.input_schema, "eager_input_streaming": True}
            for t in req.tools
        ]
        if tools:
            tools[-1]["cache_control"] = {"type": "ephemeral"}
        attempt = 0
        while True:
            emitted = False
            try:
                async with self._client.messages.stream(
                    model=self._model,
                    max_tokens=req.max_tokens,
                    system=[{"type": "text", "text": req.system, "cache_control": {"type": "ephemeral"}}],
                    messages=_wire_messages(req.messages),  # type: ignore[arg-type]
                    tools=tools,  # type: ignore[arg-type]
                    tool_choice={"type": "auto"},
                    thinking={"type": "adaptive"},
                    output_config={"effort": self._effort},  # type: ignore[arg-type]
                ) as s:
                    async for event in s:
                        if event.type == "text":
                            emitted = True
                            yield TextDelta(event.text)
                    final = await s.get_final_message()
            except ValueError:
                attempt += 1
                if emitted or attempt > _JSON_RETRIES:
                    raise ProviderError("model produced unparseable tool input") from None
                continue
            except anthropic.RateLimitError as e:
                raise ProviderError(f"rate limited: {e.message}", retryable=True) from e
            except anthropic.APIStatusError as e:
                raise ProviderError(f"anthropic {e.status_code}: {e.message}", retryable=e.status_code >= 500) from e
            except anthropic.APIConnectionError as e:
                raise ProviderError("anthropic unreachable", retryable=True) from e
            u = final.usage
            usage = Usage(u.input_tokens, u.output_tokens, getattr(u, "cache_read_input_tokens", 0) or 0)
            content = [blk for b in final.content if (blk := _block(b)) is not None]
            yield Done(content, str(final.stop_reason or "end_turn"), usage)
            return
