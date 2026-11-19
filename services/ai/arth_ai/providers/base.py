from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Protocol

Block = dict[str, Any]
Message = dict[str, Any]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass(frozen=True)
class LlmRequest:
    system: str
    messages: list[Message]
    tools: list[ToolSpec]
    max_tokens: int = 4096


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0

    def add(self, other: Usage) -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cache_read_tokens += other.cache_read_tokens

    @property
    def total(self) -> int:
        return self.input_tokens + self.output_tokens


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class Done:
    content: list[Block]
    stop_reason: str
    usage: Usage = field(default_factory=Usage)


LlmEvent = TextDelta | Done


class ProviderError(Exception):
    def __init__(self, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


class Provider(Protocol):
    name: str

    def stream(self, req: LlmRequest) -> AsyncIterator[LlmEvent]: ...


def text_of(content: list[Block]) -> str:
    return "".join(b["text"] for b in content if b.get("type") == "text")


def tool_uses(content: list[Block]) -> list[Block]:
    return [b for b in content if b.get("type") == "tool_use"]
