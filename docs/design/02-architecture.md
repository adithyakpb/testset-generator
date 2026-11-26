# 2. System Architecture

## 2.1 Components

```
┌───────────────────────── docker compose ──────────────────────────┐
│                                                                   │
│  web (React SPA)  ──────►  api (FastAPI)  ──────►  postgres       │
│                              │    ▲                (+ pgvector)    │
│                              ▼    │                                │
│                           worker (Python)                          │
│                           └── core library (testset_gen)           │
│                               ├── ingest / anonymize / analyze    │
│                               ├── generate / transform / rollout  │
│                               ├── spec compiler                   │
│                               └── llm gateway ──► OpenAI/Anthropic│
│                                       └──────────►  Ollama (local)│
│                                                                   │
│  file storage: local volume (uploads, corpora, exports)           │
└───────────────────────────────────────────────────────────────────┘
```

| Component | Responsibility |
|---|---|
| **web** | React SPA served by the api (or nginx). Guided forms, review queue, coverage view. |
| **api** | FastAPI. Auth, CRUD, job submission, exports. Thin shell over the core library. |
| **worker** | Same Python process shape as api, pulls jobs from a queue table. Runs generation, analysis, anonymization, multi-turn rollout. |
| **core library** | All pipeline logic (§5). Importable directly for SDK/CLI use. |
| **postgres** | All state + pgvector for embeddings (lexicon, intent clustering, dedupe). |
| **llm gateway** | Single client: provider routing, retries, prompt hashing, records model+prompt hash on each call. Local-model profile uses Ollama so deployments can run fully offline for LLM steps. |

## 2.2 Job model

Simple queue — no Celery/Redis for v1:

- A `jobs` table in Postgres is the queue. API inserts a job row; worker polls (`SELECT … FOR UPDATE SKIP LOCKED`), executes, updates status/progress.
- Job types: `anonymize`, `analyze` (lexicon/register/intents), `generate`, `rollout` (multi-turn part of generate).
- Generation is deterministic given `seed` — re-running a job with the same config reproduces identical cases.
- Cancellation: worker checks a cancel flag between steps; partial cases are saved and marked `partial`.

## 2.3 Data flow (one generation job)

```
seeds (anonymized) ─► intent clusters + lexicon + register profile
                        │
response spec ──────────┼──► per case: draft query/plan (constrained LLM call)
                        │         └► expected response + assertions (from spec)
                        │              └► transform chain (typos → grammar → code-mixing
                        │                 → register → terminology mangling, validated)
                        │                  └► [multi-turn] rollout: simulator + verifier
                        └──► cases stored with provenance ─► review queue ─► testset ─► export
```

## 2.4 Packaging & deployment

- `docker compose up` starts: `web`, `api`, `worker`, `postgres`. One shared image for api/worker.
- Config via environment variables: `DATABASE_URL`, `LLM_PROVIDER`/`LLM_MODEL`/`LLM_API_KEY` (or `OLLAMA_BASE_URL`), `SECRET_KEY`, `DATA_DIR`.
- Local models: Ollama sidecar profile (`--profile local`) bundles an LLM + spaCy models; offline deployments set `LLM_PROVIDER=ollama` and never make external calls.
- Upgrades: schema migrations via Alembic on api startup; exports/versioning keep old testsets intact.
