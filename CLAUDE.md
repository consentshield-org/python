# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.


# ConsentShield

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

India's DPDP compliance enforcement engine. Stateless compliance oracle — processes consent events, delivers to customer storage, deletes immediately.

## Authorship and copyright

All documents, code, and other artefacts in this project are authored by and copyright of Sudhindra Anegondhi (a.d.sudhindra@gmail.com). No AI tool, model, or service may be credited as author, co-author, or collaborator in any document, commit message, code comment, or other artefact. This is a non-negotiable rule.

## Stack

- Next.js 16 + TypeScript + Tailwind + shadcn/ui
- Supabase Auth + Postgres (RLS on every table)
- Cloudflare Workers + KV + R2
- Vercel hosting + cron
- Resend (email), Razorpay (billing), Sentry (errors)

## Build and test

The repo is a Bun workspace monorepo (ADR-0026). Run commands from the workspace that owns them.

- `bun install` at repo root — installs deps for all workspaces
- `cd app && bun run dev` — customer app local dev (port 3000)
- `cd admin && bun run dev` — admin app local dev (port 3001, once ADR-0026 Sprint 3.1 lands)
- `cd app && bun run build` — customer app build; must pass before committing
- `cd app && bun run lint` — customer app lint; zero warnings allowed
- `cd app && bun run test` — customer app tests (worker harness, buffer, rights, workflows)
- `bun run test:rls` from repo root — cross-app RLS isolation tests
- `bunx supabase db push` for schema migrations

## Architecture reference

Read these on demand — before structural changes, ADR work, or anything touching the area. Do NOT read for routine edits. These are the contradiction-winning source of truth; if guidance elsewhere conflicts, these files win.

- `docs/architecture/consentshield-definitive-architecture.md` — source of truth for all architecture. Read before: Worker/pipeline/RLS/roles/enforcement/API changes.
- `docs/architecture/consentshield-complete-schema-design.md` — source of truth for all database objects. Read before: any migration, new table, RLS policy, or role grant.
- `docs/architecture/consentshield-testing-strategy.md` — what to test and when. Read before: writing tests or modifying test infra.
- `docs/architecture/nextjs-16-reference.md` — Next.js 16 specifics (proxy.ts, caching, breaking changes). Read before: routing, middleware/proxy, caching, or config changes.

## UI specification reference

There are **two** parallel UI specifications in this repository — one per app in the monorepo. Both follow the same normative discipline: the wireframes are the spec, code MUST conform, drift is recorded in an alignment doc + ADR.

### Customer app (`app/` post-monorepo, currently `src/`)

The wireframes in `docs/design/screen designs and ux/` are the visual and interaction specification for the ConsentShield customer-facing UI. The Next.js implementation MUST conform to those screens.

- `docs/design/screen designs and ux/consentshield-screens.html` — web app wireframes (sidebar nav + 9 panels). Read before: any change to dashboard layout, panel structure, banner builder, rights flow, audit/reports, settings, onboarding, or the DEPA panels (Consent Artefacts, Purpose Definitions).
- `docs/design/screen designs and ux/consentshield-mobile.html` — iOS wireframes (3 flows). Read before: any iOS work (deferred until Month 6+ ABDM trigger).
- `docs/design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md` — drift catalogue between customer wireframes and architecture. Read before: building any new customer screen.

### Admin app (`admin/` post-monorepo)

The wireframes in `docs/admin/design/` are the visual and interaction specification for the ConsentShield operator console (admin.consentshield.in).

- `docs/admin/architecture/consentshield-admin-platform.md` — admin platform source of truth. Read before: any admin auth, role, hosting topology, RPC contract, or impersonation work. Defines admin-side Rules 21–25.
- `docs/admin/architecture/consentshield-admin-schema.md` — admin Postgres schema (admin tables, cs_admin role, RLS, audit-log RPC pattern). Read before: any admin migration or RPC.
- `docs/admin/architecture/consentshield-admin-monorepo-migration.md` — step-by-step plan to convert this repo into a Bun workspace monorepo. Read before: starting Phase 1 of the restructure.
- `docs/admin/design/consentshield-admin-screens.html` — admin wireframes (sidebar nav + 11 panels + impersonation drawer). Visual cue: red admin-mode strip + red sidebar border distinguishes the operator console from the customer app at a glance. Read before: any change to admin UI.
- `docs/admin/design/ARCHITECTURE-ALIGNMENT-2026-04-16.md` — drift catalogue between admin wireframes and admin architecture. Cross-references customer-side items (W13, W14) where applicable.

### The rule (both apps)

Silent UI drift away from these screens is not acceptable in either app. Either update the wireframes (and re-align via the matching alignment doc) or update the code to match. The wireframes are normative. Tick items off the §4/§6 reconciliation trackers as the relevant ADRs ship.

### Monorepo

The repo will be restructured into a Bun workspace (`app/` + `admin/` + `worker/` + `packages/*` + shared `supabase/` + shared `docs/`) per the migration plan. Until that ADR (proposed: ADR-0026) ships, the customer app continues to live at the repo root. The admin platform implementation is blocked on the monorepo restructure landing first.

## Non-negotiable rules

These are hard constraints. Do not work around them. Do not find creative interpretations. If a task conflicts with any of these rules, stop and say so.

### Data rules

1. **Buffer tables are temporary.** consent_events, tracker_observations, audit_log, processing_log, delivery_buffer, rights_request_events, deletion_receipts, withdrawal_verifications, security_scans, consent_probe_runs — these hold data for seconds to minutes. Rows are deleted immediately after confirmed delivery to customer storage. Never treat these as permanent storage. Never build features that rely on old data being present in these tables.

2. **Append-only means append-only.** Never write UPDATE or DELETE statements against buffer tables for the `authenticated` role. Never write RLS policies that allow UPDATE or DELETE on buffer tables. Only the scoped service roles (cs_worker, cs_delivery, cs_orchestrator) can mutate buffer tables.

3. **Health data (FHIR) is never persisted.** No table, no log, no file, no variable that outlives the request. If you find yourself writing FHIR content to any durable storage, stop. This is a hard architectural constraint, not a suggestion.

4. **The customer owns the compliance record.** Dashboard views can read from buffer tables for real-time display. Compliance exports, audit packages, and anything DPB-facing must read from or direct users to customer-owned storage (R2/S3). Never build an export that reads from ConsentShield's database as the canonical source.

### Security rules

5. **Scoped database roles, not one service key.** The Cloudflare Worker uses `cs_worker` (INSERT into consent_events and tracker_observations only). The delivery Edge Function uses `cs_delivery`. All other Edge Functions use `cs_orchestrator`. The customer-app `/api/v1/*` handlers use `cs_api` — direct Postgres via the Supavisor pooler, zero table privileges, EXECUTE limited to 12 whitelisted SECURITY DEFINER RPCs, every one fenced by `assert_api_key_binding(p_key_id, p_org_id)` before any tenant-visible work (ADR-1009). Never use SUPABASE_SERVICE_ROLE_KEY in running customer-app code — it is for migrations only. A CI grep gate (`scripts/check-no-service-role-in-customer-app.ts`, wired into `app/` prelint + prebuild) refuses any reintroduction. **Carve-out (ADR-0045):** admin Route Handlers under `admin/src/app/api/admin/*` may use the service role **solely** for `auth.admin.*` operations (user create / update / delete), because Supabase exposes those APIs only to the service role. Every such handler MUST (a) live behind the admin proxy (`is_admin` + AAL2), and (b) call an `admin.*` SECURITY DEFINER RPC that runs `admin.require_admin('platform_operator')` **before** the `auth.admin.*` call. Non-auth work in those handlers (reads, joins, user-visible data) uses the authed `cs_admin` client like every other admin surface.

6. **No secrets in client code.** Never put any database key, API secret, signing secret, or encryption key in a `NEXT_PUBLIC_` environment variable. Never import server-side env vars in a client component. Never log secrets in any error handler.

7. **HMAC-verify all consent events.** The Worker must verify the HMAC signature and timestamp (±5 minutes) on every POST to /v1/events and /v1/observations before writing. Never skip this validation, even in development.

8. **Validate Origin on Worker endpoints.** Check the Origin/Referer header against the web property's allowed_origins. Reject mismatches with 403. Flag missing origins as `origin_unverified` in the payload.

9. **Sign deletion callback URLs.** Every callback_url sent to a customer's webhook must include an HMAC signature. The callback endpoint must verify the signature before accepting any confirmation.

10. **Turnstile + email OTP on rights requests.** Never create a rights_request row without Cloudflare Turnstile verification. Never send the notification email to the compliance contact until the requestor's email is OTP-verified.

11. **Encrypt credentials with per-org key derivation.** `org_key = HMAC-SHA256(MASTER_ENCRYPTION_KEY, org_id || encryption_salt)`. Never use the master key directly to encrypt anything.

12. **Identity isolation between customer app and admin app.** A single auth.users row is either a customer identity or an admin identity — never both. Admin identities (`app_metadata.is_admin === true`) MUST NOT reach any surface of the customer app (`app/`). Customer identities (no `is_admin` claim) MUST NOT reach any surface of the admin app (`admin/`). Both proxies enforce this: admin proxy rejects non-`is_admin` with 403; customer proxy rejects `is_admin` sessions with 403 and hints at the admin origin. Any invite / elevation code path must refuse to mix the two identities (e.g., admin-invite refuses if the target has any `account_memberships` or `org_memberships` rows; customer-invite refuses if the target has `is_admin=true`).

### Code rules

13. **RLS on every table.** If you create a new table, it must have `enable row level security` and at least one policy before any data can be written. No exceptions.

14. **org_id on every table.** Every table that holds per-customer data must have an `org_id` column with an RLS policy that filters by `current_org_id()`. If you create a table without org_id, justify why.

15. **No new npm dependencies without justification.** If the functionality can be implemented in 1 day of coding and testing, write it yourself. A day of work eliminates a permanent supply chain risk. State the justification in the PR description.

16. **Zero dependencies in the Cloudflare Worker.** The Worker is vanilla TypeScript. No npm packages. This is policy. Every dependency in the Worker runs on every page load of every customer's website.

17. **Exact version pinning.** All package.json dependencies use exact versions. No `^`, no `~`.

18. **Sentry captures no sensitive data.** All Sentry `beforeSend` hooks must strip request bodies, headers, cookies, and query parameters. Only stack traces and error messages reach Sentry.

19. **Invoice issuance requires an active `billing.issuer_entities` row — and invoices are immutable.** No hard-coded issuer identity: legal name, GSTIN, PAN, registered state, invoice prefix, FY sequence origin, and signatory must be read from the currently-active issuer row at issuance time. If no row is active, invoice issuance RPCs must raise a clear error rather than emit an invoice. Retiring one issuer and activating another is an auditable admin action; invoices before the retirement keep their original issuer linkage.

   **Immutable identity fields (issuer_entities).** `legal_name`, `gstin`, `pan`, `registered_state_code`, `invoice_prefix`, `fy_start_month` cannot be updated in place. To change any of them, retire the current issuer and create a new one. Only `registered_address`, `logo_r2_key`, `signatory_name`, `signatory_designation`, `bank_account_masked` may be patched on a live issuer.

   **Immutable invoices (`public.invoices`).** No role in running application code has DELETE. UPDATE is trigger-constrained to the allow-list in ADR-0050 (`status` transitions, `paid_at`, `razorpay_invoice_id/order_id`, `pdf_r2_key`, `pdf_sha256`, `issued_at`, `voided_at/voided_reason`, `email_message_id`, `email_delivered_at`). Voiding is a status flip with reason, not deletion. Every issued PDF is content-hashed and stored in R2; the R2 key is never overwritten.

   **`platform_owner` role.** Issuer-entity writes and all-issuer historical invoice visibility/export are restricted to the `platform_owner` admin tier. `platform_operator` retains operational visibility — list, search, view, and export invoices *scoped to the currently-active issuer*. Retired-issuer invoices are never visible to operators; they belong to the owner's historical lens. `admin_role` enum: `platform_owner > platform_operator > support > read_only`. `platform_owner` is seeded by migration onto the founder's `auth.users` row; it is never grantable via admin-invite. Recovery is via migration with service-role key. See ADR-0050.

## Development workflow — ADR-driven

Every coding session follows a structured plan. No code is written without an ADR.

### Before writing any code

1. Create an ADR in `docs/ADRs/ADR-NNNN-short-title.md` (next sequential number)
2. The ADR must contain: context, decision, implementation plan (phases/sprints), testing plan, and acceptance criteria
3. For simple changes (< 1 sprint): single-phase ADR with one sprint
4. For complex changes (multi-sprint): break into phases, each phase into sprints, each sprint with clear deliverables

### ADR structure

```
docs/ADRs/
├── ADR-0001-initial-schema-and-rls.md
├── ADR-0002-cloudflare-worker-hmac.md
├── ADR-0003-rights-request-turnstile.md
├── ...
└── ADR-index.md                        ← Auto-maintained index of all ADRs with status
```

### During each sprint

1. Update the ADR's sprint status: `[ ] planned` → `[~] in progress` → `[x] complete`
2. If the sprint changes any flow or architecture, document the change in the ADR under a `### Architecture Changes` section and update the relevant architecture document
3. Every logical checkpoint that CAN be tested MUST be tested before proceeding
4. Record actual test results in the ADR under `### Test Results` — not just "passed" but what was tested, how, and the output
5. Commit after each sprint with a message referencing the ADR: `feat(ADR-0001): sprint 2 — RLS policies for buffer tables`

### After each sprint

1. Update the ADR sprint status
2. Update the changelog for the relevant area (see changelog structure below)
3. Commit all changes to the local repo: code + ADR update + changelog entry

### Changelogs

Changelogs are split by area to prevent any single file from growing too large:

```
docs/changelogs/
├── CHANGELOG-schema.md         ← Database migrations, RLS policies, roles
├── CHANGELOG-worker.md         ← Cloudflare Worker changes
├── CHANGELOG-dashboard.md      ← Next.js UI changes
├── CHANGELOG-api.md            ← API route changes
├── CHANGELOG-edge-functions.md ← Supabase Edge Function changes
├── CHANGELOG-infra.md          ← Vercel, Cloudflare, Supabase config changes
└── CHANGELOG-docs.md           ← Documentation changes
```

Each changelog entry follows this format:
```
## [Sprint ref] — YYYY-MM-DD

**ADR:** ADR-NNNN — Title
**Sprint:** Phase X, Sprint Y

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Tested
- [x] Test description — PASS
- [x] Test description — PASS
```

### ADR lifecycle

- **Proposed** — ADR written, plan not started
- **In Progress** — at least one sprint started
- **Completed** — all sprints done, all tests passed, all changelogs updated
- **Superseded** — replaced by a later ADR (link to successor)
- **Abandoned** — decided not to proceed (document why)

### V2 backlog

When an ADR consciously accepts a limitation (e.g., "static HTML analysis v1 — browser-based probes are a v2 follow-up"), record the deferred item in `docs/V2-BACKLOG.md` with a pointer back to the ADR. The backlog is reviewed only after Phase 2 closes; do NOT pull items from it into mid-phase sprints.

### The rule

No code without a plan. No sprint without tests. No merge without a changelog. No architectural change without updating the architecture documents.

## Reviews

Every review must be documented in `docs/reviews/` with a dated markdown file.

### When to review

- Before promoting design docs to `docs/architecture/` (source of truth)
- Before any multi-sprint ADR is marked Completed
- When any non-negotiable rule or security constraint is modified
- When cross-cutting changes affect multiple architecture documents

### Review file format

```
docs/reviews/YYYY-MM-DD-short-description.md
```

Each review must contain: scope, documents reviewed, findings (blocking/should-fix/cosmetic), fixes applied, verification result, and outcome. See `docs/reviews/2026-04-13-architecture-consistency-review.md` for the template.

### The rule

No architecture doc is promoted to source of truth without a documented review. No review finding classified as blocking or should-fix is left open.

## Coding style

- TypeScript strict mode. No `any` types except in explicitly justified escape hatches.
- 2-space indentation.
- No semicolons (Prettier handles it).
- Prefer early returns over nested conditionals.
- File naming: kebab-case for files, PascalCase for React components, camelCase for functions/variables.
- Database columns: snake_case.
- All SQL in raw form (no ORM query builders for Supabase). Use the Supabase client library for auth and realtime, raw SQL for schema and migrations.

## Git

- Branch naming: `feature/short-description` or `fix/short-description`
- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`
- Never commit `.env` files, secrets, or credentials
- Run `cd app && bun run build && bun run lint && bun run test` and `bun run test:rls` (from repo root) before every commit

## Directory structure

```
consentshield/
├── CLAUDE.md                          # This file
├── docs/architecture/                 # Source-of-truth architecture docs
├── docs/design/                       # Design docs (historical, superseded by architecture/)
├── docs/ADRs/                         # Architecture Decision Records
├── docs/changelogs/                   # Per-area changelogs
├── docs/reviews/                      # Documented architecture and code reviews
├── app/                               # Customer-facing Next.js app (ADR-0026)
│   ├── src/
│   │   ├── app/                       # Next.js App Router
│   │   │   ├── (dashboard)/           # Authenticated dashboard routes
│   │   │   ├── api/                   # API routes (server-side only)
│   │   │   │   ├── orgs/[orgId]/      # Authenticated org-scoped endpoints
│   │   │   │   ├── public/            # Public endpoints (rights requests)
│   │   │   │   ├── v1/                # Compliance API (API key auth)
│   │   │   │   └── webhooks/          # Razorpay, deletion callbacks
│   │   │   └── (public)/              # Public pages (login, rights portal)
│   │   ├── components/                # React components
│   │   ├── lib/
│   │   │   ├── supabase/              # Supabase client (server + browser)
│   │   │   ├── cloudflare/            # R2/KV utilities
│   │   │   ├── encryption/            # Per-org key derivation, pgcrypto helpers
│   │   │   ├── notifications/         # Email + Slack/Teams/Discord webhook sender
│   │   │   └── connectors/            # Deletion connector interfaces
│   │   └── types/                     # Shared TypeScript types
│   └── tests/                         # App tests (worker harness, buffer, rights, workflows)
├── admin/                             # Operator-facing Next.js app (ADR-0026 Sprint 3.1+)
├── packages/                          # Shared workspace packages (ADR-0026 Sprint 2.1+)
├── worker/                            # Cloudflare Worker (zero npm deps)
│   ├── src/
│   │   ├── index.ts                   # Worker entry point
│   │   ├── banner.ts                  # Banner script compilation + delivery
│   │   ├── events.ts                  # Consent event ingestion (HMAC + origin validation)
│   │   ├── observations.ts            # Tracker observation ingestion
│   │   └── hmac.ts                    # HMAC verification utilities
│   └── wrangler.toml
├── supabase/
│   ├── migrations/                    # Ordered SQL migrations
│   ├── functions/                     # Supabase Edge Functions (Deno)
│   │   ├── deliver-consent-events/
│   │   ├── send-sla-reminders/
│   │   ├── orchestrate-deletion/
│   │   ├── check-stuck-buffers/
│   │   ├── run-security-scans/
│   │   ├── check-retention-rules/
│   │   └── verify-withdrawal/
│   └── seed.sql                       # Tracker signatures, sector templates
└── tests/
    └── rls/                           # Cross-app multi-tenant isolation tests (run every deploy)
```

## When creating database migrations

1. Read `docs/architecture/consentshield-complete-schema-design.md` first
2. Every new table needs: `enable row level security`, at least one RLS policy, org_id column (unless it's reference data)
3. Buffer tables need: `delivered_at` column, index on `delivered_at WHERE delivered_at IS NULL`, REVOKE UPDATE/DELETE from authenticated role
4. Run the verification queries from Section 9 of the schema document after every migration
5. Write the RLS isolation test for the new table before writing any application code that uses it

## When creating API routes

1. Authenticated routes: extract org_id from the JWT, verify it matches the URL parameter, let RLS handle the rest
2. Public routes: rate-limit, validate inputs server-side, never trust client-provided org_id
3. Webhook routes: verify signatures before any database operation
4. Never return the service role key, any encryption key, or any credential in an API response
5. Never log request bodies that might contain personal data

## When modifying the Cloudflare Worker

1. Read @worker/README.md for the build process
2. No npm dependencies. If you need a utility, write it in worker/src/
3. Test with `wrangler dev` locally before deploying
4. Every POST endpoint must validate HMAC + origin before writing
5. Failed writes must return 202 (not 500) — never break the customer's website
6. Use the cs_worker database credential, not the service role key

## When writing Edge Functions

1. Use the cs_delivery credential for the delivery function
2. Use the cs_orchestrator credential for all other functions
3. Never use the service role key
4. Buffer operations: mark delivered_at AND delete in the same transaction
5. If an Edge Function fails, it must not leave buffer rows in an inconsistent state
