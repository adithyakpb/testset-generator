# 5. Module Design

The core pipeline as a Python library: `ingest → anonymize → analyze → generate → transform → rollout → curate → export`. Every LLM call goes through one gateway (OpenAI/Anthropic/local). The deterministic stages (ingest, anonymize, lexicon, most transforms) work without any LLM so the tool runs offline.

Scope note: this is testset **generation** only. Running generated testsets against endpoints / scoring is out of scope for now — the assertions produced here are exported with the testset for downstream eval tools.

---

## 5.1 Ingestion & Connectors

**Purpose.** Get user data in and normalize it.

- **v1 sources:** file upload (CSV/JSONL/Parquet/text), pasted text. Later: Postgres, S3, webhook push.
- Normalize everything to one shape:

```python
RawRecord = {
  id, text, role: "user"|"assistant"|None,
  turn_index: int|None,        # only for conversational sources
  session_id: str|None,        # groups multi-turn conversations
  meta: dict                   # source-specific fields
}
```

- Simple dedup by content hash; malformed rows go to a rejects list, never silently dropped.
- Random sample with a simple stratification guard (min N per intent/language bucket) so one dominant pattern doesn't swamp the seeds.

**Knobs:** `sample_size`, `max_record_chars`, per-connector `field_map`.

---

## 5.2 Anonymization

**Purpose.** No PII reaches any LLM call. Raw prod text is never replayed into test cases — we anonymize, then synthesize.

- **Presidio** (regex + NER) detection, run over the whole `session_id` group, not line-by-line — PII in multi-turn text is context-dependent (arXiv 2609.22200).
- **Consistent surrogates:** one real entity = one fake value across turns and sessions (same person keeps the same pseudonym), preserving conversation coherence.
- **Format preservation:** fake phones have phone shapes, dates look like dates, etc.
- Keep a simple allow-list for domain terms that look like PII (product names etc.). Raw text stays local and encrypted; generation only ever sees the anonymized view.

**Knobs:** `entity_types[]`, `surrogate_locale`, `allow_list[]`, `confidence_threshold`.

---

## 5.3 Analysis

**Purpose.** Learn from the project's own data instead of using generic noise — this is what makes output realistic.

Produces four artifacts:

```python
DomainLexicon    = {terms: [{term, freq, variants, typo_surface_forms, aliases}]}
RegisterProfile  = {language_pairs: [{"hi-en", share}], cmi_index,  # measured code-mix ratio
                    default_cmd}                                     # e.g. "users write ~35% Hindi words"
IntentInventory  = {clusters: [{cluster_id, label, exemplar_ids, size, top_terms}]}
DialogueStats    = {avg_turns, followup_rate, clarification_rate, topic_shift_rate}
```

- **Lexicon:** KeyBERT (MMR) + spaCy NER; morphological variants + typo'd surface forms seeded from WikiTypo edit-op priors — so we know how users *actually type* jargon.
- **Register/language profile:** language ID + word-level mixing detection over the corpus; measured CMI becomes the default CMD (mixing slider) rather than a guessed number.
- **Intents:** embeddings (pgvector) + HDBSCAN; clusters are editable (rename/merge/split in UI).
- **Dialogue stats:** measured from multi-turn sessions; become the *defaults* for simulator behavior dials (§5.6) — simulate observed behavior, not invented behavior.

**Knobs:** `min_term_freq`, `ngram_range`, `embedding_backend`, `min_cluster_size`.

**Fallbacks:** small corpora → use domain presets until stats are reliable; offline installs → spaCy small models bundled in the Docker image.

---

## 5.4 Generation

**Purpose.** Draft candidate test cases grounded in seeds, lexicon, personas, register, and the Response Spec.

```python
CandidateCase = {
  case_id, kind: "single_turn"|"multi_turn",
  intent_cluster_id, persona, register, cmd,
  utterances: [...],           # pre-transform drafts
  expected: {response, assertions},   # built from the Response Spec
  seed_ids: [...]
}
Assertion = {type: "must_include"|"must_not_include"|"regex"|"tone"|"structure"|"refusal", ...}
```

- **Single-turn:** per intent cluster, LLM drafts queries with explicit prompt constraints: required lexicon terms, persona card, register template (WhatsApp-casual, review, formal…), target CMD. Expansion modes: paraphrase, edge case, negative.
- **Multi-turn:** persona + goal agenda (ordered sub-goals) → the rollout in §5.6 executes it; this stage only drafts the plan and opening turns.
- **Expected outputs:** generated conditioned on the Response Spec; the spec also compiles to `assertions[]` which are stored on the case and exported with the testset (for downstream eval tooling, not run here).
- Diversity: dedupe near-identical drafts (embedding similarity); report lexicon-hit rate and retry if the LLM ignored constraints; flag drafts that copy seed text verbatim.

**Knobs:** `n_per_cluster`, `cmd`, `register`, `variant_modes[]`, `temperature`, `dedup_threshold`.

---

## 5.5 Transform Chain

**Purpose.** The realism layer: turn clean drafts into noisy human input. Ordered, composable, per-utterance — and reproducible.

Each op is a pure function of `(text, params, seed)`, applied in order:

1. **Keyboard typos** — nlpaug `KeyboardAug` baseline, upgraded with MulTypo-style ops (replace/insert/delete/transpose) and WikiTypo priors; typos preferentially hit task-important words (ATA).
2. **Grammar degradation** — LLM rewrite: "rewrite informally with N grammatical errors, keep meaning and entities."
3. **Code-mixing** — CMD-controlled word substitution + LLM smoothing (CodeMixBench recipe); verify measured mixing against target CMD with a language-ID model; transliterate (indic-trans) if the LLM returns native script.
4. **Register shift** — rewrite into the target register (WhatsApp-casual, review, …).
5. **Terminology mangling** — substitute domain terms with their lexicon `typo_surface_forms` (runs last so it sees post-mixing text).

- **Validators** after each op: meaning preserved (embedding similarity), required entities still present, length bounds. Failed → retry at lower intensity or drop the op; every decision logged.
- **Presets:** `mild | moderate | heavy` map to preset chains; "custom" exposes per-op probability/intensity.
- **Reproducibility:** one chain seed expands into per-op seeds. Ops 1/4/5 are pure Python (offline-capable); LLM ops record model + prompt hash.

**Knobs:** `chain_seed`, per-op `probability`/`intensity`, `cmd` + `cmd_tolerance`, `language_pair`, `preset`.

**Key failure:** over-corruption destroys test validity → validators + UI before/after inspection per op.

---

## 5.6 Multi-Turn Rollout

**Purpose.** Execute the conversation plan (persona + goal agenda from §5.4) to produce complete, realistic multi-turn test cases.

- **User simulator** plays the persona and works through the goal agenda turn by turn.
- **Verifier check** (DuetSim pattern): after each exchange, a separate verifier LLM scores the simulated user's turn against the persona/goal; low adherence → regenerate the turn (bounded retries); persistent drift → terminate.
- **Behavior dials** injected into the simulator prompt, with defaults from measured `DialogueStats` (§5.3): `frustration_escalation`, `topic_drift`, `resistance`, `clarification_rate`. Field research says LLM simulators are too polite — these dials are the fix.
- **Stopping rules:** `max_turns`, agenda complete, verifier terminate, no-progress detection, token budget.

```python
Dialogue = {case_id, turns: [...], stop_reason, agenda_state, verifier_trace}
```

**Knobs:** `max_turns`, `dials{}`, `verifier_model`, `regen_retries_per_turn`, `stop_rules{}`.

---

## 5.7 Curation & Provenance

**Purpose.** Human-in-the-loop review; edits become a compounding asset; every case stays reproducible.

- Review states: `draft → in_review → approved | rejected | human_revised`.
- Review queue: filter by intent/messiness/verdict; approve / edit / reject with comments. Edits are versioned diffs, never silent overwrites.
- **Edits as few-shot anchors:** `human_revised` cases (matched by intent + register) are injected into generation prompts — the system improves as SMEs correct it.
- **Provenance, kept lean:** each case records `{seed_ids, transform chain + params, model + prompt hash, spec_version, job_id}` — enough to reproduce and audit, stored inline on the case.

**Knobs:** `auto_approve` (when all validators + verifier passed), `anchor_k`, retention of raw views.
