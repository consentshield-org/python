# ADR-0043: Customer App is Auth-Only (Drop Public Landing)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-17
**Date completed:** 2026-04-17

---

## Context

`app.consentshield.in` (the customer-facing Next.js app) currently serves a public landing page at `/` that describes the product, links to a demo, and has two CTAs — "Create an account" and "Sign in". This confuses the app's scope: the customer app is the signed-in product experience, not a marketing surface.

Product surfaces split cleanly:

- **Marketing / explainer / pricing / public docs** — belongs on `www.consentshield.in`, a separate site (not yet built).
- **Signed-in product** — `app.consentshield.in`. Dashboard, banners, rights inbox, exports, billing settings. Auth-required.
- **Operator console** — `admin.consentshield.in`. Red-accent admin app.
- **Rights portal** — `/rights` (public, Turnstile-gated, no auth). Stays.

Until the marketing site exists, signup must still be possible. The login page already links `/signup` at the bottom, so no new surface is needed.

## Decision

Drop the landing. `/` becomes an auth-aware redirect:

- **Authenticated user** → `/dashboard` (existing behaviour).
- **Unauthenticated user** → `/login`.

The `/signup` route stays reachable (via the link on `/login`) as an interim signup path until the marketing site ships. The `/rights` public route is unaffected.

No proxy-matcher change needed — the redirect lives in the page component itself, and the proxy already handles dashboard gating.

## Consequences

- App scope is now unambiguous: it's the product, period. Marketing moves to its own home.
- One less surface to maintain in this repo. The landing-page copy + demo link will live on the marketing site when it ships.
- Bookmarks to `https://app.consentshield.in/` still resolve — just land on login instead of the marketing splash.
- Future marketing site at `www.consentshield.in` is tracked as a separate workstream (new ADR when scoped).

## Implementation Plan

### Sprint 1.1: replace landing with auth-aware redirect

**Estimated effort:** 15 minutes.

**Deliverables:**
- [x] `app/src/app/page.tsx` — landing JSX removed. Server component redirects `/dashboard` (authed) or `/login` (unauthed).

**Testing plan:**
- [x] `cd app && bun run build` — `/` still in route manifest; build passes.
- [x] `cd app && bun run lint` — no new issues (pre-existing lint errors on `dashboard/page.tsx` + `api/internal/run-probes/route.ts` are unrelated to this change; see ADR-0042 follow-ups).
- [ ] Browser smoke — signed-out hit on `/` lands on `/login`; signed-in hit lands on `/dashboard`. (User to verify.)

**Status:** `[x] complete` — 2026-04-17

## Out of Scope

- `www.consentshield.in` marketing site design/build — separate project, separate ADR when scoped.
- Customer RBAC (super_admin vs admin) — separate ADR (proposed: ADR-0044) to land next.
- Any change to `/signup`, `/login`, or `/rights` routes.
