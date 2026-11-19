from __future__ import annotations

import json
from typing import Any


def parse_sse(raw: str) -> list[tuple[str, dict[str, Any]]]:
    out: list[tuple[str, dict[str, Any]]] = []
    for frame in raw.strip().split("\n\n"):
        name, data = "", ""
        for line in frame.splitlines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data += line[6:]
        if name:
            out.append((name, json.loads(data)))
    return out


def final_text(events: list[tuple[str, dict[str, Any]]]) -> str:
    text = ""
    for name, data in events:
        if name == "token":
            text += data["text"]
        elif name == "replace":
            text = data["text"]
    return text
