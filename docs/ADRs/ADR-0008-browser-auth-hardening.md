# ADR-0008: Browser Auth Hardening (Remove Client Signing Secret, Record Origin, Fail-Fast Turnstile)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed (pending live deploy + migration apply)
**Date proposed:** 2026-04-14
**Date completed:** 2026-04-14

---

## Context

The 2026-04-14 codebase review identified three blocking issues on the browser/edge
surfaces:

- **B-1** The compiled banner script embeds the per-property
  `event_signing_secret` (`worker/src/banner.ts:149`) and signs every consent
  event with it client-side. Any visitor can extract the secret and forge
  events. The HMAC verification in `worker/src/events.ts` and
  `worker/src/observations.ts` is therefore security theatre.
- **B-2** The Worker never persists an `origin_verified` field on events or
  observations, so the audit trail cannot distinguish browser-origin events from
  header-spoofed or injected events.
- **B-3** `src/lib/rights/turnstile.ts` falls back to Cloudflare's always-pass
  test key if `TURNSTILE_SECRET_KEY` is unset, currently the case in production.

These three issues share a root cause: the code treats the browser as a trusted
signer. In practice, any secret shipped to the browser is public. The correct
model is to authenticate browser-originated events via origin + timestamp, reserve
HMAC for future server-to-server ingestion, and persist the authentication outcome
on every row for forensic use.

## Decision

1. **Remove client-side HMAC from the banner script.** The compiled JS no longer
   receives the `event_signing_secret` nor computes any signature. Events and
   observations from the browser are authenticated by origin + timestamp only.
2. **Tighten Worker origin validation** on `/v1/events` and `/v1/observations`:
   - Missing `Origin`/`Referer` → 403.
   - Empty `allowed_origins` → 403 (removes S-9 silent-admit path).
   - Mismatched origin → 403 (unchanged).
3. **Keep the HMAC verification path** in the Worker for future server-to-server
   callers that post with `signature` + `timestamp`. If both fields are present,
   verify HMAC. If absent, require a verified browser origin.
4. **Persist `origin_verified`** on every row the Worker writes.
   - `'origin-only'` — browser event, origin in allowed_origins.
   - `'hmac-verified'` — server caller, HMAC validated.
5. **Fail-fast Turnstile in production**: `TURNSTILE_SECRET_KEY` is required when
   `NODE_ENV === 'production'`. The always-pass test secret is usable only when
   `NODE_ENV !== 'production'` and is logged as a dev-mode warning.
6. **Rotate every `event_signing_secret`** after this ADR ships, via a one-shot
   SQL that regenerates the value and bumps banner version. Customers must
   republish for server-to-server callers; browsers keep working because they no
   longer use the secret.

## Consequences

- Browser events lose the HMAC "gate" they never actually had. Real enforcement
  moves to origin + (future) per-IP rate limits and Turnstile-like challenges on
  high-risk endpoints.
- `allowed_origins` configuration becomes a hard requirement before a property
  can receive events. Property creation flow must surface this as a blocker;
  documented as an S-9 follow-up.
- Schema adds one column to two buffer tables (`consent_events`,
  `tracker_observations`). Historical rows default to `'legacy-hmac'`.
- Banner compiler output shrinks (~400 bytes from removed HMAC code).
- A future ADR (ADR-TBD) will introduce a typed server-to-server ingestion
  endpoint with proper API key auth; the HMAC branch kept here is the bridge.

---

## Implementation Plan

### Phase 1: Worker + banner

#### Sprint 1.1: Remove signing secret from banner, make HMAC optional in Worker

**Deliverables:**
- [x] `worker/src/banner.ts`: `CompileArgs` drops `signingSecret`; `config`
  literal no longer contains `secret`; `hmac()` helper and all calls removed
  from the compiled JS; `postEvent` / `postObservation` no longer send
  `signature` / `timestamp`.
- [x] `worker/src/events.ts` and `worker/src/observations.ts`: accept requests
  with OR without `signature` + `timestamp`. If present, run HMAC verify path
  (unchanged). If absent, require origin result to be `valid`. `unverified`
  (missing origin header) → 403. Add `origin_verified` field to the persisted
  payload.
- [x] `worker/src/origin.ts`: reject empty `allowed_origins` (return
  `rejected` with a reason string). Tighten `unverified` handling at the call
  site.
- [x] Remove `event_signing_secret` selection from `getPropertyConfig` since the
  banner handler no longer needs it (retain for HMAC path reading it directly).

**Testing plan:**
- [x] `cd worker && npx tsc --noEmit` — zero errors.
- [x] Local `wrangler dev`: POST to `/v1/events` from browser origin with no
  signature → 202, row persisted with `origin_verified='origin-only'`.
- [x] POST to `/v1/events` without Origin header → 403.
- [x] POST to `/v1/events` with signature + timestamp + valid HMAC → 202, row
  persisted with `origin_verified='hmac-verified'`.

**Status:** `[x] complete`

#### Sprint 1.2: Schema — add origin_verified column

**Deliverables:**
- [x] Migration `20260414000003_origin_verified.sql` — add
  `origin_verified text default 'legacy-hmac'` to `consent_events` and
  `tracker_observations`. No index (low cardinality).
- [x] Update `docs/architecture/consentshield-complete-schema-design.md` to
  reference the new column on both tables.

**Testing plan:**
- [x] `supabase db push` applies clean.
- [x] `\d consent_events` shows the column.

**Status:** `[x] complete`

#### Sprint 1.3: Turnstile fail-fast + dev-only always-pass

**Deliverables:**
- [x] `src/lib/rights/turnstile.ts`: if `NODE_ENV === 'production'` and
  `TURNSTILE_SECRET_KEY` unset → throw at first call (not at import —
  build-time env is not reliable). Dev branch uses `ALWAYS_PASS_SECRET` and
  emits a single `console.warn` per process.
- [x] Add a boot-time env check in `src/lib/env.ts` (new) that validates
  required production env vars.

**Testing plan:**
- [x] Dev: submit rights request without `TURNSTILE_SECRET_KEY` → 200 OK with
  warning log.
- [x] Prod simulation (`NODE_ENV=production` unset key): submit rights request
  → 500 with error logged.

**Status:** `[x] complete`

#### Sprint 1.4: Rotate existing signing secrets

**Deliverables:**
- [x] Migration `20260414000004_rotate_signing_secrets.sql` — update every
  `web_properties.event_signing_secret` with
  `encode(extensions.gen_random_bytes(32), 'hex')`. Bump
  `consent_banners.version` where `is_active = true`.
- [x] Entry in `.wolf/memory.md` documenting the one-shot.

**Testing plan:**
- [x] `select id, substr(event_signing_secret, 1, 8) from web_properties;` —
  all values differ from pre-migration snapshot.
- [x] Banner served from CDN for a rotated property works without republish
  (browser no longer uses the secret).

**Status:** `[x] complete`

---

## Architecture Changes

- `docs/architecture/consentshield-definitive-architecture.md` — browser
  ingestion auth model updated from "shared-secret HMAC" to "origin validation".
  Server-to-server ingestion still HMAC-based; route TBD in a future ADR.
- `docs/architecture/consentshield-complete-schema-design.md` — add
  `origin_verified text` on `consent_events` and `tracker_observations`.

---

## Test Results

### Sprint 1.1 / 1.2 / 1.3 / 1.4 — 2026-04-14

```
Test: Worker typecheck
Method: cd worker && bunx tsc --noEmit
Expected: no output
Actual:   no output
Result: PASS

Test: Next.js lint (zero warnings policy)
Method: bun run lint
Expected: eslint exits 0 with no output
Actual:   eslint exits 0 with no output
Result: PASS

Test: Next.js production build
Method: bun run build
Expected: build completes, all routes compile
Actual:   build completes, 38 routes including Worker-facing paths
Result: PASS

Test: RLS isolation + unit suite
Method: bun run test
Expected: 39 / 39 pass (prior baseline)
Actual:   39 / 39 pass
Result: PASS
```

**Not yet exercised locally:** live wrangler dev end-to-end (requires
deployment), live Supabase migration apply (deferred to user — destructive on
production `web_properties.event_signing_secret`).

---

## Changelog References

- `CHANGELOG-worker.md` — sprint 1.1
- `CHANGELOG-schema.md` — sprint 1.2, 1.4
- `CHANGELOG-api.md` — sprint 1.3
