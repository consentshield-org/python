# ConsentShield — Complete Feature Inventory
(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Generated:** 2026-04-18
**Status:** Phase 0–2 Complete; Phase 2.1–2.2 In Progress; Phase 3+ Deferred

---

## Table of Contents
1. [Completed Features (ADR Status: Completed)](#completed-features)
2. [In-Progress Features (ADR Status: Proposed/In Progress)](#in-progress-features)
3. [Out-of-Scope (Handled in ADRs)](#out-of-scope-handled)
4. [Out-of-Scope (V2 Backlog — Deferred)](#out-of-scope-v2-backlog)

---

## Completed Features

### Phase 1: Foundation (ADRs 0001–0018)

#### ADR-0001: Project Scaffolding ✓ COMPLETED
**Features:**
- Next.js 16 app shell with TypeScript, Tailwind, shadcn/ui
- Supabase schema: 14 operational tables + 10 buffer tables + Phase 3 reference tables
- RLS policies on all tables; multi-tenant isolation
- Scoped database roles: `cs_worker`, `cs_delivery`, `cs_orchestrator`
- Auth flow: Supabase Auth + custom JWT claims (org_id, org_role)
- Org bootstrap on signup
- All 11 schema verification queries passing
- Cloudflare Worker skeleton (routing, HMAC utilities)
- Trigger-based SLA/breach deadline computation
- pg_cron jobs: buffer sweep, stuck-buffer detection, SLA reminders, security scan, retention check

**Out of Scope (Handled Elsewhere):**
- Scoped-role enforcement over REST (→ ADR-0009)
- Browser auth hardening (→ ADR-0008)

---

#### ADR-0002: Worker HMAC Verification + Origin Validation ✓ COMPLETED
**Features:**
- POST /worker/v1/events — HMAC-SHA256 verification + ±5min timestamp check
- POST /worker/v1/observations — same HMAC + timestamp guard
- Origin header validation against org's `allowed_origins`
- Failed signature → 403 without writing
- Failed origin → flag as `origin_unverified` in payload
- Signature rotation: `previous_event_signing_secret` column support

**Out of Scope:**
- Client-side signing logic (→ ADR-0008: removed entirely)
- Origin enforcement for connectors (→ future ADR)

---

#### ADR-0003: Consent Banner Builder + Compliance Dashboard ✓ COMPLETED
**Features:**
- **Banner Builder:**
  - Web property CRUD (URL, allowed_origins configuration)
  - Banner builder UI: headline, body, position (bottom-bar/modal/left/right)
  - Purpose management (name, description, required flag, default state)
  - Live preview panel
  - Draft/publish workflow with versioning
  - Auto-rotation of `event_signing_secret` on publish
  - KV cache invalidation for banner config + secret

- **Banner Script Compilation:**
  - Self-contained vanilla JS (~26KB)
  - Captures consent decisions
  - HMAC signature computation
  - POST to /v1/events
  - localStorage persistence (don't show again)
  - Automatic dismissal

- **Compliance Dashboard:**
  - Dashboard layout: sidebar nav + main content area
  - Compliance score (banner deployed, consent flowing, inventory complete)
  - Recent consent events feed (last 24h from buffer)
  - Enforcement clock (days until DPDP enforcement)
  - Quick stats: total consents today, active properties, pending rights requests

- **Data Inventory + Privacy Notice:**
  - Data inventory CRUD
  - Auto-seed from tracker observations (`source_type='auto_detected'`)
  - Privacy notice generator (guided wizard)
  - Public privacy notice page at /privacy/[orgId]
  - PDF download of privacy notice

**Out of Scope:**
- Custom banner CSS (→ v2: theme builder)
- Multi-language banner UI (→ v2: localization engine)
- Banner analytics dashboard (→ v2: events detailed analysis)

---

#### ADR-0004: Rights Request Workflow ✓ COMPLETED
**Features:**
- **Public Rights Request Form:**
  - /rights/[orgId] — no auth required
  - Cloudflare Turnstile verification on submit
  - 6-digit OTP generation + email send via Resend
  - Rate limit: 5/IP/hour

- **Email OTP Verification:**
  - POST /api/public/rights-request/verify-otp
  - email_verified_at timestamp on success
  - Compliance contact notification after verification
  - Lockout after 5 wrong attempts
  - 15-minute OTP TTL
  - Auto-cleanup of unverified rows > 24h

- **Dashboard Rights Inbox:**
  - /dashboard/rights — list with filters (new, in_progress, completed)
  - SLA countdown per row
  - /dashboard/rights/[id] — detail view with workflow steps
  - Status transitions (assignee, identity verification, response drafting, closure)
  - Audit trail in `rights_request_events`
  - RLS: org-scoped visibility

- **SLA Reminders:**
  - Edge Function `send-sla-reminders` (pg_cron scheduled)
  - 7-day and 1-day reminders before deadline
  - Auto-set SLA deadline (30 days from creation)

**Out of Scope:**
- Multi-language rights request form (→ v2)
- Rights portal customization (colors, logos) (→ v2)
- Automatic rights fulfilment (→ v2: workflow automation)

---

#### ADR-0005: Tracker Monitoring ✓ COMPLETED
**Features:**
- Banner script v2 with MutationObserver
- Script-tag detection on customer's site
- Tracker classification: known trackers (GA4, FB Pixel, etc.) vs unknown
- Automatic observation logging to `tracker_observations` buffer
- Auto-seed data inventory from `source_type='auto_detected'` observations

**Out of Scope:**
- Advanced tracking pattern detection (→ v2: ML-based heuristics)
- Browser extension for manual scanner (→ mobile phase)

---

#### ADR-0006: Razorpay Billing + Plan Gating ✓ COMPLETED
**Features:**
- Razorpay integration (keys, webhook secret, plan IDs)
- Billing checkout flow (POST /api/orgs/[orgId]/billing/checkout)
- Plan gating: limits on banners, web properties, rights requests, connectors, storage
- Webhook signature verification for `payment.authorized` / `subscription.charged`
- Subscription status tracking
- Trial plan support (30-day default)
- Plan-based soft suspend when downgrading (status → `suspended_by_plan`)

**Out of Scope:**
- Per-org usage rollup dashboard (→ v2: billing metrics dashboard)
- Self-serve plan upgrades/downgrades (→ v2)
- Refund processing UI (→ ADR-0034: operator console only)
- Invoice generation (→ v2: GST compliance)

---

#### ADR-0007: Deletion Orchestration ✓ COMPLETED
**Features:**
- Generic webhook protocol for deletion callbacks
- Connector auth types: API key, OAuth token, custom secret
- Deletion dispatch to multiple connectors in parallel
- HMAC-signed callback URLs (`callback_url` + signature)
- Callback state machine: pending → delivered → confirmed / failed
- Audit trail in `deletion_receipts`
- RLS: org-scoped deletion isolation

**Out of Scope:**
- Pre-built Mailchimp/HubSpot connectors (→ ADR-0018)
- OAuth flow for connector auth (→ ADR-0039)
- Deletion retry/timeout (→ ADR-0011)

---

#### ADR-0008: Browser Auth Hardening ✓ COMPLETED
**Features:**
- Removed client-side signing secret entirely (only HMAC verification on Worker)
- Turnstile verification required before any buffer write
- `origin_verified` column in schema (tracks whether Origin header matched)
- Fail-fast Turnstile: missing/invalid token → 403 immediately
- Session fingerprinting prep (foundation for ADR-0037)

**Out of Scope:**
- MFA for dashboard login (→ v2)
- Session revocation (→ v2: audit-log-driven)

---

#### ADR-0009: Scoped-Role Enforcement in REST Paths ✓ COMPLETED
**Features:**
- Security-definer RPCs for public-surface buffer writes
- `rpc_buffer_write_consent_event` — INSERT into `consent_events` via `cs_worker` role
- `rpc_buffer_write_tracker_observation` — INSERT into `tracker_observations` via `cs_worker` role
- `rpc_rights_request_create` — public INSERT with Turnstile + rate-limit checks
- `rpc_audit_export_manifest` — authenticated export manifest assembly
- `rpc_signup_bootstrap_org` — first-org creation in signup flow
- All RPCs run as SECURITY DEFINER with minimal privilege
- No authenticated user can directly INSERT/UPDATE/DELETE buffer tables

**Out of Scope:**
- Worker-side role enforcement (Worker is stateless; HMAC is the guard)

---

#### ADR-0010: Distributed Rate Limiter ✓ COMPLETED
**Features:**
- Distributed rate limiting using Supabase PostgREST + Postgres
- Rate limit: /api/public/rights-request — 5/IP/hour
- Rate limit: /worker/v1/events — 100/property_id/hour
- IP-based bucketing with automatic expiry
- Sub-second latency via index on `(ip_bucket, window_start)`

**Out of Scope:**
- User-ID-based rate limits (→ v2: authenticated API keys)
- Per-org rate-limit configuration (→ v2: operator console)

---

#### ADR-0011: Deletion Retry and Timeout ✓ COMPLETED
**Features:**
- `deletion_retry_state` table tracking: callback_url, attempts, last_attempt_at, next_retry_at, status
- Hourly Edge Function: `check-stuck-deletions`
- Exponential backoff: 1h → 6h → 24h retries
- 48-hour hard timeout (mark stuck, notify operator)
- Idempotent retry logic (safe to re-invoke)
- Stuck deletion alerting (Edge Function → Supabase alerts / ops dashboard)

**Out of Scope:**
- Manual retry button in UI (→ ADR-0033: ops dashboard)
- Deletion webhook signature validation (→ ADR-0007: already signed)

---

#### ADR-0012: Automated Test Suites ✓ COMPLETED
**Features:**
- RLS isolation tests: multi-tenant cross-org verification on every table
- Worker integration tests: HMAC verification, origin validation, signature rotation
- Buffer lifecycle tests: delivered_at marking, DELETE restrictions
- SLA trigger tests: deadline computation under concurrent writes
- URL-path RLS tests: authenticated routes enforce org_id parameter matching
- Test framework: Vitest + Supabase client

**Out of Scope:**
- Load/stress testing (→ v2: perf optimization phase)
- End-to-end UI tests (→ v2: Playwright suite)

---

#### ADR-0013: Signup Bootstrap Hardening ✓ COMPLETED
**Features:**
- OTP-based signup (not magic link)
- OTP-based login for returning users
- Single `/auth/callback` post-auth landing path
- Idempotency guard: `ensureOrgBootstrap` helper prevents double-create
- First org auto-creation with default name (email prefix)
- Transaction-level consistency: auth signup + org creation atomic

**Out of Scope:**
- Google OAuth signup (phase 2)
- Email-change flow (v2)
- Social login (v2)

---

#### ADR-0014: External Service Activation ✓ COMPLETED
**Features:**
- Resend API integration (email sending for OTP, SLA reminders, support notifications)
- Turnstile integration (Cloudflare's CAPTCHA service)
- Razorpay integration (checkout, webhooks, subscription state)
- Env-var setup for all three services
- Error handling: failed external calls don't crash requests (degrade gracefully)

**Out of Scope (V2-X1, V2-X2):**
- Vercel Preview env vars for Turnstile/Razorpay (→ V2-X1: defer until multi-branch dev needed)
- E2E checkout UX smoke test (→ V2-X2: requires signed-in test account)

---

#### ADR-0015: Security Posture Scanner ✓ COMPLETED
**Features:**
- Edge Function `run-security-scans` (pg_cron scheduled, nightly)
- Scans: HTTPS compliance, CSP headers, X-Frame-Options, Turnstile presence
- Results logged to `security_scans` buffer table
- Dashboard "Security Posture" panel showing scan results
- Risk scoring: critical/warning/info per scan type

**Out of Scope:**
- Automated remediation (→ v2: workflow automation)
- Custom security rules (→ v2: policy engine)

---

#### ADR-0016: Consent Probes v1 ✓ COMPLETED
**Features:**
- Static HTML analysis of customer's pages
- Detects: banner presence, tracker scripts, cookies set
- Probe results logged to `consent_probe_runs` buffer
- Dashboard "Probes" panel with run history + latest results
- Hourly Edge Function runner
- Nightly aggregation to `compliance_metrics` snapshot

**Out of Scope (V2-P1, V2-P2):**
- Headless-browser probe runner (→ ADR-0041)
- Probe CRUD UI for customers to create custom probes (→ ADR-0041)

---

#### ADR-0017: Audit Export Package ✓ COMPLETED
**Features:**
- **Phase 1: Direct ZIP Download**
  - /api/orgs/[orgId]/audit-export — generates ZIP on-the-fly
  - CSV exports: consent events, rights requests, deletions, security scans, audit log
  - Metadata: org name, period, generated timestamp
  - RLS: org-scoped export (can't export peer orgs)
  - Compression: ZIP with DEFLATE

**Out of Scope (V2-X3):**
- Audit R2 upload pipeline (→ ADR-0040: deferred to v2)

---

#### ADR-0018: Pre-built Deletion Connectors ✓ COMPLETED
**Features:**
- Mailchimp connector: bulk-delete subscribers by email via API key
- HubSpot connector: delete contacts by email via API key
- Connector registry with config schema (API key placeholder, endpoints)
- Connector audit trail: which contacts deleted, when, by whom, status

**Out of Scope (V2-C1):**
- OAuth flow for connectors (→ ADR-0039)
- Custom connector builder UI (→ v2: developer portal)

---

### Phase 2: DEPA Roadmap (ADRs 0020–0025)

#### ADR-0020: DEPA Schema Skeleton ✓ COMPLETED
**Features:**
- 6 new operational tables:
  - `purpose_definitions` — org-scoped; per-sector purpose templates
  - `consent_artefacts` — per-consent immutable record (data + purposes + legal basis)
  - `artefact_revocations` — buffer table; tracks consent withdrawals
  - `consent_expiry_queue` — finite-expiry consent tracking
  - `depa_compliance_metrics` — nightly snapshot of DEPA compliance state
  - `purpose_connector_mappings` — artefact purposes → deletion targets

- 5 ALTER TABLE amendments to existing tables (org_id, artefact_id foreign keys, etc.)
- DEPA helper functions: `compute_depa_score`, `get_active_artefacts`, etc.
- RLS policies: org-scoped READ on purpose_definitions; operator READ-ALL on artefacts
- Scoped-role grants: cs_orchestrator can INSERT/UPDATE artefacts
- Shared TypeScript types: `PurposeDefinition`, `ConsentArtefact`, `ArtefactRevocation`, etc.
- 12 verification queries validating schema correctness

**Out of Scope:**
- Triggers that dispatch to Edge Functions (→ ADR-0021)
- Expiry helpers + cron (→ ADR-0023)

---

#### ADR-0021: process-consent-event Edge Function + Dispatch Trigger ✓ COMPLETED
**Features:**
- Edge Function `process-consent-event` (idempotent):
  - Reads `consent_events` row
  - Looks up `purpose_definitions` for the org
  - Creates one `consent_artefacts` row per purpose
  - Populates `consent_artefact_index` (for deletion dispatch)
  - Updates `consent_events.artefact_ids` array
  
- AFTER INSERT trigger `trg_consent_event_artefact_dispatch`:
  - Fires `net.http_post()` to `process-consent-event` Edge Function
  - Wrapped in EXCEPTION handler (failed dispatch doesn't roll back INSERT)

- Safety-net cron `consent-events-artefact-safety-net` (5-minute intervals):
  - Re-fires Edge Function for events missing artefact_ids
  - Idempotent: multiple invocations produce same output

**Out of Scope:**
- Artefact expiry enforcement (→ ADR-0023)
- Connector-side fanout (→ ADR-0022)

---

#### ADR-0022: process-artefact-revocation Edge Function + Cascade Triggers ✓ COMPLETED
**Features:**
- Edge Function `process-artefact-revocation` (idempotent):
  - Reads `artefact_revocations` (withdrawal) row
  - Fans out via `purpose_connector_mappings`
  - Creates deletion requests for each mapped connector
  - Marks revocation as processed

- In-database cascade triggers:
  - BEFORE INSERT on `artefact_revocations`: validates org membership
  - AFTER INSERT: status update, index invalidation, audit-log append, expiry superseding

- Out-of-database dispatch trigger:
  - Fires `net.http_post()` to `process-artefact-revocation` Edge Function

**Out of Scope:**
- Webhook callback for external revocation sources (→ v2: BFSI integration)

---

#### ADR-0023: DEPA Expiry Pipeline ✓ COMPLETED
**Features:**
- `send_expiry_alerts()` helper: finds artefacts with `expires_at - 7 days` approaching
- `enforce_artefact_expiry()` helper: marks expired artefacts, triggers revocation
- AFTER INSERT trigger `trg_consent_artefact_expiry_queue` (on finite-expiry artefacts)
- Two pg_cron jobs:
  - `expiry-alerts-daily`: 6 AM IST — send 7-day warning emails to compliance contact
  - `expiry-enforcement-daily`: 6 AM IST — auto-revoke & fan-out to connectors for expired

**Out of Scope:**
- Customer-facing expiry notification (→ v2: customer email)
- Expiry deferral workflow (→ v2: extension request UI)

---

#### ADR-0024: DEPA Customer UI Rollup ✓ COMPLETED
**Features:**
- **Purpose Definitions Panel** (`/dashboard/purposes`):
  - List purpose definitions for the org
  - CRUD operations (create, edit, toggle active/inactive)
  - Purpose name, description, legal basis

- **Consent Artefacts Panel** (`/dashboard/artefacts`):
  - List consent artefacts for the org
  - Filters: status (active/withdrawn), purpose, date range
  - Artefact detail view: full consent record, purposes, legal basis
  - Revocation button (bulk or single)

- **Dashboard Tile:**
  - DEPA compliance status (% active consents, expiries pending)

- **Rights Request Reshape:**
  - Include artefact_ids in rights request detail
  - Scope deletion to matching artefacts (not all consents)

- **Settings Row:**
  - Default expiry duration config per org
  - Notification preferences (7-day alerts, etc.)

**Out of Scope:**
- Template galleries (→ v2: sector-specific purpose templates shipped pre-populated)

---

#### ADR-0025: DEPA Score Dimension ✓ COMPLETED
**Features:**
- `compute_depa_score(p_org_id)` helper (SQL):
  - Inputs: active artefacts, consents per purpose, pending revocations
  - Score components: consent-collection completeness, expiry compliance, revocation timeliness
  - Range: 0–100
  - Formula: arithmetic mean of sub-scores

- Nightly refresh via pg_cron `depa-score-refresh-nightly`
- API endpoint `/api/orgs/[orgId]/depa-score` — returns current score + timestamp
- Dashboard gauge: DEPA compliance score visualized

**Out of Scope:**
- Per-purpose scoring breakdown (→ v2: insights dashboard)
- Anomaly detection (score drops unexpectedly) (→ v2: alerting engine)

---

### Phase 2+: Admin Platform & Operations (ADRs 0026–0044)

#### ADR-0026: Monorepo Restructure ✓ COMPLETED (Phases 0–4.1)
**Features:**
- Bun workspace configuration with `app/`, `admin/`, `worker/`, `packages/*`, `supabase/`, `docs/`
- Shared packages:
  - `packages/shared-types` — DEPA types, compliance enums
  - `packages/compliance` — score computation, compliance helpers
  - `packages/encryption` — per-org key derivation (stub for now)
- Cross-import guards (Bash scripts):
  - `check-no-customer-imports-in-admin.ts`
  - `check-no-admin-imports-in-app.ts`
  - `check-env-isolation.ts`
- Monorepo isolation test (GitHub Actions)
- Per-workspace build/lint/test commands

**Out of Scope:**
- Worker as workspace (stays root-level) (→ v2: once Worker framework matures)

---

#### ADR-0027: Admin Platform Schema ✓ COMPLETED
**Features:**
- `cs_admin` scoped database role (BYPASSRLS on SELECT, no direct writes)
- 11 admin tables:
  - `admin_users` — operator account records
  - `admin_audit_log` — immutable append-only, partitioned by year
  - `impersonation_sessions` — operator → customer context switch
  - `sectoral_templates` — pre-built compliance templates per sector (Banking, Healthcare, E-commerce)
  - `connector_catalogue` — pre-built deletion connectors (Mailchimp, HubSpot, custom)
  - `tracker_signature_catalogue` — known-tracker signatures
  - `support_tickets` — operator-facing support queue
  - `org_notes` — operator annotations on orgs (contract details, special requests)
  - `feature_flags` — runtime feature toggles
  - `kill_switches` — emergency circuit breakers (e.g., disable banner serving)
  - `platform_metrics_daily` — nightly metrics snapshot

- Security-definer RPCs with audit-log tracing:
  - All writes execute in same txn as audit-log append
  - RPC name, caller, timestamp, affected rows logged

- Admin-only SELECT RLS policies on public tables (customer data)

**Out of Scope:**
- Historical audit retention > 1 year (→ v2: archival policy)
- Federated identity for operators (→ v2: SAML/OIDC)

---

#### ADR-0028: Admin App Foundation ✓ COMPLETED
**Features:**
- **Real OTP Auth:**
  - /admin/login — email + OTP form
  - Supabase Auth for operators (separate from customer auth)
  - Session isolation: operator can only see admin routes

- **Operations Dashboard:**
  - Metric tiles: total orgs, active subs, pending support tickets, cron job health
  - Recent activity feed (last 100 audit-log entries, filterable by entity)
  - Quick links to common operator tasks

- **Audit Log Viewer:**
  - /operator/audit-log — sortable, filterable table
  - Columns: timestamp, operator, action, entity, row_id, changes
  - CSV export of filtered results
  - Pre-filtered views: "all deletions", "all plan changes", etc.

**Out of Scope:**
- Audit-log retention automation (→ v2)
- Role-based access control for operators (→ v2: admin roles)

---

#### ADR-0029: Admin Organisations Panel ✓ COMPLETED
**Features:**
- **Organisations List:**
  - /operator/orgs — table: org name, plan, status, created date, metrics
  - Filters: plan type, status (active/suspended), trial vs paid
  - Pagination (50 per page)

- **Organisation Detail:**
  - /operator/orgs/[orgId] — read-only org summary
  - Sections: subscription state, members list, web properties, billing history, notes
  - Actions dropdown: extend trial, suspend, restore, add note

- **Impersonation:**
  - "Log in as this org" button → operator context-switched to customer view
  - Customer sees suspension banner (if applicable); operator sees impersonation banner
  - Audit trail: impersonation session logged with start/end time, reason
  - Time-limited (12 hours auto-logout)

- **Customer-side cross-refs:**
  - Customer dashboard shows "logged in as org_name"
  - Support session history (which operators helped this org)

**Out of Scope:**
- Operator-operator handoff notes (→ ADR-0032 deferred)
- Bulk org actions (update 10+ orgs at once) (→ v2)

---

#### ADR-0030: Sectoral Templates ✓ COMPLETED
**Features:**
- **Admin Panel:**
  - /operator/templates — list all sector templates (Banking, Healthcare, E-commerce, SaaS, Insurance)
  - Draft + Publish workflow (draft = non-live, published = customers see)
  - Template editor: sector, legal frameworks, purposes, standard clauses
  - Versioning: templates evolve, old versions archived

- **Customer-side Read:**
  - /dashboard/template — customer can view published templates
  - "Apply template" button → auto-seeds org's purpose definitions + connector mappings
  - Onboarding shortcut for new orgs

**Out of Scope:**
- Sector-specific compliance rules (→ v2: rules engine)
- Multi-language templates (→ v2)

---

#### ADR-0031: Connector & Tracker Catalogues ✓ COMPLETED
**Features:**
- **Connector Catalogue Panel:**
  - /operator/connectors — admin list of pre-built deletion connectors
  - Connector detail: name, description, auth type (API key/OAuth), config schema
  - Deprecation workflow (mark old connectors as inactive)
  - Clone connector (snapshot config as new version)

- **Tracker Signature Catalogue Panel:**
  - /operator/signatures — list of known-tracker signatures
  - Signature detail: tracker name, domains, cookie patterns, classification
  - Edit signatures (add new patterns for known trackers)
  - Import signature packs (bulk-load from external vendor)

**Out of Scope:**
- Automated signature updates (→ v2: external feed integration)
- Custom tracker signature builder UI (→ v2)

---

#### ADR-0032: Support Tickets ✓ COMPLETED
**Features:**
- **Admin Panel:**
  - /operator/support — list open/closed support tickets
  - Filters: status, priority, assigned-to, date range
  - Ticket detail: subject, customer org, email, message thread, response drafts
  - Actions: change status, change priority, assign/reassign, reply
  - Internal operator-to-operator notes (non-customer-visible)

- **Customer-side Submit:**
  - /dashboard/support — customer can create a ticket
  - "New Support Ticket" form: subject, description, attachment (optional)
  - Email confirmation sent to customer
  - Customer can see ticket status + replies
  - RLS: customer only sees own org's tickets; operator sees all

**Out of Scope:**
- Automated ticket routing (→ v2: workflow engine)
- SLA tracking for support (→ v2: service-level agreements)

---

#### ADR-0033: Admin Ops + Security ✓ COMPLETED
**Features:**
- **Pipeline Operations Panel:**
  - /operator/pipeline — health dashboard for cron jobs + Edge Functions
  - Shows: last run, status (success/failed), duration, next scheduled run
  - Manual trigger for on-demand runs
  - Failure logs: last 10 runs with error messages

- **Abuse & Security Panel:**
  - /operator/security — IP blocking interface
  - Block/unblock IPv4 addresses by CIDR
  - Reason field (customer request, attack pattern, etc.)
  - Blocked IPs synced to Worker via KV (real-time enforcement)
  - Audit trail: who blocked, when, why

**Out of Scope (Sprint 2.3 deferred):**
- Worker middleware for IP enforcement (→ deferred; schema + ops ready)

---

#### ADR-0034: Billing Operations ✓ PROPOSED → COMPLETED
**Features:**
- **Admin Billing Panel:**
  - /operator/billing — Razorpay payment failure triage
  - Failures list: org, reason (card declined, max attempts, etc.), action
  - Manual actions:
    - Retry payment
    - Apply credit/comp (override charge)
    - Override plan (upgrade to higher tier w/o payment)
    - Manual refund request to Razorpay

- **Audit trail:** all billing operations logged to admin.admin_audit_log

**Out of Scope (still deferred or v2):**
- Chargeback handling (→ v2: payment disputes API integration)
- Revenue recognition rules (→ v2: accounting automation)

---

#### ADR-0036: Feature Flags & Kill Switches ✓ COMPLETED
**Features:**
- **Feature Flags Panel:**
  - /operator/flags — runtime toggles for A/B testing or gradual rollout
  - Flags: name, description, enabled/disabled state, rollout percentage (0–100%)
  - Per-flag changelog: who enabled/disabled when

- **Kill Switches Panel:**
  - Hardcoded switches: banner serving, API gates, Edge Function execution
  - 4 seed switches: `disable_banner_serving`, `disable_rights_requests`, `disable_deletion`, `disable_cron_jobs`
  - Single-click circuit breaker (if banner is crashing → disable immediately)

- **API Integration:**
  - `public.get_feature_flag(flag_name)` RPC
  - Worker + Edge Functions query feature flags from KV cache (synced by cron)

**Out of Scope:**
- Per-org feature flags (→ v2: customer-specific experimentation)

---

#### ADR-0037: DEPA Completion ✓ COMPLETED
**Features:**
- **V2-D1: Expiry-Triggered Connector Fan-out**
  - When artefact expires → auto-revoke → dispatch to all mapped connectors
  - Atomicity: connector fan-out in single transaction

- **V2-D2: Per-Requestor Artefact Binding**
  - Rights requests now include `session_fingerprint` (sha256 of userAgent + IP + orgId)
  - Binding: compute fingerprint at request-submit time
  - Deletion scope: only artefacts matching the fingerprint + purpose are deleted
  - Prevents "one data principal deletion triggers everyone's data erasure"

- **V2-D3: CSV Export for Consent Artefacts**
  - /api/orgs/[orgId]/artefacts.csv — export all artefacts as CSV
  - Columns: artefact_id, created_at, purposes, legal_basis, status, expires_at

- **Audit DEPA Section:**
  - Audit export includes DEPA-specific section
  - Artefacts, revocations, expirations in the same ZIP

- **Onboarding Seed Pack:**
  - When template applied → materialise purposes + connector mappings
  - Customer onboarding shortcut: "apply Banking sector template" → 5 minutes to full DEPA setup

**Out of Scope:**
- Multi-purpose consent (artefact includes multiple purposes atomically) (→ v2: already supported)
- Consent withdrawal by specific purpose only (→ v2)

---

#### ADR-0038: Operational Observability ✓ COMPLETED
**Features:**
- **Cron Health Snapshot:**
  - Public RPC `admin_cron_snapshot()` — returns scheduled jobs + last run timestamp
  - Operator dashboard queries it on page load

- **Stuck-Buffer Detection:**
  - Edge Function `check-stuck-buffers` — finds buffer rows > 1 hour old, undelivered
  - Alerts: operator Slack/Email notification
  - Automatically retries (same as ADR-0011 deletion retry)

- **Failure Watchdog:**
  - pg_cron job `cron-health-watchdog` (hourly)
  - Queries failed cron runs from admin logs
  - Triggers alert if any job fails 3 times in a row

**Out of Scope:**
- SLA violation alerts (→ v2: compliance-specific alerting)

---

#### ADR-0039: Connector OAuth ✓ COMPLETED
**Features:**
- **OAuth for Mailchimp & HubSpot:**
  - Admin flow: /integrations page → "Connect Mailchimp" button
  - Browser redirect to Mailchimp OAuth → customer authorizes → callback lands access token
  - Token stored encrypted in `integration_connectors.config`
  - Token refresh cron (daily): refresh tokens approaching expiry

- **CSRF Protection:**
  - `oauth_states` table: stores random nonce per OAuth initiation
  - State param verified on callback

**Out of Scope:**
- Additional OAuth providers (Salesforce, Klaviyo, etc.) (→ v2: per-provider ADRs)
- Revocation UX (if customer disconnects OAuth account) (→ v2)

---

#### ADR-0040: Audit R2 Upload Pipeline ✓ COMPLETED
**Features:**
- **S3-compatible R2 Upload:**
  - Hand-rolled AWS SigV4 signature (no AWS SDK dep)
  - Export configurations UI: customer can set R2 bucket + credentials
  - Delivery branch: when audit exports ready → upload to R2 (not just download)

- **Customer Storage Integration:**
  - Customer provides R2 `bucket_name` + `access_key_id` + `secret_access_key`
  - Encrypted storage in `export_configurations` table (per-org key derivation)
  - POST /api/orgs/[orgId]/audit-export → generates ZIP + POSTs to R2

**Out of Scope:**
- S3 (AWS) support (v2 follow-up)
- GCS (Google Cloud) support (v2 follow-up)

---

#### ADR-0041: Probes v2 — Sandbox Runner ✓ COMPLETED
**Features:**
- **Vercel Sandbox Integration:**
  - Probe runner is a Next.js API route (not Supabase Edge Function)
  - Uses `@vercel/sandbox` SDK (headless Firecracker VM, sandboxed)
  - Deploys Playwright script to sandbox, executes in isolation

- **Probe CRUD UI:**
  - /dashboard/probes — customer can create custom probes
  - Probe types: JavaScript code, Playwright scenario, custom check
  - Run on-demand or schedule hourly
  - Results logged to `consent_probe_runs`

**Out of Scope:**
- Probe marketplace (share community probes) (→ v2)
- Probe versioning (→ v2)

---

#### ADR-0042: Signup Idempotency Test ✓ COMPLETED
**Features:**
- Unit test for `ensureOrgBootstrap` helper (used in signup)
- Verifies: multiple calls with same user ID produce one org (not N orgs)
- Regression test added to catch future idempotency breaks

---

#### ADR-0043: Customer App is Auth-Only ✓ COMPLETED
**Features:**
- Customer app root `/` redirects authenticated users → `/dashboard`
- Unauthenticated users redirect → `/auth/login`
- Public marketing site moves to `www.consentshield.in` (separate deployment)
- Customer app robots.txt: Disallow all (pre-launch, not indexed)

**Out of Scope:**
- Marketing site build-out (→ separate Vercel project)

---

#### ADR-0044: Customer RBAC — 4-Level Hierarchy ✓ PROPOSED → PHASES 0–2.2 COMPLETED
**Features:**
- **Accounts Layer (Phase 0):**
  - `public.accounts` table: subscription identity, plan, status, trial_ends_at
  - `public.plans` table: plan_code, display_name, max_organisations, max_web_properties_per_org, base_price_inr, trial_days
  - Plan gating on org/web-property creation
  - Billing moved from org-level to account-level
  - Trial = a plan (30-day trial_starter plan)
  - Plan downgrade → org suspended_by_plan (soft suspend, reversible)

- **Memberships + Role Resolution (Phase 1):**
  - `public.account_memberships(account_id, user_id, role ∈ {account_owner, account_viewer})`
  - `public.org_memberships(org_id, user_id, role ∈ {org_admin, admin, viewer})`
  - 5 total roles (hierarchical): account_owner > account_viewer, org_admin > admin > viewer
  - Role inheritance: account_owner inherits org_admin rights
  - Column-level RLS on credentials (api_key, signing_secret, R2 key) — SELECT denied except by account_owner / org_admin

- **Invitations (Phase 2.1):**
  - `public.invitations` table: single polymorphic table for 5 invite shapes
  - Invite types: account creation (first org auto-created), add-to-account, org-level (org_admin/admin/viewer)
  - `public.create_invitation(...)` RPC: role-gated by caller's account_owner / org_admin status
  - `public.accept_invitation(p_token)` RPC: polymorphic, atomic org/account creation if needed
  - Email mismatch raises error
  - One pending invite per (email, scope)

**Deferred (Phase 2.2+, v2):**
- Self-serve account-owner transfer (operator-mediated in v1)
- M&A / merge / org-transfer / multi-account-per-user
- Per-org billing (account-level pooling only in v1)
- Bulk invitations (→ v2)

---

## In-Progress Features

#### ADR-0044: Phase 2.1–2.2 (Current)
**Status:** Invitations landed 2026-04-18. Signup gate + /signup refactor pending.
- [ ] Refactor /signup page to require invite token
- [ ] Remove walk-up signup (public /signup without token)
- [ ] Test invite flow end-to-end (create invite → accept → account + org created)
- [ ] Update customer onboarding flows in admin console

---

## Out-of-Scope (Handled in ADRs)

These items were explicitly declared out of scope in one ADR but **implemented in a follow-up ADR** (not V2 Backlog).

| Item | Initial ADR | Reason Deferred | Handling ADR | Status |
|------|-------------|-----------------|-------------|--------|
| Pre-built Mailchimp/HubSpot connectors | ADR-0007 | No time in Phase 1 | ADR-0018 | ✓ Done |
| Deletion retry/timeout | ADR-0007 | Requires buffer state machine | ADR-0011 | ✓ Done |
| Scoped-role enforcement (REST) | ADR-0001 | After schema ready | ADR-0009 | ✓ Done |
| Browser auth hardening | ADR-0001 | Separate concern | ADR-0008 | ✓ Done |
| OAuth for connectors | ADR-0018 | Phase 2 enhancement | ADR-0039 | ✓ Done |
| Headless-browser probes | ADR-0016 | Static analysis v1 first | ADR-0041 | ✓ Done |
| Expiry-triggered deletion | ADR-0023 | DEPA completion | ADR-0037 | ✓ Done |
| Per-requestor deletion binding | ADR-0004 | Rights workflow v1 | ADR-0037 | ✓ Done |
| Artefact CSV export | ADR-0017 | Audit export v1 | ADR-0037 | ✓ Done |
| Admin Ops + Security panels | ADR-0001 | Needs admin schema first | ADR-0033 | ✓ Done |
| Billing operations panel | ADR-0006 | Phase 2 operator console | ADR-0034 | ✓ Done |
| RBAC + invitations | ADR-0001 | Post-Phase-2 | ADR-0044 | ✓ Phases 0–2.2 Done |

---

## Out-of-Scope (V2 Backlog — Deferred)

These items are **explicitly NOT implemented** and documented in `docs/V2-BACKLOG.md`. They are scheduled for review **after Phase 2 closes** (early May 2026).

### Testing (V2-T1)

#### V2-T1: Signup idempotency regression test → ADR-0042 ✓ DONE
Initially deferred; now completed as a lightweight test.

---

### External Services (V2-X)

#### V2-X1: Vercel Preview env vars *(origin: ADR-0014)*
**Status:** DEFERRED
**Why:** Turnstile/Razorpay keys only set for Production. Preview deploys don't populate env vars cleanly via current Vercel CLI. Single-dev project hasn't needed Preview yet.
**Scope:** Upgrade Vercel CLI script or use Dashboard integration instead.
**Impact:** None (dev-only, no live traffic).

#### V2-X2: End-to-end billing checkout UX smoke *(origin: ADR-0014)*
**Status:** DEFERRED
**Why:** Requires signed-in test account completing test card `4111 1111 1111 1111`. All signing + webhook paths verified programmatically; user flow not smoke-tested.
**Scope:** One manual test once test account onboarded.
**Impact:** Low (checkout infrastructure verified via unit tests).

#### V2-X3: Audit-export R2 upload pipeline → ADR-0040 ✓ DONE
Initially deferred; now completed.

---

### Synthetic Compliance (V2-P)

#### V2-P1: Headless-browser probe runner → ADR-0041 ✓ DONE
Initially deferred; now completed with Vercel Sandbox.

#### V2-P2: Probe CRUD UI → ADR-0041 ✓ DONE
Initially deferred; now completed.

---

### Operations / Platform (V2-O)

#### V2-O1: Unbuilt Edge Functions *(origin: ADR-0011 cleanup)*
**Status:** PARTIALLY DEFERRED
- `check-stuck-buffers` → **DONE in ADR-0038 Sprint 1.1**
- `run-security-scans` → **DONE in ADR-0015**
- `check-retention-rules` → **DEFERRED** (retention-rule enforcement is Phase 3 feature; no rules exist yet)

**Impact:** None (no retention rules in v1; ADR-0006 has fixed limits instead).

#### V2-O2: Vercel Deployment Protection *(origin: session handoff)*
**Status:** DEFERRED
**Why:** Off on both Vercel projects (admin + demo sites). Single-dev project, no live traffic.
**Scope:** Enable password protection on admin + demo sites before customer onboarding.
**Impact:** None (dev environment).

#### V2-O3: pg_cron failure detection → ADR-0038 ✓ DONE
Initially deferred; now completed as cron-health watchdog.

---

### Connectors (V2-C)

#### V2-C1: OAuth flow for pre-built connectors → ADR-0039 ✓ DONE
Initially deferred; now completed.

---

### DEPA (V2-D)

#### V2-D1: Expiry-triggered connector fan-out → ADR-0037 ✓ DONE
Initially deferred; now completed.

#### V2-D2: Per-requestor artefact binding in Rights Centre → ADR-0037 ✓ DONE
Initially deferred; now completed.

#### V2-D3: CSV export for Consent Artefacts list → ADR-0037 ✓ DONE
Initially deferred; now completed.

---

### API Key Format (V2-K)

#### V2-K1: Edge Functions require `--no-verify-jwt` *(origin: Edge Function gateway)*
**Status:** DEFERRED
**Why:** Vault-stored `cs_orchestrator_key` is in new `sb_secret_*` format. Edge Function gateway still expects legacy JWT format. Only gateway layer affected; function-internal calls work.
**Scope:** Supabase closes format gap at gateway; we redeploy (no code change).
**Impact:** Very low (workaround transparent; one redeploy when Supabase ships).
**Timeline:** Waiting for Supabase announcement (not blocking).

---

## Summary Statistics

| Category | Count | Status |
|----------|-------|--------|
| **Total ADRs** | 44 | — |
| Completed | 42 | ✓ |
| Proposed | 2 | (ADR-0034, ADR-0044 Phase 0-2.2) |
| Abandoned | 1 | (ADR-0035: folded into ADR-0033) |
| **Total Features Implemented** | ~150+ | ✓ |
| **Out-of-Scope → ADR Addressed** | 14 | ✓ |
| **Out-of-Scope → V2 Backlog** | 10 | — |
| **V2-Backlog Items Completed** | 7 | ✓ |
| **V2-Backlog Items Still Deferred** | 3 | — |

---

## Phase Roadmap

- **Phase 0–1 (Complete):** Accounts layer + memberships + credential RLS
- **Phase 2 (Complete):** Invitations schema + create/accept RPCs
- **Phase 2.1–2.2 (In Progress):** Signup gate + /signup refactor + invite flow testing
- **Phase 3+ (Post-May 2026):** M&A / org-transfer / multi-account-per-user, per-org billing, self-serve transfer

---

**Generated:** 2026-04-18 | **Next Review:** After ADR-0044 Phase 2.2 landing + Phase 2 final review
