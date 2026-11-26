# 9. MVP Cut & Milestones

## 9.1 Demo / MVP — "the demo webpage"

One guided flow, end to end, that shows both differentiators (realistic noise + measured code-mixing):

**Upload → anonymize → lexicon/intents → single-turn generate (noise + CMD) → review → JSONL export.**

Uses, from the other sections:

| Layer | MVP slice |
|---|---|
| Modules (§5) | `ingest` (file upload only, CSV/JSONL/Parquet/txt), `anonymize` (Presidio + surrogates), `analyze` — lexicon + intents + register profile only, `generate` (single-turn, one expansion mode: paraphrase), `transform` (full chain incl. code-mixing, presets mild/moderate/heavy), `curate` (review queue, approve/edit/reject), `export` (JSONL only) |
| Tables (§3) | `users`, `projects`, `data_sources` (type=`upload`), `seed_records`, `anonymized_records`, `surrogate_maps`, `lexicon_terms`, `intent_clusters`, `register_profile`, `generation_jobs`, `test_cases`, `testsets` + one implicit v1 snapshot |
| APIs | auth, project CRUD, upload, job submit/poll (`anonymize`, `analyze`, `generate`), case list/update (review state), JSONL export |
| UI | upload page, run config (n per cluster, CMD slider, noise preset), progress view, review queue, export button |

**Deferred from MVP:** personas (use a default card), response specs (no assertions beyond must-include from lexicon), multi-turn/`dialogue_stats`, rollout, spec compiler, connectors, testset versioning, coverage, provenance UI beyond inline JSON, API keys/SDK/CLI. Schema keeps columns for these so no migrations break later — they're just unused.

## 9.2 v1

1. **Multi-turn rollout** (§5.6): user simulator + verifier + behavior dials seeded from `dialogue_stats`; `personas` table activated; generation jobs gain `rollout`.
2. **Response Spec authoring UI** (§5.4/5.7): SME-facing editor (style, tone, structure, must-include) compiled to generation constraints + `assertions[]`; `response_specs`, `spec_examples`; human-revised cases become few-shot anchors.
3. **Testset versioning**: `testset_versions`/`testset_cases`, publish/immutable snapshots, diff view.
4. **Connectors**: Postgres, S3, webhook push; per-connector field maps.
5. **Full exports**: CSV, DeepEval, Promptfoo formats; assertions travel with cases.
6. **SDK/CLI**: pip-installable `testset_gen` package; CLI wraps jobs; API keys (`users.api_key_hash`).
7. **Coverage analytics v0**: intents × CMD × noise-level matrix with gap flags (from existing tables — cheap once cases exist).

## 9.3 Later

- **Eval runner** — run testsets against endpoints and score (LLM-as-judge, rubric, regex). Assertions already exported in v1, so this adds no upstream changes.
- **Coverage analytics** full version + auto-suggested scenarios.
- **Collaboration extras**: workspaces, review-queue assignment, changelogs, richer audit trail.
- **Domain presets**: vertical packs (fintech/healthcare/support) for lexicon fallback + typical failure modes.
- **More language pairs** for code-mixing beyond Hinglish; pluggable pair config (LID model, transliteration, LID-tuned verification).
- Regression dashboards; SSO/multi-tenancy if self-host demand appears.

## 9.4 Sequencing rationale

- **Differentiators first**: anonymize→lexicon→noise+CMD is the demo thesis; everything else is commodity testset tooling.
- **Single-turn machinery is the substrate for multi-turn** — rollout reuses personas, register, transform chain, and the job model; building it second is pure addition, not rework.
- **Spec editor before eval matters**: once assertions are compiled and exported at v1, an external eval runner is unnecessary; a built-in runner only earns its place when customers ask.
- **Versioning precedes eval/regression**: you can't track regressions across runs without immutable testset snapshots.
- **Analytics/presets ride on existing data**: coverage and presets need tables the MVP already populates, so they're cheap afterthoughts, not design drivers.

## 9.5 Open questions

1. **Language pairs at launch**: Hinglish only (best resources: L3Cube, GLUECoS, MeCorpus)? Or Hinglish + one more (Ta-En?); each pair needs LID + transliteration validation.
2. **Local-LLM quality bar for simulation**: multi-turn rollout and grammar-degradation are LLM-heavy — what minimum model size/quality do we certify for the Ollama offline profile?
3. **Transform chain configurability**: how much is UI-exposed (per-op sliders) vs preset-only? More knobs = more SME confusion; fewer = power-user complaints.
4. **Raw text retention**: is `raw_text_enc` kept by default, opt-in, or never — and what's the default TTL/purge policy for strict deployments?
5. **Anonymization threshold defaults**: conservative (more masked, less realistic) vs permissive (better synthesis, more leak risk) — where do we set the factory default?
6. **Intent cluster editing scope at MVP**: rename-only, or merge/split in the demo UI (adds API surface)?
7. **Self-host LLM BYO-key flow**: support own OpenAI/Anthropic keys alongside the offline profile, or offline-only for the demo deployment?
8. **Demo tenancy**: single shared demo project on testsets.adithyakpb.com, or per-signup projects (needs user lifecycle earlier than otherwise planned)?
