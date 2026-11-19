from __future__ import annotations

import re

_INSTRUCTION_LIKE = re.compile(
    r"(ignore|disregard|forget)\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)"
    r"|you\s+are\s+now\b[^.\n]*"
    r"|(reveal|print|show|repeat)\s+(your|the)\s+(system\s+prompt|instructions)"
    r"|system\s+prompt"
    r"|\bact\s+as\s+(an?\s+)?[^.\n]{0,40}"
    r"|\bdisregard\b[^.\n]*"
    r"|\b(buy|sell)\s+now\b"
    r"|</?\s*(system|assistant|user|instructions?)\s*>",
    re.IGNORECASE,
)
REMOVED = "[removed: instruction-like text]"


def neutralize(text: str) -> tuple[str, int]:
    text = re.sub(r"</?\s*untrusted_document", "&lt;untrusted_document", text, flags=re.IGNORECASE)
    return _INSTRUCTION_LIKE.subn(REMOVED, text)


def wrap_untrusted(text: str, source: str) -> str:
    clean, _ = neutralize(text)
    return f'<untrusted_document source="{source}">\n{clean}\n</untrusted_document>'
