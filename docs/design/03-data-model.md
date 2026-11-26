# 3. Data Model

Postgres. Core entities and their relationships; JSONB for flexible sub-structures, pgvector only where embeddings are needed.

## 3.1 Entity overview

```
Project 1─* DataSource, SeedRecord, IntentCluster, Persona, ResponseSpec,
             GenerationJob, TestCase, Testset
TestCase *─1 IntentCluster (optional), *─* Testset (via TestsetCase)
ResponseSpec 1─* (versions stored inline as JSON, version number column)
Testset 1─* TestsetVersion 1─* TestsetCase
```

## 3.2 Tables

| Table | Key fields (beyond id/timestamps) |
|---|---|
| `users` | email, password_hash, role (`admin`\|`user`), api_key_hash |
| `projects` | name, settings (JSONB: default cmd, language pairs, presets) |
| `data_sources` | project_id, type (`upload`\|`postgres`\|`s3`), config (JSONB, secrets referenced not inlined), status |
| `seed_records` | project_id, source_id, text, role, turn_index, session_id, meta (JSONB), content_hash (dedup), `raw_text_enc` (optional encrypted original) |
| `anonymized_records` | seed_record_id, anon_text, pii_spans (JSONB), surrogate_map_id |
| `surrogate_maps` | project_id, mapping (JSONB: entity → surrogate), encrypted |
| `lexicon_terms` | project_id, term, freq, variants (JSONB), typo_forms (JSONB), aliases (JSONB), embedding (vector) |
| `intent_clusters` | project_id, label, size, top_terms (JSONB), exemplar_ids (JSONB) |
| `register_profile` | project_id, stats (JSONB: language pair shares, cmi_index, default_cmd) |
| `dialogue_stats` | project_id, stats (JSONB: avg_turns, followup_rate, …) |
| `personas` | project_id, card (JSONB: name, goals, style, language_mix_preference), source (`derived`\|`manual`) |
| `response_specs` | project_id, name, version (int), doc (JSONB), is_active |
| `generation_jobs` | project_id, type, config (JSONB), seed (bigint), status, progress, error, created_by |
| `test_cases` | project_id, job_id, kind (`single_turn`\|`multi_turn`), intent_cluster_id, persona_id, cmd, turns (JSONB), expected (JSONB: response + assertions), transform_trace (JSONB), review_state, provenance (JSONB) |
| `test_case_revisions` | test_case_id, revision_no, data (JSONB — full snapshot), editor_id, reason |
| `testsets` | project_id, name, description |
| `testset_versions` | testset_id, version_no, snapshot (immutable after publish) |
| `testset_cases` | testset_version_id, test_case_id |
| `spec_examples` | spec_id, intent, user_text, ideal_response, why, pinned_from_case_id (nullable) |

## 3.3 Notable decisions

- **Test cases store `turns` as JSONB** (ordered list of `{role, text}`) — flexible for single- and multi-turn without separate tables.
- **Revisions are full snapshots**, not diffs — simple, and provenance per revision comes free. Volume is low (human edits), so cost is fine.
- **Specs version by row**: `response_specs` keeps one row per version; `is_active` marks current. Cases and exports reference `(spec_id, version)`.
- **Testset versions snapshot case IDs** at publish time; a published version is immutable, matching how exports/regressions will reference it later.
- **Vector embeddings** live on the rows that need them (`lexicon_terms`, seed records for clustering/dedupe) rather than a separate embedding store.
- **PII safety**: raw text lives only in `seed_records.raw_text_enc` (encrypted, optional to keep); every downstream table holds anonymized data only.
