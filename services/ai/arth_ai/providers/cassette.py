from __future__ import annotations

import hashlib
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from .base import Done, LlmEvent, LlmRequest, Provider, ProviderError, TextDelta, Usage


def request_key(req: LlmRequest) -> str:
    body = {"system": req.system, "messages": req.messages, "tools": [t.name for t in req.tools]}
    return hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()[:24]


class CassetteProvider:
    """Records a real provider's responses to disk and replays them, so LLM-backed evals are reproducible and free to rerun."""

    def __init__(self, inner: Provider | None, directory: Path, mode: str) -> None:
        self._inner, self._dir, self._mode = inner, directory, mode
        self.name = f"cassette:{inner.name if inner else 'replay'}"

    async def stream(self, req: LlmRequest) -> AsyncIterator[LlmEvent]:
        path = self._dir / f"{request_key(req)}.json"
        if path.exists() and self._mode != "record":
            data: dict[str, Any] = json.loads(path.read_text())
            for t in data["deltas"]:
                yield TextDelta(t)
            yield Done(data["content"], data["stop_reason"], Usage(**data["usage"]))
            return
        if self._inner is None or self._mode == "replay":
            raise ProviderError(f"no cassette for request {path.name}")
        deltas: list[str] = []
        async for ev in self._inner.stream(req):
            if isinstance(ev, TextDelta):
                deltas.append(ev.text)
            else:
                self._dir.mkdir(parents=True, exist_ok=True)
                path.write_text(
                    json.dumps(
                        {"deltas": deltas, "content": ev.content, "stop_reason": ev.stop_reason, "usage": vars(ev.usage)},
                        ensure_ascii=False,
                        indent=1,
                    )
                )
            yield ev
