# ADR-1005: Operations Maturity — Webhook Reference, Support Model, Status Page, Multi-channel Alerts, Public Rights API

**Status:** In Progress
**Date proposed:** 2026-04-19
**Date completed:** —
**Related plan:** `docs/plans/ConsentShield-V2-Whitepaper-Closure-Plan.md` Phase 5
**Depends on:** ADR-1001 (API keys), ADR-1002 (deletion API), ADR-1003 (processing-mode clarity)
**Related gaps:** G-011, G-035, G-013, G-014, G-015, G-049, G-043

---

## Context

By the end of ADR-1004, the data-plane and compliance-surface promises are executable. This ADR closes the operational gap — the set of things a BFSI procurement team checks that are not about the API surface but about whether the supplier can carry the customer's compliance reputation.

The whitepaper claims: a generic webhook protocol with a reference partner (§6.3, §13 FAQ); a `test_delete` endpoint for smoke-testing integrations (§12.3); an SLA per tier, severity matrix, and on-call rotation (§13 implicit, §14); a public status page (expected by BFSI procurement even though not named in the whitepaper); rights requests capturable from any channel (§11, Appendix A); and non-email notification channels (§7 Surface 4).

Verification confirmed: the webhook protocol is specified and deletion-receipt callbacks work, but no reference partner has exercised the full round-trip. The `test_delete` endpoint is unbuilt. No SLA, severity matrix, or on-call rotation is documented. No status page exists. The public rights-request API is absent (public portal form exists; `/v1/rights/requests` does not). Only Resend email delivery is wired; Slack, Teams, Discord, PagerDuty, and custom-webhook adapters are unbuilt despite the `notification_channels` schema supporting them.

Without closing these, the first BFSI Enterprise customer's procurement security review finds operational-maturity gaps. With them closed, the same review finds an operator ready for production.

## Decision

Deliver seven operational-maturity outcomes:

1. **Webhook reference partner (G-011)** — onboard one friendly partner (external fintech, non-customer internal system, or an internal sample backend) to exercise the full protocol end-to-end in production-like conditions. Capture an anonymised case study for BFSI sales.
2. **`test_delete` endpoint (G-035)** — public `POST /v1/integrations/{connector_id}/test_delete` that issues a signed no-op deletion instruction to the customer's webhook endpoint, allowing the customer to verify their handler.
3. **SE capacity (G-013)** — decide and execute hire-vs-contract; identify two named contractors with BFSI integration experience; document the sales-to-integration handoff process.
4. **Support model (G-014)** — written SLA per tier, severity matrix, on-call schedule, incident communications, post-incident process, PagerDuty tooling, BFSI Enterprise contract SLA schedule.
5. **Status page (G-015)** — `status.consentshield.in` tracking six subsystems with automated 5-minute probes, sub-2-minute incident posting, subscriber notifications, 90-day history.
6. **Public rights-request API (G-049)** — `POST /v1/rights/requests` (bypasses Turnstile but requires `identity_verified_by` attestation) and `GET /v1/rights/requests`.
7. **Non-email notification channels (G-043)** — Slack, Teams, Discord, PagerDuty (Events API v2), custom webhook (signed) adapters; per-severity routing configuration.

## Consequences

- The BFSI Enterprise procurement review passes on operational maturity. Every reasonable question (SLA, incident process, status history, support channels) has a documented, demonstrable answer.
- Rights-request capture works from every customer channel — call-centre agents, mobile app, branch, third-party support platforms — not only via the public portal.
- The orphan alert from ADR-1004 Sprint 3.1 reaches the operator through whichever channel they prefer (most BFSI customers: PagerDuty for critical, Slack for summaries).
- Webhook integration onboarding for future BFSI customers has a documented reference case to point to, de-risking their internal security-review.
- SE capacity becomes the rate-limiter. BFSI pipeline cap of 2 simultaneous integrations stays until G-013 closes; contract negotiations should reference this cap honestly.

---

## Implementation Plan

### Phase 1: Webhook reference implementation (G-011)

**Scope clarification (2026-04-22).** Phase 1 as originally drafted conflated two independent concerns:

1. **Software validation of the webhook protocol** — retry timing, overdue path, HMAC roundtrip, callback signature verification. This is software work and is NOT gated on any external GTM partner. It's covered by the existing `tests/integration/webhook-*.test.ts` suites + a mock-partner harness (below).
2. **Marketing asset / BFSI procurement reference** — a named external customer (or internal sample backend) that has exercised the protocol in production-like conditions, with a published case study. This is commercial / GTM work and IS gated on partner engagement.

Phase 1 sprints 1.1 / 1.2 as written conflate both. Amended: software validation happens now via an in-repo mock partner; the GTM case study stays scoped to Phase 1 but does not block any other phase of this ADR, and explicitly does not block Phase 2 (test_delete — the endpoint serves customer self-validation, which is independent of whether WE have a reference partner).

**Software-validation deliverables (moved out of Phase 1 sprint gates):**
- `tests/e2e/webhook-mock-partner.spec.ts` — an in-repo mock partner (Miniflare or a scratch Vercel project) that echoes the retry + overdue paths. Runs as part of the E2E evidence suite. Satisfies the "retry behaviour validated" / "overdue path validated" / "HMAC mismatch rejected" tests without needing an external counterparty.
- Tracked under ADR-1014 / ADR-1015 E2E infrastructure (Terminal A's track); this ADR no longer re-scopes those tests under Phase 1.

**Marketing-asset deliverables (what actually remains external):**
- One named partner (external fintech or internal sample backend) that has exercised ≥ 100 real deletion instructions.
- Anonymised case study at `docs/case-studies/webhook-reference-2026-Q2.md`.

Phase 1 sprints below are the MARKETING-asset scope. When a partner lands, this ADR adds their evidence + closes. Until then, Phase 1 stays `[~] awaiting partner` — non-blocking for any other phase of this ADR or any downstream ADR.


#### Sprint 1.1: Partner engagement + protocol walkthrough

**Estimated effort:** 1 week elapsed (mostly external)

**Deliverables:**
- [ ] One friendly partner identified (preferred: a Hyderabad fintech without a ConsentShield contract; fallback: an internal sample backend deployed in a separate Vercel project)
- [ ] Partner receives the protocol spec + HMAC shared-secret bootstrap
- [ ] Partner implements: HMAC verify on receive, deletion execution in their sandbox data store, signed callback with `completed | partial | failed | deferred` status
- [ ] Dry-run on staging: ConsentShield issues 10 test deletions; partner confirms all

**Testing plan:**
- [ ] Staging end-to-end: 10 deletions, all confirmed, audit chain intact
- [ ] Signature mismatch rejected by partner's endpoint
- [ ] Callback URL signature verified by ConsentShield on return

**Status:** `[ ] planned`

#### Sprint 1.2: Production exercise + case study

**Estimated effort:** 1 week

**Deliverables:**
- [ ] ≥ 100 deletion instructions issued to the partner under production-like conditions
- [ ] Retry behaviour validated: partner returns 500 to first 3 attempts, success on 4th; ConsentShield's backoff is observed (1h → 6h → 24h per ADR-0011)
- [ ] Overdue path validated: partner fails permanently; receipt transitions to `overdue`; alert fires
- [ ] Case study written (anonymised if partner requires): `docs/case-studies/webhook-reference-2026-Q2.md`
- [ ] Whitepaper §6.3 amended with lessons learned if any (CC-F)

**Testing plan:**
- [ ] Production exercise results captured in the case study
- [ ] `tests/integration/webhook-reference.test.ts` exercises the retry + overdue paths against the staging partner

**Status:** `[ ] planned`

### Phase 2: `test_delete` endpoint (G-035)

**No longer gated on Phase 1** (per 2026-04-22 scope clarification). `test_delete` lets the customer's own webhook handler validate itself; the customer is the counterparty, not a ConsentShield-engaged partner. Can ship independently.


#### Sprint 2.1: Public test endpoint — **complete 2026-04-22**

**Estimated effort:** 2 days (shipped in ~1h against existing cs_api scaffolding)

**Deliverables:**
- [x] `POST /api/v1/integrations/{connector_id}/test_delete` — v1 cs_api surface; scope `write:deletion`; path param `connector_id`.
- [x] `rpc_test_delete_trigger(p_key_id, p_org_id, p_connector_id)` — fenced by `assert_api_key_binding`; verifies connector belongs to caller's org; enforces 10-calls-per-connector-per-hour rate limit; synthesises `cs_test_principal_<uuid>` identifier; writes a `deletion_receipts` row with `trigger_type='test_delete'` and `request_payload.is_test=true`.
- [x] Test rows carry `artefact_id=NULL` + `trigger_id=NULL` → `compute_depa_score` (which left-joins on `artefact_id`) naturally excludes them from compliance aggregation. No schema-level `metadata.is_test` column needed.
- [x] `cs_api` surface 22 → 23 RPCs; grants in migration `20260804000022`.
- [x] OpenAPI path + `TestDeleteResponse` schema + docs comment in CLAUDE.md Rule 5 + `consentshield-definitive-architecture.md §5.4`.

**Testing plan:**
- [x] `tests/integration/test-delete-api.test.ts` — 6 assertions: happy-path receipt shape + DB row assertions (`trigger_type`, `request_payload.is_test`, `artefact_id=null`); cross-org connector → `connector_not_found`; inactive connector → `connector_inactive`; unknown id → `connector_not_found`; api_key-binding mismatch → `api_key_binding`; 11th call in hour → `rate_limit_exceeded`. All 6 PASS (11.8s).

**Status:** `[x] complete`

**Deferred to follow-up:** customer-facing markdown doc in `docs/customer-integrations/` showing the handler `reason==='test'` branch. The OpenAPI description already carries the behaviour spec; a richer cookbook belongs to ADR-1015 (developer docs) — added as a task there.

### Phase 3: Support model (G-014) + SE capacity (G-013)

#### Sprint 3.1: SLA + severity matrix documentation

**Estimated effort:** 1 day

**Deliverables:**
- [ ] `docs/support/sla.md`: per-tier uptime + response + resolution + maintenance window commitments (99.5% Starter, 99.9% Pro/BFSI Growth, 99.95% BFSI Enterprise/Healthcare)
- [ ] `docs/support/severity-matrix.md`: SEV1 data loss → 30 min; SEV2 feature outage → 2 hr; SEV3 cosmetic → next business day
- [ ] BFSI Enterprise contract template updated to include SLA as Schedule B
- [ ] Post-incident process: written report within 5 business days for SEV1/SEV2

**Testing plan:**
- [ ] Docs reviewed end-to-end for internal consistency
- [ ] Contract template has Schedule B populated and ready for a customer

**Status:** `[ ] planned`

#### Sprint 3.2: Incident communications tooling

**Estimated effort:** 3 days

**Deliverables:**
- [ ] PagerDuty (or equivalent) account provisioned
- [ ] Primary on-call rotation defined (founder for Indian business hours; contractor for nights/weekends)
- [ ] Incident creation hotkey on operator dashboard → routes to PagerDuty + status page
- [ ] Post-incident template at `docs/templates/post-incident-report.md`
- [ ] Customer Slack-bridge playbook (opt-in per BFSI Enterprise customer)

**Testing plan:**
- [ ] Dry-run incident: page fires to on-call phone, status page posts, customer subscriber receives email — all within 2 minutes

**Status:** `[ ] planned`

#### Sprint 3.3: SE capacity decision + handoff process (G-013)

**Estimated effort:** Variable (mostly organisational)

**Deliverables:**
- [ ] Decision documented: hire full-time SE vs contract per-engagement
- [ ] If contract: ≥ 2 named contractors identified with BFSI integration experience; rate cards agreed
- [ ] If hire: job spec written, search underway, target start date set
- [ ] Sales-to-integration handoff process at `docs/sales/se-handoff.md`: required artefacts (Purpose Definition Registry scope, processing mode decision, connector inventory, data-inventory answers)
- [ ] BFSI pipeline cap: 2 simultaneous integrations until SE online; sales operations informed

**Testing plan:**
- [ ] Process reviewed against the reference case study (Phase 1 partner onboarding) to confirm handoff artefacts are sufficient

**Status:** `[ ] planned`

### Phase 4: Status page (G-015)

#### Sprint 4.1: Status page setup

**Estimated effort:** 3 days

**Deliverables:**
- [ ] `status.consentshield.in` provisioned (StatusPage.io preferred; fallback: self-hosted Cachet on a Vercel project)
- [ ] Subsystems: Banner CDN, Consent Capture API (Worker), Verification API, Deletion Orchestration, Dashboard, Notification Channels
- [ ] Linked from main site footer, customer dashboard, admin console

**Testing plan:**
- [ ] Manual status-post dry-run visible at `status.consentshield.in`

**Status:** `[ ] planned`

#### Sprint 4.2: Uptime probe automation

**Estimated effort:** 2 days

**Deliverables:**
- [ ] Automated probes every 5 min from two regions
- [ ] 90-day uptime history retained
- [ ] Subscriber management: customers can subscribe by email or webhook
- [ ] Latency data from G-027 (ADR-1008) feeds in later (not blocking this sprint)

**Testing plan:**
- [ ] Probe induces a 5xx on staging → status page reflects within 5 min
- [ ] Subscriber receives email within 2 min of incident posting

**Status:** `[ ] planned`

### Phase 5: Public rights-request API (G-049)

#### Sprint 5.1: `/v1/rights/requests`

**Estimated effort:** 2 days

**Deliverables:**
- [x] `GET /v1/rights/requests` paged + filtered (status, request_type, captured_via, created_after/before). Keyset cursor matches `rpc_event_list` format.
- [x] `POST /v1/rights/requests` body: `{ type, requestor_name, requestor_email, request_details?, identity_verified_by, captured_via? }` — bypasses Turnstile+OTP since API key holder attests verification; sets `identity_verified=true`, `identity_verified_at=now()`, `identity_method=<attestation>`, `captured_via=api` (default) or caller-supplied operator channel (`branch`/`kiosk`/`call_center`/`mobile_app`/`email`/`other`), `created_by_api_key_id=p_key_id`.
- [x] Separate audit-log trail marking API-created requests (for DPB audit filtering) — every POST inserts a `rights_request_events` row with `event_type='created_via_api'` and a `metadata` jsonb carrying `api_key_id`, `identity_verified_by`, `captured_via`.
- [x] Scopes: `read:rights`, `write:rights` (already in `api_keys_scopes_valid`).

**Schema additions (additive):**
- `rights_requests.captured_via` text NOT NULL DEFAULT 'portal' — origin of the request. CHECK constraint covers portal / api / kiosk / branch / call_center / mobile_app / email / other.
- `rights_requests.created_by_api_key_id` uuid NULL REFERENCES api_keys(id) ON DELETE SET NULL — audit attribution for API-created requests. ON DELETE SET NULL so key deletion never breaks the audit chain.
- Two indexes: `(org_id, captured_via, created_at desc)` for filtered list queries; partial `(created_by_api_key_id) WHERE NOT NULL` for key-attribution lookups.

**Migrations shipped:**
- `20260804000001_rights_requests_captured_via.sql` — columns + CHECK + indexes.
- `20260804000002_v1_rights_api_rpcs.sql` — `rpc_rights_request_create_api(p_key_id, p_org_id, p_request_type, p_requestor_name, p_requestor_email, p_request_details, p_identity_verified_by, p_captured_via)` + `rpc_rights_request_list(p_key_id, p_org_id, p_status, p_request_type, p_created_after, p_created_before, p_captured_via, p_cursor, p_limit)`. Both SECURITY DEFINER; both fenced by `assert_api_key_binding`.
- `20260804000003_cs_api_rights_grants.sql` — EXECUTE to cs_api on both.

**Testing plan:**
- [x] POST creates a rights_request row indistinguishable in lifecycle from portal-initiated requests (same `rights_requests` table, same `status='new'`, same SLA default).
- [x] Audit trail clearly marks the captured-via channel — `rights_request_events.event_type='created_via_api'` + `metadata.captured_via`.
- [x] Missing `identity_verified_by` → 422 (`identity_verified_by_missing`).
- [x] Invalid request_type → 422 (`invalid_request_type`).
- [x] Invalid requestor_email → 422 (`invalid_requestor_email`).
- [x] Cross-org fence — key bound to otherOrg cannot create in org (`api_key_binding` → 403).
- [x] Caller-supplied captured_via=branch honoured.
- [x] `created_by_api_key_id` is stamped correctly on the row.
- [x] List filters by status / request_type / captured_via respected.
- [x] Bad cursor → 422 (`bad_cursor`).
- [x] 17/17 `rights-api.test.ts` PASS; 146/146 full integration PASS.

**Status:** `[x] complete` — 2026-04-22

### Phase 6: Non-email notification channels (G-043)

#### Sprint 6.1: Adapter interface

**Estimated effort:** 1 day

**Deliverables:**
- [x] `app/src/lib/notifications/adapters/types.ts` — `NotificationAdapter` interface (`type: ChannelType`, `validateConfig(channel): void`, `deliver(channel, event): Promise<DeliveryResult>`), `NotificationEvent` envelope (kind, severity, subject, body, occurred_at, org_id, context, idempotency_key), `NotificationChannel` row type, `DeliveryResult` discriminated union (`ok:true` carries `external_id` + `latency_ms`; `ok:false` carries `retryable` + `error` + `status_code?` + `latency_ms`), `AdapterConfigError` + `UnknownAdapterError` classes.
- [x] `app/src/lib/notifications/adapters/retry.ts` — `withRetry(attempt, config)` returning `RetryEnvelope { final, attempts[] }`. Defaults to 3 attempts, 200ms/600ms backoff. Stops immediately on non-retryable failures. Supports injectable `sleep` for tests. Validates that `backoffMs.length === maxAttempts - 1` at call time.
- [x] `app/src/lib/notifications/adapters/registry.ts` — module-singleton `Map<ChannelType, NotificationAdapter>` with `registerAdapter / unregisterAdapter / getAdapter / registeredTypes / resetRegistry`. Throws `UnknownAdapterError` when no adapter is registered for a channel_type.
- [x] `app/src/lib/notifications/adapters/mock.ts` — test-only mock adapter with an `calls` inbox + `setNextResult()` scripting queue for exercising retry / success flows.
- [x] `app/src/lib/notifications/dispatch.ts` — `dispatchEvent(event, channels, options)` filters `channels` (active + matching org_id + `alert_types ∋ event.kind`), routes each to the registered adapter through `withRetry`, and returns a `DispatchReport { event_kind, event_severity, org_id, total_channels, succeeded, failed, outcomes[] }`. Never throws on delivery failure; throws only on config mistakes (`AdapterConfigError` surfaces synchronously) or missing adapter registry entry.

**Testing plan:**
- [x] `app/tests/notifications/retry.test.ts` — 7 PASS: first-attempt success; non-retryable short-circuit; 3-attempt retry loop; retry success; config mismatch rejection; backoff order; no-sleep-after-final.
- [x] `app/tests/notifications/registry.test.ts` — 5 PASS: register/get/unregister/list/replace.
- [x] `app/tests/notifications/dispatch.test.ts` — 8 PASS: happy path × N channels; inactive/alert_types/org_id filters; config-error folded into report; retry aggregates attempts; non-retryable respected; latency totals.

**Status:** `[x] complete` — 2026-04-22. 20/20 unit tests PASS. Zero runtime dependencies (no new npm packages). Phase 6 Sprints 6.2 (Slack/Teams/Discord) + 6.3 (PagerDuty/custom webhook) + 6.4 (dashboard UI) remain.

#### Sprint 6.2: Slack + Teams + Discord adapters

**Estimated effort:** 2 days

**Deliverables:**
- [ ] Slack adapter (incoming webhook format)
- [ ] Microsoft Teams adapter (Adaptive Card format)
- [ ] Discord adapter (webhook format)
- [ ] Config schema for each in `notification_channels.config` jsonb

**Testing plan:**
- [ ] Live delivery to a test Slack, Teams, and Discord workspace

**Status:** `[ ] planned`

#### Sprint 6.3: PagerDuty + custom webhook adapters

**Estimated effort:** 2 days

**Deliverables:**
- [ ] PagerDuty adapter using Events API v2 (routing key, dedup key, severity)
- [ ] Custom webhook adapter signs body with channel's shared secret; retry policy documented
- [ ] Severity-to-channel mapping per §7 (critical → PagerDuty, daily → Slack, etc.)

**Testing plan:**
- [ ] Live PagerDuty incident triggered + acknowledged
- [ ] Custom webhook signature verified end-to-end

**Status:** `[ ] planned`

#### Sprint 6.4: Dashboard UI + test-send

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `/dashboard/settings/notifications` per-channel config page
- [ ] Test-send button per channel
- [ ] Severity-mapping matrix editable per channel
- [ ] Per-alert-type toggles (orphan event → PagerDuty ✓, Slack ✓; daily summary → Slack ✓ only)

**Testing plan:**
- [ ] Configure all 5 channels; test-send from each succeeds
- [ ] Changing severity mapping routes subsequent alerts correctly

**Status:** `[ ] planned`

---

## Architecture Changes

- `docs/architecture/consentshield-definitive-architecture.md`: expand Surface 4 notification architecture with adapter pattern; add the test_delete protocol variant
- `docs/architecture/consentshield-complete-schema-design.md`: document `notification_channels.config` jsonb schema per adapter type
- `docs/support/*` — new directory for SLA, severity, incident process

_None yet._

---

## Test Results

_Empty until Sprint 1.1 runs._

---

## V2 Backlog (explicitly deferred)

- Additional notification adapters (Google Chat, email-list, SMS-paging) — deferred until customer demand.
- HMAC rotation mechanism for webhook secrets — G-032 in ADR-1008.
- Signed-request alternative to bearer for `/v1/*` — not planned.

---

## Changelog References

- `CHANGELOG-api.md` — Sprints 2.1, 5.1 (test_delete, rights API)
- `CHANGELOG-dashboard.md` — Sprint 6.4 (notification settings)
- `CHANGELOG-infra.md` — Sprints 3.2, 4.1, 4.2 (PagerDuty, status page)
- `CHANGELOG-docs.md` — Sprints 1.2, 3.1, 3.3 (case study, SLA docs, SE handoff)
