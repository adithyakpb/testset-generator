# 6. The Response Spec

The SME-facing differentiator: a declarative, versioned document that says **"this is how I want responses to look."** Authored via a guided form UI (never YAML editing), stored as JSON, and compiled into generation constraints, assertions, and few-shot anchors. It is not a prompt template — SMEs never see prompts; the system compiles the spec into them.

One project has one base spec; intents may carry simple overrides. Every save creates a new version, so test cases pin a spec version.

## 6.1 Schema

```yaml
schema_version: 1
spec_id: ecommerce-support-bot
version: 3

tone:
  preset: friendly-professional     # preset key or free text
  description: "Warm, patient, never robotic. Use 'aap' for Hindi words."
  banned_styles: ["sarcastic", "condescending"]

structure:
  flow: [acknowledge, answer, next_step]
  max_sentences: 5

must_include:
  - "return window is 30 days from delivery"
  - "refund goes to original payment method within 5-7 business days"

must_not_include:
  - "giving legal advice about consumer court"
  - phrases: ["as an AI", "I don't know"]

format:
  output: markdown                  # plain | markdown
  max_length_chars: 800

refusal_policy:
  behavior: redirect-to-human
  trigger_hints: ["consumer court", "sue"]
  message: "I'm not able to help with that, but I can connect you to our team."

examples:                           # golden pairs — generation anchors AND assertion calibration
  - id: EX-1
    intent: return_policy
    user: "kya main 40 din baad return kar sakta hoon?"
    ideal_response: "I understand the concern. Unfortunately, our return window is 30 days from delivery, so this order is not eligible. However, if the item is damaged, warranty claims are still open — would you like me to check?"
    why: "Polite refusal beyond window + cites exact policy + offers alternative."

intent_overrides:                   # optional; override = replace whole field
  - intent: legal_threat
    refusal_policy: {behavior: refuse-and-redirect, message: "This is outside what I can help with — connecting you to a human colleague."}
```

**Override merge rule (kept deliberately simple):** a field present in an override *replaces* the base field entirely; absent fields inherit. No partial list merging.

## 6.2 Compilation targets

A pure, deterministic compiler (no LLM calls) in the core lib produces:

```
response_spec ──compile──▶ (a) generation constraints → generation prompts
                           (b) assertions             → stored on each test case (exported)
                           (c) few-shot anchors       → generation + user simulator
```

**(a) Generation constraints** — a structured block injected into expected-response generation and rollout prompts:

```
[RESPONSE SPEC v3]
TONE: friendly-professional — warm, patient, never robotic. Never sarcastic.
STRUCTURE: acknowledge → answer → next_step. Max 5 sentences.
MUST INCLUDE: return window is 30 days; refund to original payment method in 5-7 business days
MUST NOT INCLUDE: legal advice about consumer court; phrases "as an AI", "I don't know"
FORMAT: markdown, ≤800 chars
REFUSAL: if user mentions consumer court / sue → refuse and redirect: "<message>"
```

**(b) Assertions** — machine-checkable expectations stored on each test case and exported with the testset, so downstream eval tooling (or a future built-in runner) can score against them:

| Spec field | Assertion |
|---|---|
| `must_include` facts | Keyword/regex (auto-expanded with lexicon variants, e.g. "30 days" ↔ "thirty days") |
| `must_not_include` phrases | Negated regex, case-insensitive |
| `must_not_include` topics | Judge criterion: "Does the response discuss X?" |
| `tone`, `structure.flow` | Judge criteria (structure checked in order) |
| `structure.max_sentences`, `format.*` | Deterministic checks (sentence count, length, markdown) |
| `refusal_policy` | If trigger hints appear in the *user* turn → expectation that the response refuses; otherwise vacuous |

The spec's golden `examples` (with `why`) serve as calibration reference for judge-style assertions.

**(c) Few-shot anchors** — `examples[]` pairs are injected into generation prompts (as ideal responses) and into the simulator prompt (the *user* side only — "how users here actually write"; responses stay hidden to keep roles decoupled). Approved/edited cases from the review queue can be pinned as new examples with one click.

## 6.3 Validation (save-time, keep it short)

Errors (block save): empty must_include values; `must_not_include` value also in `must_include`.
Warnings (flag): duplicate facts; vague tone descriptions ("good", "nice"); facts longer than ~200 chars (likely a paragraph, not a fact); a golden example that violates its own spec — this doubles as an SME teaching tool.

## 6.4 UI mapping

| Form control | Schema field |
|---|---|
| Preset dropdown + "describe in your words" textarea | `tone` |
| Reorderable step chips (Acknowledge / Answer / Next step / …) | `structure.flow` |
| "Must always include" list builder (plain text rows) | `must_include` |
| "Must never include" list builder (topic rows + phrase rows) | `must_not_include` |
| Output segmented control + length slider | `format` |
| Refusal radio + "when to refuse" tags + message box | `refusal_policy` |
| Example cards: user box, ideal response, "why", "check against spec" button | `examples` |
| Override panel: pick intent → edit deltas vs. base | `intent_overrides` |
| Save → diff preview v(n-1) → v(n), lint inline | versioning |

## 6.5 Worked example (Hinglish e-commerce support)

Given the spec above, Stage 4/5 produces:

```json
{
  "id": "tc-0192",
  "intent": "return_policy",
  "persona": {"name": "Riya", "register": "whatsapp-casual"},
  "cmd": 0.35,
  "turns": [{"role": "user", "text": "arre yaar 40 din ho gaye delivery ko, return kar sakti hoon kya??"}],
  "expected": {
    "response": "I understand the concern. Our return window is 30 days from delivery, so this order isn't eligible. If the item is damaged, warranty is still open — want me to check?",
    "assertions": [
      {"scorer": "regex", "pattern": "(30|thirty)\\s+days?", "source": "must_include[0]"},
      {"scorer": "regex", "pattern": "as an AI|I don't know", "negate": true},
      {"scorer": "llm_judge", "criterion": "tone: friendly-professional, never robotic"},
      {"scorer": "llm_judge", "criterion": "structure: acknowledge → answer → next_step"}
    ],
    "spec_version": 3
  }
}
```

Note the split: the noise pipeline corrupts the **user** input ("arre yaar…??"), the spec governs the **expected response** (clean). Assertions travel with the case in every export format, ready for whatever eval tooling the team uses.
