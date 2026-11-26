"""Generate: single-turn case generation constrained by lexicon + persona +
register + CMD. Expected response + assertions compiled from the Response Spec.
Deterministic given `seed` (mock LLM + seeded sampling)."""
import random

from . import llm
from .spec_compiler import compile_assertions, compile_constraints

PERSONAS = [
    {"name": "Riya", "style": "whatsapp-casual", "goals": ["get order status", "return an item"]},
    {"name": "Arjun", "style": "terse", "goals": ["refund follow-up", "address change"]},
    {"name": "Priya", "style": "polite-formal", "goals": ["product question", "complaint escalation"]},
    {"name": "Rohan", "style": "frustrated-support", "goals": ["late delivery", "wrong item received"]},
]


def draft_query(intent_terms: list[str], persona: dict, register: str, cmd: float, seed: int) -> str:
    system = "You draft realistic user support queries. Use the given lexicon terms. Query:"
    user = f"TERMS: {', '.join(intent_terms[:5])}\nPERSONA: {persona.get('name')} ({persona.get('style')})\nREGISTER: {register}\nCMD: {cmd}"
    query = llm.complete(system, user)
    # reproducibility: seeded register tweaks on top of the mock output
    rng = random.Random(seed)
    if register == "whatsapp-casual" and not query.endswith(("?", "??", "!")):
        query += ("??" if rng.random() < 0.4 else "")
    return query


def generate_single_turn(
    project_ctx: dict,
    spec_doc: dict,
    intent: dict,
    count: int,
    seed: int,
    cmd: float | None = None,
    register: str | None = None,
) -> list[dict]:
    """project_ctx: {lexicon_terms, register_profile, personas, seeds}"""
    cmd = cmd if cmd is not None else project_ctx["register_profile"].get("default_cmd", 0.3)
    register = register or "whatsapp-casual"
    constraints = compile_constraints(spec_doc, intent=intent.get("label"))
    cases = []
    for i in range(count):
        case_seed = seed + i
        rng = random.Random(case_seed)
        persona = rng.choice(project_ctx["personas"])
        terms = intent.get("top_terms", [])[:5] or [t["term"] for t in project_ctx["lexicon_terms"][:5]]
        query = draft_query(terms, persona, register, cmd, case_seed)
        system = f"{constraints}\n\nEXPECTED RESPONSE (comply strictly with the spec above):"
        user = "User asked: " + query
        expected_response = llm.complete(system, user)
        cases.append({
            "kind": "single_turn",
            "intent_cluster_id": intent.get("id"),
            "intent_label": intent.get("label"),
            "persona": persona,
            "cmd": cmd,
            "register": register,
            "turns": [{"role": "user", "text": query}],
            "expected": {
                "response": expected_response,
                "assertions": compile_assertions(spec_doc, query),
                "spec_version": spec_doc.get("version", 1),
            },
            "seed_ids": intent.get("exemplar_ids", [])[:3],
            "seed": case_seed,
        })
    return cases
