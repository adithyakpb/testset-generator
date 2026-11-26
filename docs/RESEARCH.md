# Research & Build Playbook — Testset Generator

> Companion to `docs/GOALS.md`. This document records validated prior art (tools, papers, techniques)
> and translates it into concrete build instructions. It is the precursor to the system design:
> every section here maps a capability to a known technique and notes what to adopt, adapt, or build.

---

## Part I — Research Findings

### 1. Competitive landscape (validated Nov 2026)

| Tool | Testset gen from seeds | Multi-turn | Messy human input / code-mixing | SME-facing UI | Self-hostable |
|---|---|---|---|---|---|
| **RAGAS** | ✅ KG-based synthesis from docs (single/multi-hop, personas, query styles) | ✅ MultiTurnSample | ❌ clean queries only | ❌ code-first | ✅ OSS |
| **DeepEval** | ✅ Golden Synthesizer | ✅ strong Conversation Simulator (personas, DAG turns) | ❌ personas but LLM-clean text | platform UI, not spec authoring | ✅ OSS |
| **Giskard** | ✅ RAGET (question-type taxonomy) | ❌ | ⚠️ metamorphic typo transforms, not learned noise | review/annotate UI | ✅ OSS |
| **LangSmith** | partial (template-based synthesis) | ✅ thread evals | ❌ | annotation queues | hybrid option |
| **Promptfoo** | ❌ (YAML authored; red-team gen) | weak | ⚠️ obfuscation mutations (jailbreak-oriented) | ❌ | ✅ OSS |
| **LangWatch** | ❌ | ✅ simulation-based, incl. voice | ❌ | partial | ✅ OSS |
| **Phoenix / TruLens / UpTrain / Braintrust** | ❌ eval/observability only | eval-side | ❌ | varies | varies |
| **HoneyHive** | ❌ (curates from prod traces) | ✅ | ❌ | ✅ closest SME story — but *reactive* review | hybrid/self-hosted |
| **Gretel / MOSTLY AI / yData** | ✅ synthetic records from real data | ❌ not conversational | ❌ record-level realism only | data-science UIs | varies |

**White space (the thesis):** no product combines
(a) anonymized prod-data seeding → (b) calibrated human-noise synthesis (typos, grammar errors,
code-mixing, informal register) → (c) expected-response/ground-truth generation → (d) SME-side
"response spec" authoring UI. Every ingredient exists separately (below); no one composes them.
SME eval tooling today is *reactive* (review existing outputs — Langfuse/HoneyHive/LangSmith
annotation queues), never *authoring-side*.

### 2. Building blocks by capability

#### 2.1 Noise injection (typos, grammar errors, informal phrasing)
- **nlpaug** (MIT, maintained) — `KeyboardAug` (QWERTY-adjacency typos), `OcrAug`, `SpellingAug`;
  `Flow`/`Sometimes` pipelines compose augmenters with probabilities. Adopt as baseline.
- **TextFlint** — 20 general + 60 task-specific transforms, validators that keep text grammatical,
  robustness reporting. Adopt the validator idea; GPL-3.0 license → integrate as optional external
  dep, don't vendor.
- **ATA / R²ATA** (arXiv 2411.05345) — inject typos into *task-important* words iteratively;
  1-char edits measurably break LLMs. Adopt: importance-weighted noise > random noise.
- **MulTypo** (arXiv 2510.09536, ACL 2026) — human-like typo algorithm: position-aware distribution
  + replace/insert/delete/transpose ops, multilingual. Best reference implementation for realism.
- **WikiTypo corpus** (arXiv 2501.08322) — real typos mined from Wikipedia edits. Use as empirical
  typo distribution data (edit-op priors, error frequencies) instead of inventing one.

#### 2.2 Code-mixing
- **Controlled Code-Mixing Degree (CMD)** — Gupta et al. 2024 (arXiv 2410.10580): parameterized
  mixing level when generating semantically-equivalent code-mixed variants of an English sentence,
  plus the GAME evaluation metric. This *is* our "mixing slider" — expose CMD as a user-facing knob.
- **CodeMixBench** (arXiv 2505.05063) — CMD applied to Hinglish, Spanish-English, Chinese
  Pinyin-English prompts. Confirms CMD generalizes; copy its language-pair config shape.
- **CodeMixBench v2** (arXiv 2507.18791) — synthetic code-mixed text via **word substitution +
  LLM prompting**. The practical generation recipe: identify substitutable spans, swap with
  target-language equivalents, then LLM-smooth.
- **L3Cube HinglishNLP / HingGPT / HingBERT** (github.com/l3cube-pune) — 24.7M real Hinglish
  tweets; use for few-shot exemplars and for verifying generated text via HingBERT LID.
- **Hinglish-Bench** (github.com/instax-dutta/hinglish-bench) — 34 prompts × 8 realistic registers
  (WhatsApp chat, reviews, social media). Adopt as *register templates* — users type in registers,
  not paragraphs.
- **GLUECoS / indic-trans** (Microsoft) — transliteration tooling for Roman↔Devanagari output.
  Post-processing step when the LLM returns Devanagari.
- **MeCorpus/MeBERT** (arXiv 2306.14030) — Marathi-English template for adding new language pairs;
  confirms the architecture is language-pair-pluggable.

#### 2.3 Multi-turn user simulation
- **DuetSim** (arXiv 2405.13028) — two-LLM pattern: generator-LLM plays user, verifier-LLM checks
  adherence to the user's goal. Adopt as core quality mechanism for generated conversations.
- **DAUS** (arXiv 2402.13374) — user simulator fine-tuned/conditioned on real dialogues to curb
  hallucination and off-goal drift. Adopt: condition the simulator on retrieved prod-dialogue chunks.
- **Persona diversity generation** (arXiv 2502.12813, 2608.19549) — LLM-generated heterogeneous
  profiles (demographics, goals, style, knowledge level) driving session simulation. Adopt.
- **Intent-Preserving Adversarial User Simulation** (arXiv 2610.35426, Oct 2026) — simulated users
  that stay on-intent while stressing the agent. Resolves the validity-vs-difficulty tension.
- **Field consensus** (EYT-Bench, arXiv 2607.10428, and others): LLM simulators are too
  "polite/cooperative." Recent work models *resistance, shifting intents, emotional dynamics*.
  → Productize these as configurable **user behavior dials** (frustration, topic drift, clarification,
  resistance) — a differentiator.
- **Decoupled protocol (EYT-Bench)**: separate user-simulator / system-under-test / LLM-judge.
  Adopt as the runtime architecture for conversation rollout and scoring.

#### 2.4 Terminology & entity extraction (context-aware queries)
- **KeyBERT** (+ KeyLLM mode) — embedding-based keyphrase extraction, MMR diversity, pluggable
  backends (Model2Vec for cheap installs). Primary extraction engine.
- **YAKE!** — corpus-statistics baseline, no embeddings; good cheap fallback.
- **spaCy / Flair NER** — entity dictionaries (products, orgs, people, dates) for templating.
- **NLTK / Snowball / inflection libs** — morphological variants + typo'd surface forms of terms,
  so the app is tested on how users *actually type* terminology.

#### 2.5 Prod-data ingestion pipeline (pattern validated in industry)
- **Microsoft Foundry** documents a synthetic-eval-dataset generation flow (schema included) —
  reference for dataset field naming and interchange.
- **Augment Code** documents the workflow: *sample prod prompts → redact PII → generate synthetic
  variants → gate releases on eval regression*. This is the pipeline shape to expose as a product.
- **PII note** (arXiv 2609.22200): PII detection in multi-turn conversations is context-dependent —
  the same span may be PII in one turn and not another. Anonymization must be conversation-aware,
  not line-aware. Also: anonymization alone is legally fragile; design for "anonymize + synthesize"
  (never replay raw text).

### 3. Net conclusions
1. Every technical ingredient is proven; the opportunity is **composition + UX**, not novel research.
2. Two moats: **noise realism pipeline** (prod-seeded, calibrated, verifiable) and **SME authoring UI**.
3. Adopt-as-is: nlpaug, KeyBERT, spaCy, CMD metric, L3Cube corpora, EYT decoupled protocol.
4. Adapt: MulTypo/WikiTypo priors, DuetSim verifier pattern, DAUS conditioning, register templates.
5. Build from scratch: SME response-spec schema + editor, coverage analytics, provenance/versioning.

---

## Part II — Build Instructions (precursor to system design)

### 4. Architecture overview

```
┌──────────────────────────  Docker deployment  ──────────────────────────┐
│  Web UI (React)          API server (FastAPI)         Workers (Python)  │
│  ├─ SME: Response Spec   ├─ projects, testsets        ├─ generation jobs│
│  ├─ reviewer/approve     ├─ connectors, runs          ├─ rollout jobs   │
│  └─ coverage dashboard   ├─ /v1 API + exports         └─ eval jobs      │
│                                                                        │
│  Core pipeline (shared lib, importable as SDK)                          │
│  1 Ingest → 2 Anonymize → 3 Analyze → 4 Generate → 5 Transform          │
│                                          → 6 Rollout → 7 Curate → 8 Export │
│  Postgres (state) · Object/file store (corpora, artifacts) · LLM gateway │
└──────────────────────────────────────────────────────────────────────────┘
```

LLM calls go through a single **gateway abstraction** (OpenAI/Anthropic/local via vLLM-Ollama) —
self-hosted users must be able to run fully offline with local models.

### 5. Pipeline stages — how to build each

**Stage 1 — Ingest (connectors)**
- Sources v1: uploaded files (CSV/JSONL/Parquet/text), plain docs/URLs; v1.1: Postgres/MySQL,
  S3/MinIO, webhook-based chat-log push, Zendesk/Intercom-style ticket exports.
- Normalize everything to a common `RawRecord {id, text, role?, turn_index?, session_id?, meta, ts}`.
- Sampling: stratified sampling controls (by length, language, intent-cluster) so seeds aren't
  dominated by one pattern.

**Stage 2 — Anonymize (conversation-aware, mandatory, before any LLM call)**
- Detect PII with Presidio (regex + NER) at *conversation* scope, per the context-dependent PII finding.
- Redact → replace with consistent fake surrogates (same person = same pseudonym across turns;
  cross-session consistency), preserve formats (phone lengths, date shapes).
- Store both raw (local-only, encrypted) and anonymized views; generation only ever sees anonymized.

**Stage 3 — Analyze (the "understanding" layer that powers realism)**
- Build a **Domain Lexicon**: KeyBERT (MMR-diversified n-grams) + spaCy NER → entity dictionary with
  frequencies; generate morphological/inflection variants and common typo'd surface forms per term.
- Language/register profiling: detect code-mix ratio, language pairs, CMI-like statistics on real
  prod text → these become *default calibration* for generation ("your users write ~35% Hindi words").
- Intent clustering (embeddings + HDBSCAN or similar) → intent inventory with exemplar counts;
  drives coverage matrix later.
- Dialogue mining: from multi-turn logs, extract per-turn user behavior stats (follow-up rate,
  clarification rate, avg turns, rephrase patterns) → parameterize the user simulator with
  *measured* behavior, not invented behavior.

**Stage 4 — Generate (candidate cases)**
- Single-turn: for each intent cluster, draft queries via LLM constrained by (a) lexicon entities
  required in the query, (b) persona card (from persona-diversity generation), (c) register template
  (Hinglish-Bench style), (d) target CMD.
- Multi-turn: persona + goal/agenda → turn-by-turn rollout with a user-simulator prompt;
  a second verifier LLM (DuetSim pattern) scores each turn for goal adherence; regenerate or
  terminate per DAUS-style anti-drift rules; max-turns and stopping conditions configurable.
- Behavior dials injected into the simulator prompt: politeness/resistance, frustration escalation,
  mid-goal topic drift, clarification-asking rate, info-reveal-per-turn.
- **Expected outputs**: for each case, generate expected response (reference answer) + structured
  assertions from the SME Response Spec (see §6): must-include facts, tone, format, refusal conditions.

**Stage 5 — Transform (the realism layer, composable and inspectable)**
- Ordered, seeded, *per-utterance* transform chain, each with probability + intensity knobs:
  1. keyboard typos (nlpaug KeyboardAug, MulTypo-style position-aware ops)
  2. grammar degradation (LLM rewrite: "rewrite informally with N grammatical errors, keep meaning")
  3. code-mixing (CMD-controlled word substitution + LLM smoothing; verify with LID model; transliterate)
  4. informality/register shift (register templates)
  5. terminology mangling (apply lexicon's typo'd surface forms so domain terms appear as users type them)
- Every transform is deterministic given a seed → reproducible; UI shows before/after per transform
  so users trust and tune the chain; "messiness" presets map to preset chains.

**Stage 6 — Rollout & eval**
- EYT decoupled protocol: user-simulator output replayed/streamed to the customer's endpoint
  (configurable HTTP target) → collect real responses → LLM-as-judge scoring against assertions
  (keyword/regex checks + rubric judge + similarity thresholds) → per-case and aggregate reports,
  diffed across runs for regression tracking.

**Stage 7 — Curation (human-in-the-loop)**
- Review queue: accept / edit / reject each generated case; edits are first-class (stored as
  "human-revised", they become few-shot anchors for regeneration — the system improves with use).
- Provenance metadata on every case: seed record IDs, transform chain + params, model + prompt hash,
  persona, intent, CMD/messiness values → full reproducibility and audit trail.

**Stage 8 — Export & API**
- Formats: JSONL (native schema ~ Microsoft Foundry-compatible), CSV, DeepEval golden format,
  RAGAS Testset, Promptfoo YAML, raw markdown.
- `/v1` REST API + thin Python SDK; runs in CI via a CLI (`tsgen generate --project p --out eval.jsonl`).

### 6. The Response Spec (SME-facing core — design carefully)

A declarative, versioned YAML/JSON doc authored via form UI, per project or per intent group:
```yaml
response_spec:
  tone: friendly-professional        # free-text or preset
  structure: ["acknowledge", "answer", "next-step"]
  must_include: ["return window is 30 days"]
  must_not_include: ["legal advice"]
  format: markdown                   # plain | markdown | json-schema
  refusal_policy: "redirect-to-human"
  examples:                          # golden pairs written by SME
    - user: "kya main 40 din baad return kar sakta hoon?"
      ideal_response: "..."
      why: "polite refusal + policy citation"
```
Compiles to: (a) generation constraints for Stage 4/5, (b) judge rubric for Stage 6, (c) few-shot
seed examples. This is the artifact that makes SMEs first-class users — no existing tool has it.

### 7. Tech stack recommendation
- **Backend:** Python (FastAPI) — the whole NLP ecosystem (nlpaug, KeyBERT, spaCy, Presidio) is Python.
- **Core lib** published as installable package (`testset-gen`) — UI, API, CLI are thin shells over it;
  devs can use the library directly.
- **DB:** Postgres (+ pgvector for embeddings/clusters). **Queue:** simple worker (Celery/arq or RQ).
- **Frontend:** React + a component library; review/curate UI is the UX centerpiece.
- **Packaging:** single `docker compose up` (api + worker + web + postgres); optional GPU profile
  for local LLM/LID models.

### 8. Build order (MVP → v1)
1. **MVP (demo page):** file upload → anonymize → lexicon → single-turn generation with noise +
   CMD code-mixing → review UI → JSONL export. This alone demos the differentiators.
2. **v1:** multi-turn rollout with behavior dials + verifier; response-spec authoring UI; eval runs
   against a customer endpoint; coverage matrix; provenance.
3. **v1.1:** DB/S3 connectors, SDK/CLI, regression dashboards, language-pair plugins, collaboration
   (roles, review queues, versioning).

### 9. Risks & mitigations
- **Over-corrupted inputs** (noise destroys test validity) → TextFlint-style validators + UI
  before/after inspection + "intent preserved" verifier check.
- **LLM dependency for self-hosters** → gateway abstraction + local-model profile; transforms 1/3/5
  work without any LLM.
- **Code-mixing quality varies by language pair** → ship Hinglish first (richest resources), others
  behind the pluggable pair config.
- **PII leakage** → anonymization is enforced, ordered before any external LLM call; allow-list of
  local models for strict deployments.

### 10. Key references
- CMD: arXiv 2410.10580 · CodeMixBench: 2505.05063, 2507.18791 · Hinglish-Bench: github.com/instax-dutta/hinglish-bench
- L3Cube: github.com/l3cube-pune/HinglishNLP · GLUECoS: github.com/microsoft/GLUECoS · MeCorpus: arXiv 2306.14030
- ATA: arXiv 2411.05345 · MulTypo: arXiv 2510.09536 · WikiTypo: arXiv 2501.08322
- DuetSim: arXiv 2405.13028 · DAUS: arXiv 2402.13374 · Persona diversity: 2502.12813, 2608.19549
- Adversarial user sim: arXiv 2610.35426 · EYT-Bench (decoupled protocol): arXiv 2607.10428
- Tools: nlpaug, TextFlint, KeyBERT, YAKE, spaCy, Presidio · Context-aware PII: arXiv 2609.22200
- Pipeline patterns: Microsoft Foundry synthetic eval datasets; Augment Code prod-log eval workflow
