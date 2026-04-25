# Changelog — Documentation

Documentation changes.

## [ADR-1006 Phase 4 Sprint 4.2 — marketing /docs/sdks pages (fix 404)] — 2026-04-25

**ADR:** ADR-1006 — Developer Experience: Client Libraries + OpenAPI + CI Drift Check
**Sprint:** Phase 4, Sprint 4.2 (Go SDK ships in CHANGELOG-api; this entry covers the marketing-site documentation that ships in the same commit)

### Added
- **`marketing/src/app/docs/sdks/page.mdx`** — index page (the `/docs/sdks` 404 fix). Install matrix for the three official SDKs (Node / Python / Go) with `npm install`, `pip install`, `go get` snippets; "what every SDK does" method overview; the unified compliance contract table (default vs `failOpen=true` × four outcome rows); cross-SDK quickstart in CodeTabs (Node/Python/Go on the same verify call); pointer to the framework-integration examples in each SDK; pointer to the OpenAPI spec for callers in other languages.
- **`marketing/src/app/docs/sdks/node/page.mdx`** — `@consentshield/node` landing page. Install (`npm` / `pnpm` / `yarn` / `bun`) + Node 18+ note + dual ESM/CJS + `sideEffects: false`. Quickstart, configuration knobs, full method matrix grouped by concern (consent, listing+iteration, deletion+rights, health), compliance contract with TS-specific error class names, `isOpenFailure` type-guard usage, `onFailOpen` audit-trail wiring with Sentry example, trace-id round-trip with `instanceof ConsentShieldError`, examples reference (Express + Next.js).
- **`marketing/src/app/docs/sdks/python/page.mdx`** — `consentshield` (PyPI) landing page. Install + extras (`[test]` / `[dev]`) + Python 3.9+ note + `httpx` runtime dep + PEP 561 `py.typed` marker. Sync + async quickstarts (with `async with` context manager), configuration knobs, method matrix (sync = generator iterators, async = async iterators), compliance contract with Python-specific exception class names, `is_open_failure` type-guard usage, `on_fail_open` callback (sync + async-coroutine support documented), examples reference (Django middleware + Flask decorator + FastAPI dependency).
- **`marketing/src/app/docs/sdks/go/page.mdx`** — `github.com/consentshield-org/go-client` landing page. Install + Go 1.22+ note + zero-runtime-deps emphasis + Go-module-proxy release model. Quickstart, configuration knobs, full method matrix, compliance contract with `errors.As`-discrimination snippet, paginator pattern (`Next(ctx) bool` + `Page() []T` + `Err() error`), trace-id round-trip via `Error` interface, `Config.HTTPClient` swap for tests / mTLS / custom transport, examples reference (net/http + gin).

### Changed
- **`marketing/src/app/docs/_data/nav.ts`** — three new sub-entries beneath "SDK availability" (`/docs/sdks/node`, `/docs/sdks/python`, `/docs/sdks/go`) with the `nested` flag + an "SDKs" subheading; renders one level indented in the docs sidebar.
- **`marketing/src/app/docs/_data/search-index.ts`** — `/docs/sdks` description corrected from "Node / Python / Java / Go client libraries" to "Node / Python / Go client libraries — overview + install matrix" (Java was dropped per ADR-1006 scope amendment 2026-04-25). New DESCRIPTIONS entries for the three per-SDK pages with stack-specific keywords (`express`, `nextjs`, `django`, `flask`, `fastapi`, `gin`, `chi`, `net/http`, etc.) so Cmd-K finds them on framework-name searches.

### Architecture changes
- **`/docs/sdks` was a 404 before this sprint.** The sidebar entry existed (added in ADR-1015) but the matching MDX page did not. Sprint 4.2 closes the loop: every sidebar link on the docs site now resolves to a live page (verified by `bun run build` listing `/docs/sdks`, `/docs/sdks/node`, `/docs/sdks/python`, `/docs/sdks/go` in the dynamic route table).
- **Marketing copy realignment for the dropped Java SDK.** Both nav.ts and search-index.ts referenced "Java" as a published SDK. Sprint 4.2 (which formally abandons Sprint 4.1 Java per the scope amendment) corrects every customer-facing surface to the three actually-shipped languages.

### Tested
- [x] `cd marketing && bun run build` — PASS, route table includes `/docs/sdks`, `/docs/sdks/node`, `/docs/sdks/python`, `/docs/sdks/go`
- [x] `cd marketing && bun run lint` — PASS (no new warnings; the two pre-existing warnings in unrelated files remain)
- [x] All four new MDX pages render with the standard `<Breadcrumb>` + `<Callout>` + `<CodeTabs>` + `<FeedbackStrip>` shell from `mdx-components.tsx`

## [ADR-1003 Sprint 3.2 — zero-storage feature matrix + benchmark template] — 2026-04-25

**ADR:** ADR-1003 — Processor Posture + Healthcare Category Unlock
**Sprint:** Phase 3, Sprint 3.2

### Added
- `docs/design/zero-storage-feature-matrix.md` — full gap inventory (8 sections, 35+ rows) classifying every customer-visible feature ✅ / ⚠ / ❌ across Standard / Insulated / Zero-Storage. Sections: capture (write path), replay + idempotency, read + audit + audit-export, rights flows, storage mechanics, operational, sandbox, plan / billing, healthcare-specific. Captures the buffer-replay impossibility, dashboard consent-events-list placeholder need, audit-reconstruction-via-bucket-listing pattern, and four V2 follow-ups (consent-events-list zero-storage placeholder, percentile-ranking aggregator UI, sandbox-orgs-don't-count-toward-max_organisations, customer-side bucket replay tooling).
- `docs/benchmarks/zero-storage-100k.md` — benchmark report skeleton. Run-summary table, Mode A + Mode B metric tables (with thresholds), resource-impact table (Hyperdrive / Worker CPU / Supabase compute / R2 PUT), rough cost roll-up, observations + follow-ups section, re-run cadence, verdict line. All cells are `TBD`; populated after the first live run lands.

### Rationale
Sprint 3.2 ships in two phases: harness now, live run later. The gap inventory is something procurement and onboarding both need on day one — it's authored from architecture knowledge and doesn't need a load test to be useful. The benchmark template likewise stabilises the format so that the live-run results have a predictable home.

### Tested
- Static review against the Sprint 1.1 / 1.2 / 1.3 / 1.4 architecture decisions (every claim in the matrix maps to a concrete migration or sprint).
- Live operator validation deferred until the harness runs and the benchmark is filled.

## [ADR-1003 Sprint 5.1 R3 — sandbox customer doc] — 2026-04-25

**ADR:** ADR-1003 — Processor Posture + Healthcare Category Unlock
**Sprint:** Phase 5, Sprint 5.1 (round 3 of 3 — Phase 5 closes)

### Added
- `docs/customer-docs/sandbox.md` — full customer-facing guide for sandbox orgs. Covers the prod-vs-sandbox property table (org id / name suffix / API key prefix / rate tier / plan-gating / billing / cross-customer benchmarks / manifest marker), provisioning paths (dashboard form + raw SQL operator path), org switching, API key minting (cs_test_* + forced sandbox rate_tier), test-principal generator usage with `curl` examples, audit-export `manifest.json.sandbox` semantics, compliance-score impact (per-org row stays; cross-customer aggregator reads from the `_prod` view), cleanup procedure (with the `where sandbox = true` safety belt on the SQL deletion path), V1 vs V2 boundary (no promote-sandbox-to-prod path in v1), and a troubleshooting section keyed to the four observable error messages (P0004 + the three 42501 / 22023 cases).

### Rationale
Sprint 5.1 R3 closes Phase 5 with the customer-facing artefact. Backend + dashboard surfaces shipped in R1 + R2 are not self-explanatory to a procurement evaluator opening their first sandbox — the doc explicitly walks the two flows (engineer doing API-only smoke, compliance lead rehearsing rights-request workflows) and names the gotchas (Healthcare Starter requires zero_storage, sandbox keys are 100/hr, manifest marker matters for downstream audit lakes).

### Tested
- Static review against the migrations 59 + 60, the route handler at `/api/v1/sandbox/test-principals`, the audit-export route's manifest field, and the dashboard sandbox page + banner.
- Live walk-through deferred to operator validation once a real test customer hits the doc.

## [ADR-1003 Sprint 4.1 — Healthcare onboarding + operator runbook] — 2026-04-25

**ADR:** ADR-1003 — Processor Posture + Healthcare Category Unlock
**Sprint:** Phase 4, Sprint 4.1

### Added
- `docs/customer-docs/healthcare-onboarding.md` — customer onboarding guide for clinics, hospitals, diagnostic centres, pharmacies and telemedicine providers. Two parallel flows: (A) single-doctor clinic (~15 min, 7 steps from storage-mode flip through banner publish) and (B) multi-doctor practice / hospital (~45 min, adds tenancy decision, per-department connector wiring, RBAC baseline for account_owner / org_admin / admin / viewer tiers, ABDM HIE bridge placeholder). Covers the two-step admin/customer dance the ADR-1003 Sprint 4.1 gate enforces (admin flips storage_mode → customer applies template), BYOS bucket provisioning pointer, purpose-level retention defaults table (7y DISHA on clinical records, 5y ICMR on research, 1-2y on consent-only), operational realities of zero_storage mode for healthcare (no buffer-side replay, export-from-customer-bucket, audit-reconstruction responsibility), and a troubleshooting section keyed to the P0004 error message and common connector-mapping omissions.
- `docs/runbooks/adr-1003-phase-1-operator-actions.md` — one-shot operator runbook for the ADR-1003 Phase 1 close-out: Vault seed SQL (idempotent `vault.create_secret` for `cs_storage_mode_sync_url` + `cs_deliver_events_url`), Worker wrangler secret commands (`WORKER_BRIDGE_SECRET` + `ZERO_STORAGE_BRIDGE_URL`), Vercel env-var commands (`WORKER_BRIDGE_SECRET` across three environments + `SUPABASE_CS_DELIVERY_DATABASE_URL`), mirror into `app/.env.local`, and five smoke tests (storage-mode KV sync, Mode A invariant, Mode B invariant against `POST /v1/consent/record`, hot-row TTL refresh, integration suite with `--reporter=verbose` to defeat the silent Mode B skip). Per-step rollback path at the foot.

### Rationale
Sprint 4.1 is the first ConsentShield template to carry a mandatory storage-mode gate, so the customer-facing doc has to tell the account_owner they cannot self-serve the full flow — they need the operator to flip storage_mode first. The operator runbook closes the loop on Phase 1 Vault + env-var seeding that prior ADR-1003 sprints deferred.

### Tested
- Static review against the ADR-1003 §Phase 4 acceptance criteria + the `apply_sectoral_template` P0004 error message shape.
- Walk-through against the seed migration (`20260804000056`) to confirm the 7-purpose retention table matches the migration jsonb payload.
- Live operator-side verification of the runbook commands is deferred to the operator (Vault SQL editor + wrangler/vercel CLI sessions).

## [ADR-1003 Sprint 2.2 — BYOS customer docs + Standard→Insulated runbook] — 2026-04-24

**ADR:** ADR-1003 — Processor Posture + Healthcare Category Unlock
**Sprint:** Phase 2, Sprint 2.2

### Added
- `docs/customer-docs/byos-aws-s3.md` — end-to-end AWS S3 BYOS guide. Complete write-only IAM policy JSON (single `s3:PutObject` statement), `aws` CLI commands for bucket creation + public-access block + versioning, IAM user + access key provisioning, the dashboard validation steps with an expected probe-output sample, a justification table for every IAM action we deliberately do NOT grant (ties back to the scope-down invariant), orphan `cs-probe-*` lifecycle rule JSON, 90-day credential rotation procedure, and a troubleshooting section keyed to the Sprint 2.1 per-check outcome labels.
- `docs/customer-docs/byos-cloudflare-r2.md` — parallel R2 guide. Honest upfront section documenting that R2's standard "Object Read & Write" scope FAILS the Sprint 2.1 scope-down probe — the customer needs R2 custom permissions (or use AWS S3 instead). Covers bucket creation via wrangler, custom-permission API Token recipe mapping to exactly `PutObject`, dashboard validation, S3 API compatibility notes (region=auto, account-scoped endpoint, lifecycle via S3 API), and a troubleshooting section for R2-specific failure modes.
- `docs/runbooks/standard-to-insulated-migration.md` — operator runbook for the Standard → Insulated cut-over. Role split (customer drives the happy path; operator intervenes on stuck rows), pre-flight SQL queries for `storage_migrations` + `export_configurations`, cut-over-mode comparison table (`forward_only` seconds + zero bandwidth; `copy_existing` minutes-to-hours + 2× bandwidth), live monitoring queries, stuck-row diagnosis (credential expiry / rate-limit / orchestrator downtime) with a manual-advance escape hatch, post-cut-over validation (mode flipped, export_config pointing at new bucket, buffer drains normally, test-event land-in-bucket verification), one-way rollback procedure with the explicit caveat that ConsentShield cannot pull records back from the customer's bucket.

### Rationale
Sprint 2.1 shipped the scope-down probe code; Sprint 2.2 ships the customer-facing artefact that tells a procurement team exactly what IAM policy to paste. Without the customer docs the dashboard validator would reject over-scoped credentials without naming the fix. The runbook turns the cut-over from a support ticket into a customer-driven flow with a clear escalation path for the operator.

### Tested
- Static review against the ADR-1003 architecture and the Sprint 2.1 probe semantics.
- Live self-test against fresh AWS + Cloudflare accounts — deferred to operator.

## [C-1 + C-2 close-out — ADR-0044 review follow-ups] — 2026-04-24

**Review:** `docs/reviews/2026-04-18-adr-0044-customer-rbac-review.md` §4 C-1 + C-2
**Sprint:** None — deferred doc-refresh pass from the 2026-04-18 review

### Changed
- `docs/architecture/consentshield-definitive-architecture.md` §3 Data Classification — split the old `A.1 Org-scoped tables` entry into three tiers: **A.1 Account-scoped** (accounts, account_memberships, invitations, plans, ADR-0050 billing surface), **A.2 Org-scoped** (organisations + `account_id` FK, org_memberships, the existing per-org operational tables), **A.3 Global reference** (tracker_signatures, sector_templates, dpo_partners, plans). Replaces the legacy single `A.1` list that still named the removed `organisation_members` table.
- `docs/architecture/consentshield-definitive-architecture.md` §5 Multi-Tenant Isolation — new **§5.0 Tenancy Hierarchy (ADR-0044)** subsection at the top documenting the 4-level account → organisations → web_properties → artefacts hierarchy, 5-role taxonomy with role matrix, invitation-only signup, single-account-per-identity invariant (ADR-0047), and pointers to the two schema migrations (`20260428000002_accounts_and_plans.sql`, `20260429000001_rbac_memberships.sql`).
- `docs/architecture/consentshield-definitive-architecture.md` §5.1 JWT Custom Claims — replaced the pre-ADR-0044 hook snippet (queried the removed `organisation_members` table) with the current post-0044 hook body from `20260429000001_rbac_memberships.sql`; added the caveat that JWT claims are no longer authoritative for role decisions — `account_owner` inheritance and multi-org membership aren't encoded there.
- `docs/architecture/consentshield-definitive-architecture.md` §5.2 RLS Helper Functions — removed the stale `is_org_admin()` example; documented the five live helpers (`current_org_id`, `current_account_id`, `current_account_role`, `current_org_role`, `effective_org_role(p_org_id)`) with their inheritance semantics; noted that `is_org_admin()` is retained for pre-0044 policies but isn't authoritative — new gates use `effective_org_role(org_id)` or `current_account_role()`.
- `docs/admin/design/consentshield-admin-screens.html` — plan dropdown in the account-creation invite panel synced to seeded plans: `trial_starter / starter / growth / pro / enterprise` with prices `₹0 / ₹999 / ₹2,999 / ₹7,999 / custom` and the actual limits from `20260428000002_accounts_and_plans.sql:67-73` (was: the pre-0044 `free / growth / pro / enterprise` with the old ₹5,999 growth price).
- `docs/admin/design/consentshield-admin-screens.html` — account-detail billing card plan display synced to the seeded ₹2,999/mo growth price (was ₹5,999/mo).
- `docs/design/screen designs and ux/consentshield-screens.html` — customer wireframe Settings "Current plan" row + dashboard plan card synced to ₹2,999/mo + `3 orgs / 5 properties per org` limits.
- `docs/reviews/2026-04-18-adr-0044-customer-rbac-review.md` §6 follow-up table — flipped C-1 and C-2 to **Closed** with one-line remediation notes; S-2 (remove-member) also flipped to Closed with a pointer to ADR-0047 since it was shipped six days ago and the review table hadn't been updated.

### Tested
- Documentation-only. No code paths exercised.

### Why
The ADR-0044 review left three cosmetic / deferred items open: the architecture doc described v1 flat-org tenancy, the admin wireframe plan picker drifted from seed values, and remove-member was labelled "Phase 2.7 or V2 candidate" but had already shipped as ADR-0047. This pass closes all three. S-1 (marketing HMAC replay nonce) remains open as a V2 candidate; no change.

---

## [ADR-1026 — authored, attempted, abandoned same-day] — 2026-04-24

**ADRs:** ADR-1026 (new; Abandoned), ADR-1010 (Sprint 4.2 section amended with live-smoke results + Hyperdrive incident block)

### Added
- `docs/ADRs/ADR-1026-drop-hyperdrive-direct-supavisor.md` — proposal to rewind ADR-1010 Phase 3's Hyperdrive binding and connect the Worker directly to Supavisor via `postgres.js`. Authored, Sprint 1.1 (`CS_WORKER_DSN` wrangler secret) executed, Sprint 1.2 (code swap) attempted and blocked on CF Workers free-tier 50-subrequest-per-invocation limit, then Abandoned with a reopen-trigger note. Kept on file as the factual record of the attempt, not the proposed change.
- `docs/ADRs/ADR-1026-...md` — "Abandonment note" block at the top of the ADR. Leads every future reader before the (now-stale) Decision block.

### Changed
- `docs/ADRs/ADR-index.md` — added ADR-1026 entry, final status `Abandoned`, summary points at the subrequest blocker + the three reopen triggers.
- `docs/ADRs/ADR-1010-...md` — Sprint 4.2 flipped `pending` → `complete`. Added live-smoke results table (cold 2.9 s → ~800 ms; warm 60–100 ms → 55–60 ms), a recovery narrative for the in-sprint Hyperdrive pool-saturation incident (bug-725/bug-726), and a top-of-ADR status line that captures the Sprint 4.2 close-out.

### Tested
- Documentation-only. No code paths exercised in this changelog entry beyond what the referenced ADR close-outs recorded.

---

## [ADR-1014 Sprint 3.7 — pair matrix audit (Phase 3 close-out)] — 2026-04-23

**ADR:** ADR-1014 — E2E test harness + vertical demo sites
**Sprint:** Phase 3, Sprint 3.7 — Negative-control pair sweep

### Added
- `tests/e2e/specs/pair-matrix.md` — living audit document. Tabulates all ten Phase-1..3 positive tests and names each one's paired negative(s). Seven pairs are intra-file; three pair across files (browser ↔ API-layer origin-mismatch; impersonation audit ↔ rpcs.test.ts state-transitions; invoice Rule 19 ↔ invoice-immutability matrix) — each cross-file split is deliberate per its sprint's scope boundary. §5 documents three cross-cutting invariants: test-isolation property scoping, three-surface proof discipline, property-isolation on concurrent runs. §6 specifies the update rule — every new positive test in Phase 4+ MUST add a row before the sprint can close.

### Tested
- No new test code ships under Sprint 3.7 (documentation-only). Every positive + negative referenced in the matrix was verified PASS by its own sprint.

### Why
Phase 3 shipped ten positive tests across six sprints. Pair completeness is easy to lose track of as test count grows; without an inventory, the "accept-everything" bug would fail no test. Sprint 3.7's audit confirms zero gaps and installs the discipline that prevents drift in Phase 4+ (mutation testing) and Phase 5 (partner-evidence archive) where every new positive must be pair-completable before shipping.

## [ADR-1025 proposed — customer storage auto-provisioning (hybrid managed R2 + BYOK)] — 2026-04-23

**ADR:** ADR-1025 (new; Proposed)

### Added
- `docs/ADRs/ADR-1025-customer-storage-auto-provisioning.md` — 4-phase / 7-sprint proposal for populating `public.export_configurations` without operator intervention. Upstream of ADR-1019: `deliver-consent-events` can't ship until every paying org has a verified storage configuration; ADR-1025 is how they get one. (Originally drafted as ADR-1022 — renumbered later the same day so ADR-1020's reserved 1022 / 1023 / 1024 slots for multilingual Phase 2 / 3 / 4 stay coherent.) Two tiers:
  - **Tier 1 — CS-managed R2 default:** at onboarding Step 4, a background Edge Function derives a sha256-prefixed per-org bucket name, creates it via Cloudflare R2 REST API under a single CS-operated CF account, generates a bucket-scoped R2 token, encrypts both with the per-org HMAC-derived key (CLAUDE.md Rule 11), runs a PUT/GET/DELETE verification probe, flips `is_verified=true`. Zero user interaction. Wizard is non-blocking; Step 7 renders a soft banner if provisioning is still in flight.
  - **Tier 2 — BYOK escape hatch:** `/dashboard/settings/storage` (account_owner-gated) accepts R2 / S3 credentials, runs the same probe, then offers copy-existing-and-cutover or cutover-forward-only migration modes. `migrate-customer-storage` Edge Function streams historical objects across resumably (`ListObjectsV2` with `StartAfter`), atomically swaps the `export_configurations` pointer, revokes the CS-managed token.
- `docs/ADRs/ADR-1019-deliver-consent-events-edge-function.md` — upstream-dependency line added in the header front-matter pointing at ADR-1025.
- `docs/ADRs/ADR-index.md` — row for ADR-1025 inserted after ADR-1021.

### Rule-4 re-framing captured in the ADR
CLAUDE.md Rule 4 ("customer owns the compliance record, exports must pull from customer-owned storage") is re-read as being about the locus of the canonical record (R2, not buffer tables), NOT about which Cloudflare account pays the monthly bill. The DPA layer + per-tenant bucket isolation + scoped tokens + customer export + move-out rights satisfy Rule 4 in both tiers. The tier split is a commercial / procurement concern that rides on top — enterprise BFSI / healthcare customers exercise Tier 2; self-serve SMB customers default to Tier 1 and never notice.

### Why
This closes the last structural gap that was keeping ADR-1019 from being buildable. Without auto-provisioning, ADR-1019 + every downstream ADR that assumes R2 export (ADR-0022 revocation receipts, ADR-0023 expiry alerts, ADR-0040 audit R2 pipeline, Rule 4 itself) are aspirational. ADR-1025 makes the `export_configurations` table go from "defined schema with zero rows" to "one verified row per paying org at onboarding completion".

### Not decided yet
- CF account bucket-soft-limit sharding strategy (~1000 buckets per account). Sprint 4.2 adds the 80%-capacity alert; a multi-account partitioning scheme is a V2 entry if and when we approach the ceiling.
- Usage-based billing pass-through for Pro / Enterprise tiers — Sprint 4.2 surfaces the data; the billing integration is a downstream concern separately tracked.

## [ADR-1014 Sprint 3.4 — architecture-doc sync for cs_orchestrator SELECT on deletion_receipts] — 2026-04-23

**ADR:** ADR-1014 — E2E test harness + vertical demo sites
**Sprint:** Phase 3, Sprint 3.4 — docs sync

### Changed
- `docs/architecture/consentshield-definitive-architecture.md` §5.4 (cs_orchestrator role grants block) — `deletion_receipts` added to the `CAN SELECT` list with a parenthetical referencing migration 20260804000030 and the rpc_deletion_receipt_confirm rationale.
- `docs/architecture/consentshield-complete-schema-design.md` §5.1 (cs_orchestrator role GRANTs) — `grant select on deletion_receipts to cs_orchestrator;` added to the SELECT list with a comment pointing at the Sprint 3.4 follow-up migration.

### Why
Both architecture docs are the contradiction-winning source of truth for role-grant composition (per `CLAUDE.md`'s architecture-reference rule). The Sprint 3.4 schema fix (migration 20260804000030, committed in `0edb924`) added a missing SELECT grant to cs_orchestrator but didn't sync the docs — this commit closes that sync so a future role-matrix audit doesn't re-encounter the documented-vs-actual drift the test suite just finished fixing at the migration layer.

### Tested
- No code path changed; these are doc-only edits. The live grant on dev DB is already in place via the 20260804000030 migration.

## [ADR-1019 proposed — deliver-consent-events Edge Function] — 2026-04-23

**ADR:** ADR-1019 (new; Proposed)
**Status at docs level:** Proposed — no code yet, just the architectural decision.

### Added
- `docs/ADRs/ADR-1019-deliver-consent-events-edge-function.md` — full ADR proposing the missing R2 export Edge Function. 4 phases / 7 sprints. Closes the gap referenced by ADR-0022, ADR-0023, ADR-0012, and ADR-1014 Sprint 3.2 (all four ADRs assume `deliver-consent-events` exists; none of them ship it). Covers:
  - Context: `delivery_buffer` + `export_configurations` + `cs_delivery` role + per-org credential encryption primitives have all existed for ~10 days; only the function itself is missing.
  - Decision: trigger-fired primary path + `pg_cron` 60s safety net (mirrors `process-artefact-revocation`); per-row canonical JSON serialisation with content-hashable output; transaction-scoped UPDATE+DELETE on confirmed upload; exponential backoff with manual-review escalation after 10 failures.
  - Event-type coverage table mapping producer ADRs to payload shapes (8 event_types today: `consent_event`, `artefact_revocation`, `artefact_expiry_deletion`, `consent_expiry_alert`, `tracker_observation`, `audit_log_entry`, `rights_request_event`, `deletion_receipt`).
  - Integration with ADR-1018 status page (`delivery-pipeline` subsystem) and ADR-1017 readiness flags.
  - Acceptance criteria tied to CLAUDE.md Rules 1, 2, 3, 5, 11, 18.
- `docs/ADRs/ADR-index.md` — new row for ADR-1019.

### Why
Four ADRs currently reference a function that doesn't exist. Writing the proposal ADR first (rather than diving straight into code) surfaces the cross-ADR dependencies (particularly the ADR-1014 Sprint 3.2 blocker documented here just yesterday) and gates the subsequent implementation work on an operator review. No migrations, no function code, no schema changes land with this commit — proposal-only.

## [ADR-1005 Phase 2 Sprint 2.1 — test_delete doc sync] — 2026-04-22

**ADR:** ADR-1005 — Operations maturity
**Sprint:** Phase 2 Sprint 2.1

### Changed
- `CLAUDE.md` Rule 5 — `cs_api` RPC count 22 → 23 (ADR-1005 Phase 2 Sprint 2.1 adds `rpc_test_delete_trigger`).
- `docs/architecture/consentshield-definitive-architecture.md` §5.4 — cs_api leak-surface paragraph bumped to 23 with the per-ADR breakdown updated to include ADR-1005 Phase 2 Sprint 2.1: +1 test_delete.
- `docs/ADRs/ADR-1005-operations-maturity.md` — Sprint 2.1 marked complete; deliverables + test results ticked; follow-up customer-docs task redirected to ADR-1015.
- `docs/ADRs/ADR-index.md` — ADR-1005 row description appended with Phase 2 Sprint 2.1 landing.

## [ADR-1017 Sprint 1.3 — tests + runbook + ADR close-out] — 2026-04-22

**ADR:** ADR-1017 — Admin ops-readiness flags
**Sprint:** 1.3 tests + runbook

### Added
- `docs/runbooks/ops-readiness-flags.md` — operator runbook: blocker-type semantics, severity tiers, how to add a flag via migration, how to resolve/defer via UI or SQL, role-gate table, audit-log expectations, links to related runbooks.

### Changed
- `docs/ADRs/ADR-1017-admin-ops-readiness-flags.md` — Sprint 1.3 ticked complete; Test Results populated (12 ops-readiness + 11 status-page assertions green); added a note on the column-misuse fix migration bundled with this sprint.
- `docs/ADRs/ADR-1018-self-hosted-status-page.md` — new follow-up sprint recording the same audit-log column fix on the four status-page RPCs.
- `docs/ADRs/ADR-index.md` — ADR-1017 row description updated.

## [ADR-1016 — orphan-scope close-out doc sync] — 2026-04-22

**ADR:** ADR-1016 — v1 API close-out for `read:audit`, `read:security`, `read:score`

### Changed
- `docs/ADRs/ADR-1016-v1-orphan-scope-read-endpoints.md` — top-line status flipped to **Completed**. Every Sprint 1.1 / 1.2 / 1.3 deliverable + test-plan checkbox ticked. Test Results section populated.
- `docs/ADRs/ADR-index.md` — new row for ADR-1016 **Completed**.
- `CLAUDE.md` Rule 5 — RPC count bumped 19 → 22 (ADR-1009: 12 → ADR-1012: +5 → ADR-1005: +2 → ADR-1016: +3).
- `docs/architecture/consentshield-definitive-architecture.md` §5.4 — cs_api leak-surface paragraph: 19 → 22 with the per-ADR breakdown.

### Tested
- n/a (doc-only). Counts cross-referenced against the grant migrations (`20260801000006–08`, `20260802000007`, `20260803000003–04`, `20260804000003`, `20260804000010`).

## [ADR-1005 Sprint 5.1 — Rights API doc sync] — 2026-04-22

**ADR:** ADR-1005 — Operations maturity
**Sprint:** Phase 5, Sprint 5.1

### Changed
- `docs/ADRs/ADR-1005-operations-maturity.md` — Sprint 5.1 deliverables + Testing plan boxes ticked. Top-line status flipped from **Proposed** to **In Progress** (Phases 1–4 + 6 remain). Sprint 5.1 body extended with schema-additions block, migrations-shipped list, and 11-point Tested block (17/17 rights-api + 146/146 full-suite).
- `docs/ADRs/ADR-index.md` — ADR-1005 row flipped to **In Progress**; description extended to call out that Sprint 5.1 shipped.
- `CLAUDE.md` Rule 5 — `cs_api` RPC count bumped from 12 to 19 (ADR-1009: 12 → ADR-1012: +5 → ADR-1005 Sprint 5.1: +2). Phrasing rewritten to point at the migrations rather than hard-coding a count (`see supabase/migrations/20260801000008… and subsequent *_grants.sql`), so the number doesn't go stale again.
- `docs/architecture/consentshield-definitive-architecture.md` §5.4 — the cs_api credential-leak paragraph updated: "12 whitelisted RPCs" → "19 whitelisted v1 RPCs (ADR-1009: 9 business + 2 bootstrap + 1 key-status; ADR-1012: +5; ADR-1005 Sprint 5.1: +2)".

### Tested
- n/a (doc-only). Counts cross-checked against the migration grant files: `20260801000006` (1 key_status), `20260801000007` (2 bootstrap), `20260801000008` (9 business), `20260802000007` (2 introspection), `20260803000003` (2 discovery), `20260803000004` (1 plans), `20260804000003` (2 rights). Total 19.

## [ADR-1012 Sprint 2.1 — OpenAPI examples backfill + ADR CLOSED] — 2026-04-21

**ADR:** ADR-1012 — v1 API day-1 DX gap fixes **(COMPLETED)**
**Sprint:** Phase 2, Sprint 2.1

### Added
- `app/public/openapi.yaml` — request and/or 2xx response `example:` blocks on all 10 pre-ADR-1012 paths: `/_ping` (response), `/consent/verify` (response), `/consent/verify/batch` (request + response), `/consent/record` (request + 201 response + 200 replay response), `/consent/artefacts` (response), `/consent/artefacts/{id}` (response), `/consent/artefacts/{id}/revoke` (request + response), `/consent/events` (response), `/deletion/trigger` (request + response), `/deletion/receipts` (response). UUIDs, artefact IDs and purpose codes are kept consistent across examples so the spec reads as one end-to-end scenario.

### Fixed
- `app/public/openapi.yaml` — pre-existing structural bugs shipped in Sprints 1.1–1.3 that were caught by the Sprint-2.1 `redocly lint` gate:
  - **Schema mis-placement.** 9 schemas (`KeySelfResponse`, `UsageResponse`, `UsageDayRow`, `PurposeItem`, `PurposeListResponse`, `PropertyItem`, `PropertyListResponse`, `PlanItem`, `PlanListResponse`) were defined under `components/responses:` instead of `components/schemas:`. Every `$ref: "#/components/schemas/KeySelfResponse"` etc. was pointing to a missing target. Relocated all nine into `components/schemas/`. No runtime impact — the file is a static reference only.
  - **OpenAPI 3.0 `nullable: true` in a 3.1 spec.** 27 occurrences rewritten to 3.1 syntax (`type: [string, "null"]` inline, or `oneOf: [{type: "null"}, {$ref: …}]` for the one `$ref`-nullable under `ArtefactDetail.revocation`).

### Changed
- `docs/ADRs/ADR-1012-v1-dx-gap-fixes.md` — top-line status flipped to **Completed** (date completed 2026-04-21). Sprint 2.1 deliverables + Testing plan boxes ticked. Scope-amendment note added explaining the two pre-existing bugs folded into 2.1.
- `docs/ADRs/ADR-index.md` — ADR-1012 row flipped to **Completed**; description extended to mention the Sprint 2.1 scope amendment.

### Tested
- [x] `bunx @redocly/cli lint app/public/openapi.yaml` — 0 errors, 1 warning (missing `info.license` field — cosmetic, pre-existing, tracked for ADR-1006's CI spec-drift check).
- [x] `cd app && bun run build` — passes (the file is a static public asset, not imported at runtime).

## [§5.4 cs_orchestrator GRANT list refresh] — 2026-04-21

**ADR:** n/a — doc drift cleanup flagged in the 2026-04-21 session handoff (gotcha #17).

### Changed
- `docs/architecture/consentshield-definitive-architecture.md` §5.4 `cs_orchestrator` role block:
  - CAN SELECT: replaced `organisation_members` (renamed to `org_memberships` in migration `20260429000001_rbac_memberships.sql`); added `accounts`, `account_memberships`, `plans`, `tracker_signatures`, `invitations`. `plans` and `tracker_signatures` were granted in migrations `20260803000009` and `20260803000010` respectively during the ADR-0058 / ADR-1013 close-out.
  - CAN UPDATE: replaced the stale `organisations.plan/plan_started_at/razorpay fields` line with `accounts.plan_code/status/razorpay fields`. Post ADR-0044 the subscription lives on `accounts`, not `organisations`.
  - CANNOT clause: added the membership-lifecycle DELETE carve-out (invitations / account_memberships / org_memberships via RPCs) so "cannot delete any row" is no longer overstated.

### Tested
- n/a (doc-only). Accuracy cross-checked against `supabase/migrations/**` grants (`20260413000010`, `20260428000002`, `20260429000001`, `20260430000001`, `20260803000009`, `20260803000010`) and against the schema doc §5.1 full GRANT list.

## [ADR-1013 CLOSED — Phase 2 Sprint 2.2 + status flip] — 2026-04-21

**ADR:** ADR-1013 — `cs_orchestrator` direct-Postgres migration (Next.js runtime) **(COMPLETED)**

### Changed
- `docs/ADRs/ADR-1013-cs-orchestrator-direct-postgres.md` — top-line status flipped to **Completed** (date completed 2026-04-21). Sprint 2.2 deliverables + Tested block populated. Acceptance-criteria line reformatted from "except run-probes, deferred" to "verified via grep — zero hits". New close-out paragraph under the Phase 2 block summarising the final state: Next.js runtime fully off HS256, `CS_ORCHESTRATOR_ROLE_KEY` only referenced now by Edge Functions and the §12 env table.
- `docs/ADRs/ADR-index.md` — ADR-1013 row flipped to **Completed**; description rewritten to list all six migrated callers.
- `CLAUDE.md` Rule 5 — removed the "run-probes still on JWT pending Sprint 2.2" carve-out. New text: "Next.js runtime is fully off HS256 (all six callers — signup-intake, invitation-dispatch, dispatch helper, lookup-invitation, internal/invites, run-probes — use csOrchestrator() or csApi())".
- `docs/architecture/consentshield-definitive-architecture.md` §5.4 — cs_orchestrator Next.js runtime sub-bullet updated to list all six callers; dropped the "run-probes still uses JWT pending its own migration" sentence.
- `docs/architecture/consentshield-definitive-architecture.md` §12 — `SUPABASE_ORCHESTRATOR_ROLE_KEY` comment narrowed from "Edge Functions + (legacy) /api/internal/run-probes" to "Edge Functions only (Next.js runtime is on direct-Postgres after ADR-1013)".

### Tested
- `grep -rln CS_ORCHESTRATOR_ROLE_KEY app/src` — zero code hits, one comment hit (run-probes header explaining the migration).

## [ADR-1013 Sprint 2.1 — doc sync + Rule 5 update] — 2026-04-21

**ADR:** ADR-1013 — `cs_orchestrator` direct-Postgres migration (Next.js runtime)

### Changed
- `docs/architecture/consentshield-definitive-architecture.md` §5.4 — the `cs_orchestrator` role block now splits Edge-Function (hosted Supabase pool, HS256 JWT while the legacy signing path is alive) vs. Next.js-runtime (direct Supavisor pooler, `postgres.js` singleton) connection patterns explicitly. Names the env var `SUPABASE_CS_ORCHESTRATOR_DATABASE_URL` and lists the five migrated routes. The role's permissions summary is unchanged — connection topology is the only delta.
- `docs/architecture/consentshield-definitive-architecture.md` §12 Environment Variables — env block gained `SUPABASE_CS_API_DATABASE_URL` (ADR-1009) and `SUPABASE_CS_ORCHESTRATOR_DATABASE_URL` (ADR-1013) alongside the legacy `SUPABASE_ORCHESTRATOR_ROLE_KEY` (now flagged as "Edge Functions + (legacy) /api/internal/run-probes"). Closing paragraph updated: both Next.js runtime roles now LOGIN + direct-Postgres; HS256 JWT retained only by Edge Functions and the Worker.
- `CLAUDE.md` Rule 5 — rewritten to describe the Next.js direct-Postgres pattern for both `cs_api` and `cs_orchestrator`, call out `/api/internal/run-probes` as the last Next.js JWT-path caller pending Sprint 2.2, and retain the Edge-Function + Worker JWT exceptions. ADR-0045 admin carve-out text preserved verbatim.
- `docs/ADRs/ADR-1013-cs-orchestrator-direct-postgres.md` — Sprint 2.1 deliverables flipped to `[x]` (lookup-invitation + invites migrated + architecture doc + Rule 5 synced). Sprint 2.2 added for run-probes (deferred). Acceptance-criteria line amended to reflect the run-probes exception. Struck through the `check-env-isolation.ts expected-keys` deliverable — the original description was off; that script is a forbidden-name check, not an expected-keys whitelist.
- `docs/ADRs/ADR-index.md` — ADR-1013 row description expanded to summarise Phase 1 + Sprint 2.1 delivery. Status stays **In Progress** until Sprint 2.2 lands.

### Tested
- No code changes in this entry. Build + lint clean on `app/` after the accompanying Sprint 2.1 caller migrations (see CHANGELOG-api.md for that pair).

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
