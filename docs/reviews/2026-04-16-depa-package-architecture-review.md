# DEPA Package Architecture Review — 2026-04-16

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Scope:** Merge the two DEPA design documents from `docs/design/consentshield-zip/01_DEPA_documents/` (`consentshield-depa-architecture.md` and `consentshield-depa-schema-modifications.md`) into the source-of-truth documents under `docs/architecture/`. The DEPA package shifts the consent data model from one row per interaction with a `purposes_accepted[]` array to one row per purpose per interaction — DEPA-native consent artefacts. This review verifies every structural claim, surfaces conflicts, and resolves two open design questions before the architecture amendment is written.

**Reviewer:** Sudhindra Anegondhi (per the 2026-04-16 post-Phase-2 review thread).

**Trigger:** CLAUDE.md `## Reviews` section. This change hits three of the four review triggers: promoting design docs to `docs/architecture/`, modifying non-negotiable security constraints (adding Rules 19 and 20), and cross-cutting changes affecting multiple architecture documents (definitive-architecture, schema-design, and testing-strategy).

---

## 1. Documents Reviewed

**Source — DEPA package:**
1. `docs/design/consentshield-zip/01_DEPA_documents/consentshield-depa-architecture.md` — product spec for the artefact model.
2. `docs/design/consentshield-zip/01_DEPA_documents/consentshield-depa-schema-modifications.md` — full SQL migration document.

**Target — current source of truth:**
3. `docs/architecture/consentshield-definitive-architecture.md` (799 lines).
4. `docs/architecture/consentshield-complete-schema-design.md` (1415 lines).
5. `docs/architecture/consentshield-testing-strategy.md`.
6. `docs/architecture/nextjs-16-reference.md` (unaffected — confirmed).

**Supporting — non-negotiable rules and prior reviews:**
7. `CLAUDE.md` — 17 non-negotiable rules.
8. `docs/reviews/2026-04-13-architecture-consistency-review.md` — review-doc template and prior cross-doc consistency baseline.

---

## 2. Findings Summary

| Severity | Count |
|---|---|
| Blocking | 0 |
| Should-fix | 7 |
| Cosmetic | 3 |

No blocker prevents the amendment. All 7 should-fix items are cross-document ambiguities or design gaps that can be resolved inline in the amendment (see §4 and §5). The amendment is safe to proceed once the two open design questions (Q1, Q2 in §4) are confirmed.

---

## 3. Findings Detail

### Blocking (0)

No blocking findings. Every structural claim in the DEPA docs either (a) is already present in the current architecture and needs no change, (b) is a pure additive extension, or (c) is a should-fix ambiguity with a clear resolution path.

### Should-Fix (7)

| ID | Issue | Evidence | Resolution |
|---|---|---|---|
| **S-1** | `consent_artefacts` table category ambiguity. The current architecture §3 splits tables into Category A (operational, permanent) and Category B (buffer, transient). `consent_artefacts` exhibits both behaviours: append-only and delivered to customer storage (B), but retained while the artefact is `status='active'` for revocation and expiry queries (A). | DEPA schema doc §4 says "Exported to customer storage nightly via delivery_buffer" AND "APPEND-ONLY for authenticated role. Status changes via triggers and pg_cron only". The `consent_artefacts` DDL has no `delivered_at` column — delivery is via `delivery_buffer` staging, not in-place. | **Q1, resolved in §4.** `consent_artefacts` is Category A. Delivery to customer storage is an orthogonal property that applies to multiple Category A tables (artefacts, rights_requests, retention_rules all flow to customer storage via `delivery_buffer` staging). No new category needed. Update §3 to make the orthogonal axis explicit. |
| **S-2** | `consent_events.artefact_ids` population race. The Worker returns 202 after writing `consent_events`. The `process-consent-event` Edge Function asynchronously creates N artefact rows. Failure mode: the Worker's event row exists, but artefacts (and the `artefact_ids` back-reference) do not — an orphan event that looks compliant at the Worker layer but isn't DEPA-compliant. | DEPA doc §8.2 step 4 writes to `consent_events.artefact_ids` as the last step of artefact creation. Before this step, or on Edge Function failure, the field is empty. The DEPA score's `coverage_score` surfaces unmapped purposes, but that's not the same as orphan events. | **Q2, resolved in §4.** Hybrid event-driven + polling: `AFTER INSERT` trigger on `consent_events` calls `net.http_post()` to the Edge Function (sub-second latency, same primitive as the existing HTTP cron jobs). pg_cron safety-net every 5 minutes sweeps for `consent_events WHERE artefact_ids = '{}' AND created_at < now() - interval '5 minutes'`. Edge Function is idempotent (checks existence of artefacts by `consent_event_id` before creating). A new compliance metric `orphan_consent_events` counts events older than 10 minutes with empty `artefact_ids`. |
| **S-3** | `consent_artefact_index` scope overlap with the new `consent_artefacts`. The current architecture has `consent_artefact_index` as an ABDM-specific validity cache. The DEPA package both (a) extends `consent_artefact_index` with `framework` and `purpose_code` columns, and (b) introduces a new `consent_artefacts` table that also holds ABDM-specific fields (`abdm_artefact_id`, `abdm_hip_id`, `abdm_hiu_id`, `abdm_fhir_types`). After the merge, ABDM artefact identity lives in two tables. | DEPA doc §3.4 adds ABDM fields to `consent_artefacts`. DEPA schema doc §3.5 adds `framework` + `purpose_code` to `consent_artefact_index`. Current definitive-architecture §5.4 grants cs_orchestrator SELECT on `consent_artefact_index` as an existing table. | `consent_artefact_index` becomes the **multi-framework validity cache** — a small, fast-lookup table for tracker enforcement and withdrawal verification. `consent_artefacts` is the canonical DEPA record with full ABDM fields. The cache is populated/removed by triggers on the canonical table. Amendment makes this explicit in the amended §3 and schema-design §3.2. |
| **S-4** | Banner-purposes JSONB "legacy" handling. The DEPA schema doc §3.1 migration note says "Existing banners without `purpose_definition_id` are treated as legacy and do NOT generate `consent_artefacts` rows until the admin maps them." | DEPA schema doc §3.1. No corresponding text in current definitive-architecture. | **Decision (Phase B review, 2026-04-16): no legacy accommodation.** This is a pre-beta system with zero customers — there is no pre-DEPA data to preserve. The DEPA schema doc's migration-note framing is discarded. Instead: every banner purpose MUST carry a `purpose_definition_id`. Banner save/publish endpoints return 422 on any missing mapping. `process-consent-event` Edge Function writes `consent_events_misconfigured` + P1 alert + zero artefacts on missing mapping. `coverage_score` expected 100% at all times; any lower reading is a configuration bug, not a tolerated gradient. Documented in amendment §6.7. |
| **S-5** | Artefact `replaced` status — cascade semantics undefined. If artefact A is replaced by artefact B (re-consent), and B is later revoked, what happens to A? Does A transition to revoked (because its successor was revoked before its lifetime ended) or stay frozen at `replaced`? | DEPA doc §2.2 lists the 4 lifecycle states but does not specify replacement-chain cascade rules. Schema DDL has `replaced_by` FK but no cascade logic. | **Decision:** A stays frozen at `replaced` regardless of B's subsequent fate. Revocation of B creates a new `artefact_revocations` row referencing B only — it does not walk the replacement chain. Rationale: the `replaced_by` chain is a *historical* record of how consent was re-obtained, not a live authorisation chain. Only the most recent non-replaced artefact authorises the current data flow. Amendment §7.3 documents this explicitly. |
| **S-6** | Trigger mechanism for `process-consent-event` Edge Function — choice not made. The DEPA doc §8.2 says "triggered via a Supabase database webhook on `consent_events` INSERT". The current architecture uses pg_cron HTTP calls for scheduled Edge Function invocations but has no precedent for INSERT-triggered ones. | DEPA doc §8.2 prescribes DB webhooks. Current definitive-architecture §6 keeps the Worker's 4-step validation as the only synchronous write path; downstream orchestration is via pg_cron. | **Decision:** Hybrid — event-driven primary, pg_cron safety net. The primary path is an `AFTER INSERT` trigger on `consent_events` whose body calls `net.http_post()` to the `process-consent-event` Edge Function (same primitive the existing HTTP cron jobs use — not a new stack element). Trigger body is wrapped in `EXCEPTION WHEN OTHERS THEN NULL` so a failing trigger can never roll back the Worker's INSERT. Secondary path is the pg_cron safety net from S-2: every 5 minutes, sweep for orphan events and re-fire the same Edge Function. Typical latency sub-second; worst-case 5 minutes. Both paths share the idempotent Edge Function from S-7. |
| **S-7** | `process-consent-event` — Edge Function idempotency. The hybrid trigger-plus-cron design from S-2 and S-6 means the same `consent_event_id` may be handed to the Edge Function twice (trigger fires, but also gets picked up by the 5-minute safety-net sweep before the trigger path completes). Duplicate artefacts would break the 1-event-N-purposes invariant and corrupt the audit trail. | DEPA schema doc §4 uses `generate_artefact_id()` which returns a random ULID — not deterministic. No idempotency key in the DDL. Both the trigger path and the safety-net pg_cron path share the same Edge Function. | **Decision:** Edge Function is idempotent by convention — before creating artefacts, it `SELECT count(*) FROM consent_artefacts WHERE consent_event_id = $1`. If > 0, it skips creation and only reconciles `consent_events.artefact_ids` from the existing rows. If = 0, it creates artefacts atomically (single transaction). No DDL change to the DEPA package needed. Amendment §6.7 makes this contract explicit and load-bearing for both trigger and cron paths. |

### Cosmetic (3)

| ID | Issue | Fix |
|---|---|---|
| C-1 | DEPA doc references `framework = 'gdpr'` as a future value. Current definitive-architecture does not mention GDPR yet (it's Phase 3 scope). | Amendment §2 and §3 introduce `framework` as an enum with `'dpdp' \| 'abdm' \| 'gdpr'`, with a note that `'gdpr'` is reserved for Phase 3 and not yet produced by any code path. |
| C-2 | ULID-prefixed artefact IDs (`cs_art_…`) introduce a new ID convention alongside the existing UUID primary keys. Mixing conventions is harmless but worth one-line documentation. | Amendment §3 notes: "Artefact IDs use the `cs_art_` prefix with a 26-char ULID body. This convention applies only to `consent_artefacts.artefact_id` (externally referenceable, time-sortable). All other primary keys remain `uuid`." |
| C-3 | DEPA doc uses inconsistent casing ("consent artefact" vs "consent_artefact") in prose. | Amendment copies DDL verbatim but normalises prose to "consent artefact" (two words) when describing the concept and `consent_artefacts` (snake_case) only when referencing the table name. |

---

## 4. Design Decisions (Open Questions Resolved)

### Q1 — How does `consent_artefacts` fit the two-category data-classification model?

**Context.** The current definitive-architecture §3 declares every table as Category A (operational, permanent) or Category B (buffer, transient — delivered to customer storage and deleted). `consent_artefacts` fits neither cleanly: it is append-only and delivered to customer storage via `delivery_buffer` staging (B behaviour), but retained in ConsentShield's database while `status = 'active'` so revocation and expiry queries can operate on it (A behaviour).

**Options considered.**

- **Option A.** Introduce a third category — Category D for DEPA-style artefacts that are both operational and delivered.
- **Option B.** Classify `consent_artefacts` as Category A and introduce an orthogonal "delivered to customer storage" property that applies across categories.
- **Option C.** Classify `consent_artefacts` as Category B and redefine Category B to allow retention-while-operational.

**Decision — Option B.**

`consent_artefacts` is Category A. The amendment introduces an orthogonal property — "delivered to customer storage" — that can apply to any Category A table. `consent_artefacts`, `rights_requests`, `retention_rules`, and `consent_artefact_index` all carry this property today; they are operational records AND their state is copied to customer storage via `delivery_buffer` staging. This preserves the two-category clarity and makes the delivery pattern visible where it applies.

Amendment §3 restructures:

```
Category A — Operational state (permanent)
  A.1 — Org-scoped tables (existing list + new DEPA tables)
  A.2 — Global reference tables (unchanged)
  (orthogonal property) Some A.1 tables flow to customer storage via delivery_buffer
                         staging when their state changes. See §7.

Category B — User data buffer (transient, delivered-then-deleted)
  (existing list + artefact_revocations)

Category C — Health data (zero persistence, unchanged)
```

The 6 new DEPA tables classify as:
- **A.1 (operational):** `purpose_definitions`, `purpose_connector_mappings`, `consent_artefacts`, `consent_expiry_queue`, `depa_compliance_metrics`.
- **B (buffer):** `artefact_revocations`.

### Q2 — Artefact-creation atomicity under Worker → Edge Function handoff.

**Context.** The Cloudflare Worker writes a `consent_events` row and returns 202 to the customer's browser — this latency budget is non-negotiable (the banner must never delay page rendering). The DEPA model requires N artefact rows to be created per consent event, in a separate asynchronous step. A failure in that async step leaves an orphan event: compliant at the Worker layer but missing DEPA artefacts.

**Options considered.**

- **Option A — webhooks-only.** `AFTER INSERT` trigger on `consent_events` fires `net.http_post()` to the Edge Function. Sub-second latency. Downside: no safety net if `pg_net` drops the payload or the Edge Function exhausts its retries — the event is silently orphaned.
- **Option B — synchronous path.** Worker writes `consent_events` AND `consent_artefacts` in a single transaction. Downside: Worker needs `cs_worker` grants on multiple new tables; increases Worker response latency; pushes the artefact-creation logic (including `purpose_definitions` lookup and per-purpose fan-out) into the Worker, which must stay zero-dep per rule #15.
- **Option C — polling-only.** pg_cron every 1 minute. Edge Function is idempotent. Downside: best-case ~30-second latency, worst-case ~1 minute. A user who accepts consent and immediately withdraws within that window can't find an artefact to revoke.
- **Option D — hybrid (event-driven primary + pg_cron safety net).** `AFTER INSERT` trigger fires `net.http_post()` for sub-second typical latency. pg_cron every 5 minutes sweeps for orphan events (`artefact_ids = '{}' AND created_at < now() - interval '5 minutes'`) as defence-in-depth against dropped webhook payloads or exhausted retries. Both paths call the same idempotent Edge Function.

**Decision — Option D (hybrid).**

The `AFTER INSERT` trigger on `consent_events` uses `net.http_post()` — the same primitive the four existing HTTP cron jobs use (see `20260414000009_cron_vault_secret.sql` and later cron migrations). Trigger body wrapped in `EXCEPTION WHEN OTHERS THEN NULL` so a failing trigger (e.g., Vault miss, extension error) never rolls back the Worker's INSERT — the Worker's 202 response is preserved under all trigger failure modes.

The pg_cron safety net every 5 minutes picks up any event whose trigger path didn't complete: `SELECT id FROM consent_events WHERE artefact_ids = '{}' AND created_at < now() - interval '5 minutes'`. It re-fires the same Edge Function for each. Idempotency (S-7) prevents duplicate artefact creation when both paths land for the same event.

Latency: typical sub-second (trigger fires, `pg_net` is async so the consent_events INSERT commits immediately while the HTTP call is in flight). Worst-case 5 minutes (safety-net pickup). Both well within DPDP audit-trail requirements; neither affects customer-facing banner UX. The compliance metric `orphan_consent_events` counts events older than 10 minutes with empty `artefact_ids` as a dashboard-visible compliance gap.

Stack impact: zero new elements. `pg_net`, `pg_cron`, and Vault are already in use for the existing scheduled HTTP cron jobs; this design extends the same primitives to row-insert-triggered HTTP calls.

---

## 5. Cross-Document Consistency Verdict

A claim-by-claim verification against the current `docs/architecture/` source of truth:

| DEPA claim | Current architecture | Verdict |
|---|---|---|
| Stateless oracle identity preserved | Definitive arch §1 | **Pass** — DEPA reinforces the principle; no change. |
| 17 non-negotiable rules preserved | Definitive arch §11 | **Pass with addition** — Rules 19 (artefact append-only) and 20 (mandatory `expires_at`) added. Rules 1–18 unchanged. |
| Cloudflare Worker contract unchanged | Definitive arch §6 | **Pass** — DEPA explicitly says Worker does not change. New Edge Functions operate downstream. |
| Scoped-role model (cs_worker/cs_delivery/cs_orchestrator) | Definitive arch §5.4 | **Pass with extension** — grants extend to new tables; model unchanged. |
| Buffer lifecycle (immediate-delete + 5-min sweep + 1h alert + 24h P0) | Definitive arch §7 | **Pass** — `artefact_revocations` follows the existing pattern exactly. |
| Zero-storage for health data | Definitive arch §4 | **Pass** — ABDM artefacts use the unified table but the FHIR content never persists (unchanged). |
| RLS-on-every-table + org_id-on-every-per-customer-table | Schema design §5 | **Pass with extension** — all 6 new tables get RLS policies and (where applicable) `org_id`. |
| Three processing modes (Standard / Insulated / Zero-Storage) | Definitive arch §4 | **Pass** — DEPA tables flow through the same three modes unchanged. |
| Consent event HMAC signing | Definitive arch §6 + rule #13 | **Pass** — HMAC path unchanged; the new Edge Function operates on already-validated events. |
| DEPA compliance score dimension | — (new) | **Net-new** — adds 20-pt dimension alongside existing categories. Existing categories rescaled proportionally. |
| Per-purpose data-scope deletion cascade | Definitive arch §8.4 | **Replaces** — current deletion-orchestration inputs change from "user + reason" to "artefact_id + data_scope + connector mapping". Generic webhook protocol preserved; inputs to the protocol change. |
| Purpose Definition Registry (canonical library) | — (new) | **Net-new** — new mutable, admin-managed table. |
| Consent expiry pipeline (schedule → alert → enforce) | — (new) | **Net-new** — 3-stage pipeline, 3 new pg_cron jobs. |
| Unified artefact model (dpdp/abdm/gdpr in same table) | Definitive arch mentions ABDM fields separately | **Net-new** — supersedes the ABDM-specific fragmentation. |

---

## 6. Verification

| Check | Result |
|---|---|
| All 7 should-fix items have resolution text above | Pass |
| Q1 and Q2 have explicit user-confirmable decisions | Pass (confirmed during Phase A review: Q1 Option B, Q2 Option D hybrid) |
| Cosmetic items identified, no substantive impact | Pass |
| No non-negotiable rule is weakened or removed | Pass — rules 1, 2, 4–18 preserved word-for-word; Rule 2 extended with `artefact_revocations`; **Rule 3 scope broadened** (2026-04-16 per Phase B review) from FHIR-only to all regulated sensitive content (FHIR + banking identifiers + any future sector); Rules 19–20 added |
| `grep "SUPABASE_SERVICE_ROLE_KEY" docs/design/consentshield-zip/01_DEPA_documents/` | **0 matches** — DEPA docs correctly use scoped roles |
| `grep "purposes_accepted\[" docs/design/consentshield-zip/01_DEPA_documents/` | Only in migration notes describing the superseded pattern |
| DEPA DDL reuses existing `set_updated_at()`, `current_org_id()`, `is_org_admin()` helpers | Verified — no helper duplication |
| No conflict with ADRs 0001–0018 | Verified — DEPA is additive; existing shipped code continues to work during the transition |
| Cross-reference between the two DEPA design docs | Verified — architecture doc and schema-modifications doc agree on table names, column names, trigger functions, and cron schedules |

---

## 7. Outcome

**Approved for architecture amendment**, subject to user confirmation of Q1 (Option B — orthogonal "delivered to customer storage" property) and Q2 (Option D — hybrid: `AFTER INSERT` trigger primary + pg_cron safety-net secondary, both sharing the idempotent Edge Function).

No blocking issue remains. All 7 should-fix items have resolution text that will be incorporated inline during the amendment (Phases B, C, D of the plan at `/Users/sudhindra/.claude/plans/quiet-noodling-pond.md`). Cosmetic items are cleanup during the amendment pass.

**The DEPA package is internally consistent and forms a coherent extension of the existing source-of-truth architecture.** It does not weaken any non-negotiable rule and preserves the stateless-oracle identity. It introduces a significant new dimension (per-purpose artefacts) that is additive in the data model sense but replaces the previous deletion-orchestration inputs.

**The amendment does not ship any code.** The ADR roadmap that ports the DEPA model into running code (ADR-0019 charter + ADR-0020..0025 sprints) is a separate follow-on effort that references the amended architecture as its source of truth.

### Post-amendment follow-ups (out of scope for the amendment itself)

- Reconcile `docs/V2-BACKLOG.md` against the DEPA package. Several V2 items (V2-C1 OAuth connectors, V2-P1 headless probe runner) are unaffected; others may be absorbed or deprioritised.
- Decide whether to retain `docs/design/consentshield-zip/` in the repo after the amendment or remove it (the content now lives in `docs/architecture/`).
- Amend `CLAUDE.md` to add Rules 19 and 20 alongside the existing 17 (only after the definitive-architecture update is stable).

---

*Review prepared 2026-04-16. Follows the format of `docs/reviews/2026-04-13-architecture-consistency-review.md`. Verified by a second read-through of the DEPA package and the four source-of-truth documents.*
