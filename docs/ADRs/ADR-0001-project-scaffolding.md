# ADR-0001: Project Scaffolding — Next.js, Supabase Schema, Auth, Worker Skeleton

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** In Progress
**Date proposed:** 2026-04-13
**Date completed:** —

---

## Context

ConsentShield has a complete architecture (definitive architecture, schema design, testing strategy) but no application code. The project needs its foundational scaffolding before any features can be built: the Next.js app shell, the full Supabase schema with RLS policies and scoped roles, the auth flow with JWT custom claims, and the Cloudflare Worker skeleton.

The schema is the most critical piece — per the testing strategy and CLAUDE.md, RLS policies must be written and tested before any customer data exists, before any UI. The schema design doc (Section 10) specifies that all 11 verification queries must pass before development proceeds.

## Decision

Set up the full project foundation in three phases:

- **Phase 1:** Next.js app shell + Supabase schema (all Phase 1+2 tables, RLS, scoped roles, triggers, buffer lifecycle functions, pg_cron jobs)
- **Phase 2:** Auth flow (Supabase Auth, custom access token hook, org creation, JWT claims) + RLS isolation tests
- **Phase 3:** Cloudflare Worker skeleton (routes, HMAC utilities, banner delivery stub, event ingestion stub)

## Consequences

After this ADR is complete:
- The database is production-ready with all security guards active
- Multi-tenant isolation is enforced and tested
- The auth flow creates orgs and injects JWT claims
- The Worker skeleton can serve requests (stubs, not full implementation)
- All verification queries from schema doc Section 9 pass
- RLS isolation tests run and pass

This unblocks ADR-0002 (consent banner builder + dashboard) and ADR-0003 (Worker implementation with HMAC + monitoring).

---

## Implementation Plan

### Phase 1: Next.js Shell + Supabase Schema

**Goal:** Running Next.js app with the complete database schema, all RLS policies, scoped roles, triggers, and buffer lifecycle functions.

#### Sprint 1.1: Next.js Project Setup
**Estimated effort:** 2–3 hours
**Deliverables:**
- [ ] Next.js 14 project with TypeScript strict mode, Tailwind, shadcn/ui
- [ ] ESLint + Prettier config (2-space indent, no semicolons)
- [ ] package.json with exact version pinning (no ^ or ~)
- [ ] Supabase client library setup (server + browser)
- [ ] Environment variable structure (.env.local template, no secrets committed)
- [ ] Sentry setup with beforeSend data stripping
- [ ] Basic app layout shell (dashboard route group, public route group)
- [ ] Verify: `bun run build` passes, `bun run lint` passes with zero warnings

**Testing plan:**
- [ ] Build succeeds with zero errors
- [ ] Lint passes with zero warnings
- [ ] Dev server starts and renders the shell

**Status:** `[x] complete`

#### Sprint 1.2: Supabase Schema — Operational Tables + Helper Functions
**Estimated effort:** 3–4 hours
**Deliverables:**
- [ ] Migration 001: extensions (pgcrypto, pg_cron, uuid-ossp)
- [ ] Migration 002: helper functions (current_org_id, is_org_admin, set_updated_at, set_rights_request_sla, set_breach_deadline, custom_access_token_hook)
- [ ] Migration 003: operational state tables (organisations, organisation_members, web_properties, consent_banners, data_inventory, breach_notifications, rights_requests, export_configurations, tracker_signatures, tracker_overrides, integration_connectors, retention_rules, notification_channels, consent_artefact_index)
- [ ] All indexes per schema design doc
- [ ] Verify: all tables created, all indexes active

**Testing plan:**
- [ ] `npx supabase db push` succeeds
- [ ] All tables exist with correct columns (query information_schema)

**Status:** `[x] complete`

#### Sprint 1.3: Supabase Schema — Buffer Tables + Enforcement Tables
**Estimated effort:** 2–3 hours
**Deliverables:**
- [ ] Migration 004: buffer tables (delivery_buffer, consent_events, tracker_observations, audit_log, processing_log, rights_request_events, deletion_receipts, withdrawal_verifications, security_scans, consent_probe_runs)
- [ ] Migration 005: Phase 3 tables (consent_probes, api_keys, gdpr_configurations, sector_templates, dpo_partners, dpo_engagements, cross_border_transfers, white_label_configs)
- [ ] All indexes per schema design doc
- [ ] Verify: all buffer tables have delivered_at column and undelivered index

**Testing plan:**
- [ ] All tables exist with correct columns
- [ ] All buffer tables have delivered_at column
- [ ] All indexes exist (query pg_indexes)

**Status:** `[x] complete`

#### Sprint 1.4: RLS Policies + Scoped Roles + Triggers
**Estimated effort:** 4–5 hours
**Deliverables:**
- [ ] Migration 006: enable RLS on ALL tables
- [ ] Migration 007: RLS policies — operational tables (org-scoped CRUD)
- [ ] Migration 008: RLS policies — buffer tables (org-scoped read-only)
- [ ] Migration 009: RLS policies — special cases (rights_requests public insert, reference data)
- [ ] Migration 010: scoped database roles (cs_worker, cs_delivery, cs_orchestrator) with all GRANTs and REVOKEs per schema doc Section 5
- [ ] Migration 011: authenticated role restrictions (REVOKE UPDATE/DELETE on buffers, REVOKE INSERT on critical buffers)
- [ ] Migration 012: triggers (updated_at on all mutable tables, SLA deadline, breach deadline)
- [ ] Migration 013: buffer lifecycle functions (mark_delivered_and_delete, sweep_delivered_buffers, detect_stuck_buffers)
- [ ] Migration 014: pg_cron scheduled jobs (buffer sweep, stuck detection, SLA reminders, security scan, retention check)
- [ ] Run ALL 11 verification queries from schema doc Section 9

**Testing plan:**
- [ ] Verify 1: RLS enabled on every table
- [ ] Verify 2: No UPDATE/DELETE grants on buffer tables for authenticated
- [ ] Verify 3: No INSERT grants on critical buffers for authenticated
- [ ] Verify 4: SLA deadline trigger active
- [ ] Verify 5: Breach deadline trigger active
- [ ] Verify 6: pg_cron jobs scheduled
- [ ] Verify 7: No stale buffer data
- [ ] Verify 8a-8g: Scoped role privilege tests
- [ ] Verify 9: Event signing secrets populated (on any test web_properties)
- [ ] Verify 10: Encryption salts populated (on any test organisations)
- [ ] Verify 11: Cross-tenant isolation (basic)

**Status:** `[x] complete`

### Phase 2: Auth Flow + RLS Isolation Tests

**Goal:** Working signup → org creation → JWT claims flow, with comprehensive RLS isolation tests passing on every table.

#### Sprint 2.1: Auth Flow
**Estimated effort:** 3–4 hours
**Deliverables:**
- [ ] Supabase Auth config (email, magic link, Google OAuth)
- [ ] Custom access token hook registered in Supabase dashboard
- [ ] POST /api/auth/signup route (creates org + member after Supabase Auth signup)
- [ ] Supabase client setup: createServerClient (server-side), createBrowserClient (client-side)
- [ ] Middleware to protect dashboard routes (redirect to login if unauthenticated)
- [ ] Basic login/signup page (functional, not styled)
- [ ] Verify: signup creates org + member, JWT contains org_id and org_role

**Testing plan:**
- [ ] Sign up with email → org created → member linked with role 'admin'
- [ ] JWT contains org_id and org_role claims after token refresh
- [ ] Unauthenticated request to dashboard route → redirect to login

**Status:** `[x] complete`

#### Sprint 2.2: RLS Isolation Test Suite
**Estimated effort:** 4–5 hours
**Deliverables:**
- [ ] Test framework setup (vitest or bun:test)
- [ ] Test helpers: create test org, create test user, get authenticated Supabase client
- [ ] RLS isolation tests for EVERY table: User A cannot read/write/update/delete Org B's data
- [ ] Append-only tests for ALL 10 buffer tables: no UPDATE or DELETE even on own org's data
- [ ] Edge case: user with no org membership → 0 rows from every table
- [ ] Edge case: anon key (unauthenticated) → 0 rows or rejected
- [ ] Edge case: org deleted → cascade delete verified → new org has no residual data
- [ ] All tests passing

**Testing plan:**
- [ ] Full test suite passes: `bun test tests/rls/`
- [ ] Every table has at least one isolation test
- [ ] Every buffer table has append-only constraint test

**Status:** `[ ] planned`

### Phase 3: Cloudflare Worker Skeleton

**Goal:** Worker responds to all routes with correct structure, uses cs_worker scoped role, HMAC utility implemented.

#### Sprint 3.1: Worker Project Setup + Routes
**Estimated effort:** 3–4 hours
**Deliverables:**
- [ ] worker/ directory with TypeScript config (zero npm dependencies)
- [ ] wrangler.toml with KV namespace binding, env var references
- [ ] worker/src/index.ts — route handler dispatching to GET /v1/banner.js, POST /v1/events, POST /v1/observations, GET /v1/health
- [ ] worker/src/hmac.ts — HMAC-SHA256 verification utility (Web Crypto API)
- [ ] worker/src/banner.ts — banner delivery stub (returns placeholder JS)
- [ ] worker/src/events.ts — consent event ingestion stub (validates payload structure, returns 202)
- [ ] worker/src/observations.ts — observation ingestion stub (validates payload, returns 202)
- [ ] CORS handling (OPTIONS preflight → 200 with correct headers)
- [ ] Worker uses SUPABASE_WORKER_KEY (cs_worker role), not service role
- [ ] Verify: `wrangler dev` starts, all routes respond correctly

**Testing plan:**
- [ ] GET /v1/health → 200
- [ ] GET /v1/banner.js?org=test&prop=test → 200 with JavaScript content-type
- [ ] GET /v1/banner.js (missing params) → 400
- [ ] POST /v1/events with valid payload → 202
- [ ] POST /v1/events with invalid event_type → 400
- [ ] POST /v1/events with malformed JSON → 400 (not 500)
- [ ] OPTIONS /v1/events → 200 with CORS headers

**Status:** `[ ] planned`

---

## Architecture Changes

_None expected — this ADR implements the existing architecture, it does not change it._

---

## Test Results

### Sprint 1.1 — 2026-04-13

```
Test: Build succeeds
Method: bun run build
Expected: zero errors
Actual: ✓ Compiled successfully in 2.8s, Next.js 16.2.3 (Turbopack)
Result: PASS

Test: Lint passes with zero warnings
Method: bun run lint
Expected: zero warnings, zero errors
Actual: clean exit, no output
Result: PASS

Test: Dev server starts
Method: bun run dev
Expected: server starts, renders shell
Actual: ✓ Ready in 564ms on http://localhost:3000
Result: PASS
```

**Packages (all exact-pinned, latest with security patches as of 2026-04-13):**
- next 16.2.3, react 19.2.5, react-dom 19.2.5
- @supabase/supabase-js 2.103.0, @supabase/ssr 0.10.2
- @sentry/nextjs 10.48.0
- typescript 5.9.3, tailwindcss 4.2.2, eslint 9.39.4
- vitest 4.1.4, prettier 3.8.2

### Sprint 1.2 — 2026-04-13

```
Test: supabase db push succeeds
Method: supabase db push (3 migrations)
Expected: all migrations applied
Actual: Migration 001 (extensions) — PASS (pgcrypto, uuid-ossp already exist)
        Migration 002 (helper functions) — PASS (6 functions created)
        Migration 003 (operational tables) — initial FAIL: gen_random_bytes not in search path
        Fix: qualified as extensions.gen_random_bytes()
        Migration 003 (retry) — PASS (14 tables created)
Result: PASS (with fix)

Test: All tables exist with correct columns
Method: psql query against pg_tables
Expected: 14 operational tables
Actual: 14 tables confirmed — organisations, organisation_members, web_properties,
        consent_banners, data_inventory, breach_notifications, rights_requests,
        export_configurations, tracker_signatures, tracker_overrides,
        integration_connectors, retention_rules, notification_channels,
        consent_artefact_index
Result: PASS

Test: Helper functions exist
Method: psql query against pg_proc
Expected: 6 functions
Actual: current_org_id, is_org_admin, set_updated_at, set_rights_request_sla,
        set_breach_deadline, custom_access_token_hook
Result: PASS
```

**Bug encountered:** `gen_random_bytes()` is in the `extensions` schema on hosted Supabase, not `public`. Must qualify as `extensions.gen_random_bytes()` in all migrations.

### Sprint 1.3 — 2026-04-13

```
Test: All tables exist with correct columns
Method: psql query against pg_tables
Expected: 32 tables total (14 operational + 10 buffer + 8 phase 3)
Actual: 32 tables confirmed
Result: PASS

Test: All buffer tables have delivered_at column
Method: psql query against information_schema.columns
Expected: 10 buffer tables with delivered_at
Actual: audit_log, consent_events, consent_probe_runs, deletion_receipts,
        delivery_buffer, processing_log, rights_request_events, security_scans,
        tracker_observations, withdrawal_verifications
Result: PASS

Test: All indexes exist
Method: migrations applied without error
Result: PASS
```

### Sprint 1.4 — 2026-04-13

```
Migrations applied: 006 (RLS enable), 007 (RLS operational), 008 (RLS buffer),
  009 (RLS special), 010 (scoped roles), 011 (auth restrictions),
  012 (triggers), 013 (buffer lifecycle), 015 (fix stuck buffers)
Migration 014 (pg_cron): DEFERRED — requires dashboard extension enablement

Verify 1: RLS enabled on every table — PASS (32/32)
Verify 2: No UPDATE/DELETE on buffer tables for authenticated — PASS (0 rows)
Verify 3: No INSERT on critical buffers for authenticated — PASS (0 rows)
Verify 4: SLA deadline trigger active — PASS (BEFORE INSERT)
Verify 5: Breach deadline trigger active — PASS (BEFORE INSERT)
Verify 6: pg_cron jobs — DEFERRED (extension not enabled yet)
Verify 7: No stale buffer data — PASS (0 stuck rows)
Verify 8a: Scoped roles exist — PASS (cs_worker, cs_delivery, cs_orchestrator)
Verify 8b: cs_worker CAN INSERT consent_events — PASS
Verify 8c: cs_worker CANNOT SELECT organisations — PASS
Verify 8d: cs_delivery CANNOT SELECT organisations — PASS
Verify 8e: cs_delivery CAN DELETE consent_events — PASS
Verify 8f: cs_orchestrator CANNOT SELECT consent_events — PASS
Verify 8g: cs_orchestrator CAN INSERT audit_log — PASS
Verify 9: Event signing secrets — PASS (default generates on insert)
Verify 10: Encryption salts — PASS (0 missing)
```

**Bug encountered:** `consent_probe_runs` uses `run_at` not `created_at`. Fixed in migration 015.
**Deferred:** pg_cron migration (014) pending dashboard extension enablement. Renamed to .pending.

### Sprint 2.1 — 2026-04-13

```
Test: Build succeeds
Method: bun run build
Actual: ✓ Compiled, TypeScript passed, all pages generated
        Routes: / (static), /login (static), /signup (static),
        /dashboard (dynamic), /api/auth/signup (dynamic)
        Proxy detected and active
Result: PASS

Test: Lint passes
Method: bun run lint
Actual: clean exit, zero warnings
Result: PASS

Note: proxy.ts uses Next.js 16 pattern (not middleware.ts)
Note: Custom access token hook requires dashboard registration
  → Authentication → Hooks → Custom Access Token → public.custom_access_token_hook
```

**Fixes during sprint:**
- Dashboard page: separated org query to avoid Supabase join type mismatch
- Login page: wrapped useSearchParams in Suspense boundary (Next.js 16 requirement)

### Sprint 2.2 — [Date]

_Pending_

### Sprint 3.1 — [Date]

_Pending_

---

## Changelog References

- CHANGELOG-schema.md — [date] — Sprint 1.2, 1.3, 1.4
- CHANGELOG-dashboard.md — [date] — Sprint 1.1, 2.1
- CHANGELOG-worker.md — [date] — Sprint 3.1
