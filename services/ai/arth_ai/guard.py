from __future__ import annotations

import re
from dataclasses import dataclass

DISCLAIMER = "Information only, not investment advice. Arth is not a SEBI-registered investment adviser."

REFUSAL = (
    "I can't tell you whether to buy, sell or hold a security. Only a SEBI-registered investment adviser can give "
    "personalised advice like that."
)

_EDUCATIONAL = re.compile(
    r"\b(what\s+(is|are|does)|explain|meaning\s+of|define|definition|how\s+does|how\s+is\b.*\btaxed)\b|kya\s+hota\s+hai|matlab",
    re.IGNORECASE,
)
_ACTION = r"(buy|sell|hold|exit|accumulate|book\s+profit|invest\w*|enter|switch\w*|add\s+more|average\s+down|kharid\w*|bech\w*|le\s+lu|nikal\w*)"
_ACTION_ING = r"(buying|selling|holding|exiting|accumulating|averaging\s+down|adding\s+more|booking\s+profits?)"
_ADVICE = [
    re.compile(
        rf"\b(should|shall|must|recommend|suggest|advis\w*|worth|good\s+time|right\s+time|better\s+to)\b.*\b({_ACTION}|{_ACTION_ING})\b",
        re.IGNORECASE,
    ),
    re.compile(rf"\b{_ACTION}\b.*(\bor\s+not\b|\bya\s+nahi\b|\bchahiye\b|\bkarun?\b|\bkya\b|\bnow\s*\??\s*$)", re.IGNORECASE),
    re.compile(rf"^\s*{_ACTION}\b[^.]*\?", re.IGNORECASE),
    re.compile(rf"\bkya\b.*\b{_ACTION}", re.IGNORECASE),
    re.compile(
        r"\b(which|what|kaun\s*s[ae])\s+(stock|share|fund|mutual\s+fund)s?\b.*\b(buy|invest|pick|best|kharid\w*)", re.IGNORECASE
    ),
    re.compile(r"\bis\s+\w+(\s+\w+)?\s+a\s+(good\s+|strong\s+)?(buy|sell)\b", re.IGNORECASE),
    re.compile(r"\b(recommend|suggest)\s+(me\s+)?(a|an|some|any|good)\b", re.IGNORECASE),
    re.compile(r"\b(best|top)\s+\d*\s*(stocks?|shares?)\s+(to|for)\s+(buy|invest)", re.IGNORECASE),
]
_FORECAST = re.compile(
    r"\b(stock\s+tips?|tips?\s+(for|on)|multibagger|target\s+price|price\s+target|(going\s+to|gonna)\s+(rally|fall|rise|crash|go\s+(up|down))|will\s+(\w+\s+){1,3}(go\s+(up|down)|rise|fall|crash|recover|double))\b",
    re.IGNORECASE,
)

_OUT_ADVICE = re.compile(
    r"\b(you\s+should|i(?:'d|’d|\s+would)?\s+(recommend|suggest|advise)|consider)\s+(buying|selling|holding|exiting|adding|trimming|reducing|increasing|booking)"
    r"|\b(strong\s+)?(buy|sell)\s+(rating|call|recommendation)\b"
    r"|\b(it\s+is|it's|now\s+is)\s+a\s+good\s+time\s+to\s+(buy|sell|invest)"
    r"|\b(the|our|my|its)\s+target\s+price\s+(of|for|is)\b|\btarget\s+price\s+of\s+(₹|rs\.?\s*)?\d"
    r"|\b(will|is\s+going\s+to)\s+(definitely\s+)?(go\s+up|rise|double|outperform)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Verdict:
    blocked: bool
    reason: str = ""


def check_input(question: str) -> Verdict:
    q = question.strip()
    if _FORECAST.search(q):
        return Verdict(True, "forecast_request")
    for pat in _ADVICE:
        if pat.search(q):
            if _EDUCATIONAL.search(q) and not re.search(r"\b(should|recommend|chahiye|which\s+stock)\b", q, re.IGNORECASE):
                return Verdict(False)
            return Verdict(True, "advice_request")
    return Verdict(False)


def check_output(answer: str) -> Verdict:
    return Verdict(True, "advice_in_output") if _OUT_ADVICE.search(answer) else Verdict(False)


def reframe(question: str) -> str:
    return (
        f"{REFUSAL}\n\nWhat I can do is show you the facts: your current exposure, how a holding has performed, "
        "how your portfolio compares with the NIFTY 50, or recent filings and news. For example, ask "
        '"How concentrated is my portfolio?" or "How has my portfolio done against the NIFTY 50 this year?"'
    )
