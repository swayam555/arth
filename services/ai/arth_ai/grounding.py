from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

_NUM = re.compile(
    r"(?<![\w.])[-−]?(?:\d{1,3}(?:,\d{2})*,\d{3}|\d+)(?:\.\d+)?(?:\s*(lakh|lakhs|crore|crores|cr|k|%))?", re.IGNORECASE
)
_SCALE = {"lakh": 1e5, "lakhs": 1e5, "crore": 1e7, "crores": 1e7, "cr": 1e7, "k": 1e3}
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z₹\"'(*-])|\n+")
_CITE = re.compile(r"\[\d+\]")
SMALL_INT = 12


@dataclass(frozen=True)
class Mention:
    raw: str
    value: float
    decimals: int


@dataclass(frozen=True)
class Report:
    grounded: bool
    unsupported: tuple[str, ...]


def mentions(text: str) -> list[Mention]:
    out: list[Mention] = []
    for m in _NUM.finditer(_CITE.sub(" ", text)):
        raw = m.group(0)
        num = re.sub(r"[^\d.\-−]", "", raw.split()[0] if m.group(1) and " " in raw else re.sub(r"[a-zA-Z%]+$", "", raw))
        num = num.replace("−", "-").rstrip(".")
        if not num or num in "-.":
            continue
        value = float(num)
        unit = (m.group(1) or "").lower()
        decimals = len(num.split(".")[1]) if "." in num else 0
        out.append(Mention(raw.strip(), value * _SCALE.get(unit, 1.0), decimals if unit not in _SCALE else -1))
    return out


def collect(values: Iterable[Any]) -> set[float]:
    found: set[float] = set()

    def walk(v: Any) -> None:
        if isinstance(v, bool) or v is None:
            return
        if isinstance(v, int | float):
            found.add(float(v))
        elif isinstance(v, str):
            for part in re.findall(r"\d+(?:\.\d+)?", v.replace(",", "")):
                found.add(float(part))
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list | tuple):
            found.add(float(len(v)))
            for x in v:
                walk(x)

    for v in values:
        walk(v)
    return found


def _matches(m: Mention, known: set[float]) -> bool:
    target = m.value
    if target.is_integer() and 0 <= target <= SMALL_INT:
        return True
    for k in known:
        for cand in (k, abs(k), k * 100, k / 100, -k):
            if m.decimals >= 0 and round(cand, m.decimals) == round(target, m.decimals):
                return True
            if abs(target) > 0 and abs(cand - target) / abs(target) <= 0.005:
                return True
            if abs(abs(cand) - abs(target)) / max(abs(target), 1e-9) <= 0.005:
                return True
    return False


def check(answer: str, known: set[float]) -> Report:
    bad = [m.raw for m in mentions(answer) if not _matches(m, known)]
    return Report(not bad, tuple(bad))


def strip_unsupported(answer: str, known: set[float]) -> str:
    kept = [s for s in _SENTENCE.split(answer) if s.strip() and check(s, known).grounded]
    return " ".join(kept).strip()
