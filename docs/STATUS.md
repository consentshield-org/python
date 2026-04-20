# ConsentShield Status

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Snapshot date:** 2026-04-20
**Branch:** main
**Latest commit:** `b609dea` — feat(ADR-0050): sprint 3.2 — dispute workspace; 13/13 PASS
**Total commits:** 179
**Test suite:** 412 / 414 passing (2 pre-existing flaky lifecycle-RPC tests; not a code defect)
**Migrations applied:** 136
**Edge Functions deployed:** 10

---

## Summary

The project has two independently deployable apps in a Bun workspace monorepo:

- **`app/`** — Customer-facing Next.js app (consent management dashboard, rights portal, billing, DEPA compliance, probes, audit export)
- **`admin/`** — Operator console Next.js app (admin.consentshield.in — accounts, billing, disputes, issuer entities, impersonation, audit log, connector catalogue, feature flags)

**Phase 1 customer app:** Functionally complete. All core compliance workflows (consent capture → artefact creation → rights requests → deletion orchestration → audit export) are end-to-end and tested. DEPA panels (purposes, artefacts, score), probes v2, and the full RBAC/invitation model are live.

**Admin console:** 13/13 wireframe panels live. Billing track complete through ADR-0050: issuer entities, invoice issuance + PDF + GST + Resend delivery, invoice search + export + GST statement CSV, and dispute workspace with evidence bundle assembly.

**ADR-1001 (public API / Bearer infrastructure):** In progress — bearer middleware + `cs_live_*` key schema + API keys dashboard UI shipped. Route handlers (ADR-1002+) are next.

---

## ADR Completion

### Completed (50 ADRs)

| ADR | Title | Notes |
|-----|-------|-------|
| 0001 | Project scaffolding (Next.js, Supabase schema, auth, Worker skeleton) | |
| 0002 | Worker HMAC verification + origin validation | |
| 0003 | Consent banner builder + compliance dashboard | |
| 0004 | Rights request workflow (Turnstile + OTP + dashboard inbox) | |
| 0005 | Tracker monitoring (banner script v2 + MutationObserver) | |
| 0006 | Razorpay billing + plan gating | |
| 0007 | Deletion orchestration (generic webhook protocol) | |
| 0008 | Browser auth hardening (remove client signing secret, origin_verified, fail-fast Turnstile) | |
| 0009 | Scoped-role enforcement in REST paths | |
| 0010 | Distributed rate limiter (Upstash via Vercel Marketplace) | |
| 0011 | Deletion retry + timeout Edge Function | |
| 0012 | Automated test suites (worker / buffer / workflows / RLS) | |
| 0013 | Signup bootstrap hardening (OTP-only) | |
| 0014 | External service activation (Resend / Turnstile / Razorpay) | |
| 0015 | Security posture scanner (run-security-scans + dashboard) | |
| 0016 | Consent probes v1 (static HTML analysis) | |
| 0017 | Audit export package Phase 1 (direct-download ZIP) | |
| 0018 | Pre-built deletion connectors (Mailchimp + HubSpot direct API) | |
| 0019 | DEPA roadmap charter (meta-ADR, no code) | |
| 0020 | DEPA schema skeleton (6 tables + §11.3 ALTERs + helpers + triggers + shared types) | |
| 0021 | `process-consent-event` Edge Function + dispatch trigger + safety-net cron | |
| 0022 | `process-artefact-revocation` Edge Function + revocation dispatch | |
| 0023 | DEPA expiry pipeline (`send_expiry_alerts` + `enforce_artefact_expiry` + pg_cron) | Implemented as pg_cron SQL functions, not separate Edge Functions |
| 0024 | DEPA customer UI rollup (purposes + artefacts + dashboard tile + rights reshape + settings row) | |
| 0025 | DEPA score dimension (nightly refresh + API + dashboard gauge) | |
| 0026 | Monorepo restructure (Bun workspace — `app/` + `admin/` + `packages/*`) | Sprints 1–2 complete; Sprint 3 (shared packages) deferred |
| 0027 | Admin platform schema (`cs_admin` role + `admin.*` tables + audit log + impersonation) | |
| 0028 | Admin app foundation (real OTP auth + operations dashboard + audit log viewer) | |
| 0029 | Admin organisations (list + detail + actions + impersonation + customer cross-refs) | |
| 0030 | Sectoral templates (admin panel + customer-side read) | |
| 0031 | Connector catalogue + tracker signature catalogue (admin panels) | |
| 0032 | Support tickets (admin panel + customer-side submit) | |
| 0033 | Admin ops + security (pipeline operations + abuse & security panels) | |
| 0034 | Admin billing operations (Razorpay failures + refunds + comps + plan overrides) | |
| 0036 | Feature flags + kill switches (admin panel + Worker KV sync) | |
| 0037 | DEPA completion (expiry fan-out + per-requestor binding + CSV + audit DEPA + onboarding seed pack) | |
| 0038 | Operational observability (cron failure watchdog + stuck-buffer Edge Function) | |
| 0039 | Connector OAuth (Mailchimp + HubSpot) | |
| 0040 | Audit R2 upload pipeline (sigv4 + export_configurations UI + delivery-target branch) | |
| 0041 | Probes v2 (Vercel Sandbox runner + probe CRUD UI) | |
| 0042 | Signup idempotency regression test | |
| 0043 | Customer app is auth-only (drop public landing) | |
| 0044 | Customer RBAC (4-level hierarchy + 5-role model + invitation-only signup) | |
| 0045 | Admin user lifecycle (invite + role change + disable) | |
| 0047 | Customer membership lifecycle (role change + remove + single-account-per-identity invariant) | |
| 0048 | Admin accounts panel + ADR-0033/34 deviation closeout | |
| 0049 | Security observability ingestion (rate_limit_events + sentry_events) | |
| 0050 | Admin account-aware billing — issuer entities + invoices + GST + dispute workspace | Sprint 3.2 complete 2026-04-20; ADR-index still shows In Progress — needs update |

### In Progress

| ADR | Title | What's done | What remains |
|-----|-------|------------|--------------|
| 0046 | Significant Data Fiduciary foundation | Phase 1 (schema + admin SDF panel + customer dashboard card) complete | Phases 2–4: DPIA records, data auditor engagements, DPIA export |
| 1001 | Public API foundation (`cs_live_*` keys + Bearer middleware) | Sprints 1.1–2.3: schema, bearer middleware, API keys dashboard UI | Sprints 3+: remaining whitepaper accuracy gaps |

### Proposed (not started)

| ADR | Title | Scope |
|-----|-------|-------|
| 0051 | Billing evidence ledger — chargeback-defense capture points | Admin-side; capture points at signup, invoice email, rights request, admin plan changes |
| 0052 | Razorpay dispute evidence auto-submission | Admin-side; automated Razorpay API submission |
| 0053 | GSTR-1 XML generation + filing helpers | Admin-side |
| 0054 | Customer-facing invoice + billing portal | Customer `app/` — Settings billing tab + invoice history + PDF download |
| 0055 | Account-scoped impersonation (admin side) | Admin-side |
| 0056 | Per-account feature-flag targeting | Admin-side |
| 0057 | Account-level sectoral default templates | Customer Settings + onboarding |
| 1002 | DPDP §6 runtime enforcement (`/v1/consent/verify` + `record` + artefact ops + deletion API) | Public API |
| 1003 | Processor posture (`storage_mode` + BYOS + Zero-Storage + Healthcare seed + sandbox) | Public API |
| 1004 | Statutory retention (Regulatory Exemption Engine + material-change re-consent + silent-failure detection) | Public API |
| 1005 | Operations maturity (webhook reference, test_delete, support model, status page, rights API, non-email channels) | Public API |
| 1006 | Developer experience (Node/Python/Java/Go client libs + OpenAPI + CI drift check) | Public API |
| 1007 | Connector ecosystem expansion (CleverTap, Razorpay, WebEngage, Intercom, Shopify, Segment + plugins) | Connectors |
| 1008 | Scale + audit polish + P3 hardening | Operations |

---

## Customer App (`app/`) — Panel Inventory

### Shipped and wired

| Panel | Route | Notes |
|-------|-------|-------|
| Dashboard home | `/dashboard` | DPDP score, DEPA score gauge, status tiles |
| Consent banners | `/dashboard/banners` | Builder, preview, publish, purpose binding |
| Purpose definitions (DEPA) | `/dashboard/purposes` | CRUD, connector mappings tab, sector seed pack |
| Consent artefacts (DEPA) | `/dashboard/artefacts` | List + filter chips + pagination, detail with 4-link chain-of-custody, revoke |
| Web properties | `/dashboard/properties` | CRUD, banner snippet, Worker verification |
| Data inventory | `/dashboard/inventory` | Data category catalogue CRUD |
| Rights requests | `/dashboard/rights` | Public intake (Turnstile + OTP), inbox, detail + actions, artefact-scoped erasure |
| Integrations | `/dashboard/integrations` | Connector list, Mailchimp + HubSpot OAuth + API key, credential storage |
| Consent probes | `/dashboard/probes` | List, create, Vercel Sandbox runner, results |
| Enforcement | `/dashboard/enforcement` | Security posture scanner, withdrawal verifier |
| Audit & Reports | `/dashboard/exports` + `/dashboard/template` | DEPA audit CSV, R2 export config, sectoral templates |
| Settings | `/dashboard/settings` | Account info, team members, invitations, notification channels, API keys panel |
| Support | `/dashboard/support` | Ticket submit + list |
| Billing | `/dashboard/billing` | Plan selector, Razorpay checkout modal |

### Not yet built in customer app

| Gap | Planned ADR | Notes |
|-----|------------|-------|
| Customer invoice history + PDF download (Settings billing tab) | ADR-0054 | Phase 2; blocked on nothing |
| Account-level sectoral template switcher | ADR-0057 | Customer Settings; Phase 2 |
| Support sessions tab (impersonation history visible to account owner) | ADR-0029 follow-up | Route exists (`/dashboard/support-sessions`); logic incomplete |
| Org suspension banner (red banner + read-only state when account suspended) | ADR-0048 follow-up | Needs Worker + dashboard wiring |
| API keys CRUD routes (create, list, rotate, revoke) | ADR-1001 Sprint 3+ | UI wireframe done; 4 API routes missing |

---

## Admin App (`admin/`) — Panel Inventory

### Shipped (13/13 wireframe panels + billing extensions)

| Panel | Route | ADR |
|-------|-------|-----|
| Accounts | `/accounts` + `/accounts/[accountId]` | ADR-0048 |
| Organisations | `/orgs` + `/orgs/[orgId]` | ADR-0029 |
| Billing landing | `/billing` | ADR-0050 |
| Billing — per-account detail | `/billing/[accountId]` | ADR-0050 |
| Billing operations | `/billing/operations` | ADR-0034 |
| Billing — issuer entities | `/billing/issuers` | ADR-0050 |
| Billing — invoice search | `/billing/search` | ADR-0050 |
| Billing — GST statement | `/billing/gst-statement` | ADR-0050 |
| Billing — invoice export | `/billing/export` | ADR-0050 |
| Billing — disputes | `/billing/disputes` + `[disputeId]` | ADR-0050 |
| Pipeline operations | `/pipeline` | ADR-0033 |
| Abuse & Security | `/security` | ADR-0033 |
| Connector catalogue | `/connectors` | ADR-0031 |
| Tracker signatures | `/signatures` | ADR-0031 |
| Sectoral templates | `/templates` | ADR-0030 |
| Feature flags | `/flags` | ADR-0036 |
| Admin users | `/admins` | ADR-0045 |
| Support tickets | `/support` | ADR-0032 |
| Audit log | `/audit-log` + `/audit-log/export` | ADR-0028 |

### Not yet built in admin app

| Gap | Planned ADR |
|-----|------------|
| Billing evidence ledger panel (on dispute detail) | ADR-0051 |
| Razorpay auto-submit evidence | ADR-0052 |
| GSTR-1 XML download | ADR-0053 |
| Account-scoped impersonation | ADR-0055 |
| Per-account feature flag overrides | ADR-0056 |
| DPIA records panel (ADR-0046 Phase 2) | ADR-0046 |
| Data auditor engagements panel (ADR-0046 Phase 3) | ADR-0046 |

---

## Infrastructure

| Component | Identifier / URL |
|-----------|-----------------|
| Customer app (Vercel) | `consentshield-one.vercel.app` |
| Admin app (Vercel) | `consentshield-admin.vercel.app` |
| Cloudflare Worker CDN | `https://cdn.consentshield.in/v1/*` |
| Supabase project | `xlqiakmkdjycfiioslgs` |
| GitHub repo | `github.com/SAnegondhi/consentshield` |

**Edge Functions deployed (10):**
`process-consent-event`, `process-artefact-revocation`, `send-sla-reminders`, `run-security-scans`, `run-consent-probes`, `check-stuck-buffers`, `check-stuck-deletions`, `check-cron-health`, `oauth-token-refresh`, `sync-admin-config-to-kv`

**pg_cron jobs:** Multiple active jobs covering SLA reminders, buffer sweeps, security scans, consent probes, stuck-deletion checks, cron health watchdog, sentry-events cleanup, feature-flag KV sync, DEPA expiry enforcement.

**Database:** 136 migrations applied. All tables have RLS enabled. Three scoped runtime roles (`cs_worker`, `cs_delivery`, `cs_orchestrator`). No `SUPABASE_SERVICE_ROLE_KEY` in running app code. Admin route handlers that call `auth.admin.*` use service role behind `is_admin` + AAL2 proxy + SECURITY DEFINER RPC guard (carve-out per Rule 5 / ADR-0045).

---

## Test Suite

| Suite | Count | Notes |
|-------|-------|-------|
| RLS isolation (multi-tenant) | ~200 | Cross-org data leak tests |
| Admin lifecycle RPCs | 10 (12 total, 2 flaky) | 2 "last active platform_operator" guards fail on shared dev DB with extra rows |
| Billing — GST statement | 5 | |
| Billing — invoice export authz | 14 | |
| Billing — invoice export contents | 7 | |
| Billing — dispute webhook | 5 | |
| Billing — evidence bundle | 8 | |
| API keys RLS | (committed by Terminal B) | ADR-1001 Sprint 2.1 |
| Worker + buffer + rights + workflows | ~150 | Miniflare + live Supabase round trips |
| **Total passing** | **412 / 414** | 2 pre-existing flaky (not blocking) |

---

## Known Issues

| Issue | Severity | Notes |
|-------|----------|-------|
| `admin-lifecycle-rpcs.test.ts` — 2 "last active platform_operator" guards | Low | Shared dev DB has extra `platform_operator` rows from prior test runs; guards never fire. Fix: clean up dev DB before running those tests, or add per-test isolation. |
| ADR-0050 ADR-index entry still shows "In Progress" | Cosmetic | Update to "Completed" |
| ADR-0026 Sprint 3 (shared packages) not started | Low | Independent of all current work |

---

## Immediate Next Steps

**Next ADRs in priority order:**

1. **ADR-0051** — Billing evidence ledger (admin-side capture points; feeds dispute bundle assembler). Unblocked.
2. **ADR-0054** — Customer-facing invoice + billing portal. Unblocked; schema and R2 PDFs already exist.
3. **ADR-0046 Phase 2** — DPIA records (admin + customer). Partial ADR exists.
4. **ADR-0052** — Razorpay dispute auto-submission. Depends on ADR-0051.
5. **ADR-1002** — Public API route handlers (`/v1/consent/verify` + `record` + artefact ops). Depends on ADR-1001 completion.
