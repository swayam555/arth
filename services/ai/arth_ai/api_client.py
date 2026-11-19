from __future__ import annotations

import uuid
from typing import Any, Protocol

import httpx

from .auth import internal_token
from .config import Settings

Json = dict[str, Any]


class ApiError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"{status}: {detail}")
        self.status = status


class PortfolioApi(Protocol):
    async def consents(self, user: uuid.UUID) -> dict[str, bool]: ...
    async def portfolio(self, user: uuid.UUID) -> Json: ...
    async def history(self, user: uuid.UUID, days: int) -> Json: ...
    async def closes(self, user: uuid.UUID, symbol: str, days: int) -> Json: ...


class HttpPortfolioApi:
    def __init__(self, cfg: Settings, client: httpx.AsyncClient | None = None) -> None:
        self._cfg = cfg
        self._client = client or httpx.AsyncClient(base_url=cfg.api_base_url, timeout=httpx.Timeout(5.0, connect=2.0))

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _get(self, user: uuid.UUID, path: str, params: dict[str, Any] | None = None) -> Any:
        r = await self._client.get(
            f"/internal/v1{path}",
            params=params,
            headers={"Authorization": f"Bearer {internal_token(user, self._cfg)}"},
        )
        if r.status_code >= 400:
            raise ApiError(r.status_code, r.text[:200])
        return r.json()

    async def consents(self, user: uuid.UUID) -> dict[str, bool]:
        data = await self._get(user, "/consents")
        return {str(k): bool(v) for k, v in data.items()}

    async def portfolio(self, user: uuid.UUID) -> Json:
        return dict(await self._get(user, "/portfolio"))

    async def history(self, user: uuid.UUID, days: int) -> Json:
        return dict(await self._get(user, "/portfolio/history", {"days": days}))

    async def closes(self, user: uuid.UUID, symbol: str, days: int) -> Json:
        return dict(await self._get(user, f"/instruments/{symbol}/closes", {"days": days}))
