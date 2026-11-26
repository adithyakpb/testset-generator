# 7. Frontend Design

## 7.1 Stack

React + TypeScript + Vite, **shadcn/ui** (Radix + Tailwind) for components, **TanStack Query** for server state. No Redux, no router-heavy meta-framework — one SPA, hash-free client routing via React Router. Charts (coverage matrix) via a tiny table/heatmap, not a charting library.

## 7.2 Screen inventory

| # | Screen | Route | Notes |
|---|---|---|---|
| 1 | Connect / Upload | `/p/:pid/data` | Connector list (admin-managed credentials), file upload (CSV/JSONL/text). Shows anonymization status per seed source. |
| 2 | Seeds & Anonymization | `/p/:pid/seeds` | Seed table (source, count, PII-scan status), "Run anonymization" → job progress bar. |
| 3 | Analysis view | `/p/:pid/analysis` | Tabs: **Lexicon** (terms/variants table, "extract" button), **Intents** (clusters, rename/merge inline). |
| 4 | Response spec editor | `/p/:pid/spec` | Form-based per §6.4: tone preset+textarea, flow chips, list builders, format control, refusal builder, example cards, override panel. Save → diff modal → new version. |
| 5 | Generation wizard | `/p/:pid/generate` | Stepper: mode (single/multi-turn) → count + seed filter → messiness preset → CMD slider → personas → (multi-turn) behavior dials → confirm. Submits async job. |
| 6 | Review queue | `/p/:pid/review` | Case cards: conversation view, expected response, assertions. Approve / Reject / Edit (inline + reason). **Before/after transform inspection** (user turn: pre/post messiness pipeline). Filters: intent, persona, cmd, status. |
| 7 | Testsets & versions | `/p/:pid/testsets` | List + detail: pinned spec version, case counts, changelog, coverage heatmap (intent × persona). |
| 8 | Exports | `/p/:pid/testsets/:tsid/exports` | Format picker (JSONL / CSV / DeepEval / Promptfoo), download link, export history. |
| 9 | Admin: users & keys | `/admin` | admin-only. Users table, issue/revoke API keys, connector credentials, delete-data actions. |

Project switcher in the top bar; all screens scoped to a project.

## 7.3 User flows

**First run (developer):** Login → create project → Connect/Upload (1) → run anonymization (2, poll job) → Analysis (3, skim lexicon/intents) → Wizard (5): single-turn, 200 cases, moderate messiness → Review queue (6): approve/reject/edit, pin good cases as examples → Testsets (7) → Export (8) JSONL. Total: one sitting, no YAML touched.

**SME flow:** Login → lands directly on **Response spec editor** (4) — their home view. Author spec via form, save → diff preview → v2. Optionally visit Review queue to approve/edit cases and "pin as example" (feeding §6 examples). Never sees prompts, connectors, or admin screens.

**Same app, two landings:** one SPA; role from the auth key decides the default route (`/p/:pid/generate` for admin/dev-oriented users, `/p/:pid/spec` for SMEs) and hides admin-only screens. No separate build or user-type toggles.

## 7.4 Key UX details

| Detail | Why it matters | How |
|---|---|---|
| **Before/after transform inspection** | Trust builder — shows *how* messiness corruption was applied to user turns | In review cards: click a user turn → side-by-side clean seed text vs. generated noisy text, with the corruption ops applied listed (typo, casing, code-mix…). |
| **Diff preview on spec save** | SMEs must see exactly what changed before a new version is committed | Save button → modal with field-level diff v(n-1)→v(n) (added/removed must-include rows, tone change…) → confirm creates version. |
| **"Pin as example" one-click** | Human-approved cases become few-shot anchors (§6.2c) | On approve/edit success: toast + card action "Pin as example" → prompts for intent + optional "why" → adds to `examples[]` in current spec draft. |
| **Progress polling on async jobs** | Anonymization & generation are 202+jobs (§4.5) | TanStack Query `refetchInterval` on `GET /jobs/{id}` (e.g. 2s while running), progress bar from `{done, total}`, cancel button, error state surfaces `error`. |
| Inline lint on spec form | Catch errors before save (§6.3) | Field-level errors block save; warnings (duplicates, vague tone) shown as yellow hints. |
| Keyboard-first review queue | Bulk curation speed | `a` approve, `r` reject, `e` edit, `j/k` navigate; batch actions on filtered selection. |
| Empty-state checklists | First-run guidance | Data screen shows "1. upload → 2. anonymize → 3. analyze → 4. generate" progress checklist per project. |

## 7.5 State & data layer

- **TanStack Query** for all server state: projects, seeds, lexicon, intents, spec versions, cases, jobs. Query keys namespaced per project (`['p', pid, 'test-cases', filters]`).
- Mutations invalidate the relevant keys; review actions optimistically update the case card, reconcile on refetch.
- **Local state only** for form drafts (spec editor keeps a draft in component state + `localStorage` per project for crash safety; save → server version).
- No global store, no client-side caching beyond Query, no websockets — polling is sufficient at this scale.
