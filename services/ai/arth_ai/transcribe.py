from __future__ import annotations

from typing import Protocol

import httpx

MAX_AUDIO_BYTES = 10 * 1024 * 1024
GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_MODEL = "whisper-large-v3-turbo"
ALLOWED_TYPES = frozenset(
    {"audio/m4a", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg"}
)


class TranscribeError(Exception):
    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status, self.code = status, code


class Transcriber(Protocol):
    async def transcribe(self, audio: bytes, filename: str, content_type: str, language: str | None) -> str: ...


class GroqTranscriber:
    def __init__(self, api_key: str, client: httpx.AsyncClient | None = None) -> None:
        self._key = api_key
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0))

    async def transcribe(self, audio: bytes, filename: str, content_type: str, language: str | None) -> str:
        data = {"model": GROQ_MODEL, "response_format": "json", "temperature": "0"}
        if language:
            data["language"] = language
        try:
            r = await self._client.post(
                GROQ_URL,
                headers={"Authorization": f"Bearer {self._key}"},
                data=data,
                files={"file": (filename, audio, content_type)},
            )
        except httpx.HTTPError as e:
            raise TranscribeError(502, "transcription_unreachable") from e
        if r.status_code >= 400:
            raise TranscribeError(502, f"transcription_failed_{r.status_code}")
        return str(r.json().get("text", "")).strip()


class UnavailableTranscriber:
    async def transcribe(self, audio: bytes, filename: str, content_type: str, language: str | None) -> str:
        raise TranscribeError(503, "transcription_not_configured")
