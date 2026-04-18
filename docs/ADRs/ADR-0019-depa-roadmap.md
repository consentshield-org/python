# ADR-0019: DEPA Roadmap — Charter & Sequencing of ADR-0020..0025

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-17
**Date completed:** 2026-04-18 (all execution ADRs landed — see below)
**Type:** Meta-ADR (no code, no sprints). Authors the plan that ADRs 0020–0025 execute.

> **Closeout 2026-04-18:** the six execution ADRs chartered here all shipped Completed, plus ADR-0037 bundled the deferred DEPA follow-ups (expiry fan-out, per-requestor binding, CSV, audit DEPA, onboarding seed pack). Nothing outstanding from this charter. Closed.
**Depends on:** Phase 2 closed (ADRs 0001–0018 Completed). Architecturally independent of ADR-0026 (monorepo) and ADR-0027 (admin schema) — they operate on disjoint code paths.

---

## Context

On 2026-04-16 the DEPA package architecture was merged into the source-of-truth documents (commit `9d1d05b`). The merge was substantial:

- **`docs/architecture/consentshield-complete-schema-design.md` §11** — full DEPA schema: helper functions (§11.2), 5 ALTER TABLE amendments (§11.3), 6 new tables (§11.4), indexes (§11.5), RLS policies (§11.6), scoped-role grants (§11.7), triggers (§11.8), buffer-lifecycle extensions (§11.9), 4 new pg_cron jobs (§11.10), 12 verification queries (§11.11), guard summary (§11.12), ALTER-vs-DROP migration strategy (§11.13).
- **`docs/architecture/consentshield-definitive-architecture.md`** — DEPA-native consent model adopted across the doc. Rules 19 (artefact append-only) and 20 (mandatory `expires_at`) added; Rule 3 broadened to cover any regulated sensitive content (FHIR, PAN, Aadhaar, etc.).
- **`docs/architecture/consentshield-testing-strategy.md` §10 Priority 10** — 10 numbered tests (10.1 through 10.10) covering 8 failure modes: orphan events, duplicate-artefact race, trigger-rollback propagation, revocation-cascade drift, missed expiry enforcement, replacement-chain bug, score-arithmetic bug, data-scope value leakage.
- **Two locked architectural decisions** from the Phase A design review:
  - **Q1 Option B — orthogonal delivered-to-storage property.** `consent_artefacts`, `purpose_definitions`, `purpose_connector_mappings`, `consent_expiry_queue`, `depa_compliance_metrics` are Category A (operational). `artefact_revocations` is Category B (buffer). Artefacts carry the orthogonal "delivered to customer storage" property via `delivery_buffer` staging — the row itself stays for active-status queries.
  - **Q2 Option D — hybrid trigger + polling.** Primary path is `AFTER INSERT` trigger on `consent_events` firing `net.http_post()` to `process-consent-event`. Safety-net is a 5-minute `pg_cron` sweep that re-fires dropped events. Trigger body wrapped in `EXCEPTION WHEN OTHERS THEN NULL` so trigger failures never roll back the Worker's INSERT.
- **Phase B design posture** — "no legacy in the data model" applies to *runtime semantics*, not to schema objects. Pre-DEPA tables exist in dev; §11.3 evolves them in place via ALTER TABLE. Customer consent data is zero across all environments, so no data migration is needed. See `feedback_no_legacy_vs_no_objects` memory.

These are **specifications, not code**. Nothing under §11 yet exists in the live database. The customer app continues to write pre-DEPA `consent_events` without any artefact back-reference; the `consent_artefact_index` still treats the world as ABDM-only. Closing that gap is the task of ADRs 0020–0025.

This ADR does not re-decide anything that §11 has already decided. Its job is to sequence the execution, call out cross-ADR dependencies, and pin the non-goals that will not be addressed in this roadmap.

---

## Decision

Port §11 of the complete schema design into running code through six sequential ADRs (0020–0025), in the order below. Each ADR has its own sprint plan, its own tests, and its own changelog entries; this ADR does not author their content. The lettering here is load-bearing — **ADR-0021 cannot start before ADR-0020 lands**, and so on, because each step depends on the database objects or pipelines introduced by the previous one.

Scope reconciliation:

- **In scope** — everything in `docs/architecture/consentshield-complete-schema-design.md` §11 and the corresponding changes in `consentshield-definitive-architecture.md`. Also the 10 tests in testing-strategy §10 Priority 10.
- **Explicitly out of scope** — BFSI Regulatory Exemption Engine (lawful-basis carve-outs for credit bureaus; deferred to its own ADR after the DEPA core lands). ABDM artefact unification (merging `abdm_artefact_id` with the DEPA `artefact_id` lifecycle; deferred). Both will become ADRs of their own once the DEPA core is stable.

Sequencing, with dependencies and rough effort:

| # | Title | Depends on | Rough effort | Artefact type |
|---|---|---|---|---|
| ADR-0020 | DEPA Schema Skeleton | — | 1 sprint (~4h) | Schema (tables, RLS, grants, helper funcs) + shared types |
| ADR-0021 | `process-consent-event` Edge Function + Dispatch Trigger + Safety-Net Cron | 0020 | 1 sprint (~4h) | Edge Function + trigger + cron + idempotency tests |
| ADR-0022 | `process-artefact-revocation` Edge Function + Cascade Triggers | 0020, 0021 | 1 sprint (~3h) | Edge Function + in-DB + out-of-DB cascade + tests |
| ADR-0023 | Expiry Pipeline (`send_expiry_alerts` + `enforce_artefact_expiry` + pg_cron) | 0020 | 1 sprint (~2h) | Helper funcs + 2 new cron jobs + tests |
| ADR-0024 | Purpose-Definition & Connector-Mapping Admin UI | 0020; wireframe precondition | 1–2 sprints (~4h) | Customer-app dashboard panels (per wireframe) |
| ADR-0025 | DEPA Score Dimension + Dashboard Panel | 0020, 0023 | 1 sprint (~3h) | `compute_depa_score` + nightly cron + score API + UI |

Total: roughly 5–6 working days of focused time across the six ADRs. Individual ADRs are small enough that each can land as a single coherent commit with its own ADR file, migrations, tests, and changelog entries.

---

## Consequences

- **Six ADR files will be authored in `docs/ADRs/`** (0020 through 0025). Each follows the standard template (Context / Decision / Consequences / Implementation Plan / Test Results / Changelog References).
- **`packages/shared-types/` gets its first real occupants** — DEPA TypeScript types land in ADR-0020 (PurposeDefinition, ConsentArtefact, ArtefactRevocation, ConsentExpiryQueueEntry, DepaComplianceMetrics). Until ADR-0020 lands the package remains a stub. Admin-side types stay in admin-specific paths per `feedback_share_narrowly_not_broadly`.
- **4 new pg_cron jobs will be scheduled** (expiry-alerts-daily, expiry-enforcement-daily, depa-score-refresh-nightly, consent-events-artefact-safety-net). Prefix `depa-` is not used because the testing-strategy spec already pins the exact names above; they slot into the existing `supabase/` cron convention.
- **2 new Edge Functions will be written** (`process-consent-event`, `process-artefact-revocation`). Both run as `cs_orchestrator`. Both are idempotent — the idempotency contract is load-bearing for the Q2 Option D trigger+cron race. See §11.12 guard S-7.
- **Schema changes land incrementally but the skeleton is one migration.** ADR-0020 produces one large migration (or, per the ADR-0026-style revert-friendly pattern, a small number of cohesive per-concern migrations) that applies §11.3 + §11.4 + §11.5 + §11.6 + §11.7 + §11.2 helper funcs. Triggers that call `net.http_post` (§11.8) are deferred to ADR-0021 because they depend on the Edge Function URL being stable. Expiry helpers + cron are deferred to ADR-0023.
- **Customer-facing behaviour changes in stages.** ADR-0020 is invisible to customers. ADR-0021 makes every new consent event start producing artefacts silently in the background (dashboard still shows the same numbers). ADR-0024 adds the new admin panels (Purpose Definitions, Consent Artefacts). ADR-0025 adds the DEPA score panel. Nothing user-visible moves in a way that requires an announcement.
- **Two feedback memories apply to this whole roadmap.** `feedback_hybrid_trigger_over_polling` (use Q2 Option D) and `feedback_wireframes_before_adrs` (ADR-0024 needs wireframe to exist first; see §Wireframe precondition below).
- **Coordination with Terminal A (ADR-0027).** Both streams write to `supabase/migrations/`. This ADR reserves the `20260418NNNNNN_*` and later timestamp series for the DEPA roadmap; ADR-0027 continues with `20260417NNNNNN_*`. Applied order follows timestamp sort regardless of which stream wrote first. No collision on tests either — DEPA adds new tests under `tests/rls/depa-*.test.ts` and `tests/depa/*.test.ts`; ADR-0027 stays under `tests/admin/*`.

---

## Sequencing detail

### ADR-0020 — DEPA Schema Skeleton

**Produces:** All 6 new tables + 5 ALTER TABLE amendments + indexes + RLS policies + scoped-role grants + §11.2 helper functions *except* the two `net.http_post`-firing triggers (deferred to ADR-0021) and the expiry helpers + cron (deferred to ADR-0023). Also populates `packages/shared-types/` with the DEPA type definitions.

**Does NOT produce:** Edge Functions. Triggers that dispatch to Edge Functions. The `consent-events-artefact-safety-net` cron. Any UI. Any data migration (customer consent data is zero across all environments — see §11.13).

**Blocking precondition for 0021..0025:** the schema must be in place before any of the downstream ADRs can add their functional layer.

### ADR-0021 — `process-consent-event` Edge Function + Dispatch Trigger + Safety-Net Cron

**Produces:** `supabase/functions/process-consent-event/index.ts` (idempotent, reads `consent_events`, looks up `purpose_definitions`, inserts one `consent_artefacts` row per purpose, populates `consent_artefact_index`, updates `consent_events.artefact_ids`). The AFTER INSERT trigger `trg_consent_event_artefact_dispatch` firing `trigger_process_consent_event()`. The `consent-events-artefact-safety-net` pg_cron job. Tests 10.1, 10.2, 10.3 from testing-strategy §10.

**Critical property:** idempotency. The Edge Function must produce N artefacts for N purposes regardless of how many times it is invoked for the same `consent_event_id`. This is the load-bearing guard against the Q2 Option D trigger+cron race (guard S-7 in §11.12).

### ADR-0022 — `process-artefact-revocation` Edge Function + Cascade Triggers

**Produces:** `supabase/functions/process-artefact-revocation/index.ts` (reads `purpose_connector_mappings`, fans out to `deletion_requests` for each mapped connector). The BEFORE trigger `trg_revocation_org_validation`. The AFTER triggers `trg_artefact_revocation` (in-DB cascade: status, index, audit log, expiry supersede) and `trg_artefact_revocation_dispatch` (out-of-DB cascade via `net.http_post`). Tests 10.4, 10.5, 10.7, 10.10.

### ADR-0023 — Expiry Pipeline

**Produces:** `send_expiry_alerts()` + `enforce_artefact_expiry()` + `trg_consent_artefact_expiry_queue` (inserts `consent_expiry_queue` row per finite-expiry artefact; §11.8). The 2 pg_cron jobs `expiry-alerts-daily` and `expiry-enforcement-daily`. Test 10.6 (time-travel, runs weekly in staging).

### ADR-0024 — Purpose-Definition & Connector-Mapping Admin UI

**Wireframe precondition.** Per `feedback_wireframes_before_adrs`, this ADR may not be drafted until:
- `docs/design/screen designs and ux/consentshield-screens.html` — "Consent Artefacts" panel + "Purpose Definitions" panel are present and describe the interactions. They landed as part of commit `9d1d05b`.
- `docs/design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md` — drift between the wireframe and the architecture for these two panels is catalogued. This will be verified at ADR-0024 kickoff.

**Produces:** Dashboard routes for Purpose Definitions (`/dashboard/purposes`) and Consent Artefacts (`/dashboard/artefacts`). Purpose-Definition CRUD (with `is_active` toggle in lieu of delete, per the RLS policy in §11.6). Connector-mapping editor. Artefact list with filters (status, purpose, date range). Tests on the app-level routes; RLS assertions live in ADR-0020's test suite.

**If the wireframe is insufficient to spec these panels** the kickoff must first update the wireframe + alignment doc; the ADR cannot proceed otherwise.

### ADR-0025 — DEPA Score Dimension + Dashboard Panel

**Produces:** The `compute_depa_score(p_org_id)` helper (if not already landed in ADR-0020; it's in §11.2 so it will be). The `depa-score-refresh-nightly` pg_cron job. Score API endpoint. Dashboard panel wiring (the existing compliance score on the dashboard gains a DEPA sub-score dimension). Test 10.8 (property-based score arithmetic).

**Wireframe note:** the compliance-score panel in the existing wireframe may need a DEPA dimension added at ADR-0025 kickoff; this is a small amendment, not a new panel.

---

## Architecture Changes

This ADR introduces no new architecture — it ports an existing design. The authoritative references are:

- `docs/architecture/consentshield-complete-schema-design.md` §11
- `docs/architecture/consentshield-definitive-architecture.md` (Rules 19, 20; broadened Rule 3; artefact-scoped deletion in §8.4)
- `docs/architecture/consentshield-testing-strategy.md` §10 Priority 10

---

## Test Results

Not applicable — this ADR authors no code. Individual test-result records live in ADR-0020 through ADR-0025.

---

## Changelog References

- `CHANGELOG-docs.md` — 2026-04-17 — ADR-0019 charter authored. (Entry added on Completion — this ADR goes to Completed once all six downstream ADRs reach Completed.)
