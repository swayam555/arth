from __future__ import annotations

from dataclasses import dataclass

TOPIC_DIGEST_READY = "digest.ready"
TOPIC_USER_DELETED = "user.deleted"


def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _str(field: int, value: str) -> bytes:
    if not value:
        return b""
    raw = value.encode()
    return _varint(field << 3 | 2) + _varint(len(raw)) + raw


@dataclass(frozen=True)
class DigestReady:
    user_id: str
    digest_id: str
    for_date: str
    title: str
    body: str

    def encode(self) -> bytes:
        return b"".join(
            _str(i, v) for i, v in enumerate((self.user_id, self.digest_id, self.for_date, self.title, self.body), start=1)
        )


@dataclass(frozen=True)
class UserDeleted:
    user_id: str
    ts_ms: int


def _read_varint(buf: bytes, i: int) -> tuple[int, int]:
    shift = n = 0
    while True:
        if i >= len(buf):
            raise ValueError("truncated varint")
        b = buf[i]
        i += 1
        n |= (b & 0x7F) << shift
        if not b & 0x80:
            return n, i
        shift += 7
        if shift > 63:
            raise ValueError("varint too long")


def decode_user_deleted(buf: bytes) -> UserDeleted:
    user_id, ts, i = "", 0, 0
    while i < len(buf):
        key, i = _read_varint(buf, i)
        field, wt = key >> 3, key & 7
        if wt == 0:
            v, i = _read_varint(buf, i)
            if field == 2:
                ts = v
        elif wt == 2:
            n, i = _read_varint(buf, i)
            if i + n > len(buf):
                raise ValueError("truncated field")
            if field == 1:
                user_id = buf[i : i + n].decode()
            i += n
        elif wt == 1:
            i += 8
        elif wt == 5:
            i += 4
        else:
            raise ValueError(f"unsupported wire type {wt}")
    if not user_id:
        raise ValueError("user_id missing")
    return UserDeleted(user_id, ts)
