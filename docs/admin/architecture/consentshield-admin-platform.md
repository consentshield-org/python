# ConsentShield — Admin Platform Architecture Reference

*(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com*
*Source of truth for the operator-facing admin platform · April 2026*
*Companion to: [`docs/architecture/consentshield-definitive-architecture.md`](../../architecture/consentshield-definitive-architecture.md)*
*Companion UI spec: [`docs/admin/design/consentshield-admin-screens.html`](../design/consentshield-admin-screens.html)*

---

## Document Purpose

This is the single authoritative technical document for the **operator-facing** half of ConsentShield — the admin platform used to run the service. The customer-facing definitive architecture covers everything customers see and the data flows that serve them. This document covers everything that supports those flows from the operator's side: org management, support, sectoral template authoring, connector catalogue maintenance, abuse mitigation, billing operations, system-wide pipeline observability, and the audit trail of admin actions themselves.

If something contradicts this document on the admin platform, this document wins. If something contradicts both this document and the customer-side definitive architecture, raise it as an ADR and resolve before building.

---

## 1. Architectural Identity

The ConsentShield admin platform is a **separate Next.js application** sharing the same Supabase project as the customer app, deployed to a separate Vercel project on `admin.consentshield.in`. It is the only surface from which platform operators (initially: Sudhindra; eventually: a small ops team) administer customer organisations, edit sectoral templates and the connector catalogue, respond to support tickets, run impersonation sessions, manage feature flags and kill switches, and audit platform-wide pipeline health.

Three principles flow from this identity:

**Principle 1 — Separation by blast radius.** The admin app must be killable without affecting the customer app. A bug or incident in admin must not page on-call for the customer-facing product. Conversely, an outage in customer-facing infrastructure must not lock the operator out of the tools needed to triage and respond. Two Vercel projects, two `proxy.ts` files, two domains, two deploy cadences.

**Principle 2 — Every admin action is audited inside the same transaction.** An admin action that succeeds without an audit row is impossible by design. A `BEFORE INSERT/UPDATE/DELETE` trigger pattern, plus security-definer RPCs that wrap mutations + audit logging in a single transaction, means there is no "I made the change, forgot to log it" path.

**Principle 3 — Impersonation is a regulated act.** When an operator impersonates a customer org for support, the customer must be notified, the session must be time-boxed, the reason must be recorded, and every action during that session must carry the impersonation session ID in the audit log. Impersonation is not a free pass — it is a privileged act that the customer can audit after the fact.

These three principles map to admin-specific Rules 21–25 (§9 of this doc).

---

## 2. Hosting & Repository Topology

### 2.1 Monorepo layout

The repository becomes a Bun workspace monorepo. Existing single-app layout migrates as follows:

```
consent-sheild/                          # Repo root (workspace root)
├── app/                                 # Customer-facing Next.js app  (NEW location — was: root)
│   ├── src/                             # was: src/
│   ├── tests/                           # app-specific tests
│   ├── package.json                     # app's own dependencies
│   ├── next.config.ts
│   ├── proxy.ts
│   ├── tsconfig.json
│   └── vitest.config.ts
├── admin/                               # NEW: Operator-facing Next.js app
│   ├── src/
│   │   ├── app/                         # App Router pages
│   │   │   ├── (operator)/              # Authenticated admin routes
│   │   │   ├── (auth)/                  # Login + hardware-key registration
│   │   │   └── api/admin/               # Admin API surface (server-only)
│   │   ├── components/
│   │   ├── lib/
│   │   └── types/
│   ├── tests/
│   ├── package.json
│   ├── next.config.ts
│   ├── proxy.ts
│   ├── tsconfig.json
│   └── vitest.config.ts
├── worker/                              # Cloudflare Worker  (unchanged location)
├── packages/                            # NEW: 3 narrowly-shared workspace packages
│   ├── shared-types/                    # Types derived from the Postgres schema
│   ├── compliance/                      # DPDP + DEPA score + privacy notice composition
│   └── encryption/                      # Per-org key derivation helpers
│   #
│   # Deliberately NOT shared (each app keeps its own copy):
│   #   - Supabase server/browser clients (different roles, claim checks, schema targets)
│   #   - shadcn/ui components (shadcn is copy-paste-into-codebase by design)
│   #   - App-specific lib code (billing/, rights/, admin RPCs)
│   # Rationale: independence + smaller blast radius + hard security boundary.
│   # See ADR-0026 Decision § for the full reasoning.
├── supabase/                            # Migrations + Edge Functions  (unchanged — shared)
│   ├── migrations/
│   ├── functions/
│   └── seed.sql
├── tests/                               # Cross-app integration tests
│   ├── rls/                             # Multi-tenant isolation (existing)
│   └── admin/                           # Admin RLS, audit, impersonation
├── docs/                                # Shared docs  (unchanged — shared)
│   ├── architecture/                    # Customer architecture (existing)
│   ├── admin/                           # NEW
│   │   ├── architecture/                # Admin architecture docs
│   │   └── design/                      # Admin UI/UX specs + alignment
│   ├── design/                          # Customer design (existing)
│   ├── ADRs/
│   ├── changelogs/
│   └── reviews/
├── scripts/                             # Cross-app scripts  (unchanged)
├── test-sites/                          # Demo customer sites  (unchanged)
├── package.json                         # Workspace root — defines workspaces
├── tsconfig.base.json                   # Shared TS config
├── eslint.config.mjs                    # Shared lint config
└── bun.lock                             # Single lockfile for the whole workspace
```

The migration path that produces this layout is in [`consentshield-admin-monorepo-migration.md`](./consentshield-admin-monorepo-migration.md). It is a one-shot restructure followed by per-package extraction; admin work begins after the workspace exists.

### 2.2 Deployment topology

Two Vercel projects, one per app folder:

| Project | Vercel project name | Root directory | Production domain | Preview domain |
|---|---|---|---|---|
| Customer app | `consentshield` (existing) | `app/` | `consentshield.in`, `app.consentshield.in` | `consentshield-*.vercel.app` |
| Admin app | `consentshield-admin` (new) | `admin/` | `admin.consentshield.in` | `consentshield-admin-*.vercel.app` |

Both projects link to the **same Supabase project** (`xlqiakmkdjycfiioslgs`). Both connect to the same Cloudflare Worker (`cdn.consentshield.in`). They differ in:

- **Env vars** — admin requires `ADMIN_SUPABASE_DB_PASSWORD` (cs_admin role), `ADMIN_HARDWARE_KEY_ENFORCED=true`, `ADMIN_IMPERSONATION_NOTIFY_DELAY_MINUTES=5`. Customer app must NOT have these.
- **Domain** — admin is reachable only from `admin.consentshield.in`. The admin `proxy.ts` rejects requests with any other Host header.
- **IP allowlist** — admin sits behind Cloudflare Access (free tier) configured to allow only Sudhindra's hardware-key-bearing devices. This is a defence-in-depth layer beyond Supabase Auth.
- **Sentry project** — separate Sentry project (`consentshield-admin`) so admin errors don't pollute customer error budgets.

The customer app continues to deploy from the `main` branch on every push. The admin app deploys only on changes to `admin/**` or `packages/**` (configured via Vercel's "Ignored Build Step"). Customer changes never trigger admin deploys; admin changes never trigger customer deploys.

### 2.3 Shared infrastructure

These resources are shared across both apps and are NOT duplicated:

- **Supabase project** — single Postgres database, single auth.users table, single set of Edge Functions
- **Cloudflare Worker + KV + R2** — single Worker handles consent ingestion for all customer banners
- **Sentry organisation** — separate projects per app, but same org for billing
- **Razorpay account** — admin app reads payment events; customer app initiates checkouts
- **Resend account** — single account with two named senders (`noreply@consentshield.in` for customer, `admin@consentshield.in` for operator notifications + customer impersonation alerts)

---

## 3. Identity & Authentication

### 3.1 Single identity provider, two trust levels

Both apps use the same Supabase Auth instance. There is one `auth.users` table. The differentiator is a custom JWT claim:

```jsonc
// JWT for Sudhindra (admin) signing into admin.consentshield.in
{
  "sub": "uuid-of-sudhindra-auth-user",
  "email": "a.d.sudhindra@gmail.com",
  "app_metadata": {
    "is_admin": true,                      // ← gate
    "admin_role": "platform_operator",     // platform_operator | support | read_only
    "hardware_key_required": true
  },
  "aal": "aal2",                           // assurance level — must be aal2 for admin
  "current_org_id": null                   // null unless impersonating
}

// JWT for any customer user signing into app.consentshield.in
{
  "sub": "uuid-of-customer-auth-user",
  "email": "user@customer.in",
  "app_metadata": {
    "is_admin": false,                     // ← absent or false
    "current_org_id": "uuid-of-customer-org"
  },
  "aal": "aal1"                            // customers can be aal1 (password-only)
}
```

`is_admin` is set in `auth.users.raw_app_meta_data` and is **not** settable from the customer app. It is settable only via:
- Direct database update by the service role key (initial bootstrap)
- The admin app's own admin-onboarding endpoint (which itself requires an existing admin's JWT)

The admin claim is forged-resistant because it sits in the JWT signed by Supabase, not in any cookie or header the client controls.

### 3.2 Hardware key enforcement

Supabase Auth's WebAuthn / passkey support enforces a second factor. The admin app's `proxy.ts` checks the JWT's `aal` (Authenticator Assurance Level) on every request:

```ts
// admin/proxy.ts (sketch)
import { type NextRequest, NextResponse } from 'next/server'

export async function proxy(req: NextRequest) {
  const url = new URL(req.url)

  // 1. Reject requests not coming via admin.consentshield.in (Rule 24)
  const expectedHost = 'admin.consentshield.in'
  if (req.headers.get('host') !== expectedHost &&
      !req.headers.get('host')?.endsWith('.vercel.app')) {
    return new NextResponse('Not found', { status: 404 })
  }

  // 2. Public routes (login + hardware-key registration) skip the rest
  if (url.pathname.startsWith('/login') || url.pathname.startsWith('/api/auth')) {
    return NextResponse.next()
  }

  // 3. Validate Supabase session
  const session = await getSupabaseSession(req)  // admin/src/lib/supabase/server.ts (admin-specific)
  if (!session) return NextResponse.redirect(new URL('/login', req.url))

  // 4. Reject if not admin (Rule 21)
  if (session.user.app_metadata?.is_admin !== true) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // 5. Reject if AAL < 2 (Rule 21 — hardware key required)
  if (session.user.aal !== 'aal2') {
    return NextResponse.redirect(new URL('/login?reason=mfa_required', req.url))
  }

  return NextResponse.next()
}
```

Customer-app `proxy.ts` is unchanged and ignores `is_admin`. There is no path by which an admin JWT confers privilege on the customer app — the customer app does not check `is_admin` and the customer's RLS still resolves to `current_org_id`. Rule 24 (admin endpoints unreachable from customer subdomain) is enforced by the host check in step 1.

### 3.3 Admin role grants

Three admin role tiers:

- **`platform_operator`** — full admin (Sudhindra, future co-founder). Can do everything below plus: edit sectoral templates, edit connector catalogue, manage feature flags, set kill switches, change other admins' roles.
- **`support`** — read-only on most surfaces; can respond to support tickets; can start impersonation sessions (with reason); cannot edit templates or set kill switches.
- **`read_only`** — pure read access for audits, partner due diligence, accountant reviews. Cannot impersonate. Cannot mutate anything.

Role is held in `app_metadata.admin_role` and enforced both in the admin app's API route handlers and in the database via RPC argument checks.

---

## 4. Database Roles & Schema Boundary

### 4.1 New scoped role: `cs_admin`

In addition to the three existing scoped roles (`cs_worker`, `cs_delivery`, `cs_orchestrator`), the admin platform introduces:

**`cs_admin`** — used by the admin app only. Properties:

- `BYPASSRLS = TRUE` for the `public` schema (so admin can read across all customer orgs)
- `INHERIT FROM authenticated, cs_orchestrator` for shared helpers
- `WITH SET TRUE` (Postgres 16 GRANT ROLE separation — required for the admin app's pooler connection to assume the role per session — see `docs/architecture/consentshield-complete-schema-design.md` migration 011 pattern)
- Owns the new `admin` schema (defined below)

**`cs_admin` is NOT used directly for writes to customer tables.** Every admin write to customer data must go through a security-definer RPC defined in the `admin` schema (e.g., `admin.update_customer_setting(org_id, key, value, reason)`). The RPC inserts the audit row + performs the write in the same transaction (Rule 22).

**Writes to admin tables** use `cs_admin` directly because admin tables have their own RLS that already requires the admin claim.

### 4.2 New schema: `admin`

A dedicated `admin` Postgres schema isolates all admin-only objects from customer objects. Customer tables stay in `public`. Benefits:

- `GRANT USAGE ON SCHEMA admin TO cs_admin` is the only role that can see admin tables — no accidental cross-pollination.
- Backups, exports, and migrations can target `admin.*` separately.
- A future audit can grep for `admin.` to find every admin touchpoint.

The admin schema's tables are detailed in [`consentshield-admin-schema.md`](./consentshield-admin-schema.md). Summary list:

- `admin.admin_audit_log` — every admin action (read or write)
- `admin.sectoral_templates` — DPDP minimum, BFSI starter, healthcare seed packs
- `admin.connector_catalogue` — global catalogue of pre-built deletion connectors
- `admin.tracker_signature_catalogue` — promoted from `supabase/seed/tracker_signatures.sql` to a managed table
- `admin.support_tickets` + `admin.support_ticket_messages` — operator-managed support queue
- `admin.org_notes` — admin-only notes per customer org
- `admin.feature_flags` — global + per-org feature flag overrides
- `admin.kill_switches` — emergency disablements (banner delivery, DEPA processing, deletion dispatch)
- `admin.impersonation_sessions` — every impersonation session with reason + duration + outcome
- `admin.admin_users` — extends `auth.users` with admin-specific metadata (hardware key registered, last admin action, role, status)
- `admin.platform_metrics_daily` — materialised system-wide stats for the operations dashboard

### 4.3 RLS on admin tables

All admin tables have RLS enabled. The default policy on every admin table is:

```sql
create policy "admin_only" on admin.<table>
  for all
  to authenticated
  using ( (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true )
  with check ( (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true );
```

For role-tiered tables (e.g., `admin.kill_switches` requires `platform_operator`), the policy adds `AND (auth.jwt() -> 'app_metadata' ->> 'admin_role') = 'platform_operator'`.

Customer authentication never produces a JWT with `is_admin = true`, so customer requests cannot read or write admin tables even if they discovered the schema name.

---

## 5. The Admin Audit Log

### 5.1 Mandatory wrapping pattern

Every admin write is performed via a security-definer RPC of this shape:

```sql
create or replace function admin.update_customer_setting(
  p_org_id uuid,
  p_setting_key text,
  p_new_value jsonb,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  v_admin_id uuid := auth.uid();
  v_old_value jsonb;
begin
  if (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean is not true then
    raise exception 'admin claim required';
  end if;
  if p_reason is null or length(p_reason) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;

  select settings -> p_setting_key into v_old_value from public.organisations where id = p_org_id;

  -- Insert audit row first; the write follows in the same transaction.
  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, old_value, new_value, reason)
  values
    (v_admin_id, 'update_customer_setting', 'organisations', p_org_id, p_setting_key, v_old_value, p_new_value, p_reason);

  -- Now perform the write.
  update public.organisations
     set settings = jsonb_set(coalesce(settings, '{}'), array[p_setting_key], p_new_value),
         updated_at = now()
   where id = p_org_id;
end;
$$;
```

Three properties this gives:

- **No write without an audit row.** The audit insert is in the same transaction; if the write fails (constraint, RLS, missing row), the audit row is rolled back too. If the audit insert fails, the write doesn't happen.
- **Reason is structurally required.** Every admin write API surface enforces `reason: string (>=10 chars)` and passes it down. Rejected at the RPC if missing.
- **The application code never UPDATEs customer tables directly.** All admin writes are RPC calls.

### 5.2 Read auditing — pragmatic stance

Reads are NOT logged by default. Auditing every SELECT generates noise that drowns the actual events of interest. Reads ARE logged in three specific cases:

- **Impersonation sessions** — every page visited under an impersonation session is logged with the session ID.
- **Audit log self-reads** — reading `admin.admin_audit_log` is itself logged (so a future bad-actor can't quietly review what they did).
- **Bulk customer data exports** — any admin export that returns more than 100 customer rows is logged with the row count and filter criteria.

Additional read auditing is opt-in per RPC and called out in the RPC's documentation.

### 5.3 Audit log retention

`admin.admin_audit_log` is **append-only and never deleted**. Per Rule 22, an admin's history is permanent. There is no admin RPC to delete or modify audit rows — even `platform_operator` cannot. Cleanup, if ever needed for storage, is via a future ADR with a documented compliance rationale.

For practical query performance, the table is partitioned monthly (`admin_audit_log_2026_04`, `admin_audit_log_2026_05`, ...) and old partitions can be detached and moved to cold storage (R2) without losing them.

---

## 6. Impersonation

### 6.1 Why impersonation exists

Customer support sometimes requires seeing exactly what the customer sees — their banner, their consent artefacts, their rights requests, their integrations. Reading from a service-role console doesn't reproduce the exact UI state RLS would render. Impersonation lets an operator render the customer's UI in the customer's RLS context for the duration of a support session.

### 6.2 Lifecycle

1. **Start** — Operator opens an org, clicks "Start support session", picks a reason from a dropdown (`bug_investigation`, `data_correction`, `compliance_query`, `partner_demo`, `other_with_freetext`) and adds free-text detail. The admin API:
   - Inserts into `admin.impersonation_sessions` (admin_user_id, target_org_id, reason, reason_detail, started_at, expires_at = now + 30 min, status='active')
   - Sends an email to the org's compliance contact within 5 minutes (`admin@consentshield.in`): "Sudhindra K. began a support session on your account at <time>. Reason: bug_investigation. The session will end at <time + 30min> or when ended manually. View the full audit log at <link>."
   - Returns a special JWT minted server-side with `current_org_id` set to the target + `impersonation_session_id` claim

2. **Active session** — Admin app navigates to the customer app's URL set under impersonation context. A red banner across the top of every page reads: `IMPERSONATING ACME TECHNOLOGIES — Session expires in 28 min — End session now`. Every action during the session is logged with the impersonation_session_id in `admin.admin_audit_log`.

3. **End** — Auto-expires after 30 minutes, or operator clicks "End session", or platform_operator force-ends another operator's session. Status moves to `completed` / `expired` / `force_ended`. A second email goes to the customer: "Support session ended at <time>. Actions taken: <summary>."

4. **Customer audit access** — Every org's settings page (existing customer UI) gains a new tab "Support sessions" (W-Admin-CustomerVisibility — see ALIGNMENT doc) listing every impersonation session against their org with start/end times, reason, and the actions taken. Customers can request a per-session detail export.

### 6.3 What impersonation cannot do

Impersonation grants the customer's RLS context for **read** only. Writes during impersonation must still go through the same admin RPCs that would log the action without impersonation. The session ID is added to the audit row but the audit machinery is unchanged. There is no "act as the customer" path — operators can read but not write as the customer. (A future ADR may carve out a controlled exception for "fix this customer's misconfigured banner with their permission" — but the v1 default is read-only.)

---

## 7. Admin API Surface

All admin endpoints sit under `/api/admin/*` in the admin app. None are exposed on the customer app. Authentication is Supabase Auth + admin claim + AAL2.

### 7.1 Org management

| Route | Method | Notes |
|---|---|---|
| `/api/admin/orgs` | GET | List orgs. Filters: plan, status, signup_after, last_active_before, q (search). Paginated. |
| `/api/admin/orgs/[id]` | GET | Org detail (settings, plan, score history, recent activity, billing state, support history). |
| `/api/admin/orgs/[id]/notes` | GET, POST | Operator-only notes on this org. |
| `/api/admin/orgs/[id]/impersonate` | POST | Body: `{ reason, reason_detail }`. Returns impersonation token. |
| `/api/admin/orgs/[id]/extend-trial` | POST | Body: `{ days, reason }`. Updates org's trial expiry. |
| `/api/admin/orgs/[id]/suspend` | POST | Body: `{ reason }`. Sets `org.status='suspended'`; banner serves a fail-closed default. |
| `/api/admin/orgs/[id]/restore` | POST | Body: `{ reason }`. Reverses suspension. |

### 7.2 Sectoral templates

| Route | Method | Notes |
|---|---|---|
| `/api/admin/sectoral-templates` | GET, POST | List or create a template. |
| `/api/admin/sectoral-templates/[id]` | GET, PATCH | Read or edit (creates a new draft version). |
| `/api/admin/sectoral-templates/[id]/publish` | POST | Body: `{ version_notes }`. Promotes draft to published. |
| `/api/admin/sectoral-templates/[id]/preview` | POST | Body: `{ org_id }`. Dry-run apply against an org's existing purpose_definitions; returns the diff. |

### 7.3 Connector catalogue

| Route | Method | Notes |
|---|---|---|
| `/api/admin/connectors` | GET, POST | List or create a connector entry. |
| `/api/admin/connectors/[id]` | GET, PATCH | Read or edit. |
| `/api/admin/connectors/[id]/deprecate` | POST | Body: `{ replacement_id?, reason }`. Marks as deprecated; warns customers using it. |

### 7.4 Tracker signatures

| Route | Method | Notes |
|---|---|---|
| `/api/admin/tracker-signatures` | GET, POST | List or add a tracker signature. |
| `/api/admin/tracker-signatures/[id]` | PATCH, DELETE | Edit or hard-delete (with audit). |
| `/api/admin/tracker-signatures/import` | POST | Body: signature pack JSON; bulk import for new tracker discoveries. |

### 7.5 Support tickets

| Route | Method | Notes |
|---|---|---|
| `/api/admin/support-tickets` | GET | List tickets. Filters: status, priority, assigned_admin, org_id. |
| `/api/admin/support-tickets/[id]` | GET, PATCH | Detail or update (assign, change status). |
| `/api/admin/support-tickets/[id]/messages` | POST | Add a message to the thread. |

### 7.6 Pipeline operations

| Route | Method | Notes |
|---|---|---|
| `/api/admin/pipeline/worker-errors` | GET | System-wide worker_errors with filter and aggregation. |
| `/api/admin/pipeline/stuck-buffers` | GET | Aggregated stuck buffer counts across all orgs. |
| `/api/admin/pipeline/expiry-queue` | GET | DEPA expiry queue depth + expiring-soon by org. |
| `/api/admin/pipeline/delivery-health` | GET | Median delivery latency, failure rate, throughput per cron job. |
| `/api/admin/pipeline/cron-jobs` | GET | pg_cron job list with last run time + success status. |

### 7.7 Billing operations

| Route | Method | Notes |
|---|---|---|
| `/api/admin/billing/payment-failures` | GET | Razorpay events filtered to failures. |
| `/api/admin/billing/refunds` | GET, POST | List + initiate refunds. |
| `/api/admin/billing/comp-account` | POST | Body: `{ org_id, plan, duration_months, reason }`. Set comp pricing. |
| `/api/admin/billing/plan-override` | POST | Body: `{ org_id, plan, reason, expires_at }`. Override plan gate without billing event. |

### 7.8 Abuse & security

| Route | Method | Notes |
|---|---|---|
| `/api/admin/security/rate-limit-triggers` | GET | Recent rate-limit hits with IP/identity attribution. |
| `/api/admin/security/hmac-failures` | GET | Worker HMAC validation failures (potential signature compromise indicator). |
| `/api/admin/security/origin-failures` | GET | Worker origin mismatches (potential snippet copy-pasta). |
| `/api/admin/security/sentry-escalations` | GET | Sentry events flagged severity ≥ error. |
| `/api/admin/security/blocked-ips` | GET, POST, DELETE | Manage IP blocklist (small global set). |

### 7.9 Feature flags & kill switches

| Route | Method | Notes |
|---|---|---|
| `/api/admin/feature-flags` | GET, POST | List or create a flag. |
| `/api/admin/feature-flags/[key]` | PATCH | Update flag value (global or per-org). |
| `/api/admin/kill-switches` | GET | List all kill switches with current state. |
| `/api/admin/kill-switches/[key]` | PATCH | Body: `{ enabled, reason }`. Toggle a kill switch. |

### 7.10 Audit log

| Route | Method | Notes |
|---|---|---|
| `/api/admin/audit-log` | GET | Filter by admin_user_id, action, target_table, org_id, date range. The act of querying the audit log is itself audited. |
| `/api/admin/audit-log/export` | POST | Bulk CSV export (audited). |

---

## 8. Cross-System Flows

### 8.1 Sectoral template publish → customer onboarding

1. Operator drafts a new sectoral template ("BFSI starter v2") in `admin.sectoral_templates` (status=`draft`).
2. Operator previews the template against a synthetic org (`/preview` endpoint) — sees the purpose_definitions diff.
3. Operator publishes (`/publish`). Status → `published`. A new version row is created.
4. Customer onboarding (W9 — purpose definition seed packs) reads from `admin.sectoral_templates WHERE status='published' AND sector=<customer_sector>` and offers the new pack.
5. Existing customers on an older version of the template see a notification: "A newer version of your sector template is available — review changes". Adopting is opt-in.

### 8.2 Connector deprecation

1. Operator marks `Mailchimp v1` as deprecated, supplying a replacement (`Mailchimp v2`).
2. All customer integrations using `Mailchimp v1` are flagged in their dashboard with a "Migrate to v2" prompt.
3. Customer can migrate at their convenience; a final cutover deadline is set in the deprecation entry.
4. Deletion requests already in flight against `Mailchimp v1` continue to use it until the cutover deadline.

### 8.3 Kill switch — banner delivery

In an emergency (CDN incident, malicious banner change, regulatory order), operator toggles `kill_switches.banner_delivery` to `enabled=false`.

The Cloudflare Worker reads this flag from KV (synced by an Edge Function on every kill-switch change). When set, the Worker returns a tiny no-op banner script that does nothing (no consent collection, no tracker analysis). Customer sites continue to function — the banner just doesn't appear.

The flag is the killswitch of last resort. It does not target a specific org; it kills banner delivery for all customers. Per-org kill is a future ADR.

### 8.4 Impersonation → audit visibility

Already covered in §6. The customer-side feature (a "Support sessions" tab in customer Settings) is tracked as item W-Admin-CustomerVisibility in the customer-side `ARCHITECTURE-ALIGNMENT-2026-04-16.md`.

---

## 9. Admin Non-Negotiable Rules (21–25)

These extend the customer-side Rules 1–20 (defined in `docs/architecture/consentshield-definitive-architecture.md` §11). They cannot be relaxed without a documented ADR and a security review.

**Rule 21 — Admin sessions require hardware-key 2FA.** Every admin app session requires Supabase AAL2 (WebAuthn / passkey). Password-only login may complete to AAL1 but the admin app's `proxy.ts` rejects any request that has not promoted to AAL2. SMS OTP does not count as the second factor. TOTP apps do not count. Hardware-bound passkey only.

**Rule 22 — Every admin action is audit-logged in the same transaction as the action.** Admin writes to customer tables go through security-definer RPCs in the `admin` schema that insert into `admin.admin_audit_log` and perform the write in a single transaction. An action that succeeds with an unwritten audit row is structurally impossible. The audit log is append-only — no admin role can delete or modify audit rows, including `platform_operator`.

**Rule 23 — Impersonation is time-boxed, reason-required, and customer-notified.** Maximum session duration is 30 minutes. Each session requires a reason (dropdown + free-text detail). The customer's compliance contact receives an email within 5 minutes of session start. Every action during the session carries the impersonation_session_id. Customer-side UI surfaces every impersonation session against the customer's org. Impersonation grants RLS-context **read**; writes during impersonation still go through audit-logged RPCs.

**Rule 24 — No admin endpoint is reachable from the customer subdomain.** Admin app's `proxy.ts` rejects any request whose Host header is not `admin.consentshield.in` (or the project's Vercel preview pattern). Customer app has no `/api/admin/*` routes. The admin and customer JWT pools are the same `auth.users` table but the customer app's RLS never grants on the admin claim and the admin app's RLS never grants on the customer claim alone.

**Rule 25 — Admin app deploys independently from customer app.** Admin and customer live in separate Vercel projects with independent deploy triggers, independent build commands, independent env vars, independent Sentry projects. An admin outage does not page customer on-call. A customer outage does not lock operators out. A bad admin deploy can be rolled back without touching the customer deployment. Shared code lives in `packages/*` and is consumed by both apps via the workspace; a `packages/*` change triggers both apps' rebuilds.

---

## 10. Security Posture — Admin-Specific

### Bootstrap admin (one-shot)

The first admin user is promoted via `scripts/bootstrap-admin.ts` (ADR-0027 Sprint 4.1). The script is idempotent and refuses to run a second time once any `admin.admin_users` row carries `bootstrap_admin = true`.

**Procedure:**

1. Sign up through the admin app's `/login` page (email + password; the app auto-confirms in dev) to create the `auth.users` row. The script does NOT create auth users — it only promotes existing ones.
2. Run:
   ```bash
   BOOTSTRAP_ADMIN_EMAIL=<operator-email> \
   BOOTSTRAP_ADMIN_DISPLAY_NAME="<Full Name>" \
   bunx tsx scripts/bootstrap-admin.ts --i-understand-this-is-a-one-time-action
   ```
3. Sign out and sign in again so the JWT picks up the new `is_admin=true` + `admin_role='platform_operator'` claims.
4. Verify the Operations Dashboard renders the operator's display name.
5. Register a second hardware key before flipping `ADMIN_HARDWARE_KEY_ENFORCED=true` in admin-app env (AAL2 enforcement). Rule 21.

**Safety rails:**

- Exit 2 — safety flag or env vars missing.
- Exit 3 — a bootstrap admin already exists (idempotency).
- Exit 4 — email has no `auth.users` row (operator must sign up first).
- Exit 1 — unexpected DB error; the script reports which step failed.

**Recovery (lost hardware keys on the bootstrap account):** another `platform_operator` can mark the original row `status = 'disabled'` + register a new admin. Pre-second-operator, recovery is direct DB update via the service role key (break-glass procedure stored with the operator's personal secrets).

### Other admin security controls

- **Admin secrets** — `cs_admin` database password, Razorpay admin webhook secret, Resend admin sender token. All in Vercel env vars on the admin project only. Never set on the customer project.
- **Admin Sentry** — separate Sentry project; same `beforeSend` hook strips sensitive data. Admin error messages may legitimately contain customer org IDs (which are not personal data) but never customer personal data, never JWT contents, never raw query results.
- **Admin logs** — Vercel function logs for the admin project are retained per Vercel default; no customer personal data should appear in admin logs (the same `beforeSend`-style filter applies). Audit log is the canonical record of admin actions, NOT Vercel logs.
- **Cloudflare Access** — admin domain sits behind Cloudflare Access (free tier, GitHub-OAuth-restricted to Sudhindra's account). This is **defense in depth on top of** Supabase Auth + AAL2, not a replacement.
- **Admin JWT secret rotation** — when an admin user's role changes or is removed, their existing JWT remains valid until expiry. The admin app must enforce a short JWT lifetime (1 hour max) and the user must re-login. For immediate revocation, the platform_operator can mark the admin user `status='disabled'` and the admin app rejects all JWTs for disabled users at the proxy level.
- **Hardware-key loss** — every admin must have at least 2 hardware keys registered (primary + backup). Onboarding requires 2 keys before AAL2 unlocks. If both are lost, recovery is via direct database update by another platform_operator (or, for the bootstrap operator, by re-enrolment via Supabase service role with a separately-stored break-glass procedure).

---

## 11. Environment Variables

### Vercel — admin project (server-side only)

```
# Database (cs_admin role)
SUPABASE_URL=https://xlqiakmkdjycfiioslgs.supabase.co
ADMIN_SUPABASE_DB_URL=postgresql://cs_admin:<password>@aws-...pooler.supabase.com:6543/postgres
ADMIN_SUPABASE_DB_PASSWORD=<from Supabase>

# Auth
SUPABASE_ANON_KEY=<existing>
SUPABASE_JWT_SECRET=<from Supabase>
ADMIN_HARDWARE_KEY_ENFORCED=true

# Impersonation
ADMIN_IMPERSONATION_NOTIFY_DELAY_MINUTES=5
ADMIN_IMPERSONATION_DEFAULT_DURATION_MINUTES=30
ADMIN_IMPERSONATION_MAX_DURATION_MINUTES=120

# Notifications
RESEND_ADMIN_SENDER=admin@consentshield.in
RESEND_API_KEY=<existing>

# Sentry (separate project)
SENTRY_DSN=<admin-specific DSN>
SENTRY_ORG=consentshield
SENTRY_PROJECT=consentshield-admin

# Cloudflare Access (validation token)
CLOUDFLARE_ACCESS_AUD=<from CF Access>
CLOUDFLARE_ACCESS_TEAM=consentshield
```

### Vercel — customer project

Unchanged from current. Specifically, the customer project must NOT have `ADMIN_*` or `cs_admin` credentials. A pre-deploy check in CI (script in `scripts/check-env-isolation.ts`) fails the customer build if any `ADMIN_*` env var is present.

---

## 12. Migration & Rollout

The admin platform is a meaningful body of work. It does NOT need to be built before any DEPA ADR; the customer-side DEPA roadmap (ADR-0019+) and the admin platform are independent streams.

Recommended sequencing:

1. **Monorepo restructure** ([`consentshield-admin-monorepo-migration.md`](./consentshield-admin-monorepo-migration.md)) — single ADR (proposed: ADR-0026), ~2 sprints. Pure restructuring, no new functionality.
2. **Admin schema + cs_admin role + audit log + impersonation tables** ([`consentshield-admin-schema.md`](./consentshield-admin-schema.md)) — single ADR, ~2 sprints. Migrations land; nothing reads them yet.
3. **Admin app skeleton + proxy.ts + login + Operations Dashboard** — first usable admin surface; ~2 sprints.
4. **Per-panel build-out** — one ADR per panel cluster (Orgs+Impersonation; Sectoral Templates; Connector Catalogue + Tracker Signatures; Support Tickets; Pipeline Operations; Billing Operations; Abuse & Security; Feature Flags + Kill Switches). Each ADR ~1 sprint.
5. **Customer-side "Support sessions" tab** — small ADR on the customer app, parallel to admin Impersonation work.

The customer-side DEPA roadmap can run in parallel with steps 2–5 (admin platform doesn't depend on DEPA tables; DEPA tables get audit-logged when admin touches them via the wrapper RPCs, which adds value but isn't blocking).

The full operator console can be live in ~10–12 weeks of focused work alongside DEPA. If DEPA is the priority and admin can wait, admin steps 2–5 slip to after DEPA Phase A; the monorepo restructure should happen before DEPA Phase A regardless because both apps will benefit from the workspace.

---

## 13. Reference

Companion documents in this folder:

- [`consentshield-admin-schema.md`](./consentshield-admin-schema.md) — every admin table, RLS policy, RPC, and grant
- [`consentshield-admin-monorepo-migration.md`](./consentshield-admin-monorepo-migration.md) — step-by-step monorepo restructure plan

Companion UI specification:

- [`../design/consentshield-admin-screens.html`](../design/consentshield-admin-screens.html) — the visual + interaction spec for every admin panel; code MUST conform
- [`../design/ARCHITECTURE-ALIGNMENT-2026-04-16.md`](../design/ARCHITECTURE-ALIGNMENT-2026-04-16.md) — drift catalogue between admin wireframes and this architecture (initialised at zero drift; future architecture amendments add entries)

Customer-side cross-references:

- [`../../architecture/consentshield-definitive-architecture.md`](../../architecture/consentshield-definitive-architecture.md) — the customer architecture; Rules 1–20
- [`../../architecture/consentshield-complete-schema-design.md`](../../architecture/consentshield-complete-schema-design.md) — customer schema (defines the tables the admin RPCs operate on)
- [`../../design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md`](../../design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md) — customer-side alignment, including W-Admin-CustomerVisibility

---

*End of Admin Platform Architecture Reference.*
