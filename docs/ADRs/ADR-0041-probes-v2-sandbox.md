# ADR-0041: Probes v2 — Headless-Browser Runner via Vercel Sandbox + Probe CRUD UI

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-17
**Date completed:** 2026-04-17
**Depends on:** ADR-0016 (probes v1 static-HTML analysis), ADR-0014 (Resend). Vercel Sandbox (GA Jan 2026) available on the account.
**Unblocks:** Closes V2-P1 (headless-browser probe runner) and V2-P2 (probe CRUD UI).

---

## Context

ADR-0016 shipped a static-HTML probe runner: `run-consent-probes` Edge Function does two-pass string matching over the raw HTML + inline JS of each probe target. It correctly flags the demo `/violator?violate=1` case but emits a **documented false positive** on `/blog` because inline JS conditional loads (`if (consented) { load() }`) look identical to unconditional loads when the URL appears in inline JS.

The v2 fix is a **real headless browser**. The runner loads the page, sets the banner cookie to the probe's declared `consent_state`, waits for JS to settle, collects the network request list + final DOM + cookies, and matches against `tracker_signatures`. Conditional loads flip with the consent state; unconditional ones don't.

Execution substrate: **Vercel Sandbox** ephemeral Firecracker microVMs (GA Jan 2026). A Next.js API route programmatically creates a sandbox per probe, copies in a pinned Playwright scenario script, runs it, captures the JSON stdout, and writes a `consent_probe_runs` row. One sandbox per probe run; torn down after ~30 seconds.

### Authentication

`@vercel/sandbox` SDK authenticates via `VERCEL_OIDC_TOKEN` (provided at runtime when running on a Vercel Function) or `VERCEL_AUTH_TOKEN` (PAT) for non-Vercel hosts. Since the orchestrator IS a Vercel API route on the customer app, OIDC works without any extra secret. For dev / self-hosted deployments, a PAT env var is the fallback.

### Orchestrator placement — Next.js API route, not Supabase Edge Function

Three reasons:
1. OIDC auth works natively on Vercel Functions — no token plumbing.
2. The `@vercel/sandbox` SDK is Node.js; Deno compatibility isn't confirmed.
3. The existing `run-consent-probes` cron target (a Supabase Edge Function) is abandoned in favour of pg_cron calling the Next.js route directly.

### Network policy

Each probe target is a customer URL. The sandbox needs `allow-all` network access for the HTTP fetch + whatever analytics/CDN endpoints the page loads. Per-probe CIDR scoping is overkill for v2. Sandbox runtime budget per probe: 2 minutes max; enforced via `--timeout 2m`.

### Result shape — align with ADR-0016

v1 writes `consent_probe_runs.result jsonb` with:
- `detected_trackers: [{ service_slug, category, is_functional, confidence }]`
- `violations: [{ service_slug, reason }]`
- `overall_status: 'ok' | 'violations'`

v2 keeps the shape. The new fields are `browser_version` + `user_agent` + `page_load_ms`, appended inside the same `result` JSONB.

### Static-HTML path — retire, not retain

The two-pass static analysis is the source of the false positive and carries no defensive value once the browser path works. Delete the old Edge Function body; the cron target swaps to the new Next.js endpoint.

### V2-P2 — Probe CRUD UI

Dedicated `/dashboard/probes` route: list probes, create new, edit/archive, inspect last run JSON. No deep-dive probe-builder yet (property selector + consent-state form + schedule + path). Keeps CRUD simple.

---

## Decision

Five sprints:

1. **Sprint 1.1** — ADR + deps + scaffolding.
2. **Sprint 1.2** — Playwright probe scenario file `app/sandbox-scripts/probe-runner.mjs`. Self-contained: reads a JSON config from `/tmp/probe-input.json`, sets cookies, loads URL, collects network + DOM, writes JSON to stdout.
3. **Sprint 1.3** — Orchestrator Next.js API route `POST /api/internal/run-probes`. Authenticated via a shared secret header (`PROBE_CRON_SECRET`) that pg_cron sends. Iterates probes; creates + runs + stops a sandbox per probe; writes `consent_probe_runs` row. Replace the pg_cron target.
4. **Sprint 1.4** — `/dashboard/probes` CRUD.
5. **Sprint 1.5** — unit tests for the tracker-signature matching logic (signature-matching extracted to a pure module); deployed-smoke note.

### Why shared-secret auth not OIDC

The orchestrator route runs on Vercel and calls Sandbox with OIDC. But pg_cron calls the route from Supabase with a simple HMAC-like bearer token. The existing pattern for Supabase cron → Vercel function uses `CS_ORCHESTRATOR_ROLE_KEY` already; we add a distinct `PROBE_CRON_SECRET` so the key rotation scope is clear.

---

## Consequences

- **New dep: `@vercel/sandbox`** (~1MB). Pinned to 1.10.0 per Rule 16 (exact versions).
- **New dep: `playwright-core`** inside the sandbox scripts directory. Not bundled into the app server bundle — copied into the sandbox at run time.
- **New Vercel Function `/api/internal/run-probes`.** Part of the app's Vercel deployment. Consumes Vercel Sandbox concurrency budget during scheduled runs.
- **pg_cron target changes.** `consent-probes-hourly` stops calling `run-consent-probes` (Supabase Edge Function) and starts calling the new Vercel route via `net.http_post` with `PROBE_CRON_SECRET`.
- **Supabase Edge Function `run-consent-probes` deprecated.** Keep deployed for rollback; the new code path doesn't invoke it.
- **New customer surface: `/dashboard/probes`.** +1 nav item.
- V2-P1 + V2-P2 closed.

### Architecture Changes

Minor: a cron job now targets a Vercel route instead of a Supabase Edge Function. Everything else is additive.

---

## Implementation Plan

### Sprint 1.1 — ADR + deps

**Deliverables:**

- [x] ADR-0041 drafted.
- [x] `app/package.json` — add `"@vercel/sandbox": "1.10.0"` to dependencies.
- [x] `app/bun install` to pin lockfile.

**Status:** pending `bun install` + ADR-index update.

### Sprint 1.2 — Playwright probe scenario

**Deliverables:**

- [ ] `app/sandbox-scripts/probe-runner.mjs` — self-contained ES module. Reads JSON config (url, consent_cookie_name, consent_state). Uses `playwright-core` from `@playwright/browser-chromium`. Launches Chromium, sets consent cookie, navigates, intercepts network requests, collects script tags + iframe srcs + cookies, outputs JSON.
- [ ] `app/sandbox-scripts/package.json` — dependencies for the sandbox runtime. `playwright` pinned.

**Status:** `[x] complete` — 2026-04-17

### Sprint 1.3 — orchestrator route

**Deliverables:**

- [ ] `app/src/app/api/internal/run-probes/route.ts` — POST handler. Checks `Authorization: Bearer <PROBE_CRON_SECRET>` header. Queries `consent_probes` WHERE `is_active=true AND (next_run_at IS NULL OR next_run_at <= now())`. For each probe: create sandbox (runtime `node24`, network `allow-all`, timeout `2m`), copy `sandbox-scripts/**`, run `node probe-runner.mjs` with probe config as argv, parse stdout JSON, match against `tracker_signatures`, INSERT `consent_probe_runs`, update `consent_probes.last_run_at` + `next_run_at`, stop sandbox.
- [ ] `app/src/lib/probes/signature-match.ts` — pure module, signature match logic extracted for unit testing.
- [ ] Update `supabase/migrations/20260425000003_probe_cron_vercel.sql` — unschedule old `consent-probes-hourly` cron; reschedule pointing at Vercel route with `PROBE_CRON_SECRET` vault secret.

**Status:** `[x] complete` — 2026-04-17

### Sprint 1.4 — `/dashboard/probes` UI

**Deliverables:**

- [ ] `app/src/app/(dashboard)/dashboard/probes/page.tsx` — list + create.
- [ ] `app/src/app/(dashboard)/dashboard/probes/[probeId]/page.tsx` — edit + last-run JSON.
- [ ] `app/src/app/(dashboard)/dashboard/probes/actions.ts` — CRUD server actions.
- [ ] Nav item.

**Status:** `[x] complete` — 2026-04-17

### Sprint 1.5 — tests + deployed-smoke note

**Deliverables:**

- [ ] `app/tests/probes/signature-match.test.ts` — unit tests for the tracker-signature matching logic against known fixtures.
- [ ] Document in the ADR test results section: full end-to-end sandbox smoke requires a Vercel preview deploy + `PROBE_CRON_SECRET` + `VERCEL_OIDC_TOKEN`; manual verification one-shot.

**Status:** `[x] complete` — 2026-04-17

---

## Test Results

### Closeout — 2026-04-17

```
Test: signature-match unit suite
Method: cd app && bunx vitest run tests/probes/signature-match.test.ts
Result: 10/10 PASS (GA4 detection, dedup, multi-service, unknown-URL
        rejection; functional-tracker exemption; loaded_against_denied_state
        vs loaded_without_consent reason selection; overallStatus).

Test: Full test:rls suite
Method: bun run test:rls
Result: 14 files, 160/160 PASS (no regression).

Build: cd app && bun run build
Result: Zero errors, zero warnings. New routes in the manifest:
  /api/internal/run-probes
  /dashboard/probes
```

**End-to-end sandbox smoke is a deploy-time step.** The orchestrator needs three
env vars on the deployed Vercel Function: `PROBE_CRON_SECRET` (shared with
pg_cron Vault), `CS_ORCHESTRATOR_ROLE_KEY` (already set), and either
`VERCEL_OIDC_TOKEN` (auto-provided by Vercel at runtime) or a PAT. Plus two
Supabase Vault secrets for pg_cron to reach the Vercel route: `vercel_app_url`
and `probe_cron_secret`. Documented inline in the migration file
`20260425000003_probe_cron_vercel.sql`. Manual verification:

1. Operator creates both Vault secrets.
2. Operator sets `PROBE_CRON_SECRET` on the Vercel project.
3. Wait up to an hour (or invoke pg_cron manually) — `consent_probe_runs`
   gets a fresh row with `result.browser_version` populated (distinguishes
   v2 from the deprecated v1 static-HTML path).
4. Any detected violations surface in the `/dashboard/probes` history.

---

## Changelog References

- `CHANGELOG-schema.md` — Sprint 1.3 cron swap.
- `CHANGELOG-api.md` — Sprint 1.3 orchestrator route.
- `CHANGELOG-dashboard.md` — Sprint 1.4 probes CRUD.
- `CHANGELOG-edge-functions.md` — `run-consent-probes` deprecation note.
- `CHANGELOG-docs.md` — ADR authored; V2-P1 + V2-P2 closed.
