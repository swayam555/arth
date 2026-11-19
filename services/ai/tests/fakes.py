from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any

from arth_ai.api_client import ApiError

Json = dict[str, Any]


def _holding(sym: str, name: str, sector: str, qty: float, avg: float, ltp: float, prev: float, weight: float) -> Json:
    value = qty * ltp
    cost = qty * avg
    return {
        "symbol": sym,
        "name": name,
        "sector": sector,
        "qty": qty,
        "avgCost": avg,
        "ltp": ltp,
        "value": value,
        "dayChange": qty * (ltp - prev),
        "dayChangePct": (ltp / prev - 1) * 100,
        "pnl": value - cost,
        "pnlPct": (value / cost - 1) * 100,
        "weight": weight,
    }


def demo_portfolio(version: str = "v1") -> Json:
    holdings = [
        _holding("TCS", "Tata Consultancy Services", "IT", 10, 3500, 4100.5, 4080, 0.4),
        _holding("HDFCBANK", "HDFC Bank", "Financials", 20, 1500, 1640.25, 1650, 0.32),
        _holding("ITC", "ITC", "FMCG", 60, 400, 478.1, 470, 0.28),
    ]
    value = sum(h["value"] for h in holdings)
    invested = sum(h["qty"] * h["avgCost"] for h in holdings)
    day = sum(h["dayChange"] for h in holdings)
    return {
        "version": version,
        "invested": invested,
        "value": value,
        "dayChange": day,
        "dayChangePct": day / (value - day) * 100,
        "pnl": value - invested,
        "pnlPct": (value / invested - 1) * 100,
        "realized": 1250.0,
        "xirr": 0.1834,
        "holdings": holdings,
        "allocation": {
            "sector": [
                {"key": "IT", "value": holdings[0]["value"], "weight": 0.4},
                {"key": "Financials", "value": holdings[1]["value"], "weight": 0.32},
                {"key": "FMCG", "value": holdings[2]["value"], "weight": 0.28},
            ],
            "mcap": [{"key": "large", "value": value, "weight": 1.0}],
            "asset": [{"key": "equity", "value": value, "weight": 1.0}],
        },
    }


def _days(n: int) -> list[str]:
    start = date(2026, 11, 18) - timedelta(days=n - 1)
    return [(start + timedelta(days=i)).isoformat() for i in range(n)]


class FakeApi:
    def __init__(self, consents: dict[str, bool] | None = None, portfolio: Json | None = None, fail: bool = False) -> None:
        self.consent_map = consents if consents is not None else {"core": True, "ai_copilot": True}
        self.data = portfolio if portfolio is not None else demo_portfolio()
        self.fail = fail
        self.calls: list[str] = []

    async def consents(self, user: uuid.UUID) -> dict[str, bool]:
        return dict(self.consent_map)

    async def portfolio(self, user: uuid.UUID) -> Json:
        self.calls.append("portfolio")
        if self.fail:
            raise ApiError(503, "down")
        return self.data

    async def history(self, user: uuid.UUID, days: int) -> Json:
        self.calls.append(f"history:{days}")
        n = min(days, 30)
        inv = self.data["invested"]
        pts = [{"date": d, "value": inv * (1 + 0.004 * i), "invested": inv} for i, d in enumerate(_days(n))]
        return {"points": pts, "estimatedShare": 0.0}

    async def closes(self, user: uuid.UUID, symbol: str, days: int) -> Json:
        self.calls.append(f"closes:{symbol}:{days}")
        base = 250.0 if symbol == "NIFTYBEES" else 1000.0
        n = min(days, 30)
        return {
            "symbol": symbol,
            "name": symbol,
            "closes": [{"date": d, "close": base * (1 + 0.002 * i)} for i, d in enumerate(_days(n))],
        }
