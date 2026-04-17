# Changelog — Documentation

Documentation changes.

## [ADR-0025 charter + closeout] — 2026-04-17

**ADR:** ADR-0025 (DEPA Score Dimension — nightly refresh + API + dashboard gauge)

### Added
- `docs/ADRs/ADR-0025-depa-score.md` — drafted and shipped to Completed same session. Two sprints (docs+migration; API+UI+tests).

### Changed
- `docs/design/screen designs and ux/consentshield-screens.html` — Dashboard Overview panel DEPA sub-label strip updated from the 3-label earlier draft ("Coverage · Timeliness · Scope precision") to the 4 schema-true labels ("Coverage · Expiry · Freshness · Revocation"). Max-width bumped to 180px.
- `docs/design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md` §W5 — sub-metric list aligned to the four `compute_depa_score` sub-scores (`coverage_score`, `expiry_score`, `freshness_score`, `revocation_score`). Re-alignment note dated 2026-04-17.
- `docs/ADRs/ADR-index.md` — ADR-0025 added as Completed.

## [ADR-0023 charter + closeout] — 2026-04-17

**ADR:** ADR-0023 (DEPA Expiry Pipeline — `send_expiry_alerts` + `enforce_artefact_expiry` + pg_cron)

### Added
- `docs/ADRs/ADR-0023-expiry-pipeline.md` — drafted as Completed (same-session ship). Single phase / two sprints. Decision captures the "auto-delete stages delivery_buffer, not deletion_receipts" stance and pins connector fan-out to V2-D1.
- `docs/V2-BACKLOG.md` — new `## DEPA` section + `V2-D1. Expiry-triggered connector fan-out` entry with two proposed shapes for the v2 fix.
- `docs/ADRs/ADR-index.md` — ADR-0023 added as Completed.

## [ADR-0022 charter + sprint 1.1] — 2026-04-17

**ADR:** ADR-0022 (`process-artefact-revocation` Edge Function + Revocation Dispatch)

### Added
- `docs/ADRs/ADR-0022-artefact-revocation-pipeline.md` — ADR drafted as Proposed. Option 2 locked: no `deletion_requests` table; `deletion_receipts` is the request+receipt hybrid disambiguated by `status`. Four sprints planned (1.1 docs / 1.2 migration / 1.3 Edge Function / 1.4 tests).

### Changed
- `docs/architecture/consentshield-complete-schema-design.md` — §11.3 phantom `deletion_requests` ALTER block removed; `deletion_receipts.artefact_id` block rewritten with hybrid semantics and FK to `consent_artefacts(artefact_id) on delete set null`. §11.4.4 `artefact_revocations` comment updated (`deletion_requests` → `deletion_receipts`). §11.5 `trigger_process_artefact_revocation()` comment updated; idempotency contract documented inline. §11.13 ALTER-vs-DROP matrix row for `deletion_requests` removed. "No legacy in the data model" paragraph no longer lists `deletion_requests` as a pre-DEPA table (it never existed in the codebase).
- `docs/architecture/consentshield-definitive-architecture.md` — §7.x Edge Functions list entry for `process-artefact-revocation` rewritten to split in-DB vs out-of-DB cascade and reference `deletion_receipts`. §8.4 "Deletion Orchestration" rewritten: scoping rule now creates `deletion_receipts` rows; triggers table gains `trigger_type` column; webhook callback URL templated on `{receipt_id}`; chain-of-custody rewritten 4-link → 3-link.
- `docs/architecture/consentshield-testing-strategy.md` — §10 revocation-drift failure mode, Test 10.4 assertion, and Test 10.10 expected outcomes updated to reference `deletion_receipts` with `trigger_type = 'consent_revoked'`.
- `docs/ADRs/ADR-index.md` — ADR-0022 added as Proposed (1 phase / 4 sprints).

## [ADR-0021 sprint 1.1] — 2026-04-17

**ADR:** ADR-0021 (`process-consent-event` Edge Function + Dispatch Trigger + Safety-Net Cron)

### Added
- `docs/ADRs/ADR-0021-process-consent-event.md` — full ADR with execution notes. Two architecture observations documented: (a) Edge Functions using the `sb_secret_*` Vault token need `--no-verify-jwt` at deploy time; (b) idempotency guard S-7 moved from "enforced by code review" to "enforced by UNIQUE constraint + ON CONFLICT DO NOTHING" (stronger guarantee; schema-design doc §11.12 amendment noted for later).

### Changed
- `docs/ADRs/ADR-index.md` — ADR-0021 added as Completed.

## [ADR-0019 charter + ADR-0020 sprint 1.1] — 2026-04-17

**ADRs:** ADR-0019 (DEPA Roadmap charter), ADR-0020 (DEPA Schema Skeleton)

### Added
- `docs/ADRs/ADR-0019-depa-roadmap.md` — meta-ADR authoring the scope + sequencing of ADR-0020..0025. No code; dependency graph pins 0021+ behind 0020. Out-of-scope items (BFSI regulatory exemption engine, ABDM artefact unification) are called out as future ADRs.
- `docs/ADRs/ADR-0020-depa-schema-skeleton.md` — Sprint 1.1 plan + execution notes + test results + §11.11 verification coverage map. Architecture-doc finding logged: §11.3 and §8.4 reference a `deletion_requests` table that does not exist (ADR-0022 resolves).

### Changed
- `docs/ADRs/ADR-index.md` — ADR-0019 added as Proposed (charter, no sprints); ADR-0020 added as Completed (Phase 1 / Sprint 1.1). Reserved-range comment updated.
