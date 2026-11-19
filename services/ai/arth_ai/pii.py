from __future__ import annotations

import re
from dataclasses import dataclass

_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("email", re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")),
    ("pan", re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")),
    ("aadhaar", re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b")),
    ("phone", re.compile(r"(?<![\w.])(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b")),
]


@dataclass(frozen=True)
class Masked:
    text: str
    found: tuple[str, ...]


def mask(text: str) -> Masked:
    found: list[str] = []
    for kind, pat in _PATTERNS:
        text, n = pat.subn(f"[{kind.upper()}]", text)
        found.extend([kind] * n)
    return Masked(text, tuple(found))
