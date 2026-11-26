# 8. Cross-cutting Concerns

## 8.1 Security & PII

- **Anonymization-before-LLM ordering is structural, not a convention.** The pipeline stage order (`ingest → anonymize → …`) is enforced by the job scheduler: `generate`, `transform` (LLM ops), and `rollout` jobs cannot run until the project's `anonymize` job has succeeded. Raw text is never passed to a gateway call — generation only ever sees the anonymized view (§5.2).
- **Raw text at rest:** uploads and raw views are encrypted at rest (AES-GCM, key derived from `SECRET_KEY`). Retention is per-project and optional: `retain_raw: never | until_curated | forever` (default `until_curated`); a scheduled purge deletes raw blobs when the policy expires. Anonymized views and generated cases are always retained.
- **Secrets:** only `SECRET_KEY` and provider keys (`LLM_API_KEY`) live in env vars — never in the DB, never logged, never exported in testsets or provenance blobs.
- **Auth (single-tenant, v1):** two roles (`admin`, `member`), session-cookie auth backed by a single `users` table; optional `AUTH_DISABLED=true` for local/CLI use. No SSO, no orgs — see §01 out-of-scope.
- **Default posture:** docker compose binds only to the host's LAN interface (no `0.0.0.0` cloud exposure); no TLS termination in compose (reverse-proxy is the user's job); CORS locked to the served SPA origin. Data stays in the deployer's volume; offline profile (`LLM_PROVIDER=ollama`) makes zero external calls.

## 8.2 LLM Call Handling

All LLM traffic flows through the single gateway (§2.1); callers never see a provider SDK.

- **Retries:** exponential backoff with jitter (e.g. 3 attempts, 2s base) on 429/5xx/connection errors; no retry on 4xx auth/validation.
- **Timeouts:** per-call timeout (default 120s, configurable); rollout turns enforce a per-turn deadline so a hung provider can't stall a job.
- **Token/cost logging:** every call appends `{job_id, stage, model, prompt_tokens, completion_tokens, latency_ms}` to an `llm_calls` table; job rows roll up totals so the UI can show cost/token usage per job.
- **Reproducibility:** gateway records a `prompt_content_hash` (canonical serialization of prompt + params) on each call; cases store it in provenance (§5.7) so a regenerated case can be verified against its original prompt.
- **Graceful degradation:** provider down → job marked `failed` with a provider-attributed error and is re-runnable; deterministic stages (ingest, anonymize, lexicon, transform ops 1/4/5) keep working offline; rollout terminates cleanly on persistent provider failure, saving partial dialogues.

## 8.3 Observability

- **Structured JSON logs** from api + worker; every log line carries `request_id` (API) and/or `job_id` (worker). `request_id` propagates to spawned jobs.
- **Minimal metrics** (Prometheus `/metrics` on api, optional): job durations by type, job success/failure counts, LLM token usage, queue depth. No APM/tracing stack for v1 — `llm_calls` + job rows are the audit trail.

## 8.4 Error Handling Conventions

- **API:** RFC 7807 problem+json shape `{type, title, status, detail, instance}`; validation errors include field paths. No stack traces to clients.
- **Jobs:** failures are stored on the job row (`status=failed`, `error`, `error_stage`) and surfaced in the UI; jobs never fail silently. Cancellation saves partial output as `partial` (§2.2).
- **Ingestion:** malformed rows go to a per-dataset `rejects` table `{dataset_id, row_index, reason, raw_excerpt}` with per-row reasons; never silently dropped, viewable and re-exportable from the UI.
- **Transforms/rollout:** validator and verifier failures degrade (lower intensity, regenerate, drop op / terminate) and are logged as decisions, not raised.

## 8.5 Extensibility Points

Each is a small registry/plugin list in the core library — no plugin manager, no dynamic loading.

| Extension point | Mechanism | v1 contents |
|---|---|---|
| Language pairs (code-mixing) | entry in `LANGUAGE_PAIRS` registry (LID model + transliterator + mixing op params) | `hi-en`, plus `en`-only passthrough |
| Connectors | `Connector` protocol: `fetch() → RawRecord[]`, `field_map` | file upload (CSV/JSONL/Parquet/text), pasted text; later Postgres/S3/webhook |
| Transform ops | ordered `TransformOp` registry; pure `(text, params, seed)` functions, LLM ops declare their model need | typos, grammar, code-mixing, register, terminology mangling |
| Export formats | `Exporter` registry: `export(cases, options) → bytes` | JSONL, CSV, DeepEval, Promptfoo |
| LLM providers | gateway provider backends | openai, anthropic, ollama (vLLM later) |

## 8.6 Configuration

Environment variables (from §2.4) + per-project settings JSON; no config file required.

| Env var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (incl. pgvector) |
| `SECRET_KEY` | Cookie signing + at-rest encryption key derivation |
| `DATA_DIR` | Local volume for uploads, corpora, exports |
| `LLM_PROVIDER` / `LLM_MODEL` | Gateway default routing (`openai` / `anthropic` / `ollama`) |
| `LLM_API_KEY` | Provider API key (not required for ollama) |
| `OLLAMA_BASE_URL` | Local provider endpoint |
| `AUTH_DISABLED` | Skip auth for local/CLI use (default `false`) |

- **Per-project settings JSON** (single `settings` column on the project row): anonymization knobs (`entity_types`, `allow_list`, `retain_raw`), generation defaults (`n_per_cluster`, `cmd`, `register`), transform preset + per-op params, rollout dials/stopping rules, export defaults. Validated against a Pydantic schema on write; knobs are documented in §5 per stage.
- **Precedence:** job-level params > project settings > env-var defaults. Unknown keys are rejected, not ignored.
