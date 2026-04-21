# Changelog — Documentation

Documentation changes.

## [ADR-1013 Sprint 1 verified end-to-end] — 2026-04-21

**ADR:** ADR-1013 — `cs_orchestrator` direct-Postgres migration (Next.js runtime)

### Changed
- `docs/ADRs/ADR-1013-cs-orchestrator-direct-postgres.md` — Sprint 1.1 Tested block flipped from "deferred" to "verified". Sprint 1.2 (operator action) flipped to `[x]` after the cs_orchestrator password rotation + env-var paste landed and the marketing signup form successfully delivered an invite email end-to-end.
- `docs/changelogs/CHANGELOG-marketing.md` (ADR-0058 follow-up — email relay + explicit signup status) — "End-to-end email send — deferred" flipped to verified, citing the dispatch-trigger retirement (commit `d5143fd`) and ADR-1013 cs_orchestrator migration (commit `c0f94f3`) as the two prerequisites that landed on 2026-04-21.
- `docs/changelogs/CHANGELOG-api.md` (ADR-0058 follow-up — drop dispatch trigger) — "End-to-end email send — deferred" flipped to verified.

### Tested
- Marketing `consentshield.in/signup` form (localhost:3002 in dev) → app `/api/public/signup-intake` (localhost:3000) running as cs_orchestrator via the new direct-Postgres pool → `public.create_signup_intake` RPC → `branch='created'` → in-process `dispatchInvitationById` → marketing `/api/internal/send-email` relay → Resend API → invite email delivered to the recipient inbox.

ADR-1013's Phase 2 (env + doc cleanup, retire `CS_ORCHESTRATOR_ROLE_KEY` from Next.js docs) remains scoped for a follow-up sprint; ADR row stays **In Progress** until that lands.

## [ADR-0058 — ADR complete] — 2026-04-21

**ADR:** ADR-0058 — Split-flow customer onboarding (**COMPLETED**)

### Changed
- `docs/ADRs/ADR-0058-split-flow-onboarding.md` — top-line status flipped to **Completed** (all 5 sprints shipped 2026-04-21). Each sprint's checkbox list flipped to `[x]`. Six `[ ]` entries remain, all explicitly deferred and labelled (manual click-throughs → operator playtest; resend-link form → V2 follow-up pending an ADR-material decision on endpoint vs. CORS; `tests/integration/signup-intake.test.ts` → V2 follow-up pending a headless-browser harness).
- `docs/ADRs/ADR-index.md` — ADR-0058 row set to **Completed**.
- `docs/architecture/consentshield-definitive-architecture.md`:
  - §10.1 gained `/api/public/signup-intake` (POST, OPTIONS) with its CORS + Turnstile + dual-bucket rate-limit protections.
  - A new "Split-flow customer onboarding (ADR-0058 — shipped)" block sits alongside the rights-request flow diagram, walking the pricing → `/signup` → `/onboarding` → `/dashboard` path and calling out the Rule 12 enforcement points.
  - §10.2 gained the two onboarding-scoped authenticated endpoints (`status`, `verify-snippet`).
  - Appendix A — Accounts row expanded to include `/accounts/new-intake` and ADR-0058 in the ADR column; the ADR column now reads "0048 + 0058" and the preceding sentence acknowledges the ADR-0058 operator surface.

### Tested
- No code changes in this entry; three CHANGELOGs already carry the per-sprint test results (schema / api / dashboard), and the CHANGELOG-marketing entry for Sprint 1.2 is unchanged.

## [Backlog sweep] — 2026-04-21

### Added
- `docs/ADRs/ADR-1010-cloudflare-worker-role-migration.md` — **Proposed** ADR scoping the Cloudflare Worker migration off HS256 scoped-role JWT. 4 phases / 6 sprints: research mechanism (Hyperdrive vs Supabase Data API vs hand-rolled) → cs_worker LOGIN readiness → Worker rewrite (read paths then write paths) → cutover + deprecation. Does not implement yet.
- `docs/ADRs/ADR-1011-revoked-key-tombstone.md` — **Completed** ADR retroactively documenting the V2 C-1 fix (migration 20260801000010 + cs-api-role test + api-keys.e2e flipped assertion).

### Changed
- `docs/ADRs/ADR-index.md` — new rows for ADR-1010 (Proposed) and ADR-1011 (Completed).
- `docs/V2-BACKLOG.md` — backlog sweep. 12 pre-existing closed items and the new C-1 / C-2 / ADR-1009-follow-up completions collapsed into a single "Closed (tracked in ADRs)" section. Remaining open items grouped by blocker type: pre-launch only (3), waiting on external platform (1), blocked on downstream ADR (1). "Open — actionable but small" section removed (its sole entry, C-2, shipped inline).

## [ADR-1009 Sprint 3.2 — ADR complete] — 2026-04-21

**ADR:** ADR-1009 — v1 API role hardening (**COMPLETED**)
**Sprint:** Phase 3 Sprint 3.2 — doc sync

### Changed
- `CLAUDE.md` Rule 5 — rewritten to name `cs_api` as the v1 role, describe the direct-Postgres pattern + 12-RPC EXECUTE surface + `assert_api_key_binding` fence, and reference the CI grep gate (`scripts/check-no-service-role-in-customer-app.ts`). The ADR-0045 admin carve-out text is preserved verbatim.
- `docs/architecture/consentshield-definitive-architecture.md` §5.4 — intro updated from "three scoped roles" to "four scoped roles on the customer surface" (cs_worker / cs_delivery / cs_orchestrator / cs_api), plus cs_admin on the admin surface. Added a full `cs_api` block describing zero table privileges, the 12 RPC EXECUTE surface, the Supavisor pooler connection, and the rationale for direct Postgres over HS256 JWT signing.
- `docs/V2-BACKLOG.md` — new **ADR-1009 follow-up: migrate Cloudflare Worker off HS256 scoped-role JWT** entry. The Worker's `SUPABASE_WORKER_KEY` is on the same kill-timer as the HS256 signing secret. Priority: High.
- `docs/ADRs/ADR-index.md` — ADR-1009 status flipped to **Completed**. ADR row rewritten to reflect the scope amendment.

## [ADR-1002 Sprint 5.1 — ADR complete] — 2026-04-20

**ADR:** ADR-1002 — DPDP §6 runtime enforcement (**COMPLETED**)

### Changed
- `docs/ADRs/ADR-1002-dpdp-section6-runtime-enforcement.md` — status flipped to **Completed**; all 8 sprints marked `[x]`.
- `docs/ADRs/ADR-index.md` — ADR-1002 status flipped to **Completed**.
- `docs/design/ConsentShield-Customer-Integration-Whitepaper-v2.md` Appendix E — 5 rows moved from Roadmap Q2 2026 to **Shipping today**:
  - `GET /v1/consent/verify`
  - `POST /v1/consent/verify/batch`
  - `/v1/consent/{verify, verify/batch, record}` (bundle row in §API table)
  - `/v1/consent/artefacts` + revoke + events
  - `/v1/deletion/trigger` + receipts list (with deferred-retention_expired note)

## [ADR-1001 Sprint 2.2] — 2026-04-20

**ADR:** ADR-1001 — Truth-in-Marketing + Public API Foundation
**Sprint:** Sprint 2.2 — Bearer middleware + request context

### Changed
- `docs/architecture/consentshield-definitive-architecture.md` §10.3 — expanded from a bare route table to a full compliance-API section: auth model (Bearer gate in proxy.ts, 5-step verify flow, RFC 7807 error table), `cs_api` Postgres role description, key lifecycle summary (issue/rotate/revoke), canary endpoint, rate-tier mapping stub (Sprint 2.4), updated route table with _ping.
- `docs/architecture/consentshield-complete-schema-design.md` — replaced the stale Phase-3 scaffolding `api_keys` definition with the Sprint 2.1 v2 schema: all new columns (account_id, rate_tier, created_by, revoked_at, revoked_by, previous_key_hash, previous_key_expires_at, last_rotated_at), generated `is_active` column, scope allow-list CHECK function. Added `api_request_log` day-partitioned table. Added `cs_api` role description + RPC call-signature inventory.

## [ADR-1001 Sprint 1.2] — 2026-04-19

**ADR:** ADR-1001 — v2 Whitepaper Phase 1 (Truth-in-marketing + Public API foundation)
**Sprint:** Sprint 1.2 — Operational Maturity appendix (G-004)

### Added
- `docs/design/ConsentShield-Customer-Integration-Whitepaper-v2.md` — new Appendix E *Operational Maturity (Capability Status)*: authoritative inventory of 78 capabilities across 11 sections, each flagged Shipping / Beta / Roadmap. Every Roadmap row carries a target quarter and cites its owning ADR-1001..1008 sprint. The public `/v1/*` compliance API is explicitly Roadmap (resolved by end of ADR-1002). Appendix E wins any conflict with body paragraphs.
- Executive Summary paragraph added pointing readers to Appendix E as the first place to reconcile claims against product reality.

### Changed
- Status semantics formalised: Shipping means live in production; Beta means live but narrow; Roadmap means scoped in an ADR with a target quarter. Two Shipping variants — `Shipping (structural)` for DDL-enforced claims (e.g. Category-label rule) and `Shipping (architectural)` / `Shipping (commercial)` for non-code claims — distinguish them from code-backed Shipping entries.

### Deferred
- Mirror Appendix E into security-review sales deck — no deck exists in the repo today; defers until a deck is authored. Appendix E itself is authoritative wherever it lives.

### Tested
- [x] Test 1: row count ≥ 30 — PASS (78 rows)
- [x] Test 2: every Shipping row backed by landed ADR or structural-schema constraint — PASS (all 31 rows verified)
- [x] Test 3: every Roadmap row carries target quarter — PASS (zero exceptions)
- [x] Test 4: public `/v1/*` surface flagged Roadmap — PASS (7 Roadmap, 1 Shipping for existing callback)

## [ADR-1001 Sprint 1.1] — 2026-04-19

**ADR:** ADR-1001 — v2 Whitepaper Phase 1 (Truth-in-marketing + Public API foundation)
**Sprint:** Sprint 1.1 — Connector catalogue accuracy (G-001)

### Changed
- `docs/design/ConsentShield-Customer-Integration-Whitepaper-v2.md` — Appendix D re-tabled into Shipping today / Q3 2026 / Q4 2026 status columns with ADR-1007 sprint targets; only Mailchimp + HubSpot marked Shipping today. §6.2 in-body connector table reshaped to match. §9.1 Pure-Web-SaaS archetype diagram corrected (removed Intercom from "pre-built OAuth connectors" line).
- `docs/design/screen designs and ux/consentshield-site.html` — five overclaims corrected: feature card (line 1016), product-section bullet (line 1297), solution tile (line 1846), pricing tile (line 1868), FAQ (line 2156). The "13 pre-built connectors" language is fully removed.

### Added
- `app/src/lib/connectors/README.md` — authoritative connector catalogue, matching the whitepaper Appendix D exactly. Documents the Shipping today / Q3 2026 / Q4 2026 status semantics and the owning ADR-1007 sprints. Added the norm that this file, Appendix D, and the site HTML MUST match (per CC-F, whitepaper-as-normative-spec).

### Tested
- [x] Test 1: grep for "Shipping today" in whitepaper — PASS (2 data rows, both backed by real files)
- [x] Test 2: Shipping claims ↔ connector files under `app/src/lib/connectors/oauth/` — PASS (1:1 correspondence: Mailchimp ↔ `mailchimp.ts`, HubSpot ↔ `hubspot.ts`)
- [x] Test 3 (added): no stale "13 pre-built" / "15 pre-built" claims in site HTML — PASS

## [ADR-0050 Sprint 2.3 status flip] — 2026-04-19

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.3 — invoice history + webhook reconciliation

### Changed
- `docs/ADRs/ADR-0050-admin-account-aware-billing.md` — Sprint 2.3 flipped `[ ] planned` → `[x] complete`; test results recorded (webhook-reconciliation 5/5, billing-invoice-list 14/14, issuer-immutability 10/10, repo 371/371). ADR-index status for ADR-0050 updated to reflect Sprint 2 complete.

## [ADR-0050 Sprint 2.2 status flip] — 2026-04-19

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.2 — invoice issuance RPC + GST computation + finalize RPCs

### Changed
- `docs/ADRs/ADR-0050-admin-account-aware-billing.md` — Sprint 2.2 flipped `[ ] planned` → `[x] complete`; test results recorded (GST 11/11, issue-invoice 13/13, repo 343/343). Noted the Route Handler relocation from `app/` to `admin/` (Rule 12 isolation).

## [Architecture-doc refresh] — 2026-04-18

### Changed

- `docs/architecture/consentshield-complete-schema-design.md` — new §12 Post-DEPA Amendments catalogues every new table, column, and RPC shipped between ADRs 0033 and 0049: refunds + plan_adjustments (+ account_effective_plan), blocked_ips, rate_limit_events, sentry_events, worker_errors prefix discipline, organisations.sdf_* columns, admin.admin_users.status invited. Admin RPC roster added (§12.5). Rule 12 identity-isolation guards documented (§12.7).
- `docs/architecture/consentshield-definitive-architecture.md` — four new appendices:
  - Appendix A — Admin console panels (13 operator surfaces with route + data source + ADR pointer).
  - Appendix B — Observability data model (flow diagram across worker_errors / rate_limit_events / sentry_events / blocked_ips).
  - Appendix C — Identity isolation (four-layer enforcement summary).
  - Appendix D — Rule 5 service-role carve-out (what, where, and under what preconditions).

Source-of-truth docs now match the ADRs that shipped in the 2026-04-17/18 window.

## [ADR-0049 charter + closeout] — 2026-04-18

**ADR:** ADR-0049 — Security observability ingestion (closes V2-S1 + V2-S2)

### Added
- `docs/ADRs/ADR-0049-security-observability-ingestion.md` — chartered + shipped Completed. Two phases.
- `docs/ops/sentry-webhook-setup.md` — operator runbook for wiring Sentry Internal Integration + round-trip smoke.

## [ADR-0048 charter + closeout] — 2026-04-18

**ADR:** ADR-0048 — Admin Accounts panel + ADR-0033/34 deviation closeout

### Added
- `docs/ADRs/ADR-0048-admin-accounts-and-observability.md` — chartered + shipped Completed. Two phases.

### Changed
- ADR-0034 Sprint 2.1 deviations (Suspend-org fan-out, Adjustment UUID textbox) marked closed.
- ADR-0033 Security HMAC/Origin empty-tab deviation marked closed.

## [ADR-0046 charter + Phase 1] — 2026-04-18

**ADR:** ADR-0046 — Significant Data Fiduciary foundation

### Added
- `docs/ADRs/ADR-0046-significant-data-fiduciary.md` — chartered as four phases. Phase 1 shipped; Phases 2–4 remain charter-only.

## [ADR-0045 charter + closeout] — 2026-04-18

**ADR:** ADR-0045 — Admin user lifecycle (invite + role change + disable)

### Added
- `docs/ADRs/ADR-0045-admin-user-lifecycle.md` — promoted stub → Completed in one session.

## [Policy: Rule 5 carve-out + new Rule 12] — 2026-04-18

### Changed
- `CLAUDE.md` Rule 5 — documented carve-out: admin Route Handlers under `admin/src/app/api/admin/*` may use service-role **solely for `auth.admin.*`** operations, and MUST call an `admin.*` RPC running `require_admin('platform_operator')` first. Non-auth reads stay on `cs_admin`.
- `CLAUDE.md` new Rule 12 — identity isolation: one auth.users row is customer OR admin, never both. Both proxies enforce; `accept_invitation` + `admin_invite_create` refuse cross-identity mixing. Code-rules section renumbered 13–18.
- `app/src/proxy.ts` — rejects `is_admin=true` sessions with 403 + hint at admin origin.

## [Brand assets] — 2026-04-17

### Added
- `docs/design/brand-assets/` — 12 SVGs extracted from `consentshield-logos-v2.pdf` (shield variants, wordmarks, full logos, verified badge, social avatar) + README.
- Mirrored into `app/public/brand/` and `admin/public/brand/`.

## [ADR-0034 charter + closeout] — 2026-04-18

**ADR:** ADR-0034 — Billing Operations

### Added
- `docs/ADRs/ADR-0034-billing-operations.md` — chartered + shipped Completed. Three sprints.

### Changed
- Amended for ADR-0044 Phase 0 — billing subject moved from `organisations` to `accounts`; refunds/plan_adjustments rewired; RPCs re-signatured.

## [ADR-0019 closeout] — 2026-04-18

**ADR:** ADR-0019 — DEPA Roadmap (meta-ADR)

### Changed
- `docs/ADRs/ADR-0019-depa-roadmap.md` — flipped Proposed → Completed. All children (0020/0021/0022/0023/0024/0025 + 0037 rollup) shipped.

## [ADR-0039 charter + closeout] — 2026-04-17

**ADR:** ADR-0039 (Connector OAuth — Mailchimp + HubSpot)

### Added
- `docs/ADRs/ADR-0039-connector-oauth.md` — drafted and shipped Completed. Three sprints. Closes V2-C1.

### Changed
- `docs/V2-BACKLOG.md` — V2-C1 replaced with pointer.
- `docs/ADRs/ADR-index.md` — ADR-0039 added as Completed.

## [ADR-0041 charter + closeout] — 2026-04-17

**ADR:** ADR-0041 (Probes v2 — Vercel Sandbox runner + CRUD UI)

### Added
- `docs/ADRs/ADR-0041-probes-v2-sandbox.md` — drafted and shipped Completed. Five sprints. Closes V2-P1 + V2-P2.

### Changed
- `docs/V2-BACKLOG.md` — V2-P1 + V2-P2 replaced with pointers.
- `docs/ADRs/ADR-index.md` — ADR-0041 added as Completed.

## [ADR-0042 charter + closeout] — 2026-04-17

**ADR:** ADR-0042 (Signup idempotency regression test)

### Added
- `docs/ADRs/ADR-0042-signup-idempotency-test.md` — drafted Completed. One sprint. Closes V2-T1.

### Changed
- `docs/V2-BACKLOG.md` — V2-T1 replaced with pointer.
- `docs/ADRs/ADR-index.md` — ADR-0042 added as Completed.

## [ADR-0040 charter + closeout] — 2026-04-17

**ADR:** ADR-0040 (Audit R2 Upload Pipeline)

### Added
- `docs/ADRs/ADR-0040-audit-r2-upload.md` — drafted and shipped Completed. Four sprints. Closes V2-X3.

### Changed
- `docs/V2-BACKLOG.md` — V2-X3 replaced with pointer to ADR-0040.
- `docs/ADRs/ADR-index.md` — ADR-0040 added as Completed.

## [ADR-0038 charter + closeout] — 2026-04-17

**ADR:** ADR-0038 (Operational Observability — cron watchdog + stuck-buffer alerting)

### Added
- `docs/ADRs/ADR-0038-operational-observability.md` — drafted and shipped Completed. Three sprints. Closes V2-O3 and V2-O1.a (`check-stuck-buffers`).

### Changed
- `docs/V2-BACKLOG.md` — V2-O3 replaced with pointer to ADR-0038 Sprint 1.1. V2-O1 entry rewritten: `check-stuck-buffers` pointer added; `check-retention-rules` stays (Phase-3 feature prerequisite).
- `docs/ADRs/ADR-index.md` — ADR-0038 added as Completed.

## [ADR-0037 charter + closeout] — 2026-04-17

**ADR:** ADR-0037 (DEPA Completion — V2-D1 + V2-D2 + V2-D3 + W8 + W9)

### Added
- `docs/ADRs/ADR-0037-depa-completion.md` — drafted and shipped Completed same session. Bundles five previously-deferred DEPA items.

### Changed
- `docs/V2-BACKLOG.md` — V2-D1, V2-D2, V2-D3 entries replaced with one-line pointers to ADR-0037 sprints per the write-once-then-pointer rule.
- `docs/design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md` — W8 + W9 code columns flipped from `☐` to `✅ 2026-04-17`. Implementing-ADR attribution corrected to ADR-0037.
- `docs/ADRs/ADR-index.md` — ADR-0037 added as Completed.

## [ADR-0024 charter + closeout] — 2026-04-17

**ADR:** ADR-0024 (DEPA Customer UI Rollup — W2 + W3 + W6 + W7 + W10)

### Added
- `docs/ADRs/ADR-0024-depa-customer-ui.md` — drafted and shipped Completed same-session. Bundles five wireframe-defined customer UI items (Consent Artefacts panel, Purpose Definitions catalogue + Connector mappings, Dashboard tile, Rights Centre impact preview, Settings sector template).

### Changed
- `docs/design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md` tracker — W2/W3/W6/W7/W10 code columns flipped from `☐` to `✅ 2026-04-17`. Responsible ADR attribution corrected to ADR-0024 (rollup) for W2/W6/W7 (previously tagged to 0021/0022/0025 which shipped backend-only).
- `docs/V2-BACKLOG.md` — new entries V2-D2 (per-requestor artefact binding in Rights Centre) and V2-D3 (CSV export for Consent Artefacts list).
- `docs/ADRs/ADR-index.md` — ADR-0024 added as Completed.

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

## [ADR-0050 Sprint 3.2 close + STATUS refresh] — 2026-04-20

**ADR:** ADR-0050 — Admin account-aware billing (close-out)

### Changed
- `docs/STATUS.md` — Full rewrite to 2026-04-20 snapshot: 50 ADRs completed, both apps inventoried, test suite counts, immediate next steps.
- `docs/ADRs/ADR-index.md` — ADR-0050 status updated from In Progress → Completed.
- `docs/ADRs/ADR-0050-admin-account-aware-billing.md` — Sprint 3.1 and 3.2 statuses flipped to complete; search-scope test skip rationale and account_id best-effort note appended.

## [STATUS refresh — late 2026-04-20] — 2026-04-20

**ADR:** various close-outs

### Changed
- `docs/STATUS.md` — refreshed to reflect ADR-0051 close-out: 53 completed ADRs, latest commit `b9c28e9`, 150 migrations, 199 commits. Evidence ledger + dispute ledger viewer called out in the admin panel inventory. ADR-1002 in progress (Terminal B). Immediate-next list trimmed to ADR-0052 + 0053.

## [STATUS refresh — admin billing close-out] — 2026-04-20

**ADRs closed:** 0051, 0052, 0053

### Changed
- `docs/STATUS.md` — 55 completed ADRs; latest commit `f22312b`; 157 migrations; admin billing track (0050 → 0053) fully closed. Immediate-next list trimmed to ADR-0055 + 0056.
