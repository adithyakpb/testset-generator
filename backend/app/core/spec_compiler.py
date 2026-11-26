"""Response-spec compiler: pure functions. spec doc -> (generation constraints
text, assertions list, few-shot anchors). No LLM calls."""
import re


def validate_spec(doc: dict) -> tuple[list[str], list[str]]:
    """Save-time lint. Returns (errors, warnings)."""
    errors, warnings = [], []
    mi = doc.get("must_include") or []
    mni = doc.get("must_not_include") or []
    if any(not str(f).strip() for f in mi):
        errors.append("must_include contains an empty value")
    inc = {str(f).strip().lower() for f in mi}
    for x in mni:
        v = x.get("phrase") if isinstance(x, dict) else x
        if v and str(v).strip().lower() in inc:
            errors.append(f"phrase also in must_include: {v}")
    for f in mi:
        if len(str(f)) > 200:
            warnings.append("very long must_include item — likely a paragraph, not a fact")
    tone = str(doc.get("tone", {}).get("description", "") if isinstance(doc.get("tone"), dict) else doc.get("tone", ""))
    if tone.strip().lower() in ("good", "nice", "great"):
        warnings.append('vague tone description ("good"/"nice")')
    return errors, warnings


def compile_constraints(doc: dict, intent: str | None = None) -> str:
    """(a) Generation constraints block injected into expected-response prompts."""
    tone = doc.get("tone", {}) or {}
    struct = doc.get("structure", {}) or {}
    fmt = doc.get("format", {}) or {}
    refusal = doc.get("refusal_policy", {}) or {}
    lines = [f"[RESPONSE SPEC v{doc.get('version', 1)}]"]
    if tone:
        desc = tone.get("description", "") if isinstance(tone, dict) else ""
        lines.append(f"TONE: {tone.get('preset', '') if isinstance(tone, dict) else ''}{' — ' + desc if desc else ''}".strip(" —"))
    if struct:
        lines.append(f"STRUCTURE: {' → '.join(struct.get('flow', []))}. Max {struct.get('max_sentences', 5)} sentences.")
    if doc.get("must_include"):
        lines.append("MUST INCLUDE: " + "; ".join(doc["must_include"]))
    for x in doc.get("must_not_include", []) or []:
        if isinstance(x, dict) and "phrase" in x:
            lines.append(f"MUST NOT INCLUDE phrase: \"{x['phrase']}\"")
        else:
            lines.append(f"MUST NOT INCLUDE topic: {x}")
    if fmt:
        lines.append(f"FORMAT: {fmt.get('output', 'plain')}, ≤{fmt.get('max_length_chars', 800)} chars")
    if refusal:
        lines.append(f"REFUSAL: if user mentions {' / '.join(refusal.get('trigger_hints', []))} → {refusal.get('behavior')}: \"{refusal.get('message', '')}\"")
    if intent:
        for ov in doc.get("intent_overrides", []) or []:
            if ov.get("intent") == intent:
                lines.append(f"[OVERRIDE for {intent}]: {ov}")
    return "\n".join(lines)


_NUM_WORDS = {"1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven", "10": "ten", "30": "thirty", "40": "forty", "60": "sixty", "90": "ninety"}


def compile_assertions(doc: dict, user_turn: str) -> list[dict]:
    """(b) Machine-checkable assertions for one case. Refusal policy is only
    active when trigger hints appear in the user turn."""
    assertions: list[dict] = []
    for fact in doc.get("must_include", []) or []:
        alts = [re.escape(fact)]
        for n, w in _NUM_WORDS.items():
            if n in fact:
                alts.append(re.escape(fact.replace(n, w)))
        assertions.append({"scorer": "regex", "pattern": "|".join(alts), "negate": False, "source": "must_include"})
    for x in doc.get("must_not_include", []) or []:
        v = x.get("phrase") if isinstance(x, dict) else x
        if v:
            assertions.append({"scorer": "regex", "pattern": re.escape(str(v)), "negate": True, "source": "must_not_include"})
        else:
            assertions.append({"scorer": "llm_judge", "criterion": f"Does the response discuss: {x}? must not.", "source": "must_not_include"})
    tone = doc.get("tone", {})
    if tone:
        preset = tone.get("preset") if isinstance(tone, dict) else tone
        assertions.append({"scorer": "llm_judge", "criterion": f"tone: {preset}", "source": "tone"})
    struct = doc.get("structure", {}) or {}
    if struct.get("flow"):
        assertions.append({"scorer": "llm_judge", "criterion": "structure: " + " → ".join(struct["flow"]), "source": "structure"})
    fmt = doc.get("format", {}) or {}
    if fmt.get("max_length_chars"):
        assertions.append({"scorer": "length", "max_chars": fmt["max_length_chars"], "source": "format"})
    refusal = doc.get("refusal_policy", {}) or {}
    hints = refusal.get("trigger_hints", []) or []
    if hints and any(h.lower() in (user_turn or "").lower() for h in hints):
        assertions.append({"scorer": "regex", "pattern": re.escape(refusal.get("message", ""))[:0] or "refusal expected",
                           "negate": False, "source": "refusal_policy", "expect_refusal": True,
                           "message": refusal.get("message", "")})
    return assertions


def compile_anchors(doc: dict) -> list[dict]:
    """(c) Golden examples as few-shot anchors."""
    return doc.get("examples", []) or []
