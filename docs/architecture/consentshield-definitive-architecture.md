# ConsentShield — Definitive Architecture Reference

*(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com*
*Source of truth for all development · April 2026*
*Supersedes: consentshield-technical-architecture.md, consentshield-stateless-oracle-architecture.md*
*Amended: 2026-04-16 (DEPA alignment — see [`docs/reviews/2026-04-16-depa-package-architecture-review.md`](../reviews/2026-04-16-depa-package-architecture-review.md))*

---

## Document Purpose

This is the single authoritative technical document for ConsentShield. Every architectural decision, every data flow, every security rule, every integration contract is specified here. If something contradicts this document, this document wins.

**Companion UI specification.** The visual and interaction spec for the dashboard, banners, rights flows, audit reports, and DEPA panels lives in `docs/design/screen designs and ux/`. The Next.js implementation in `app/src/app/` MUST conform to those wireframes; drift between this architecture doc and the wireframes is tracked in `docs/design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md`. Read the wireframes alongside this doc when implementing or reviewing any UI surface.

**Companion admin platform.** ConsentShield has a parallel **operator-facing** application — the admin platform — defined in `docs/admin/architecture/consentshield-admin-platform.md` (with schema in `consentshield-admin-schema.md` and monorepo migration plan in `consentshield-admin-monorepo-migration.md`). The admin platform shares this Supabase project but deploys as a separate Next.js app under `admin/` in the monorepo to `admin.consentshield.in`. It introduces 5 admin-side non-negotiable rules (21–25) that extend the 20 rules in §11 of this document. Admin-side UI lives in `docs/admin/design/`. Customer-side cross-references (W13 — "Support sessions" tab; W14 — suspended-org banner state) are tracked in the customer alignment doc.

---

## 1. Architectural Identity

ConsentShield is a **stateless compliance oracle**. It processes consent events, generates compliance evidence, and delivers the canonical record to the customer's own storage. It does not hold the compliance record — the customer does.

Three design principles flow from this identity:

**Principle 1 — Process, deliver, delete.** Every piece of user data that enters ConsentShield exits to customer storage within minutes. ConsentShield's buffer tables are write-ahead logs, not databases. A row that has been delivered and confirmed has zero reason to exist. It is deleted immediately, not on a schedule.

**Principle 2 — The customer is the system of record.** Dashboard views may read from buffer tables for real-time display. Compliance exports, audit packages, and any DPB-facing artefact must read from — or direct users to — customer-owned storage. Any code path that treats ConsentShield's buffer as the canonical record is architecturally wrong.

**Principle 3 — ConsentShield is a Data Processor, not a Data Fiduciary.** This is not a legal nicety. Under DPDP, a Fiduciary faces ₹250 crore per violation. A Processor that accumulates a centralised record of everything it processes starts looking like a Fiduciary. The stateless oracle architecture ensures ConsentShield never crosses that line.

---

## 2. Stack Overview

| Layer | Technology | Purpose | Access Level |
|---|---|---|---|
| Frontend | Next.js 14 + TypeScript + Tailwind + shadcn/ui | Web application | User-facing |
| Auth | Supabase Auth | Email, magic link, Google OAuth | Integrated with DB RLS |
| Database | Supabase Postgres | Operational state store | RLS-enforced multi-tenancy |
| Edge Functions | Supabase Edge Functions (Deno) | Async: delivery, SLA reminders, scans, deletion orchestration | Service role only |
| Banner + Monitoring | Cloudflare Worker + KV | cdn.consentshield.in — banner.js delivery, consent event ingestion, tracker observation ingestion | Public endpoints |
| Scan Engine | Vercel Cron + HTTP checks | Withdrawal verification, security posture scans | Service role only |
| Notification Channels | Resend (email) + Slack/Teams/Discord webhooks | Compliance alerts | Service role only |
| Tracker Signature DB | Versioned JSON, embedded in banner script | Tracker classification intelligence | Read-only, shipped in banner |
| Billing | Razorpay Subscriptions | INR plans, auto-renewal | Server-side only |
| Customer Storage | Cloudflare R2 (default) or AWS S3 (BYOS) | Canonical compliance record | Write-only from ConsentShield |
| Monitoring | Sentry + Vercel Analytics | Error tracking, performance | Server-side only |

### The fundamental architectural decision

Supabase Auth and Supabase Postgres are the same system. The `auth.uid()` and `auth.jwt()` functions are available inside every RLS policy. Multi-tenant isolation is enforced at the database level, not in application code. Every query runs the policy — there is no way to forget it.

---

## 3. Data Classification

Every table in ConsentShield's database belongs to exactly one of three categories. This distinction is the single most important thing to understand before touching any code.

### Category A — Operational State (permanent)

Data that ConsentShield needs to function. Organisation configs, banner settings, billing records, team membership, tracker signature definitions, DEPA purpose definitions, consent artefacts, consent expiry scheduling. This is the working set — no different from what any B2B tool holds, plus the DEPA-native consent record that lives in ConsentShield's database while the artefact's lifecycle is active. It stays in ConsentShield's database until explicit lifecycle transitions or org-cascade deletes remove it.

**A.1 — Org-scoped tables:** organisations, organisation_members, web_properties, consent_banners, data_inventory, tracker_overrides, integration_connectors, retention_rules, export_configurations, consent_artefact_index, api_keys, breach_notifications, rights_requests, consent_probes, cross_border_transfers, gdpr_configurations, dpo_engagements, white_label_configs, notification_channels, **purpose_definitions** (DEPA), **purpose_connector_mappings** (DEPA), **consent_artefacts** (DEPA), **consent_expiry_queue** (DEPA), **depa_compliance_metrics** (DEPA)

**A.2 — Global reference tables (no org_id):** tracker_signatures, sector_templates, dpo_partners

### Category A — Orthogonal Property: Delivered to Customer Storage

Several Category A tables carry a *secondary* property: their state changes are also staged in `delivery_buffer` for nightly export to customer-owned storage, so the customer holds the canonical compliance record independently of ConsentShield. This is an *additional* flow, not a lifecycle transition — the source row in the Category A table is unaffected by the delivery.

Tables with this property today: **consent_artefacts** (every insert + status change), **rights_requests** (every state change), **retention_rules** (every policy change), **consent_artefact_index** (validity transitions). The property is orthogonal to Category A / B / C; a row does not move between categories because it happens to be delivered.

### Category B — User Data Buffer (transient)

Personal data of data principals that flows through ConsentShield on its way to customer-owned storage. Consent events, audit log entries, tracker observations, deletion receipts, processing log entries, security scan results, withdrawal verification results, artefact revocations. This data is buffered only to guarantee delivery. Once customer storage confirms the write, ConsentShield's copy is deleted.

**Tables:** consent_events, tracker_observations, audit_log, processing_log, delivery_buffer, rights_request_events, deletion_receipts, security_scans, withdrawal_verifications, consent_probe_runs, **artefact_revocations** (DEPA)

### Category C — Regulated Sensitive Content (zero persistence)

*Scope broadened 2026-04-16 per the DEPA alignment review.*

Content-layer data governed by sector-specific retention regulation. Never written to any table, any log, any file, any buffer. Flows through ConsentShield's server in memory only, if at all. Processed (e.g., drug interaction check for FHIR; deletion-request signature for banking connectors), then released.

Currently enumerated as in-scope:

- **FHIR clinical records** from ABDM — diagnoses, medications, lab results, prescriptions, observations, imaging. Processed (drug interaction check, prescription template), then released.
- **Banking identifiers and transactional content** from BFSI customers — PAN values, Aadhaar values, bank account numbers, account balances, bank statements, repayment history, transaction records, bureau pulls, KYC documents. Handled at the deletion-orchestration and tracker-monitoring boundaries only; the actual values are never seen by ConsentShield's database.

Any future regulated sector's content (telecom CDRs, insurance claims content, education records, etc.) inherits Category C by default and is enumerated here when the corresponding module ships.

**DEPA artefact model — category metadata vs content.** The `consent_artefacts` table under the DEPA model holds *category declarations*, never values. `data_scope = ['pan', 'repayment_history']` declares which regulated categories a consent covers — the actual PAN value never enters the row. The same separation applies to ABDM: an ABDM consent artefact is a row in `consent_artefacts` with `framework = 'abdm'` and metadata (`abdm_artefact_id`, `abdm_hip_id`, `abdm_hiu_id`, `abdm_fhir_types`) — Category A metadata, not FHIR content. The FHIR records that the artefact authorises remain Category C and never enter any table.

This is a structural property of the schema, not a policy to follow — the DDL has no column where a PAN value or a FHIR resource payload can be written. A review that encounters such a column rejects the change.

---

## 4. Processing Modes

The storage_mode on the organisations table determines the data handling path. This check runs at the API gateway level before any data write.

| Mode | What ConsentShield Holds | Customer Storage | Who Manages Storage |
|---|---|---|---|
| **Standard** | Operational config + encrypted buffer | ConsentShield-provisioned R2 bucket, per-customer encryption key (delivered once, discarded) | ConsentShield provisions; customer holds key |
| **Insulated** | Operational config only | Customer's own R2 or S3 bucket. Write-only credential from ConsentShield. Cannot read, list, or delete. | Customer manages |
| **Zero-Storage** | Consent artefact index (TTL) + delivery buffer (seconds) | Customer's own bucket. Data flows through memory only. | Customer manages |

Zero-Storage is mandatory for health data. Insulated is the default for Growth tier and above. Standard is for Starter tier customers who cannot provision their own bucket.

---

## 5. Multi-Tenant Isolation

### 5.1 JWT Custom Claims

After signup and org creation, `org_id` and `org_role` are injected into every JWT via Supabase's custom access token hook:

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  claims jsonb; org_id uuid; org_role text;
begin
  claims := event -> 'claims';
  select om.org_id, om.role into org_id, org_role
  from organisation_members om where om.user_id = (event ->> 'user_id')::uuid limit 1;
  if org_id is not null then
    claims := jsonb_set(claims, '{org_id}', to_jsonb(org_id::text));
    claims := jsonb_set(claims, '{org_role}', to_jsonb(org_role));
  end if;
  return jsonb_set(event, '{claims}', claims);
end; $$;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
```

### 5.2 RLS Helper Functions

```sql
create or replace function current_org_id() returns uuid language sql stable as $$
  select (auth.jwt() ->> 'org_id')::uuid;
$$;

create or replace function is_org_admin() returns boolean language sql stable as $$
  select (auth.jwt() ->> 'org_role') = 'admin';
$$;
```

### 5.3 Isolation Enforcement Pattern

Every table follows one of three RLS patterns:

**Pattern 1 — Org-scoped read/write (operational tables):**
```sql
create policy "org select" on [table] for select using (org_id = current_org_id());
create policy "org insert" on [table] for insert with check (org_id = current_org_id());
create policy "org update" on [table] for update using (org_id = current_org_id());
```

**Pattern 2 — Org-scoped read-only (buffer tables written by service role):**
```sql
create policy "org select" on [table] for select using (org_id = current_org_id());
-- NO insert, update, or delete policy for authenticated users
-- Writes come exclusively from service role (bypasses RLS)
```

**Pattern 3 — Public insert, org-scoped read (rights requests):**
```sql
create policy "org select" on rights_requests for select using (org_id = current_org_id());
create policy "org update" on rights_requests for update using (org_id = current_org_id());
create policy "public insert" on rights_requests for insert with check (true);
-- Rate-limited at API layer: 5 requests/IP/hour
```

### 5.4 Scoped Database Roles (Principle of Least Privilege)

The previous architecture used a single service role key for all server-side operations. That is replaced with four scoped roles on the customer surface — `cs_worker`, `cs_delivery`, `cs_orchestrator`, `cs_api` — each with the minimum permissions required for its function. The admin surface carries its own `cs_admin` role (ADR-0027) and a carefully-scoped service-role carve-out for `auth.admin.*` operations (ADR-0045). The full service role key is retained only for schema migrations and manual admin operations — never in running customer-app code (verified by a CI grep gate introduced in ADR-1009 Phase 3).

**Role: cs_worker** (used by Cloudflare Worker)

```
CAN INSERT: consent_events, tracker_observations
CAN SELECT: consent_banners, web_properties (to serve banner config and verify signing secret)
CAN UPDATE: web_properties.snippet_last_seen_at only
CANNOT: read organisations, rights_requests, integration_connectors, audit_log, or any other table
```

If the Worker credential leaks, the attacker can insert garbage consent events but cannot read any customer data, any configuration, or any credentials. That is vandalism, not theft.

**Role: cs_delivery** (used by the delivery Edge Function)

```
CAN SELECT: all buffer tables (application-level convention: query WHERE delivered_at IS NULL)
            — includes consent_events, tracker_observations, audit_log, processing_log,
              delivery_buffer, rights_request_events, deletion_receipts, withdrawal_verifications,
              security_scans, consent_probe_runs, artefact_revocations (DEPA)
CAN UPDATE: delivered_at column on all buffer tables (same list)
CAN DELETE: all buffer tables (application-level convention: only rows WHERE delivered_at IS NOT NULL)
CAN SELECT: export_configurations (to read storage credentials for delivery)
CAN DELETE: consent_artefact_index (expired entries)
CAN SELECT: consent_artefacts (DEPA — to read delivered-to-customer-storage payload),
            purpose_definitions (DEPA — to include with artefact export),
            artefact_revocations (DEPA — buffer pattern)
CANNOT: read organisations, integration_connectors, consent_banners, or any operational table
        outside of what is needed to assemble the delivery payload.
```

If the delivery credential leaks, the attacker can read in-flight buffer rows (minutes of data, hashed/truncated) and export configuration (encrypted credentials they can't decrypt). They cannot access any operational data outside of the DEPA artefact metadata that is already being delivered to the customer.

**Role: cs_orchestrator** (used by Edge Functions + the invitation + signup-intake Next.js routes)

Connection patterns differ by runtime:

- **Edge Functions (Deno):** direct Postgres via the Supabase-hosted pool using `CS_ORCHESTRATOR_ROLE_KEY` (HS256 JWT, while the legacy signing secret is still alive; migration to direct-LOGIN tracked alongside ADR-1010 for the Worker).
- **Next.js runtime (customer app):** direct Postgres via the Supavisor pooler as the LOGIN role `cs_orchestrator.<project-ref>`, using `postgres.js` with `prepare: false`. See `app/src/lib/api/cs-orchestrator-client.ts` (ADR-1013). Seven Next.js-runtime callers use this path: signup-intake, invitation-dispatch, dispatch helper, lookup-invitation, internal/invites, run-probes, and **provision-storage** (ADR-1025 Sprint 2.1). The HS256 JWT path is fully retired from the Next.js runtime.

Env: `SUPABASE_CS_ORCHESTRATOR_DATABASE_URL` on the customer-app project (parity with `SUPABASE_CS_API_DATABASE_URL`).

The following is a summary of security-relevant permissions. See consentshield-complete-schema-design.md Section 5.1 for the complete GRANT list.

```
CAN INSERT: audit_log, processing_log, rights_request_events, deletion_receipts,
            withdrawal_verifications, security_scans, consent_probe_runs, delivery_buffer,
            consent_artefacts (DEPA — process-consent-event Edge Function fan-out),
            artefact_revocations (DEPA — system-originated revocations: expiry, regulatory),
            export_configurations (ADR-1025 Sprint 2.1 — provisioning route UPSERTs here after
                                   a successful verification probe; migration 20260804000037),
            export_verification_failures (ADR-1025 Sprint 1.3 — probe failures;
                                          migration 20260804000035),
            storage_migrations (ADR-1025 Sprint 3.2 — BYOK migration orchestrator;
                                migration 20260804000038)
CAN SELECT: accounts, account_memberships, organisations, org_memberships, web_properties,
            plans, tracker_signatures, integration_connectors, retention_rules,
            notification_channels, rights_requests, consent_artefact_index,
            consent_probes, data_inventory, invitations,
            deletion_receipts (ADR-1014 Sprint 3.4 — rpc_deletion_receipt_confirm reads the
                                row before updating; migration 20260804000030 added the grant
                                that was missing from the initial scoped-roles migration 010),
            export_configurations (ADR-1025 Sprint 2.1 — provisioning idempotency check;
                                   migration 20260804000037),
            storage_migrations (ADR-1025 Sprint 3.2 — migration orchestrator loads rows at
                                every chunk; migration 20260804000038),
            consent_events (DEPA — process-consent-event needs the originating event row),
            purpose_definitions (DEPA), purpose_connector_mappings (DEPA),
            consent_artefacts (DEPA), consent_expiry_queue (DEPA),
            depa_compliance_metrics (DEPA)
CAN UPDATE: rights_requests.status/assignee_id, consent_artefact_index.validity_state,
            accounts.plan_code/status/razorpay fields (post ADR-0044 — plan lives on account),
            consent_probes scheduling fields, integration_connectors health fields,
            retention_rules check fields, deletion_receipts status fields,
            withdrawal_verifications scan fields,
            export_configurations (ADR-1025 — full-row update via UPSERT; no column-level
                                   restriction because the orchestrator writes bucket_name +
                                   write_credential_enc + is_verified atomically),
            storage_migrations (ADR-1025 Sprint 3.2 — orchestrator advances state
                                queued→copying→completed/failed + bumps progress counters +
                                wipes to_credential_enc on terminal state),
            consent_events.artefact_ids (DEPA — reconcile back-reference after artefact creation),
            consent_artefacts.status (DEPA — expiry enforcement and replacement only),
            consent_expiry_queue.notified_at/processed_at/superseded (DEPA — expiry pipeline),
            depa_compliance_metrics.* (DEPA — nightly score refresh upsert)
CANNOT: read tracker_observations directly. Cannot delete any row (except invitations /
        account_memberships / org_memberships via membership-lifecycle RPCs).
```

**Role: cs_api** (used by `/api/v1/*` handlers in the customer app; introduced by ADR-1009 Phase 2)

```
NO direct table privileges — zero INSERT, SELECT, UPDATE, DELETE on any public table.
CAN EXECUTE: rpc_api_key_verify, rpc_api_key_status, rpc_api_request_log_insert
             (auth + telemetry bootstrap),
             rpc_consent_verify, rpc_consent_verify_batch, rpc_consent_record,
             rpc_artefact_list, rpc_artefact_get, rpc_artefact_revoke,
             rpc_event_list, rpc_deletion_trigger, rpc_deletion_receipts_list
             (the 9 v1 business RPCs — all SECURITY DEFINER, all fenced by
             assert_api_key_binding at the top of their bodies).
Connection:  direct Postgres via Supavisor pooler (aws-1-<region>.pooler.
             supabase.com:6543, transaction mode), not PostgREST.
             Runtime uses postgres.js singleton pool (app/src/lib/api/cs-api-client.ts).
```

Why direct Postgres instead of a `role: cs_api` JWT on Supabase REST (the pattern `SUPABASE_WORKER_KEY` uses today)? Supabase is rotating project JWT signing keys from HS256 (shared secret) to ECC P-256 (asymmetric). The legacy HS256 secret is flagged "Previously used" in the dashboard and slated for revocation; once revoked, every HS256-signed scoped-role JWT stops working. Direct Postgres connections as LOGIN roles are unaffected by the rotation. This is also the Worker's eventual migration path — tracked as a V2 backlog item.

If the cs_api credential leaks, the attacker can execute the 23 whitelisted v1 RPCs (ADR-1009: 9 business + 2 bootstrap + 1 key-status; ADR-1012: +5; ADR-1005 Sprint 5.1: +2 rights-API; ADR-1016: +3 orphan-scope reads; ADR-1005 Phase 2 Sprint 2.1: +1 test_delete) — but every one of them calls `assert_api_key_binding(p_key_id, p_org_id)` first, which refuses the call unless the plaintext-derived key_id matches the supplied org_id. So even with the credential, there is no cross-tenant read or write without also having a valid Bearer API key that's bound to the target organisation. No direct table reads are possible at all.

**The full service_role key** is never used in running customer-app code. It exists for:
- Schema migrations
- Manual database administration
- Emergency debugging (logged, audited, requires justification)
- The admin-app `auth.admin.*` carve-out (ADR-0045), scoped to user lifecycle operations behind AAL2 + `admin.require_admin('platform_operator')`.

Each role gets its own Supabase database password (for LOGIN roles) or JWT (for scoped roles on Supabase REST, while the HS256 path is still alive), stored as a separate environment variable. The Next.js runtime uses LOGIN + direct-Postgres for both `cs_api` (ADR-1009) and `cs_orchestrator` (ADR-1013); the HS256 JWT path is retained only by Edge Functions (cs_orchestrator, cs_delivery) and the Worker (cs_worker, tracked under ADR-1010).

---

## 6. The Consent Banner — Edge Architecture

### 6.1 Cloudflare Worker (cdn.consentshield.in)

The Worker handles three routes:

```
GET  /v1/banner.js          → Serve compiled banner script (with monitoring)
POST /v1/events             → Ingest consent event
POST /v1/observations       → Ingest tracker observation report
GET  /v1/health             → Health check
```

### 6.2 KV Store

```
banner:config:{propertyId}           → JSON banner config (includes allowed_origins), TTL 300s
banner:script:{propertyId}:{version} → Compiled banner.js string, TTL 3600s
banner:signing_secret:{propertyId}   → Current HMAC signing secret for event validation, TTL matches banner version
snippet:verified:{propertyId}        → '1' on each successful load, TTL 600s
```

### 6.3 Banner Script v2

The compiled script is a self-contained vanilla JS file (~26KB gzipped, zero npm dependencies). It performs two functions:

**Consent capture:** Render banner → capture user decision → compute HMAC signature → POST consent event → store in localStorage → dismiss banner.

**Tracker monitoring:** After consent resolves, start MutationObserver (DOM script injection) + PerformanceObserver (resource timing). 5-second initial observation window, 60-second extended window. Classify detected trackers against embedded signature database. Compare against consent state. POST observation report with any violations.

The compiled script includes the per-property HMAC signing secret (from `web_properties.event_signing_secret`). The secret rotates with each banner version. When a customer publishes a new banner, a new secret is generated, compiled into the new script, and the old secret is invalidated after a 1-hour grace period (to handle cached scripts).

### 6.4 Consent Event Ingestion

The Worker performs four validation steps before writing:

```
1. ORIGIN VALIDATION
   — Read Origin/Referer header from request
   — Compare against allowed_origins from banner config (cached in KV)
   — Match → proceed
   — Missing (server-side request) → proceed but flag payload as origin_unverified
   — Mismatch → reject with 403

2. HMAC VERIFICATION
   — Extract signature and timestamp from request body
   — Verify timestamp is within ±5 minutes of now (prevents replay attacks)
   — Compute HMAC-SHA256(org_id + property_id + timestamp, signing_secret)
   — Compare against provided signature
   — Match → proceed
   — Mismatch → reject with 403

3. PAYLOAD VALIDATION
   — Validate required fields: org_id, property_id, banner_id, event_type
   — Validate event_type is a known value
   — Truncate IP (remove last octet), hash user agent

4. WRITE (using cs_worker role — NOT service role)
   — INSERT into consent_events buffer
   — Return 202 immediately — a failed write must never break the user's browsing session
   — Dispatch delivery to customer storage asynchronously
```

### 6.5 Observation Report Ingestion

Same four-step validation as consent events (origin, HMAC, payload, write). HMAC uses the same per-property signing secret. Writes to tracker_observations buffer via cs_worker role.

### 6.6 Worker Rate Limiting

Configured in the Cloudflare dashboard (not in Worker code):

| Route | Limit | Action |
|---|---|---|
| POST /v1/events | 200 requests per IP per minute | Return 429 |
| POST /v1/observations | 100 requests per IP per minute | Return 429 |
| GET /v1/banner.js | 1000 requests per IP per minute | Return 429 |

These thresholds are generous for legitimate use (a single IP won't generate more than a handful of consent events). The HMAC signing (step 2 above) handles determined attackers who use distributed IPs — the rate limit handles casual abuse.

### 6.7 Consent Artefact Pipeline (DEPA)

*Added 2026-04-16 per the DEPA alignment review.*

The Worker's contract is unchanged: it validates a consent event, writes a row to `consent_events`, and returns 202. What's new is the DEPA fan-out that happens **downstream** of the Worker, asynchronously, without affecting the Worker's latency budget.

**Fan-out rule.** One `consent_events` row generates N `consent_artefacts` rows — one per purpose accepted. The banner's `purposes` JSONB array carries a `purpose_definition_id` for each purpose, which keys into the `purpose_definitions` table for the canonical `data_scope` and `default_expiry_days`. Artefacts copy those fields at creation time (stable snapshot — the artefact's `data_scope` does not change if the purpose definition is later edited).

**No legacy accommodation.** Every purpose on every banner MUST carry a `purpose_definition_id`. This is a hard constraint, not a migration-era softening. Banner save and banner publish endpoints reject the request with HTTP 422 if any purpose object in the `purposes` JSONB array lacks a `purpose_definition_id`. The `process-consent-event` Edge Function asserts the mapping exists when processing an event; if a mapping is missing, it writes a `consent_events_misconfigured` audit entry, fires a P1 alert via the notification channels, and creates zero artefacts. The flow is broken and visible, not silently accommodated. The DEPA `coverage_score` sub-metric is expected to read 100% at all times — any lower reading is a configuration bug to be caught and fixed, not a gradient to tolerate.

**Two Edge Functions drive the pipeline:**

- **`process-consent-event`** — reads a new `consent_events` row, looks up each accepted purpose in `purpose_definitions`, creates one `consent_artefacts` row per mapped purpose, upserts each into `consent_artefact_index` (validity cache), inserts corresponding `consent_expiry_queue` rows, stages the artefacts in `delivery_buffer` for export, and finally updates `consent_events.artefact_ids` with the created IDs.
- **`process-artefact-revocation`** — fires after an INSERT into `artefact_revocations`. The in-database cascade trigger (`trg_artefact_revocation_cascade`) already transitioned `consent_artefacts.status` to `'revoked'`, removed it from `consent_artefact_index`, superseded matching `consent_expiry_queue` rows, and wrote the audit log entry. The Edge Function handles the **out-of-database cascade**: looks up `purpose_connector_mappings` for the artefact's `purpose_definition_id`, intersects each connector's `data_fields` with the artefact's `data_scope`, and creates one `deletion_receipts` row per connector (`trigger_type='consent_revoked'`, `status='pending'`, `artefact_id` populated). The existing delivery dispatcher then pushes each receipt to the connector webhook and updates it to `confirmed`/`failed` on callback.

**Trigger mechanism — hybrid (Q2 Option D from the 2026-04-16 review).** The primary path is an `AFTER INSERT` trigger on `consent_events` whose body calls `net.http_post()` to invoke `process-consent-event` — the same primitive the HTTP cron jobs use. Trigger body is wrapped in `EXCEPTION WHEN OTHERS THEN NULL` so a failing trigger cannot roll back the Worker's INSERT (Worker always returns 202). The secondary path is a pg_cron job every 5 minutes that sweeps `consent_events WHERE artefact_ids = '{}' AND created_at < now() - interval '5 minutes'` and re-fires the same Edge Function. Typical latency sub-second; worst-case 5 minutes.

**Idempotency contract (load-bearing).** The Edge Function is idempotent by convention: `SELECT count(*) FROM consent_artefacts WHERE consent_event_id = $1` — if > 0, it skips creation and only reconciles `consent_events.artefact_ids` from the existing rows. This prevents duplicate artefacts when both trigger and safety-net cron paths land for the same event.

**Orphan event detection.** A compliance metric `orphan_consent_events` counts `consent_events` rows where `artefact_ids = '{}'` and `created_at > now() - interval '10 minutes'`. Any non-zero value on the dashboard indicates a stuck pipeline. Alert fires via the notification channels.

**Data flow summary:**

```
Worker validates + writes consent_events row + returns 202 to browser
    │
    ▼
AFTER INSERT trigger on consent_events
    └─→ net.http_post(process-consent-event)   (EXCEPTION → NULL, non-blocking)
            │
            ▼
        process-consent-event Edge Function (cs_orchestrator)
            ├─ idempotency check: count artefacts for consent_event_id
            ├─ lookup purpose_definitions for each purpose
            ├─ INSERT N rows into consent_artefacts (with data_scope snapshot)
            ├─ UPSERT into consent_artefact_index (validity cache)
            ├─ INSERT into consent_expiry_queue (notify_at = expires_at - 30 days)
            ├─ INSERT into delivery_buffer (stage for nightly export)
            ├─ UPDATE consent_events SET artefact_ids = ARRAY[...]
            └─ INSERT audit_log

Safety net (pg_cron every 5 min):
    SELECT consent_events WHERE artefact_ids = '{}' AND created_at < now() - 5 min
        └─→ re-fire process-consent-event for each (idempotent)
```

---

## 7. The Stateless Oracle Pipeline

This is the core data flow for all user data.

```
Event source (Worker, Edge Function, API route)
    │
    ▼
Buffer table (consent_events, audit_log, tracker_observations, etc.)
    │  Row created with delivered_at = null
    │
    ▼
Delivery Edge Function
    │  Reads undelivered rows
    │  Writes to customer storage (R2/S3)
    │  On confirmed write:
    │    → SET delivered_at = now() on the buffer row
    │    → Hard-delete the row immediately
    │  On failed write:
    │    → Increment attempt_count
    │    → Log delivery_error
    │    → Retry per backoff schedule
    │    → After 10 failures: alert, hold for manual review
    │
    ▼
Customer-owned storage (R2/S3)
    │  Canonical compliance record
    │  Encrypted with customer-held key
    │  Survives ConsentShield shutdown
    │
    ▼
DPB audit export (read from customer storage, not from ConsentShield)
```

### 7.1 Buffer Lifecycle — Zero Tolerance for Stale Data

The buffer tables are write-ahead logs. A row's lifecycle is measured in seconds to minutes, not hours or days.

**Immediate deletion path (preferred):**

```sql
-- Inside the delivery Edge Function, after confirmed write to customer storage:
-- Step 1: Mark delivered
UPDATE consent_events SET delivered_at = now() WHERE id = $1 AND delivered_at IS NULL;
-- Step 2: Delete immediately
DELETE FROM consent_events WHERE id = $1 AND delivered_at IS NOT NULL;
-- These two statements run in the same transaction.
```

The previous architecture used a "nightly purge" approach. That is wrong. A consent event that was successfully delivered at 14:32 has no reason to exist in ConsentShield's database at 14:33. The deletion is immediate, not scheduled.

**Superseded timing:** The earlier technical architecture document specified "hard-delete delivered buffer rows older than 48 hours." That 48-hour window is explicitly superseded. The correct timing is: immediate deletion on confirmed delivery, 5-minute threshold on the safety-net sweep, 1-hour threshold for stuck-row alerts, 24-hour threshold for P0 escalation. No buffer row should exist for 48 hours under any circumstance — that would represent a multi-day delivery pipeline failure.

**Fallback sweep (safety net):**

Even with immediate deletion, edge cases can leave orphaned rows (process crash between mark and delete, delivery confirmation received but delete failed). A pg_cron job runs every 15 minutes to catch these:

```sql
-- Every 15 minutes: delete any rows delivered more than 5 minutes ago
-- This should find 0 rows in normal operation. If it finds rows, something went wrong.
DELETE FROM consent_events WHERE delivered_at IS NOT NULL AND delivered_at < now() - interval '5 minutes';
DELETE FROM tracker_observations WHERE delivered_at IS NOT NULL AND delivered_at < now() - interval '5 minutes';
DELETE FROM audit_log WHERE delivered_at IS NOT NULL AND delivered_at < now() - interval '5 minutes';
DELETE FROM processing_log WHERE delivered_at IS NOT NULL AND delivered_at < now() - interval '5 minutes';
DELETE FROM delivery_buffer WHERE delivered_at IS NOT NULL AND delivered_at < now() - interval '5 minutes';
DELETE FROM artefact_revocations WHERE delivered_at IS NOT NULL AND delivered_at < now() - interval '5 minutes';  -- DEPA
```

**Stuck row detection (alert, don't silently lose data):**

```sql
-- Every hour: alert on rows that have been undelivered for > 1 hour
-- These represent delivery failures that need investigation
SELECT count(*) FROM consent_events WHERE delivered_at IS NULL AND created_at < now() - interval '1 hour';
-- If count > 0: fire alert via notification channels
```

**Hard limit (compliance emergency):**

```sql
-- Any row in a buffer table older than 24 hours is a compliance emergency.
-- It means the delivery pipeline has been broken for a full day.
-- This should NEVER fire in normal operation.
SELECT count(*) FROM consent_events WHERE created_at < now() - interval '24 hours';
-- If count > 0: page the developer. This is a P0.
```

### 7.2 Export Storage Configuration

Stored in `export_configurations` per organisation. Credentials are encrypted at rest using pgcrypto with a server-side encryption key.

**Write-only access pattern:** The IAM credential stored permits `PutObject` only. Cannot read, list, or delete. If compromised, the attacker gains write access to an encrypted bucket they cannot decrypt.

**Default (Standard mode):** ConsentShield provisions a Cloudflare R2 bucket within its own account, scoped to a per-customer path prefix. A per-customer encryption key is generated, delivered to the customer once, and discarded. ConsentShield cannot read the exported data.

**BYOS (Insulated/Zero-Storage mode):** Customer provides their own bucket and a write-only credential. ConsentShield validates the credential on setup (test write + verify), stores it encrypted, and uses it for all exports.

### 7.3 Consent Artefact Lifecycle (Category A, delivered via staging)

*Added 2026-04-16 per the DEPA alignment review.*

`consent_artefacts` is Category A (operational) — it is not a buffer table. Rows are not deleted when delivery is confirmed, because an active artefact is the live authorisation record for the data flow it governs. Deletion of an artefact row happens only when the organisation is cascade-deleted (via `organisations ON DELETE CASCADE`); status transitions (revoked, expired, replaced) update the status column but leave the row in place.

The "delivered to customer storage" orthogonal property (introduced in §3) applies: every insert and every status transition also stages a `delivery_buffer` row so the customer's canonical compliance record stays in sync. The staging row **is** Category B and follows the standard deliver-then-delete lifecycle; the source `consent_artefacts` row is unaffected by staging-row deletion.

**Lifecycle states and transitions:**

```
                    ┌──────────┐
                    │  active  │ ◄── created by process-consent-event
                    └─────┬────┘
              ┌───────────┼─────────────┐
              ▼           ▼             ▼
         ┌─────────┐  ┌─────────┐  ┌─────────┐
         │ revoked │  │ expired │  │ replaced│
         └─────────┘  └─────────┘  └─────────┘
         (artefact_   (enforce_     (new consent
         revocations  artefact_     interaction
         INSERT +     expiry()      creates successor
         trigger)     pg_cron)      artefact)
```

**Replacement chain semantics (S-5 from the review, decided).** If artefact A is replaced by B (re-consent), and B is later revoked, A's status stays frozen at `replaced`. Revocation of B creates an `artefact_revocations` row referencing B only and does **not** walk the `replaced_by` chain. Rationale: the chain is a *historical* record of how consent was re-obtained, not a live authorisation chain. Only the most recent non-replaced artefact authorises the current data flow.

**What's retained, what's staged:**

| Action | `consent_artefacts` | `delivery_buffer` staging |
|---|---|---|
| Artefact created | Row inserted, `status = 'active'` | `event_type = 'artefact_created'` staged |
| Artefact revoked | Status updated to `'revoked'` (row stays) | `event_type = 'artefact_revoked'` staged |
| Artefact expired | Status updated to `'expired'` (row stays) | `event_type = 'artefact_expired'` staged |
| Artefact replaced | Status updated to `'replaced'`, `replaced_by` set (row stays) | `event_type = 'artefact_replaced'` staged |
| Org cascade-delete | All rows removed | Staging rows that weren't yet delivered orphan — caught by the 1-hour stuck-detection alert |

**Safety invariant.** A compliance audit reading only the customer's storage can reconstruct the complete artefact lifecycle from the staged events alone — the ConsentShield `consent_artefacts` table is the working set, not the canonical record.

---

## 8. Enforcement Engine

### 8.1 Tracker Detection

The banner script's monitoring module observes third-party requests after the consent decision. Each detected request is classified against the embedded tracker signature database (JSON, ~15KB, covering 40+ services common on Indian websites).

Classification produces:
```
Detected domain → Known service → Purpose category → Consent required?
    → Compare against user's actual consent state
    → Match = compliant | Mismatch = violation
```

Violations are included in the observation report POSTed to the Worker.

**False positive mitigation:**
1. Functional allowlist — payment gateways, CAPTCHA, essential chat widgets are never flagged
2. 60-second grace period after consent change (cached scripts may fire)
3. Customer-configurable overrides via tracker_overrides table

### 8.2 Consent Withdrawal Verification

On `consent_withdrawn` event, the delivery Edge Function schedules three verification scans:

| Scan | Delay | Catches |
|---|---|---|
| Scan 1 | T + 15 minutes | Immediate enforcement failures |
| Scan 2 | T + 1 hour | Cached script issues |
| Scan 3 | T + 24 hours | Persistent violations |

Each scan: HTTP GET customer's page → parse HTML for tracker scripts → compare against withdrawn consent purposes → log result.

Client-side monitoring (banner script) catches dynamic trackers in real user sessions. Server-side scans catch hardcoded scripts at any time. Together they cover the most important violation patterns.

### 8.3 Security Posture Scanning

Nightly Vercel Cron (02:00 IST) per web property:

| Check | Method | Severity |
|---|---|---|
| SSL certificate | TLS handshake | Critical if expired |
| HSTS header | HTTP response | Warning if missing |
| CSP header | HTTP response | Warning if missing/partial |
| X-Frame-Options | HTTP response | Info |
| Vulnerable JS libraries | Script version vs CVE DB | Critical |
| Mixed content | HTML parse | Warning |
| Cookie flags | Set-Cookie inspection | Warning |

### 8.4 Deletion Orchestration (Artefact-Scoped)

*Amended 2026-04-16 per the DEPA alignment review. Re-amended 2026-04-17 per ADR-0022 to reflect the single-table (`deletion_receipts`) dispatch+receipt model. The generic webhook protocol is preserved; the orchestration inputs and deletion scoping are the DEPA change.*

Deletion is **artefact-scoped**. Every `deletion_receipts` row references an `artefact_id` (nullable for non-artefact-triggered deletions — see below). One `deletion_receipts` row represents **one connector instruction for one deletion trigger**: created with `status='pending'` when dispatched, transitioned to `status='confirmed'` or `status='failed'` when the customer's webhook callback fires. Per ADR-0022 Option 2, there is no separate `deletion_requests` table — the two semantic roles (instruction vs. proof) are disambiguated by `status`.

**Scoping rule:**

1. **Resolve the artefact** — read `consent_artefacts.data_scope` for the triggering artefact.
2. **Map to connectors** — `SELECT * FROM purpose_connector_mappings WHERE purpose_definition_id = <artefact's purpose_definition_id>`. Each row declares which connector handles which subset of the artefact's data_scope.
3. **Create scoped deletion receipts** — one `deletion_receipts` row per connector, with `status='pending'`, `trigger_id=<revocation_id | expiry_queue_id | rights_request_id>`, `artefact_id` populated, and `request_payload.data_scope` set to the intersection of the mapping's `data_fields` with the artefact's `data_scope`. Deduplicate. Idempotency enforced by `UNIQUE (trigger_id, connector_id) WHERE trigger_type = 'consent_revoked'`.
4. **Dispatch** — the existing delivery pathway calls each connector with the scoped payload and updates `status` on callback.

This replaces the prior blanket "delete the user from every connector" pattern. A user withdrawing their `marketing` consent no longer triggers a bureau-reporting deletion at a banking customer (bureau is governed by a different artefact).

**Deletion triggers and their inputs:**

| Trigger | `deletion_receipts.trigger_type` | `artefact_id` | Scope |
|---|---|---|---|
| `artefact_revocations` INSERT (user-withdrawn consent) | `consent_revoked` | The revoked artefact | Only connectors mapped to the artefact's purpose |
| `enforce_artefact_expiry()` pg_cron (TTL lapse) | `consent_expired` | The expired artefact | Same |
| Rights-portal erasure request (DPDP Section 13) | `erasure_request` | `NULL` — sweeps *all* active artefacts for the requestor's session fingerprints | All connectors mapped to any active artefact |
| Retention-rule expiry on a Category B buffer | `retention_expired` | `NULL` — data-scope-driven, not artefact-driven | Connectors mapped to the data category |

**Generic webhook protocol (DPDP-era fields):**
```json
POST customer's endpoint:
{
  "event": "deletion_request",
  "receipt_id": "uuid",                           // = deletion_receipts.id
  "artefact_id": "cs_art_01HXX2",                 // DEPA — null for non-artefact triggers
  "data_principal": { "identifier": "...", "identifier_type": "email" },
  "data_scope": ["email_address", "name"],        // DEPA — what to delete, per this artefact
  "reason": "consent_revoked",                    // DEPA — 'consent_revoked' | 'consent_expired' | 'erasure_request' | 'retention_expired'
  "callback_url": "https://api.consentshield.in/v1/deletion-receipts/{receipt_id}?sig={HMAC}",
  "deadline": "ISO timestamp"
}

Customer callback (unchanged):
{
  "receipt_id": "uuid",
  "status": "completed | partial | failed",
  "records_deleted": 47,
  "completed_at": "ISO timestamp"
}
```

The callback URL's HMAC signature and state-guard verification (Rule 14) are unchanged from the pre-DEPA design. On a successful callback the dispatcher transitions the same `deletion_receipts` row from `pending` to `confirmed` in place.

**Chain of custody.** Every artefact-triggered deletion has a three-link audit chain: `consent_artefacts.artefact_id → artefact_revocations.artefact_id → deletion_receipts.artefact_id`. Rights-portal erasures and retention-rule expiries produce two-link chains starting at `rights_requests`/`retention_rules` respectively. An auditor can reconstruct which user consented, when they withdrew, which systems were instructed to delete which fields, and when each system confirmed. This is the DPDP Section 12 evidence trail.

**Pre-built connectors** (Mailchimp, HubSpot; more planned) continue to follow the standard `DeletionConnector` interface. The connector authors do not see a contract change — they receive a `data_scope` array in the deletion payload and are responsible for deleting only those fields, not the entire contact. Legacy connectors written before DEPA alignment may ignore `data_scope` and delete the whole contact; the orchestration allows this as a degraded mode but flags it via the `degraded_deletion_scope` audit event.

Every deletion produces an immutable `deletion_receipts` row (Category B buffer) exported to customer storage as DPB evidence.

### 8.5 Consent Probe Testing Engine (Phase 3)

Consent probes are synthetic compliance tests. ConsentShield loads a customer's website in a controlled environment, sets a specific consent state, and verifies that the site respects it. This is the automated equivalent of a human auditor visiting the site and checking whether trackers fire after consent is denied.

**How probes work:**

```
1. Probe definition (stored in consent_probes table):
   — Target: web property URL
   — Consent state to simulate: e.g. { analytics: false, marketing: false }
   — Schedule: weekly | daily | on-demand

2. Probe execution (Vercel Cron → Edge Function):
   — HTTP GET the target URL with a headless browser or HTTP client
   — Inject the simulated consent state (bypass the banner, set consent directly)
   — Wait for page to fully load (5 seconds)
   — Collect all third-party resource requests (same technique as banner script monitoring)
   — Classify each detected tracker against the signature database
   — Compare classifications against the simulated consent state

3. Result (stored in consent_probe_runs buffer table):
   — List of trackers detected
   — List of violations (tracker loaded that should have been blocked by the simulated consent state)
   — Duration, status, error message if probe failed
   — Delivered to customer storage, then deleted from buffer

4. Alerting:
   — Violations → alert via notification channels
   — Compliance score impacted by probe failures
```

**What probes catch that real-time monitoring doesn't:**

Real-time monitoring (banner script v2) depends on actual user visits. A page that gets 10 visits per day may take weeks to accumulate enough observations for statistical confidence. Probes test every consent state combination on a schedule, regardless of traffic.

Probes also catch server-side rendering issues: a tracker script hardcoded in a Next.js `<Head>` component that loads before the banner script can intervene. Real-time monitoring misses this because the banner script can only observe what happens after it loads. The probe loads the page from scratch and sees everything.

**Limitations:**

Probes use HTTP-level inspection, not a full browser. They catch script tags and resource URLs but cannot execute JavaScript to detect dynamically injected trackers that load via `createElement('script')`. For dynamic trackers, the banner script's MutationObserver in real user sessions remains the primary detection mechanism. Probes and real-time monitoring are complementary — neither alone is sufficient.

---

## 9. Platform Strategy and Notification Architecture

### 9.1 No Native Mobile App (Phases 1–3)

No workflow in Phases 1–3 justifies the install friction, app store dependency, and maintenance burden of a native mobile app. ConsentShield's customers are SaaS founders and compliance managers who work at desks. The dashboard is a responsive web application. The rights request inbox is optimised for mobile browsers.

For alerts (tracker violations, SLA warnings, breach events), notification channels replace push notifications. Alerts reach users wherever they already work — email for founders, Slack for engineering teams, Teams for enterprise compliance officers.

A native app (React Native) enters scope only if Phase 4 clinic pilots validate that Progressive Web App camera limitations on iOS genuinely block the ABHA QR scan workflow in real clinic conditions. Until then, the tablet-optimised clinic web interface handles patient queue management, ABHA lookup (manual entry + web camera), and consent-gated record display.

### 9.2 Notification Channels

All alerts delivered through configurable channels:

| Channel | Method | Delivery guarantee |
|---|---|---|
| Email (Resend) | Transactional email to compliance contact | Always on, primary channel |
| Slack | Incoming webhook to configured channel | Configurable per alert type |
| Microsoft Teams | Incoming webhook | Configurable per alert type |
| Discord | Webhook | Configurable per alert type |
| Custom webhook | POST to customer endpoint | For PagerDuty, OpsGenie, etc. |

Alert types (each independently configurable per channel):
- Tracker violations detected
- New rights request received
- SLA warning (7 days remaining)
- SLA overdue
- Consent withdrawal verification failure
- Security scan: new critical finding
- Retention period expired
- Deletion orchestration failure
- Consent probe failure
- Compliance score change (daily summary)

---

## 10. API Surface

### 10.1 Public Endpoints (no auth)

| Route | Method | Handler | Protection |
|---|---|---|---|
| cdn.consentshield.in/v1/banner.js | GET | Cloudflare Worker — serve banner | Rate limit: 1000/IP/min |
| cdn.consentshield.in/v1/events | POST | Cloudflare Worker — ingest consent event | HMAC signature + origin validation + rate limit: 200/IP/min |
| cdn.consentshield.in/v1/observations | POST | Cloudflare Worker — ingest tracker observation | HMAC signature + origin validation + rate limit: 100/IP/min |
| /api/public/rights-request | POST | Next.js API — submit rights request | Cloudflare Turnstile + email OTP + rate limit: 5/IP/hour |
| /api/public/signup-intake | POST, OPTIONS | Next.js API — marketing-site signup intake (ADR-0058) | CORS allow-list + Cloudflare Turnstile + per-IP 5/60s + per-email 3/hour + existence-leak parity |
| /api/v1/deletion-receipts/{id} | POST | Next.js API — deletion callback | HMAC-signed callback URL |

**Rights request submission flow (hardened):**

```
1. Data Principal fills form on customer's privacy page
2. Cloudflare Turnstile validates the browser environment (invisible, no puzzle)
   → If Turnstile fails: reject, do not create any database row
3. Server sends OTP to the provided email address (via Resend)
   → Row created in rights_requests with email_verified = false
   → No notification sent to compliance contact yet
4. Data Principal enters OTP
   → Server verifies OTP, sets email_verified = true
   → NOW: notification email sent to compliance contact
   → SLA 30-day clock starts from the original submission time (not OTP verification time)
5. If OTP is not verified within 24 hours: row is auto-deleted (abandoned submission)
```

This ensures the notification email — the one that could be used as a spam vector — only fires after a verified human with access to the provided email address submitted the request.

**Split-flow customer onboarding (ADR-0058 — shipped):**

```
consentshield.in/pricing → /signup?plan=<code>
  └─ Turnstile + cross-origin POST
      → app.consentshield.in/api/public/signup-intake
          → public.create_signup_intake (cs_orchestrator, SECURITY DEFINER)
              → INSERT public.invitations (origin='marketing_intake',
                                            account_id=null, org_id=null,
                                            plan_code=set, default_org_name=set)
              → AFTER INSERT trigger → net.http_post → Resend
              → /onboarding?token=<48hex>
                  → 7-step wizard:
                      1. OTP → accept_invitation (creates account + org + memberships)
                      2. Industry picker → update_org_industry
                      3. Data inventory (3 yes/no) → seed_quick_data_inventory
                      4. Sector template → apply_sectoral_template
                      5. Snippet install + SSRF-defended verify
                      6. DEPA score review
                      7. First-consent watch (5-second poll, 5-minute timeout)
                      → /dashboard?welcome=1
```

The admin-side `/accounts/new-intake` mirrors the shape but calls `admin.create_operator_intake` with `origin='operator_intake'` — same `public.invitations` row shape, same dispatch pipeline, same wizard. The shared-table design is deliberate: one set of integration tests covers both flows; `origin` is a hint that drives email copy and analytics labelling only.

Invitations with `origin in ('marketing_intake','operator_intake')` expire after 14 days (pg_cron sweep). Wizard progress is persisted via `organisations.onboarding_step` (0..7) so a refresh resumes at the last completed step; step-timing telemetry lands in the append-only `public.onboarding_step_events` buffer. In-wizard plan swap is available from Step 2 onward (Starter ↔ Growth ↔ Pro) via `public.swap_intake_plan`, gated by `onboarded_at is null`.

Rule 12 (identity isolation) enforces that admin identities cannot accept customer intakes — `accept_invitation` refuses any caller whose JWT carries `app_metadata.is_admin = true`, and the customer-app proxy rejects admin identities from `/onboarding` with a 403 + admin-origin hint.

### 10.2 Authenticated Endpoints (Supabase JWT)

| Route | Method | Purpose |
|---|---|---|
| /api/orgs/[orgId]/banners | GET, POST | List/create consent banners |
| /api/orgs/[orgId]/banners/[id]/publish | POST | Activate banner, invalidate KV |
| /api/orgs/[orgId]/inventory | GET, POST, PATCH | Data inventory CRUD |
| /api/orgs/[orgId]/rights-requests | GET | List rights requests |
| /api/orgs/[orgId]/rights-requests/[id] | PATCH | Update request (assign, verify, respond) |
| /api/orgs/[orgId]/rights-requests/[id]/events | POST | Append workflow event |
| /api/orgs/[orgId]/breaches | GET, POST | List/create breach notifications |
| /api/orgs/[orgId]/audit/export | POST | Generate audit package |
| /api/orgs/[orgId]/settings | GET, PATCH | Organisation settings |
| /api/orgs/[orgId]/integrations | GET, POST, DELETE | Manage connectors |
| /api/orgs/[orgId]/integrations/[id]/delete | POST | Trigger deletion via connector |
| /api/orgs/[orgId]/notifications | GET, PATCH | Notification channel config |
| /api/orgs/[orgId]/purpose-definitions | GET, POST | (DEPA) List/create purpose definitions |
| /api/orgs/[orgId]/purpose-definitions/[id] | GET, PATCH | (DEPA) Read/update a purpose definition |
| /api/orgs/[orgId]/purpose-definitions/[id]/connectors | GET, POST, DELETE | (DEPA) Manage purpose → connector mappings |
| /api/orgs/[orgId]/artefacts | GET | (DEPA) List consent artefacts (filter: status, framework, purpose_code, expiring_before) |
| /api/orgs/[orgId]/artefacts/[id] | GET | (DEPA) Read one artefact with its full audit trail |
| /api/orgs/[orgId]/artefacts/[id]/revoke | POST | (DEPA) Revoke an artefact — creates an `artefact_revocations` row |
| /api/orgs/[orgId]/expiry-queue | GET | (DEPA) List upcoming expiry notifications |
| /api/orgs/[orgId]/expiry-queue/export | POST | (DEPA) Export expiring session fingerprints for re-consent campaign |
| /api/orgs/[orgId]/depa-score | GET | (DEPA) Read the cached DEPA compliance score + sub-metrics |
| /api/orgs/[orgId]/onboarding/status | GET | (ADR-0058) Read onboarding watermarks (onboarding_step, onboarded_at, first_consent_at) — polled by wizard Step 7 |
| /api/orgs/[orgId]/onboarding/verify-snippet | POST | (ADR-0058) SSRF-defended server fetch of a customer URL + regex scan for `<script[^>]+banner\.js`; stamps `web_properties.snippet_verified_at` on pass |

### 10.3 Compliance API (API key auth — Pro/Enterprise)

**Status:** Bearer middleware shipped (ADR-1001 Sprint 2.2). Route handlers ship in ADR-1002 onward.

#### Auth model

```
Authorization: Bearer cs_live_<base64url-32-bytes>
```

Every `/api/v1/*` request (except `/api/v1/deletion-receipts/*`, which uses HMAC callback verification) passes through the **Bearer gate** in `app/src/proxy.ts` (Next.js 16 proxy — runs on Node.js, not Edge):

1. Proxy parses the `Authorization` header. Missing or non-`cs_live_` → 401.
2. Proxy calls `public.rpc_api_key_verify(p_plaintext)` via a service-role Supabase client. The RPC computes `SHA-256(plaintext)` and matches against `api_keys.key_hash` (active key) or `api_keys.previous_key_hash` (dual-window rotation). Returns a JSONB context object or null.
3. If null: a secondary query checks whether a row with that hash exists but has `revoked_at IS NOT NULL` → 410 (Gone). Otherwise → 401.
4. On success: the proxy checks the rate limit for the key's tier (via the ADR-0010 Upstash-backed `checkRateLimit`, bucket = `api_key:<key_id>`, 1-hour window). Exceeded → 429 with `Retry-After` + `X-RateLimit-Limit` headers.
5. On success: the proxy stamps six request headers — `x-api-key-id`, `x-api-account-id`, `x-api-org-id`, `x-api-scopes` (comma-separated), `x-api-rate-tier`, `x-cs-t` (epoch ms, for latency tracking) — and calls `NextResponse.next({ request: { headers } })`.
6. Route handlers read context via `getApiContext()` from `app/src/lib/api/context.ts`. Per-handler scope enforcement uses `assertScope(context, 'read:consent')` which returns a 403 problem+json response if the key lacks the scope.
7. Each route handler calls `logApiRequest(context, route, method, statusCode, latencyMs)` (fire-and-forget) which inserts a row via `rpc_api_request_log_insert` using the service-role client. Failures are silently swallowed so logging never affects the response.

All error responses are **RFC 7807 problem+json** (`Content-Type: application/problem+json`):

| Status | Trigger |
|--------|---------|
| 401 | Missing/malformed/invalid Bearer token |
| 403 | Key is valid but lacks the required scope |
| 410 | Key has been revoked |
| 429 | Rate limit exceeded — per `api_keys.rate_tier` → `public.plans.api_rate_limit_per_hour` |

#### `cs_api` Postgres role

A minimum-privilege Postgres role (`cs_api`) created in migration `20260520000001_api_keys_v2.sql`:
- EXECUTE on `public.rpc_api_key_verify` only
- No direct table DML
- Intended for future direct-connection poolers (PgBouncer, Supavisor); the current Next.js proxy uses `service_role` for the REST API call because Supabase REST does not support custom Postgres roles

#### API key lifecycle

Keys are issued, rotated, and revoked via SECURITY DEFINER RPCs (`rpc_api_key_create`, `rpc_api_key_rotate`, `rpc_api_key_revoke`). Plaintext is returned only at creation time — `key_hash` (SHA-256 hex) is stored. Rotation preserves the key `id`, moves the old hash to `previous_key_hash` with a 24-hour expiry window, and issues a new plaintext. Revocation sets `revoked_at` and clears `previous_key_hash` so both plaintexts stop working immediately.

Usage is logged in `public.api_request_log` (day-partitioned, 90-day retention).

#### Canary / internal

`GET /api/v1/_ping` — returns `{ ok: true, org_id, account_id, scopes, rate_tier }` from the proxy-injected headers. Used to smoke-test key issuance end-to-end.

#### Route table

| Route | Method | Required scope |
|---|---|---|
| /api/v1/_ping | GET | *(any valid key)* |
| /api/v1/consent/events | GET | read:consent |
| /api/v1/consent/score | GET | read:score |
| /api/v1/tracker/violations | GET | read:tracker |
| /api/v1/rights/requests | GET, POST | read:rights, write:rights |
| /api/v1/deletion/trigger | POST | write:deletion |
| /api/v1/deletion/receipts | GET | read:deletion |
| /api/v1/audit/export | GET | read:audit |
| /api/v1/security/scans | GET | read:security |
| /api/v1/probes/results | GET | read:probes |
| /api/v1/artefacts | GET | (DEPA) read:artefacts |
| /api/v1/artefacts/[id] | GET | (DEPA) read:artefacts |
| /api/v1/artefacts/[id]/revoke | POST | (DEPA) write:artefacts |
| /api/v1/expiry/upcoming | GET | (DEPA) read:artefacts |
| /api/v1/purpose-definitions | GET | (DEPA) read:consent |

#### Rate-tier mapping (ADR-1001 Sprint 2.4 — shipped)

Rate windows are defined in `public.plans.api_rate_limit_per_hour` + `api_burst` (migration 20260601000001) and enforced at proxy time per `api_keys.rate_tier`. A static mirror in `app/src/lib/api/rate-limits.ts` avoids a per-request DB query in middleware.

| Tier | Requests / hour | Burst |
|------|----------------|-------|
| trial / trial_starter / starter / sandbox | 100 | 20 |
| growth | 1 000 | 100 |
| pro | 10 000 | 500 |
| enterprise | 100 000 | 2 000 |

#### Request audit log

Every `/api/v1/*` route handler records a row in `public.api_request_log` (day-partitioned, 90-day retention via pg_cron) via `rpc_api_request_log_insert` (SECURITY DEFINER, service_role grant). The RPC accepts `(key_id, org_id, account_id, route, method, status, latency_ms)`. Failures are swallowed server-side so logging never breaks a response.

`rpc_api_key_usage(key_id, days=7)` — SECURITY DEFINER, `authenticated` grant — returns `(day, request_count, p50_ms, p95_ms)` for the usage dashboard at `/dashboard/settings/api-keys/[id]/usage`.

---

## 11. Security Rules — Non-Negotiable

These are architectural constraints, not feature decisions. They cannot be relaxed without rebuilding significant parts of the product.

**Rule 1 — No single key unlocks everything.** Three scoped database roles (cs_worker, cs_delivery, cs_orchestrator) replace the single service role key in all running application code. Each role has the minimum permissions for its function. The full service role is for migrations and emergency admin only — never in running code.

**Rule 2 — Buffer tables are append-only for authenticated users.** No UPDATE or DELETE RLS policy exists on any buffer table for any user role. No INSERT privilege for the `authenticated` role on critical buffers (consent_events, tracker_observations, audit_log, processing_log, delivery_buffer, **artefact_revocations**). Only the scoped service roles can write. Delivered rows are deleted by the cs_delivery role immediately after confirmed delivery. The DEPA `consent_artefacts` table is Category A (operational) rather than a buffer, but is also append-only for `authenticated` — see Rule 19.

**Rule 3 — Regulated sensitive content is never persisted.** *(Scope broadened 2026-04-16 per the DEPA alignment review.)* Content-layer data governed by sector-specific retention regulation — FHIR clinical records under ABDM; banking identifiers (PAN values, Aadhaar values, bank account numbers, account balances, transaction records, repayment history) under RBI KYC / PMLA / Credit Information Companies Act / Banking Regulation Act; and any future sector's regulated content — flows through ConsentShield's server in memory only, if at all. No schema, no table, no log, no buffer ever holds regulated sensitive content. The DEPA artefact model is structurally compatible with this rule: `consent_artefacts.data_scope` is a **category declaration** like `['pan', 'account_balance']` or `['MedicationRequest', 'Observation']`, never an actual value like `'ABCDE1234F'` or `'43,250.00'`. Any code that attempts to persist regulated sensitive content — whether by direct column write, JSONB payload, log line, error message, or queue entry — is rejected in review without exception.

**Rule 4 — org_id is validated at two levels.** API routes check the session's org_id against the resource. RLS policies enforce the same check at the database level. Both must pass.

**Rule 5 — Razorpay webhooks are signature-verified before processing.** Rejected if `X-Razorpay-Signature` doesn't match `HMAC-SHA256(body, RAZORPAY_WEBHOOK_SECRET)`.

**Rule 6 — Public endpoints are protected against abuse.** The rights request endpoint requires Cloudflare Turnstile + email OTP verification before creating a request and notifying the compliance contact. Worker endpoints validate HMAC signatures and check origin headers. All public endpoints are rate-limited.

**Rule 7 — ConsentShield's database is an operational state store, not a compliance record store.** Any feature that treats buffer tables as the system of record is architecturally wrong.

**Rule 8 — Export credentials are write-only and never logged.** The IAM credential permits `PutObject` only. Stored encrypted at rest with per-org key derivation. Never in any log, error message, or audit trail.

**Rule 9 — Processing modes are enforced at the API gateway.** The `storage_mode` check runs before any data write. An organisation in Zero-Storage mode must never have data written to any persistent table.

**Rule 10 — RLS policies are the first code committed.** Written and tested before any customer data exists. Before any UI.

**Rule 11 — Buffer rows do not persist after delivery.** Deletion is immediate on confirmed delivery. The 15-minute sweep is a safety net. Any row older than 1 hour is a pipeline failure. Any row older than 24 hours is a P0 incident.

**Rule 12 — Credentials are encrypted with per-org key derivation.** `org_key = HMAC-SHA256(MASTER_ENCRYPTION_KEY, org_id || encryption_salt)`. Rotating one org's credentials requires only regenerating that org's salt. A master key leak does not provide direct access — the attacker still needs the per-org derivation.

**Rule 13 — Consent events are HMAC-signed.** The banner script computes `HMAC-SHA256(org_id + property_id + timestamp, signing_secret)` for every event. The Worker rejects events with invalid or expired signatures. The signing secret rotates with each banner version.

**Rule 14 — Deletion callbacks are signature-verified.** The callback URL includes `HMAC-SHA256(request_id, DELETION_CALLBACK_SECRET)`. The endpoint rejects callbacks with invalid signatures.

**Rule 15 — Origin validation on all Worker endpoints.** The Worker checks the Origin/Referer header against the registered web property URL. Mismatches are rejected. Missing origins are flagged.

**Rule 16 — Sentry captures no sensitive data.** Request bodies, headers, cookies, query parameters, and breadcrumb data are stripped before sending to Sentry. Only stack traces and error messages are captured.

**Rule 17 — All infrastructure accounts use hardware security keys.** Supabase, Vercel, Cloudflare, GitHub, domain registrar, Razorpay, Resend — all require hardware 2FA. Not SMS. Not TOTP app.

**Rule 18 — The Cloudflare Worker has zero npm dependencies.** It is vanilla TypeScript. This is a policy. Every dependency added to the Worker runs on every page load of every customer's website and is a supply chain risk surface.

**Rule 19 — Consent artefacts are append-only.** *(Added 2026-04-16 per the DEPA alignment review.)* The `consent_artefacts` table has no INSERT, UPDATE, or DELETE RLS policy for `authenticated`. Artefacts are created exclusively by the `process-consent-event` Edge Function running as `cs_orchestrator`. Status transitions occur only through three paths: (a) `artefact_revocations` INSERT trigger (`active → revoked`), (b) `enforce_artefact_expiry()` pg_cron job (`active → expired`), or (c) `process-consent-event` during a re-consent flow (`active → replaced`). Direct UPDATE of `consent_artefacts.status` from application code is a bug and is rejected in review. Artefact rows are never deleted except by the `organisations ON DELETE CASCADE` path.

**Rule 20 — Every consent artefact has an explicit expiry.** *(Added 2026-04-16 per the DEPA alignment review.)* Open-ended consent is not permitted. Every `consent_artefacts` row carries a non-null `expires_at` populated at creation from `purpose_definitions.default_expiry_days` (default 365 days). A purpose definition that intentionally creates non-expiring artefacts (e.g., `functional` required purposes that don't need consent anyway) must set `default_expiry_days = 0` which resolves to `'infinity'::timestamptz`. The `send_expiry_alerts()` pg_cron job notifies compliance contacts 30 days before expiry; `enforce_artefact_expiry()` transitions expired artefacts to `status = 'expired'` and, if `auto_delete_on_expiry = true` on the purpose definition, cascades deletion via the artefact-scoped deletion orchestration (§8.4).

---

## 12. Environment Variables

### Vercel (server-side only — never NEXT_PUBLIC_)

```bash
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon key>                         # Client-side Supabase client

# Scoped database roles (replace single service key)
SUPABASE_DELIVERY_ROLE_KEY=<cs_delivery password>         # Delivery Edge Function only
SUPABASE_ORCHESTRATOR_ROLE_KEY=<cs_orchestrator pw>       # Edge Functions only (Next.js runtime is on direct-Postgres after ADR-1013)
SUPABASE_CS_API_DATABASE_URL=<pooler url cs_api>          # Next.js /api/v1/* — ADR-1009
SUPABASE_CS_ORCHESTRATOR_DATABASE_URL=<pooler url cs_orch>  # Next.js signup-intake + invitation-dispatch + lookup-invitation + internal/invites — ADR-1013
SUPABASE_SERVICE_ROLE_KEY=<service role key>               # Migrations and emergency admin ONLY

RAZORPAY_KEY_ID=<key id>
RAZORPAY_KEY_SECRET=<key secret>
RAZORPAY_WEBHOOK_SECRET=<webhook secret>

RESEND_API_KEY=<resend api key>

CLOUDFLARE_ACCOUNT_ID=<cf account id>
CLOUDFLARE_API_TOKEN=<cf api token>                  # KV cache invalidation — scoped to KV namespace only
CLOUDFLARE_KV_NAMESPACE_ID=<kv namespace id>

CLOUDFLARE_R2_ACCESS_KEY_ID=<r2 access key>          # Write-only, scoped to provisioned buckets
CLOUDFLARE_R2_SECRET_ACCESS_KEY=<r2 secret>

MASTER_ENCRYPTION_KEY=<32-byte hex>                  # Per-org key derivation base. Rotate annually.
DELETION_CALLBACK_SECRET=<32-byte hex>               # HMAC signing for deletion callbacks. Rotate annually.

TURNSTILE_SITE_KEY=<cf turnstile site key>           # Can be public (used in client form)
TURNSTILE_SECRET_KEY=<cf turnstile secret>           # Server-side verification only

SENTRY_DSN=<sentry dsn>
```

### Vercel (client-safe)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_APP_URL=https://app.consentshield.in
NEXT_PUBLIC_CDN_URL=https://cdn.consentshield.in
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<cf turnstile site key>
```

### Cloudflare Worker

```bash
SUPABASE_URL=<same as above>
SUPABASE_WORKER_KEY=<cs_worker password>             # Scoped: INSERT consent_events + tracker_observations only
BANNER_KV=<KV namespace binding>
```

---

## 13. Sentry Configuration

Sentry captures stack traces and error messages only. All sensitive data is stripped.

```javascript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  beforeSend(event) {
    if (event.request) {
      delete event.request.headers;       // May contain Authorization tokens
      delete event.request.cookies;       // Session tokens
      delete event.request.data;          // Request body — may contain personal data
      delete event.request.query_string;  // May contain signing secrets
    }
    return event;
  },
  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.category === 'http') {
      if (breadcrumb.data) {
        delete breadcrumb.data.request_body;
        delete breadcrumb.data.response_body;
      }
    }
    return breadcrumb;
  },
});
```

**Policy:** No environment variable, no request header, no request body, no cookie, and no query parameter is ever sent to Sentry. If a developer needs to debug a specific request, they add temporary structured logging (never including credentials) and remove it after investigation.

---

## 14. Infrastructure Security

### Account Protection

All infrastructure accounts require:
- Hardware security key (YubiKey or equivalent) for 2FA. Not SMS. Not TOTP app alone.
- Dedicated email address (infra@consentshield.in) not used for any other purpose.
- Unique password per service via password manager.

### Account Inventory

| Service | Purpose | 2FA Required | Critical Level |
|---|---|---|---|
| Supabase | Database, auth, edge functions | Hardware key | Catastrophic — full data access |
| Vercel | Next.js hosting, cron jobs, env vars | Hardware key | Critical — env var access |
| Cloudflare | Workers, KV, R2, DNS, rate limiting | Hardware key | Critical — banner script control |
| GitHub | Source code, CI/CD | Hardware key + signed commits | Critical — code integrity |
| Domain registrar | consentshield.in DNS delegation | Hardware key | Critical — DNS hijack = full control |
| Razorpay | Billing, customer payments | Hardware key | High — financial |
| Resend | Email delivery | Hardware key | High — notification channel |
| Sentry | Error tracking | Standard 2FA | Medium — no sensitive data (per Section 13) |

### Domain and DNS

- Enable registrar lock and transfer lock on consentshield.in.
- Enable DNSSEC on Cloudflare.
- Monitor DNS records for unauthorized changes (Cloudflare notifications).

### GitHub

- Branch protection on `main`: require PR review, require signed commits.
- Enable GitHub secret scanning (detects committed API keys).
- Enable Dependabot for automated dependency update PRs.

---

## 15. Dependency Management

```
All package.json dependencies use exact versions. No ^ or ~ prefixes.
npm ci (not npm install) in all CI/CD and deployment pipelines.
npm audit runs on every commit. Critical vulnerabilities block deployment.
The Cloudflare Worker has zero npm dependencies. Vanilla TypeScript only. This is policy.
No new dependency added without explicit justification in the PR description.
Dependabot or Renovate enabled for automated update PRs.
```

### Dependency Review Checklist (for every new package)

1. Does this package need network access? If yes, why?
2. Does this package access the file system? If yes, why?
3. What is the package's download count and maintenance status?
4. Has this package had any security incidents? (Check Socket.dev or Snyk DB)
5. Can this functionality be implemented in 1 day of coding and testing?

If question 5 is yes, write it yourself. A day of work eliminates a permanent supply chain risk surface. The dependency doesn't just run once — it runs on every build, every deploy, and every customer interaction for the lifetime of the product. One day of effort to remove that ongoing exposure is always worth it.

---

*Document prepared April 2026. This is the definitive architecture reference. All development decisions defer to this document. Security hardening changes integrated April 2026.*

---

## Appendix A — Admin console panels (post-ADR-0048)

`admin.consentshield.in` is a separate Next.js app behind `cs_admin` JWT + AAL2 gate (Rule 21). Thirteen operator surfaces as of ADR-0049 (plus the ADR-0058 operator-intake surface at `/accounts/new-intake`):

| Panel | Route | Primary data | ADR |
|---|---|---|---|
| Operations Dashboard | `/` | Metric tiles + health pills | 0028 |
| Organisations | `/orgs`, `/orgs/[orgId]` | `public.organisations` + members + notes + impersonation | 0029 |
| Accounts | `/accounts`, `/accounts/[accountId]`, `/accounts/new-intake` | `public.accounts` + orgs + active adjustments + audit; "Invite new account" → `admin.create_operator_intake` (ADR-0058) | 0048 + 0058 |
| Support Tickets | `/support`, `/support/[ticketId]` | `admin.support_tickets` + internal notes | 0032 |
| Sectoral Templates | `/templates` (+ new/edit) | `admin.sectoral_templates` | 0030 |
| Connector Catalogue | `/connectors` (+ new/edit) | `admin.connector_catalogue` | 0031 |
| Tracker Signatures | `/signatures` (+ new/edit/import) | `admin.tracker_signature_catalogue` | 0031 |
| Pipeline Operations | `/pipeline` | 4 tabs: worker_errors · stuck_buffers · DEPA expiry · delivery health | 0033 |
| Billing Operations | `/billing` | 4 tabs: payment_failures · refunds · comp · override (+ suspend-account + account picker) | 0034 + 0048 |
| Abuse & Security | `/security` | 5 tabs: rate-limit · HMAC · origin · Sentry · blocked-IPs — all populated | 0033 + 0048 + 0049 |
| Feature Flags | `/flags` | `admin.kill_switches` | 0036 |
| Admin Users | `/admins` | `admin.admin_users` with invite / role-change / disable | 0045 |
| Audit Log | `/audit-log` + `/audit-log/export` | `admin.admin_audit_log` partitioned monthly | 0028 |

## Appendix B — Observability data model (post-ADR-0049)

Four operational tables feed the admin Security + Pipeline surfaces. All 7-day retention, all append-only, all read via admin SECURITY DEFINER RPCs.

```
Worker request
  ├─ 403 HMAC/Origin → cs_worker → public.worker_errors (prefixed category)
  └─ 5xx upstream    → cs_worker → public.worker_errors

Next.js rights endpoint
  └─ 429 rate-limit  → anon INSERT → public.rate_limit_events

Sentry SaaS
  └─ webhook (HMAC-SHA256) → /api/webhooks/sentry → anon upsert on sentry_id
                                                  → public.sentry_events

Operator action (/security Block IP)
  └─ admin.security_block_ip → public.blocked_ips → admin_config KV snapshot
                             → Cloudflare Worker rejects on CIDR match
```

Cleanup crons run daily between 03:00 and 03:45 UTC and delete rows older than 7 days.

## Appendix C — Identity isolation (CLAUDE.md Rule 12)

A single `auth.users` row is either a customer identity or an admin identity, never both. Enforcement:

- **Admin proxy** (`admin/src/proxy.ts`) — rejects any session without `app_metadata.is_admin=true` (+ AAL2).
- **Customer proxy** (`app/src/proxy.ts`) — rejects any session with `app_metadata.is_admin=true` and redirects to the admin origin.
- **`public.accept_invitation`** — raises if caller's JWT carries `is_admin=true` (customer invite cannot be accepted by an admin identity).
- **`admin.admin_invite_create`** — raises if target has any `account_memberships` or `org_memberships` rows (customer cannot be elevated to admin).

Combined, the four layers ensure no auth row holds overlapping memberships. Bootstrap admin is the sole exception, created by one-shot script.

## Appendix D — Rule 5 service-role carve-out (ADR-0045)

Admin Route Handlers under `admin/src/app/api/admin/*` may use `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) **solely** for `auth.admin.*` operations that have no scoped-role equivalent on Supabase (`auth.admin.createUser`, `updateUserById`, `deleteUser`, `getUserById`). Every such handler must:

1. Sit behind the admin proxy's `is_admin` + AAL2 gate.
2. Call an `admin.*` SECURITY DEFINER RPC that runs `admin.require_admin('platform_operator')` **before** the `auth.admin.*` call.
3. Keep non-auth work (reads, joins, user-visible data) on the authed `cs_admin` client.

Implemented via `admin/src/lib/supabase/service.ts` + `admin/src/lib/admin/lifecycle.ts` — Route Handlers and Server Actions both delegate to the shared lifecycle helper so the RPC-first-then-auth.admin ordering lives in one place.
