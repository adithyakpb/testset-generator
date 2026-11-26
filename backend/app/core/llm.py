"""LLM gateway: single client, provider backends. OPENAI-compatible HTTP
provider + built-in MOCK provider (deterministic canned generations, keyed on
prompt hash) so the demo works with zero API keys."""
import hashlib
import json
import os
import re
from typing import Protocol

PROVIDER = os.environ.get("LLM_PROVIDER", "mock")
MODEL = os.environ.get("LLM_MODEL", "mock-1")
API_KEY = os.environ.get("LLM_API_KEY", "")
BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")

_temp_state = {"provider": PROVIDER, "model": MODEL}


def set_provider(provider: str | None = None, model: str | None = None) -> None:
    if provider:
        _temp_state["provider"] = provider
    if model:
        _temp_state["model"] = model


class Provider(Protocol):
    def complete(self, system: str, user: str) -> str: ...


def _hash(s: str) -> int:
    return int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)


class MockProvider:
    """Deterministic mock: same prompt -> same plausible output. Canned
    response bank selected by prompt hash; echoes lexicon terms passed in."""

    def complete(self, system: str, user: str) -> str:
        h = _hash(system + "\x00" + user)
        kind = _intent_of(system)
        if kind == "grammar":
            return _mock_degrade(user)
        if kind == "codemix":
            return _mock_codemix(user)
        if kind == "expected":
            return _mock_expected(user, h)
        # query drafting
        return _mock_query(user, h)


def _intent_of(system: str) -> str:
    if "rewrite informally with grammatical errors" in system:
        return "grammar"
    if "code-mix" in system:
        return "codemix"
    if "EXPECTED RESPONSE" in system:
        return "expected"
    return "query"


def _pick(seed: int, items: list[str]) -> str:
    return items[seed % len(items)]


def _mock_query(user: str, h: int) -> str:
    terms = re.findall(r"(?:TERMS|LEXICON):\s*(.*)", user)
    lex = [t.strip() for t in (terms[0].split(",") if terms and terms[0] else [])]
    topic = lex[0] if lex else "the order"
    openers = ["hi", "hello", "hey", "excuse me", "sir"]
    closers = ["please help", "kya karein?", "any update?", "jaldi batao", "thanks in advance"]
    q = f"{_pick(h, openers)}, I have a question about {topic} on my order {_pick(h >> 1, ['12345', '98765', '43210'])} — {_pick(h >> 2, ['it is not working', 'status dikha do', 'I need to change it', 'still waiting'])}, {_pick(h >> 3, closers)}"
    return q


def _mock_expected(user: str, h: int) -> str:
    # The generator embeds must-include facts; mock writes a compliant response.
    facts = re.findall(r"- (.+)", user)
    body = "I understand. "
    for f in facts[:2]:
        body += f.strip() + ". "
    body += _pick(h, ["Would you like me to check further?", "Let me know if you need anything else.", "Anything else I can help with?"])
    return body


def _mock_degrade(user: str) -> str:
    text = user.strip().splitlines()[-1]
    text = text.replace(" is ", " ")
    text = re.sub(r"\bI am\b", "im", text)
    text = text.replace(".", "").replace(",", "")
    return text.lower()


def _mock_codemix(user: str) -> str:
    """Substitute a couple of English words with Hinglish equivalents."""
    pairs = [("what", "kya"), ("how", "kaise"), ("why", "kyun"), ("yes", "haan"), ("no", "nahi"),
             ("very", "bahut"), ("quickly", "jaldi"), ("please", "please"), ("problem", " dikkat"),
             ("help", "madad"), ("give", "dedo"), ("tell", "batao"), ("good", "accha")]
    text = user.strip().splitlines()[-1]
    n = 0
    for en, hi in pairs:
        if n >= 3:
            break
        if en in text.lower():
            text = re.sub(en, hi, text, count=1, flags=re.I)
            n += 1
    return text


class OpenAICompatProvider:
    """Minimal OpenAI-compatible /chat/completions client (works for Ollama too)."""

    def complete(self, system: str, user: str) -> str:
        import httpx
        resp = httpx.post(
            f"{BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {API_KEY}"} if API_KEY else {},
            json={"model": _temp_state["model"], "temperature": 0.7,
                  "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
            timeout=120,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


def get_provider() -> Provider:
    p = _temp_state["provider"]
    return OpenAICompatProvider() if p != "mock" else MockProvider()


def complete(system: str, user: str) -> str:
    """Gateway entry: retries with backoff on transient errors (mock never fails)."""
    import time
    provider = get_provider()
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            return provider.complete(system, user)
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"llm gateway failed: {last_err}")
