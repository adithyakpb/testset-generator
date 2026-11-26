"""Anonymize: regex-based PII detection with consistent per-project surrogates.

Optional presidio-anonymizer enhancement if importable; must work without it.
Consistent surrogates: one real entity -> one fake value for the whole project.
"""
import hashlib
import re

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"(?:\+91[\-\s]?)?[6-9]\d{4}[\-\s]?\d{5}|\b\d{3}[\-\s]\d{3}[\-\s]\d{4}\b")
# name-ish: "I am/bought by <Capitalized Name>" style — deliberately crude
NAME_RE = re.compile(r"\b(?:my name is|name:|I am|this is)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b")
CARD_RE = re.compile(r"\b(?:\d[ -]?){13,16}\b")

try:  # optional enhancement, never required for install/runtime
    import presidio_anonymizer  # noqa: F401
    PRESIDIO_AVAILABLE = True
except Exception:  # pragma: no cover
    PRESIDIO_AVAILABLE = False


_FIRST = ["Riya", "Arjun", "Priya", "Rohan", "Neha", "Sameer", "Ananya", "Kabir"]
_DOMAINS = ["example.com", "mail.example.com", "test.example.in"]
_FLOOR = ["2A", "3B", "4C", "5D", "6E"]


class _Surrogates:
    """Deterministic per-project surrogate store (thin slice: in-memory per job,
    persisted into SurrogateMap by the caller)."""

    def __init__(self, mapping: dict | None = None):
        self.mapping = mapping or {}

    def get(self, real: str, kind: str) -> str:
        if real in self.mapping:
            return self.mapping[real]
        h = hashlib.sha256(f"{kind}:{real}".encode()).digest()
        if kind == "email":
            fake = f"user{h[0]}@{_DOMAINS[h[1] % len(_DOMAINS)]}"
        elif kind == "phone":
            fake = f"+9198{h[0]:02d}{h[1]:02d}{h[2]:02d}{h[3]:02d}0"
        elif kind == "card":
            fake = "XXXX-XXXX-XXXX-" + f"{h[0]}{h[1]}{h[2]}{h[3]}"
        elif kind == "name":
            fake = _FIRST[h[0] % len(_FIRST)]
        else:
            fake = f"<{kind}-{h[0]:x}>"
        self.mapping[real] = fake
        return fake


def detect_and_anonymize(text: str, surrogates: _Surrogates | None = None) -> tuple[str, list[dict]]:
    """Return (anonymized_text, pii_spans). Spans reference the ORIGINAL text."""
    surrogates = surrogates or _Surrogates()
    spans: list[dict] = []

    def sub(cur: str, re_, kind: str) -> str:
        out, pos, offset = [], 0, 0
        for m in re_.finditer(cur):
            val = m.group(1) if m.groups() else m.group(0)
            fake = surrogates.get(val, kind)
            out.append(cur[pos:m.start()])
            if kind == "name" and m.groups():
                out.append(cur[m.start():m.start(1)] + fake)
            else:
                out.append(fake)
            pos = m.end()
            spans.append({"type": kind, "start": m.start() + offset, "end": pos + offset})
        out.append(cur[pos:])
        return "".join(out)

    out = text
    for re_, kind in ((EMAIL_RE, "email"), (CARD_RE, "card"), (PHONE_RE, "phone"), (NAME_RE, "name")):
        out = sub(out, re_, kind)
    return out, spans
