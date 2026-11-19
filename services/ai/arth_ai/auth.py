from __future__ import annotations

import time
import uuid

import jwt

from .config import Settings

INTERNAL_ISSUER = "arth-ai"
INTERNAL_AUDIENCE = "arth-internal"


class AuthError(Exception):
    pass


def user_from_bearer(header: str | None, cfg: Settings) -> uuid.UUID:
    if not header or not header.startswith("Bearer "):
        raise AuthError("missing_token")
    try:
        claims = jwt.decode(
            header[7:],
            cfg.jwt_secret,
            algorithms=["HS256"],
            issuer=cfg.jwt_issuer,
            options={"require": ["sub", "exp", "iss"]},
        )
    except jwt.PyJWTError as e:
        raise AuthError("invalid_token") from e
    if claims.get("aud") is not None:
        raise AuthError("invalid_token")
    try:
        return uuid.UUID(str(claims["sub"]))
    except ValueError as e:
        raise AuthError("invalid_token") from e


def internal_token(user_id: uuid.UUID, cfg: Settings, ttl_s: int = 60) -> str:
    now = int(time.time())
    return jwt.encode(
        {"iss": INTERNAL_ISSUER, "aud": INTERNAL_AUDIENCE, "sub": str(user_id), "iat": now, "exp": now + ttl_s},
        cfg.internal_secret,
        algorithm="HS256",
    )


def user_token(user_id: uuid.UUID, cfg: Settings, ttl_s: int = 900) -> str:
    now = int(time.time())
    return jwt.encode(
        {"iss": cfg.jwt_issuer, "sub": str(user_id), "iat": now, "exp": now + ttl_s}, cfg.jwt_secret, algorithm="HS256"
    )
