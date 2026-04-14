# ConsentShield Status

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Snapshot date:** 2026-04-14
**Branch:** main
**Latest commit:** `4bacdfa` — feat(ADR-0007): deletion orchestration with generic webhook protocol

---

## Summary

Seven ADRs planned for Phase 1 are complete (28 sprints). Production CDN is live at
`cdn.consentshield.in`. Full customer flow works end-to-end: signup → web property
configuration → banner publish → snippet install → consent event ingestion → tracker
observation → rights request intake → deletion orchestration → signed receipt.

---

## ADR Completion

| ADR | Title | Status | Phases | Sprints |
|-----|-------|--------|--------|---------|
| 0001 | Project scaffolding (Next.js 16, schema, RLS, scoped roles, Worker skeleton) | Completed | 3 | 7 |
| 0002 | Worker HMAC verification + origin validation + secret rotation | Completed | 1 | 3 |
| 0003 | Consent banner builder + compliance dashboard + data inventory + privacy notice | Completed | 2 | 5 |
| 0004 | Rights request workflow (Turnstile + OTP + dashboard inbox + SLA reminders) | Completed | 2 | 4 |
| 0005 | Tracker monitoring (34 signatures + banner script v2 with MutationObserver) | Completed | 1 | 3 |
| 0006 | Razorpay billing + plan gating | Completed | 1 | 3 |
| 0007 | Deletion orchestration (generic webhook protocol + signed callbacks + receipts) | Completed | 1 | 3 |

---

## Infrastructure Live

| Component | Identifier / Endpoint |
|-----------|-----------------------|
| Supabase project | `xlqiakmkdjycfiioslgs` (ap-northeast-1 pooler) |
| Cloudflare Worker | `consentshield-cdn` |
| Custom domain | `https://cdn.consentshield.in/v1/*` |
| Workers.dev URL | `https://consentshield-cdn.a-d-sudhindra.workers.dev` |
| Cloudflare KV namespace | `dafd5bef6fa1455c8e8c05ccffcef20b` (consentshield-banner-kv) |
| Cloudflare zone (consentshield.in) | `e703f9e0203e1806fd101134359cf446` |
| GitHub repo | `github.com/SAnegondhi/consentshield` (main) |
| pg_cron jobs | 5 active: buffer sweep (15 min), stuck detection (hourly), SLA reminders (daily), security scan (daily), retention check (daily) |

---

## Database State

- **32 tables**, all with RLS enabled.
- **17 migrations applied** (`supabase/migrations/`), from `20260413000001_extensions.sql`
  through `20260414000002_encryption_rpc.sql`.
- **Scoped Postgres roles** exist at the DB level: `cs_worker`, `cs_delivery`,
  `cs_orchestrator`. (See known limitation under Deferred.)
- **Triggers and buffer lifecycle** installed: `delivered_at` on every buffer table;
  scheduled sweep deletes rows 5 min after delivery confirmation.
- **RLS isolation suite**: 39 tests passing (`tests/rls/isolation.test.ts`, runnable via
  `bun run test`).

---

## Code State by Area

| Area | Path | Notes |
|------|------|-------|
| Next.js App Router dashboard | `src/app/(dashboard)/dashboard/` | billing, enforcement, integrations, inventory, rights, properties, banners |
| Public routes | `src/app/(public)/` | login, signup, privacy, rights portal |
| API routes | `src/app/api/` | auth, orgs/[orgId], public, v1, webhooks |
| Libraries | `src/lib/` | billing, compliance, encryption, rights, supabase |
| Cloudflare Worker | `worker/src/` | banner, events, observations, hmac, origin, signatures |
| Supabase Edge Functions | `supabase/functions/send-sla-reminders/` | Deno; **not yet deployed** |
| Seed data | `supabase/seed/tracker_signatures.sql` | 34 tracker services |

---

## Pending Manual Setup

These block production cutover for real customers; the code is in place.

| Item | Action required |
|------|-----------------|
| Resend domain verification | Complete DNS verification for `consentshield.in`; switch sender from `onboarding@resend.dev` to `noreply@consentshield.in` |
| Turnstile production keys | Create production Turnstile site in Cloudflare; set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` |
| Razorpay account | Live account + 4 plan IDs; set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_STARTER/GROWTH/PRO/ENTERPRISE` |
| Edge Function deployment | `supabase functions deploy send-sla-reminders` (scheduled by pg_cron but not deployed) |
| Supabase custom access token hook | Registered in dashboard (confirmed) |
| Supabase SMTP | Configured via Resend; deliverability limited until domain verified |

---

## Deferred (Phase 2+ Work)

- Supabase REST API does not accept custom Postgres-role JWTs. The Worker uses the
  service role key today with app-level query restriction. Long-term fix: either
  invoke a Postgres function via `SET LOCAL role` or move Worker writes through an
  Edge Function that uses `cs_worker`. Tracked for a future ADR.
- Security posture scanner Edge Function — stub exists in pg_cron only.
- Consent probes (synthetic compliance tests) — not written.
- Audit export package (PDF/ZIP evidence bundle) — not written.
- Pre-built deletion connectors (Mailchimp, HubSpot OAuth) — generic webhook
  protocol works; named connectors deferred.
- GDPR module (dual-framework) — not started.
- ABDM module — Phase 4, not started.

---

## Known Bugs / Gotchas Logged to `.wolf/buglog.json`

1. `pgcrypto` functions require `extensions.` prefix on hosted Supabase.
2. Supabase REST only accepts `anon` and `service_role` JWTs (not custom roles).
3. React 19 purity blocks `Date.now()`/`new Date()` inline in server components — use
   helpers in `src/lib/compliance/score.ts`.
4. Next.js 16 removed `next lint`; lint script runs `eslint src/` directly.
5. Next.js 16 requires `<Suspense>` around `useSearchParams`.
6. Supabase join type mismatch for dashboard org query — split into two queries.
7. `tsconfig` must exclude `worker/` and `supabase/functions/` (Deno imports break
   Next.js type-checking).
8. Banner test fixture must be served via `python3 -m http.server 8080` to match
   `allowed_origins`.

---

## Next Candidate Work Streams

Unordered; selection pending.

- Security posture scanning Edge Function (SSL / HSTS / CSP nightly checks).
- Pre-built deletion connectors (Mailchimp + HubSpot OAuth).
- Consent probes (synthetic compliance tests on schedule).
- Audit export package (generate compliance evidence PDF/ZIP).
- Onboarding polish (signup → first consent UX).
- GDPR module (dual-framework support).
- Architecture/codebase critical review (compliance with architecture docs +
  non-negotiable rules).
