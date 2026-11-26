# 4. API Surface

Simple REST API (`/v1`) over the core library. JSON in/out. The UI, CLI, and SDK all call the same library functions — the API is a thin shell.

## 4.1 Conventions

- Auth: API key per user (`Authorization: Bearer <key>`); the UI uses the same mechanism.
- IDs: `proj_`, `job_`, `tc_`, `ts_` prefixed ULIDs. Timestamps ISO-8601 UTC.
- Errors: `{"error": {"message": "...", "field_errors": [{"field": ..., "message": ...}]}, "request_id": "..."}` with normal HTTP status codes.
- Pagination: `?limit=50&cursor=...`, response includes `next_cursor`.
- Generated cases are never silently overwritten — edits create a new revision.

## 4.2 Roles

Single-tenant, two roles (FastAPI dependency check per endpoint):

| Role | Can do |
|---|---|
| `admin` | Everything: users/keys, connectors (credentials), delete data |
| `user` | Ingestion, generation, response specs, test case review, exports |

## 4.3 Resources

| Resource | Paths | Notes |
|---|---|---|
| Projects | `/v1/projects`, `/{id}` | Basic CRUD |
| Seeds | `/v1/projects/{pid}/seeds` | GET list; POST = upload CSV/JSONL/text or pull from a configured connector |
| Anonymization | `.../seeds/anonymize` | POST, async job |
| Lexicon | `.../lexicon` | GET; POST triggers extraction |
| Intents | `.../intents` | GET; PATCH to rename/merge clusters |
| Response specs | `.../response-specs`, `/{id}` | CRUD; versioned on save |
| Personas | `.../personas` | CRUD (auto-derived or manual) |
| Generation jobs | `.../generation-jobs` | POST (async), GET |
| Test cases | `.../test-cases`, `/{id}` | GET list/detail; `POST .../{id}/review` with `{decision: approve\|reject\|edit, edits, reason}` |
| Testsets | `.../testsets`, `/{id}` | Named collections of cases |
| Exports | `.../testsets/{id}/exports?format=jsonl\|csv\|deepeval\|promptfoo` | POST |
| Jobs | `/v1/jobs/{id}` | Status/progress for any async job |

## 4.4 Key payloads

**Create generation job** — `POST .../generation-jobs` → `202 {id, status}`

```json
{
  "name": "refund-intent-batch-3",
  "mode": "single_turn",              // single_turn | multi_turn
  "count": 200,
  "seed_filter": {"intent_ids": ["int_01J..."]},
  "response_spec_version": 7,
  "generation": {"messiness": "moderate", "cmd": 0.35, "language_pairs": [["hi","en"]]},
  "behavior_dials": {"resistance": 0.4, "topic_drift": 0.2},   // multi_turn only
  "seed": 42
}
```

**Review decision** — `POST .../test-cases/{tc}/review`

```json
{
  "decision": "edit",
  "edits": {"user_turns": [{"turn": 1, "text": "kya main 40 din baad return kar sakta hu?"}],
             "expected_response": "Returns are accepted within 30 days..."},
  "reason": "edited Hinglish phrasing",
  "use_as_example": true        // human-revised cases become few-shot anchors
}
```

## 4.5 Async jobs

Long-running work (ingestion, anonymization, generation) is a job:

- `POST` returns `202 {id, status: queued}`.
- `GET /v1/jobs/{id}` → `{status: queued|running|succeeded|failed, progress: {done, total}, error}`.
- `POST /v1/jobs/{id}/cancel` — partial artifacts are kept and marked `partial`.
- Generation is deterministic given `seed`, so re-running a job with the same config reproduces the same cases.
