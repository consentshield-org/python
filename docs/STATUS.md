# ConsentShield Status

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Snapshot date:** 2026-04-16
**Branch:** main
**Latest commit:** `b38862b` — docs: log loose-end cleanup (migration 20260414000010 + stale auth user)

---

## Summary

Phase 1 (ADR-0001…0007) closed on 2026-04-14. The 2026-04-14 codebase
review (`docs/reviews/2026-04-14-codebase-architecture-review.md`)
surfaced nine blocking and thirteen should-fix items; all nine blockers
and nine should-fix items are closed, the remaining four are scoped
into ADR-0010/0011/0012 (`docs/reviews/2026-04-15-deferred-items-analysis.md`).
ADR-0013 (signup bootstrap hardening, OTP-only) Sprint 1 is complete
and live-verified end-to-end. The Next.js app is deployed to Vercel at
`consentshield-one.vercel.app`, five static demo customer sites at
`consentshield-demo.vercel.app`, the Worker at `cdn.consentshield.in`,
and the SLA Edge Function in Supabase. No known blocking bugs.

---

## ADR Completion

| ADR | Title | Status |
|-----|-------|--------|
| 0001 | Project scaffolding | Completed |
| 0002 | Worker HMAC + origin validation | Completed |
| 0003 | Banner builder + dashboard + privacy notice | Completed |
| 0004 | Rights request workflow (Turnstile + OTP) | Completed |
| 0005 | Tracker monitoring | Completed |
| 0006 | Razorpay billing + plan gating | Completed |
| 0007 | Deletion orchestration | Completed |
| 0008 | Browser auth hardening (remove client secret, origin_verified, fail-fast Turnstile) | Completed |
| 0009 | Scoped-role enforcement in REST paths | Completed |
| 0010 | Distributed rate limiter (Upstash via Vercel Marketplace) | Completed |
| 0011 | Deletion retry / timeout Edge Function | Proposed (scoped) |
| 0012 | Automated test suites (worker / buffer / workflows) | In Progress — Sprint 1 complete (SLA trigger + URL-path RLS) |
| 0013 | Signup bootstrap hardening (OTP-only) | Completed |

See `docs/ROADMAP-phase2.md` for the 11-sprint Phase 2 plan (ADR-0010
through ADR-0018).

---

## Deployments Live

| Component | URL / identifier |
|-----------|------------------|
| Admin app (Next.js on Vercel) | `https://consentshield-one.vercel.app` |
| Demo customer sites (Vercel) | `https://consentshield-demo.vercel.app` (5 scenarios: ecommerce, saas, blog, healthtech, violator) |
| Cloudflare Worker CDN | `https://cdn.consentshield.in/v1/*` (Worker version `9fb7bd37`) |
| Supabase project | `xlqiakmkdjycfiioslgs` |
| SLA Edge Function | `send-sla-reminders` deployed; reads `CS_ORCHESTRATOR_ROLE_KEY` (CS_ prefix because Supabase reserves SUPABASE_) |
| pg_cron jobs | 6 active: 5 orchestrator HTTP posts (key via Supabase Vault `cs_orchestrator_key`) + `cleanup-unverified-rights-requests-daily` |
| GitHub repo | `github.com/SAnegondhi/consentshield` |

---

## Database State

- **32 operational tables** + `webhook_events_processed`. All with RLS enabled.
- **21 migrations applied**, through `20260415000001_request_uid_helper.sql`.
- **Scoped roles** (`cs_worker`, `cs_delivery`, `cs_orchestrator`) are the runtime principals. Every mutating code path routes through a security-definer RPC owned by `cs_orchestrator` (or `cs_delivery`), granted to `anon` or `authenticated` per endpoint. `grep -r SUPABASE_SERVICE_ROLE_KEY src/` returns zero matches.
- `cs_orchestrator` / `cs_delivery` carry `BYPASSRLS` so security-definer calls can read org-scoped tables inside their own function bodies. They do **not** have USAGE on schema `auth` (hosted Supabase forbids it); RPCs that need the caller's user id use the `public.current_uid()` helper from `20260415000001`.
- **Demo org** seeded: `ConsentShield Demo Customer` (`432bca6d-8fce-415a-85e0-96397ddac666`) with 5 web properties + 5 banners matching the Vercel demo site routes.
- Test suite: **55 / 55 passing** on every build (39 RLS isolation + 5 URL-path RLS + 4 rate-limit fallback + 7 SLA-timer). Live Supabase round trips where the test requires it.

---

## Pending Manual Setup

| Item | Action required |
|------|-----------------|
| Supabase email templates (password reset, email change) | Stock templates still use click-through links. Paste the OTP-form HTML from the `reference_email_deliverability` memory before enabling those flows. "Confirm signup" and "Magic Link" templates are already OTP-ready. |
| Resend domain verification | `consentshield.in` verified; relaxed-alignment DMARC live; deliverability confirmed to Gmail. |
| Turnstile production keys | Using CF always-pass test keys on Vercel. Production fail-fast is enforced; replace before any real traffic. |
| Razorpay account | No keys. Billing UI will 500 on checkout; intentional until real keys exist. |
| Vercel Deployment Protection | Off on both projects for dev; revisit before any real traffic. |
| NEXT_PUBLIC_APP_URL | Currently points to `https://consentshield-one.vercel.app`. Revisit if a custom domain is added. |

---

## Known Bugs (Outstanding)

None blocking. Signup + login + dashboard property creation verified end-to-end on 2026-04-15.

---

## Most Recent Work (2026-04-14 → 2026-04-16)

Commits, newest first:

```
b38862b docs: log loose-end cleanup (migration 20260414000010 + stale auth user)
2404833 chore: remove no-op grant usage on auth schema from migration 20260414000010
28523d8 fix: public.current_uid() helper replaces auth.uid() in scoped-role RPCs
0ee7a80 feat(ADR-0013): OTP boxes UX + support variable token lengths
6f9ea01 feat(ADR-0013): sprint 1.2 — OTP-only signup + login (supersedes magic link)
c3c0f67 feat(ADR-0013): sprint 1 — single /auth/callback for signup bootstrap
90cfd5d feat: root page is now a real landing with signup/login + demo-sites link
fcb0de4 feat: test-sites — 5 static demo customer pages for ConsentShield
266d885 fix: scoped roles need BYPASSRLS + auth schema usage for security-definer RPCs
dc6b2c3 docs: refresh .env.local.example for Vercel + ADR-0008/0009 reality
ebfc5f8 docs: Phase 2 roadmap — 11 sprints sequenced by dependency + ROI
f850568 docs: STATUS.md refreshed for the 2026-04-15 pause point
ac8b2de docs: deferred-items analysis — schedule S-1/S-5/S-11 into ADR-0010/0011/0012
d619c29 chore: deployment fixups after hosted-Supabase + pooler constraints
adcc184 fix: should-fix batch from 2026-04-14 review (S-3, S-6, S-7, S-10, S-12)
da0d168 feat(ADR-0009): complete B-4 — zero service-role usage in app code
d50b98b fix: close B-5, B-7, B-8, B-9 from 2026-04-14 review
b21b0dc feat(ADR-0009): sprint 1.1 — scoped-role RPCs for public buffer writes (B-4 partial, B-6)
788c63c feat(ADR-0008): phase 1 — browser auth hardening (B-1, B-2, B-3)
```

---

## Where to Pick Up Next

`docs/ROADMAP-phase2.md` enumerates Sprints 1–11. Sprint 1 (ADR-0013)
is Complete. Two candidates for the next session:

- **Sprint 2 — ADR-0010 distributed rate limiter.** ~3 h. Replaces the in-memory `Map` in `src/lib/rights/rate-limit.ts` with Upstash Redis via the Vercel Marketplace (Vercel KV is no longer offered as of 2025).
- **Sprint 3 — ADR-0012 Sprint 1 (SLA-timer property tests + the S-2 URL-path RLS test).** Smallest useful bite, no new deps.
