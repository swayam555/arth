from __future__ import annotations

import hashlib
import itertools
import math
import re
from typing import Protocol

import httpx

DIM = 1024
_TOKEN = re.compile(r"[a-z0-9]+(?:\.[0-9]+)?")
_STOP = frozenset(
    "a an and are as at be by for from has have i in is it its of on or that the this to was were will with what how my me "
    "do does did can you your which who whom why when where about into than then them they there these those".split()
)


def tokens(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOP]


class Embedder(Protocol):
    name: str
    dim: int

    async def embed(self, texts: list[str], kind: str) -> list[list[float]]: ...


def _bucket(feature: str) -> tuple[int, float]:
    h = hashlib.blake2b(feature.encode(), digest_size=8).digest()
    n = int.from_bytes(h, "little")
    return n % DIM, 1.0 if (n >> 63) & 1 else -1.0


class HashingEmbedder:
    """Signed feature hashing over unigrams, bigrams and char trigrams. Deterministic, offline, no model weights."""

    name = "hashing-v1"
    dim = DIM

    def _one(self, text: str) -> list[float]:
        vec = [0.0] * DIM
        toks = tokens(text)
        feats: list[tuple[str, float]] = [(f"w:{t}", 1.0) for t in toks]
        feats += [(f"b:{a}_{b}", 0.7) for a, b in itertools.pairwise(toks)]
        for t in toks:
            padded = f"#{t}#"
            feats += [(f"c:{padded[i : i + 3]}", 0.25) for i in range(len(padded) - 2)]
        for f, w in feats:
            i, sign = _bucket(f)
            vec[i] += sign * w
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]

    async def embed(self, texts: list[str], kind: str) -> list[list[float]]:
        return [self._one(t) for t in texts]


class VoyageEmbedder:
    name = "voyage-3.5"
    dim = DIM

    def __init__(self, api_key: str, client: httpx.AsyncClient | None = None) -> None:
        self._key = api_key
        self._client = client or httpx.AsyncClient(timeout=20.0)

    async def embed(self, texts: list[str], kind: str) -> list[list[float]]:
        r = await self._client.post(
            "https://api.voyageai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {self._key}"},
            json={"model": "voyage-3.5", "input": texts, "input_type": kind, "output_dimension": DIM},
        )
        r.raise_for_status()
        return [list(map(float, d["embedding"])) for d in r.json()["data"]]


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))


def to_pgvector(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"
