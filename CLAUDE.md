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

- `npm ci` (never `npm install`)
- `npm run dev` for local development
- `npm run build` before committing — build must pass
- `npm run lint` before committing — zero warnings allowed
- `npm test` runs the test suite
- `npx supabase db push` for schema migrations

## Architecture reference

Read these before making structural changes:

- @docs/architecture/consentshield-definitive-architecture.md — source of truth for all architecture
- @docs/architecture/consentshield-complete-schema-design.md — source of truth for all database objects
- @docs/architecture/consentshield-testing-strategy.md — what to test and when

## Non-negotiable rules

These are hard constraints. Do not work around them. Do not find creative interpretations. If a task conflicts with any of these rules, stop and say so.

### Data rules

1. **Buffer tables are temporary.** consent_events, tracker_observations, audit_log, processing_log, delivery_buffer, rights_request_events, deletion_receipts, withdrawal_verifications, security_scans, consent_probe_runs — these hold data for seconds to minutes. Rows are deleted immediately after confirmed delivery to customer storage. Never treat these as permanent storage. Never build features that rely on old data being present in these tables.

2. **Append-only means append-only.** Never write UPDATE or DELETE statements against buffer tables for the `authenticated` role. Never write RLS policies that allow UPDATE or DELETE on buffer tables. Only the scoped service roles (cs_worker, cs_delivery, cs_orchestrator) can mutate buffer tables.

3. **Health data (FHIR) is never persisted.** No table, no log, no file, no variable that outlives the request. If you find yourself writing FHIR content to any durable storage, stop. This is a hard architectural constraint, not a suggestion.

4. **The customer owns the compliance record.** Dashboard views can read from buffer tables for real-time display. Compliance exports, audit packages, and anything DPB-facing must read from or direct users to customer-owned storage (R2/S3). Never build an export that reads from ConsentShield's database as the canonical source.

### Security rules

5. **Three scoped database roles, not one service key.** The Cloudflare Worker uses `cs_worker` (can only INSERT into consent_events and tracker_observations). The delivery Edge Function uses `cs_delivery`. All other Edge Functions use `cs_orchestrator`. Never use SUPABASE_SERVICE_ROLE_KEY in running application code — it is for migrations only.

6. **No secrets in client code.** Never put any database key, API secret, signing secret, or encryption key in a `NEXT_PUBLIC_` environment variable. Never import server-side env vars in a client component. Never log secrets in any error handler.

7. **HMAC-verify all consent events.** The Worker must verify the HMAC signature and timestamp (±5 minutes) on every POST to /v1/events and /v1/observations before writing. Never skip this validation, even in development.

8. **Validate Origin on Worker endpoints.** Check the Origin/Referer header against the web property's allowed_origins. Reject mismatches with 403. Flag missing origins as `origin_unverified` in the payload.

9. **Sign deletion callback URLs.** Every callback_url sent to a customer's webhook must include an HMAC signature. The callback endpoint must verify the signature before accepting any confirmation.

10. **Turnstile + email OTP on rights requests.** Never create a rights_request row without Cloudflare Turnstile verification. Never send the notification email to the compliance contact until the requestor's email is OTP-verified.

11. **Encrypt credentials with per-org key derivation.** `org_key = HMAC-SHA256(MASTER_ENCRYPTION_KEY, org_id || encryption_salt)`. Never use the master key directly to encrypt anything.

### Code rules

12. **RLS on every table.** If you create a new table, it must have `enable row level security` and at least one policy before any data can be written. No exceptions.

13. **org_id on every table.** Every table that holds per-customer data must have an `org_id` column with an RLS policy that filters by `current_org_id()`. If you create a table without org_id, justify why.

14. **No new npm dependencies without justification.** If the functionality can be implemented in 1 day of coding and testing, write it yourself. A day of work eliminates a permanent supply chain risk. State the justification in the PR description.

15. **Zero dependencies in the Cloudflare Worker.** The Worker is vanilla TypeScript. No npm packages. This is policy. Every dependency in the Worker runs on every page load of every customer's website.

16. **Exact version pinning.** All package.json dependencies use exact versions. No `^`, no `~`.

17. **Sentry captures no sensitive data.** All Sentry `beforeSend` hooks must strip request bodies, headers, cookies, and query parameters. Only stack traces and error messages reach Sentry.

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
- Run `npm run build && npm run lint && npm test` before every commit

## Directory structure

```
consentshield/
├── CLAUDE.md                          # This file
├── docs/architecture/                 # Source-of-truth architecture docs
├── docs/design/                       # Design docs (historical, superseded by architecture/)
├── docs/ADRs/                         # Architecture Decision Records
├── docs/changelogs/                   # Per-area changelogs
├── docs/reviews/                      # Documented architecture and code reviews
├── src/
│   ├── app/                           # Next.js App Router
│   │   ├── (dashboard)/               # Authenticated dashboard routes
│   │   ├── api/                       # API routes (server-side only)
│   │   │   ├── orgs/[orgId]/          # Authenticated org-scoped endpoints
│   │   │   ├── public/                # Public endpoints (rights requests)
│   │   │   ├── v1/                    # Compliance API (API key auth)
│   │   │   └── webhooks/              # Razorpay, deletion callbacks
│   │   └── (public)/                  # Public pages (login, rights portal)
│   ├── components/                    # React components
│   ├── lib/
│   │   ├── supabase/                  # Supabase client (server + browser)
│   │   ├── cloudflare/                # R2/KV utilities
│   │   ├── encryption/                # Per-org key derivation, pgcrypto helpers
│   │   ├── notifications/             # Email + Slack/Teams/Discord webhook sender
│   │   └── connectors/                # Deletion connector interfaces
│   └── types/                         # Shared TypeScript types
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
    ├── rls/                           # Multi-tenant isolation tests (run every deploy)
    ├── buffer/                        # Delivery pipeline tests
    ├── worker/                        # Worker endpoint tests
    └── workflows/                     # SLA timer, breach deadline tests
```

## When creating database migrations

1. Read @docs/architecture/consentshield-complete-schema-design.md first
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
