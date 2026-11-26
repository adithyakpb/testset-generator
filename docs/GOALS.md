# Testset Generator — Goals & Sub-Goals

A self-hostable tool (Docker) with a web demo UI hosted at testsets.adithyakpb.com for generating test datasets ("testsets") for LLM-powered applications.

## 1. Core: Realistic Human-Input Test Cases
- Mimic real human input, seeded by **anonymised production data** (logs, chats, tickets).
- **Code-mixing** (e.g. Hinglish / regional language + English blends) derived from the dataset.
- **Improper grammar** — typos, missing punctuation, informal phrasing, run-ons, casing errors.
- **Context-aware keywords & terminology** — auto-extract domain vocabulary, entities, jargon, and abbreviations *from the dataset itself* (including stemming/variant generation).
- Configurable "messiness" levels (mild → heavy corruption) per testset.

## 2. Multi-Turn Conversations
- Generate realistic multi-turn dialogues (user + assistant), not just single prompts. Ease of annotation by the MSE/stakeholder
- Generate good-bad-mid / tiered examples for custom metrics/LLM-as-a-judge
- Support persona / intent drift across turns, follow-ups, clarifications, and context carry-over.
- Golden / expected assistant behavior specified per turn or per conversation.
- settings to adjust parameters of the generation: think _resistance, shifting intents, emotional dynamics_and other advanced stuff

## 3. Business Stakeholder & SME Workflow
- eval criteria is generic. use that(choose from a list) or bring your own metric. BUT this only generates test cases for that metric.
- Non-technical users can define **"this is how I want responses to look"** — expected style, tone, structure, must-include facts.
- Simple UI for reviewing, editing, approving, and rejecting generated test cases (human-in-the-loop curation).
- Rubric / acceptance-criteria builder that compiles into evaluation criteria.

## 4. Developer Workflow
- Seed-based expansion: generate **more examples from seed data** (paraphrase, edge cases, negatives, adversarial).
- Programmatic access: API / SDK / export (JSONL, CSV, Harbor-style eval formats).
- Git-friendly project files; scriptable pipelines; CI integration.

## 5. Data Connectivity (self-hosted instance)
- Connect to your own data sources: databases, data warehouses, files (CSV/JSON/Parquet), object storage, chat logs, ticketing systems. - either over MCP or REST HTTPS. in your own cloud.
- PII anonymisation / masking pipeline before data is used as seed material.
- Data stays local — a key selling point vs. SaaS.

## 6. Evaluation Integration (recommended addition)
- Run generated testsets against a deployed LLM app / endpoint and score responses (LLM-as-judge, rubric scoring, regex/keyword assertions, similarity thresholds).
- Regression tracking across versions.

## 7. Coverage & Quality Analytics (recommended addition)
- Coverage matrix: intents × personas × languages × edge cases; flag gaps in the testset.
- Auto-suggest underrepresented scenarios.

## 8. Collaboration & Governance (recommended addition)
- Projects/workspaces, roles (SME vs. developer), review queues, versioning of testsets, changelogs.
- Audit trail of how a test case was generated (provenance).

## 9. Domain Presets (recommended addition)
- Preset packs for common verticals (fintech, healthcare, support) — terminology, compliance constraints, typical failure modes.

## Non-Goals (v1)
- Full observability/tracing platform (assume integration, e.g. export to existing tools).
- General-purpose data labelling/annotation tooling.
