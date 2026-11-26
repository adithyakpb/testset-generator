"""Transform chain: seeded, ordered ops turning clean drafts into noisy human
input. Ops 1/4/5 pure python; grammar + code-mixing go via the LLM (mock-able),
with a pure-python fallback for code-mixing. Validators log decisions.

Ops: 1 typos → 2 grammar degradation → 3 code-mixing → 4 register shift →
5 terminology mangling. Presets mild|moderate|heavy.
"""
import random
import re

from . import llm
from .analyze import HINGLISH_WORDS

ROW_NEIGHBORS = {"q": "w", "w": "e", "e": "r", "r": "t", "t": "y", "a": "s", "s": "d", "d": "f", "o": "p", "i": "o", "u": "i"}


def keyboard_typos(text: str, intensity: float, rng: random.Random) -> str:
    """Pure python: replace/transpose/delete chars on random word letters."""
    words = text.split(" ")
    n_typos = max(0, int(len(words) * intensity))
    for _ in range(n_typos):
        i = rng.randrange(len(words))
        w = words[i]
        if len(w) < 3:
            continue
        j = rng.randrange(1, len(w) - 1)
        op = rng.choice(["replace", "transpose", "delete"])
        if op == "replace":
            w = w[:j] + ROW_NEIGHBORS.get(w[j].lower(), w[j]) + w[j + 1:]
        elif op == "transpose" and j + 1 < len(w):
            w = w[:j] + w[j + 1] + w[j] + w[j + 2:]
        else:
            w = w[:j] + w[j + 1:]
        words[i] = w
    return " ".join(words)


def grammar_degrade(text: str, intensity: float, use_llm: bool = True) -> tuple[str, str]:
    """LLM rewrite (mock-able); pure-python fallback if LLM off."""
    if use_llm:
        n = max(1, round(intensity * 3))
        system = f"rewrite informally with grammatical errors, keep meaning and entities"
        try:
            return llm.complete(system, text), "llm"
        except Exception:
            pass
    # fallback: lowercase, drop articles
    out = re.sub(r"\b(the|a|an)\s+", "", text, flags=re.I)
    out = re.sub(r"\bis\b|\bare\b", "", out, flags=re.I)
    return out, "fallback"


HINGLISH_SUBS = {  # tiny Hinglish lexicon for the pure-python substitution fallback
    "what": "kya", "how": "kaise", "why": "kyun", "yes": "haan", "no": "nahi",
    "very": "bahut", "quickly": "jaldi", "problem": "dikkat", "help": "madad",
    "give": "dedo", "tell": "batao", "good": "accha", "please": "please yaar",
}


def code_mix(text: str, target_cmd: float, use_llm: bool = True) -> tuple[str, float]:
    """CMD-controlled substitution. Tries the LLM first; falls back to pure
    python word substitution from the small lexicon. Returns (text, measured_cmd)."""

    def measured(t: str) -> float:
        toks = re.findall(r"[a-z\u0900-\u097F']+", t.lower())
        if not toks:
            return 0.0
        hi = sum(1 for w in toks if re.search(r"[\u0900-\u097F]", w) or w in HINGLISH_WORDS)
        return round(hi / len(toks), 3)

    if use_llm:
        try:
            out = llm.complete("code-mix the user text with natural Hinglish words", text)
            return out, measured(out)
        except Exception:
            pass
    toks = text.split(" ")
    want = max(0, round(target_cmd * len(toks)))
    done = 0
    out = []
    for w in toks:
        key = re.sub(r"[^a-z]", "", w.lower())
        if done < want and key in HINGLISH_SUBS:
            out.append(HINGLISH_SUBS[key])
            done += 1
        else:
            out.append(w)
    result = " ".join(out)
    return result, measured(result)


def register_shift(text: str, register: str, rng: random.Random) -> str:
    """Pure python: light-touch register tweaks."""
    if register == "whatsapp-casual":
        text = text.rstrip(".") + ("??" if text.rstrip().endswith("?") else "")
        if rng.random() < 0.5:
            text = "arre " + text[0].lower() + text[1:] if text and text[0].isupper() else text
    elif register == "polite-formal":
        text = "Hi, " + text[0].lower() + text[1:] if text else text
    return text


def mangle_terms(text: str, lexicon_terms: list[dict], rng: random.Random) -> str:
    """Runs last: substitute domain terms with lexicon typo_surface_forms."""
    out = text
    for t in lexicon_terms:
        forms = t.get("typo_forms") or []
        if not forms or rng.random() < 0.5:
            continue
        pat = re.compile(re.escape(t["term"]), re.I)
        if pat.search(out):
            out = pat.sub(forms[rng.randrange(len(forms))], out, count=1)
    return out


def validate(text: str, original: str, required_entities: list[str], max_ratio: float = 0.6) -> dict:
    """Length + entity-survival checks. Returns {ok, reasons}."""
    reasons = []
    if len(text) < max(4, len(original) * 0.3):
        reasons.append("too short")
    if len(text) > len(original) * 4 + 40:
        reasons.append("too long")
    for e in required_entities or []:
        if e.lower() not in text.lower() and e.isdigit() is False:
            reasons.append(f"entity lost: {e}")
    return {"ok": not reasons, "reasons": reasons}


PRESETS = {
    "mild": {"typos": 0.05, "grammar": 0.2, "cmd_scale": 0.5, "register": True, "mangle": 0.3},
    "moderate": {"typos": 0.15, "grammar": 0.5, "cmd_scale": 1.0, "register": True, "mangle": 0.6},
    "heavy": {"typos": 0.3, "grammar": 0.8, "cmd_scale": 1.3, "register": True, "mangle": 1.0},
}


def apply_chain(text: str, params: dict, chain_seed: int, lexicon_terms: list[dict]) -> tuple[str, list[dict]]:
    """Ordered, seeded, reproducible chain. Returns (final_text, trace)."""
    preset = PRESETS.get(params.get("preset", "moderate"), PRESETS["moderate"])
    rng = random.Random(chain_seed)
    trace: list[dict] = []
    cur = text
    required = re.findall(r"\d+", text)

    # 1 typos
    cur2 = keyboard_typos(cur, preset["typos"], rng)
    trace.append({"op": "typos", "ok": validate(cur2, cur, required)["ok"]})
    cur = cur2

    # 2 grammar
    if rng.random() < preset["grammar"]:
        g, via = grammar_degrade(cur, preset["grammar"], use_llm=params.get("use_llm", True))
        v = validate(g, cur, required)
        if v["ok"]:
            cur = g
        trace.append({"op": "grammar", "via": via, "ok": v["ok"], "reasons": v["reasons"]})

    # 3 code-mixing
    target = min(0.8, params.get("cmd", 0.3) * preset["cmd_scale"])
    if target > 0.05:
        c, measured = code_mix(cur, target, use_llm=params.get("use_llm", True))
        ok = abs(measured - target) <= params.get("cmd_tolerance", 0.25)
        if ok or not params.get("strict_cmd", False):
            cur = c
        trace.append({"op": "code_mix", "measured_cmd": measured, "target": target, "ok": ok})

    # 4 register shift
    if preset["register"]:
        cur2 = register_shift(cur, params.get("register", "whatsapp-casual"), rng)
        trace.append({"op": "register", "ok": validate(cur2, cur, required)["ok"]})
        cur = cur2

    # 5 terminology mangling (last)
    if rng.random() < preset["mangle"]:
        cur2 = mangle_terms(cur, lexicon_terms, rng)
        trace.append({"op": "mangle", "ok": validate(cur2, cur, required)["ok"]})
        cur = cur2

    return cur, trace
