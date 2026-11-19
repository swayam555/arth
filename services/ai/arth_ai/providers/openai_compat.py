from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from .base import Block, Done, LlmEvent, LlmRequest, Message, ProviderError, TextDelta, Usage


def _to_wire(system: str, messages: list[Message]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = [{"role": "system", "content": system}]
    for m in messages:
        blocks = m["content"]
        if m["role"] == "assistant":
            text = "".join(b["text"] for b in blocks if b["type"] == "text")
            calls = [
                {"id": b["id"], "type": "function", "function": {"name": b["name"], "arguments": json.dumps(b["input"])}}
                for b in blocks
                if b["type"] == "tool_use"
            ]
            msg: dict[str, Any] = {"role": "assistant", "content": text or None}
            if calls:
                msg["tool_calls"] = calls
            out.append(msg)
            continue
        for b in blocks:
            if b["type"] == "tool_result":
                out.append({"role": "tool", "tool_call_id": b["tool_use_id"], "content": b["content"]})
        text = "".join(b["text"] for b in blocks if b["type"] == "text")
        if text:
            out.append({"role": "user", "content": text})
    return out


class OpenAICompatProvider:
    """Chat Completions wire format: OpenAI, Groq, Gemini's OpenAI endpoint, Ollama, vLLM."""

    name = "openai_compat"

    def __init__(self, base_url: str, api_key: str, model: str, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=5.0))
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._key = api_key
        self._model = model

    async def stream(self, req: LlmRequest) -> AsyncIterator[LlmEvent]:
        body = {
            "model": self._model,
            "stream": True,
            "stream_options": {"include_usage": True},
            "max_completion_tokens": req.max_tokens,
            "messages": _to_wire(req.system, req.messages),
            "tools": [
                {"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.input_schema}}
                for t in req.tools
            ],
        }
        headers = {"Authorization": f"Bearer {self._key}"} if self._key else {}
        text: list[str] = []
        calls: dict[int, dict[str, str]] = {}
        finish = "end_turn"
        usage = Usage()
        try:
            async with self._client.stream("POST", self._url, json=body, headers=headers) as r:
                if r.status_code >= 400:
                    detail = (await r.aread()).decode(errors="replace")[:200]
                    raise ProviderError(f"{r.status_code}: {detail}", retryable=r.status_code >= 500 or r.status_code == 429)
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    if u := chunk.get("usage"):
                        usage = Usage(int(u.get("prompt_tokens", 0)), int(u.get("completion_tokens", 0)))
                    for choice in chunk.get("choices", []):
                        delta = choice.get("delta") or {}
                        if piece := delta.get("content"):
                            text.append(piece)
                            yield TextDelta(piece)
                        for tc in delta.get("tool_calls") or []:
                            slot = calls.setdefault(int(tc.get("index", 0)), {"id": "", "name": "", "args": ""})
                            fn = tc.get("function") or {}
                            slot["id"] = tc.get("id") or slot["id"]
                            slot["name"] += fn.get("name") or ""
                            slot["args"] += fn.get("arguments") or ""
                        if fr := choice.get("finish_reason"):
                            finish = {"tool_calls": "tool_use", "length": "max_tokens", "content_filter": "refusal"}.get(
                                fr, "end_turn"
                            )
        except httpx.HTTPError as e:
            raise ProviderError(f"openai-compatible endpoint unreachable: {type(e).__name__}", retryable=True) from e
        content: list[Block] = [{"type": "text", "text": "".join(text)}] if text else []
        for i in sorted(calls):
            c = calls[i]
            try:
                args = json.loads(c["args"] or "{}")
            except json.JSONDecodeError:
                args = {"__invalid_json__": c["args"][:200]}
            content.append({"type": "tool_use", "id": c["id"] or f"call_{i}", "name": c["name"], "input": args})
        yield Done(content, finish, usage)
