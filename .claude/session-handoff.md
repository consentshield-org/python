# Session Handoff — 2026-04-20 (ADR-1001 Sprints 2.2 + 2.3 wireframe)

Three commits this session, all on ADR-1001. Terminal A also shipped ADR-0050 Sprint 3.1 (GST statement + invoice export) concurrently as `1e8c148` — not touched in this terminal.

---

## Commits this session

| Hash | Message |
|------|---------|
| `8a8bea1` | feat(ADR-1001): sprint 2.2 — Bearer middleware + request context (G-036) |
| `04e237a` | docs(ADR-1001): sprint 2.2 — architecture + schema doc updates |
| `6c84f55` | wireframe(ADR-1001): sprint 2.3 — API keys settings panel |

---

## Files modified or created this session

### Sprint 2.2 — code (`8a8bea1`)

| File | Change |
|------|--------|
| `app/src/lib/api/auth.ts` | **New.** `verifyBearerToken(authHeader)` — parses `Bearer cs_live_*`, calls `rpc_api_key_verify` via service_role client, distinguishes revoked (410) from invalid (401) via secondary `api_keys.key_hash` lookup. `problemJson()` RFC 7807 body builder. |
| `app/src/lib/api/context.ts` | **New.** `getApiContext()` reads proxy-injected headers into `ApiKeyContext`; `assertScope()` returns 403 response for missing scopes; `buildApiContextHeaders()` stamps context onto the request for next step in proxy. |
| `app/src/proxy.ts` | **Modified.** Added `/api/v1/:path*` to `config.matcher`. Added Bearer gate branch: skips `/api/v1/deletion-receipts/*`, validates token, injects 5 context headers on success, or returns RFC 7807 problem+json (401/410). |
| `app/src/app/api/v1/_ping/route.ts` | **New.** Canary `GET` — reads proxy-injected headers, returns `{ ok, org_id, account_id, scopes, rate_tier }`. No DB query. |
| `tests/integration/api-middleware.test.ts` | **New.** 6 integration tests for `verifyBearerToken` — valid, missing, malformed ×2, non-existent, revoked. All pass against live DB. |
| `vitest.config.ts` | **Modified.** Added `tests/integration/**/*.test.ts` to include list. |
| `docs/ADRs/ADR-1001-truth-in-marketing-and-public-api-foundation.md` | Sprint 2.2 deliverables + test results recorded; status flipped to `[x] complete`. |
| `docs/changelogs/CHANGELOG-api.md` | Sprint 2.2 top entry added. |

### Sprint 2.2 — docs (`04e237a`)

| File | Change |
|------|--------|
| `docs/architecture/consentshield-definitive-architecture.md` | §10.3 expanded from a bare route table to a full compliance-API section: 5-step Bearer gate flow, RFC 7807 error table, `cs_api` role description, key lifecycle summary, canary, rate-tier stub (Sprint 2.4), updated route table with `_ping`. |
| `docs/architecture/consentshield-complete-schema-design.md` | Replaced stale Phase-3 `api_keys` stub with Sprint 2.1 v2 schema (all new columns, generated `is_active`, scope CHECK function). Added `api_request_log` day-partitioned table. Added `cs_api` role + RPC call-signature inventory as doc comments. |
| `docs/changelogs/CHANGELOG-docs.md` | Sprint 2.2 top entry added. |

### Sprint 2.3 — wireframe (`6c84f55`)

| File | Change |
|------|--------|
| `docs/design/screen designs and ux/consentshield-screens.html` | **"API keys" nav item** added to settings sidebar between "Team members" and "Integrations". **Full `#api-keys-section`** added: key list table (active / dual-window rotation / revoked row states), empty state CTA, Create modal (name + scope multiselect for all 13 allowed scopes + read-only rate_tier from plan), plaintext-reveal modal (monospace display, copy button, amber warning, "I have saved this key" checkbox gates Dismiss), Rotate confirm modal (24h dual-window explained), Revoke confirm modal (red, immediate). New CSS classes: `.key-table`, `.key-prefix`, `.key-plaintext-box`, `.key-modal-overlay`, `.key-modal`, `.key-scope-grid`, `.key-scope-chip`, `.dual-window-notice`. New JS helpers for all modal flows. |
| `docs/design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md` | §8 appended — documents every HTML + CSS + JS change made in this wireframe pass; serves as the reconciliation tracker for Sprint 2.3 code. |

---

## Architectural decisions made this session

### 1. `service_role` is the correct client for `rpc_api_key_verify` from Next.js
Migration `20260520000001` grants EXECUTE on `rpc_api_key_verify` to `service_role` only (explicitly revoked from `public`, `authenticated`, `anon`). The Supabase REST API only supports `anon`/`service_role` JWT auth — the `cs_api` Postgres role can't be used from REST. So proxy.ts uses `service_role` for the verify call and the revoked-key fallback query. This is the same carve-out pattern as the Cloudflare Worker's service_role REST usage, and is intentional per the Sprint 2.1 comment in the migration ("Middleware runs as `service_role`").

### 2. Proxy.ts (not a dedicated route-level helper) is the right interception point
Having the Bearer gate in `proxy.ts` (Next.js 16's `middleware.ts` replacement) means no individual route handler can be deployed without auth. A shared lib helper would require each handler to call it explicitly — easy to forget. The proxy approach is centralised and harder to bypass accidentally.

### 3. Revoked vs. unknown requires a two-pass check
`rpc_api_key_verify` returns `null` for both "no such key" and "revoked key". To return 410 (Gone) for revoked keys (rather than 401), a secondary query `SELECT revoked_at FROM api_keys WHERE key_hash = sha256(plaintext)` is needed. Using `service_role` this column is visible despite the column-level grant restriction (which only applies to `authenticated`). Edge case acknowledged in a code comment: using the *old* plaintext after rotate+revoke returns 401 not 410 (the old hash is no longer in `key_hash` after rotation). The primary-key 410 path works correctly.

### 4. Context propagated via request headers, not a shared store
Proxy injects `x-api-key-id`, `x-api-account-id`, `x-api-org-id`, `x-api-scopes`, `x-api-rate-tier` into the request. Route handlers read via `getApiContext()` which calls `await headers()` (Next.js 16 async headers API). This is the standard Next.js proxy → route-handler communication mechanism and requires no global state.

### 5. Scope enforcement is per-handler, not in the proxy
The proxy only validates that the key is active. Each route handler calls `assertScope(context, 'read:consent')` for its specific requirement. This allows the same key to call multiple endpoints with different scopes without the proxy needing to know the scope requirement of every route.

### 6. Wireframe-before-code rule enforced for Sprint 2.3
The project rule (CLAUDE.md + memory `feedback_wireframes_before_adrs.md`) requires a wireframe commit before any UI code. The user explicitly reminded us of this. We stopped, authored the wireframe + alignment doc update, committed `6c84f55`, and only then are ready to write code. The ADR's detailed UI description was noted as not being a substitute for the wireframe.

---

## In-progress work

Sprint 2.3 code has NOT been written yet. The wireframe is committed; implementation is the next step.

ADR-0050 Sprint 3.1 (billing export/GST statement) was committed by Terminal A as `1e8c148` — no action needed here.

---

## Exact next step (tomorrow)

**ADR-1001 Sprint 2.3 — `/dashboard/settings/api-keys` page implementation.**

The wireframe (`6c84f55`) is the spec. Build against it exactly.

File plan in order:

1. **`app/src/app/(dashboard)/dashboard/settings/api-keys/page.tsx`** — server component. Fetches keys via `supabase.from('api_keys').select(...)` filtered by `account_id` from the user's `account_memberships`. Renders the list table (active/dual-window/revoked rows) or empty state. Account_owner sees all keys; org_admin sees org-scoped keys; viewer gets a "no access" card (same pattern as `settings/members/page.tsx`).

2. **`app/src/app/(dashboard)/dashboard/settings/api-keys/create-form.tsx`** — `'use client'`. Dialog containing the name field + scope multiselect (all 13 scopes from the allow-list, checkbox chips matching wireframe). Calls `supabase.rpc('rpc_api_key_create', ...)`. On success, receives plaintext from the RPC response and transitions to the plaintext-reveal modal.

3. **`app/src/app/(dashboard)/dashboard/settings/api-keys/plaintext-modal.tsx`** — `'use client'`. Controlled by parent via `plaintext` prop (string | null). Monospace display + copy-to-clipboard (`navigator.clipboard.writeText`). "I have saved this key" checkbox gates the Dismiss button. Dismissing sets `plaintext` to null in parent state — key is no longer recoverable.

4. **`app/src/app/(dashboard)/dashboard/settings/api-keys/key-actions.tsx`** — `'use client'`. Rotate and Revoke buttons with confirm dialogs. Rotate calls `rpc_api_key_rotate` → on success, transitions to plaintext-reveal modal with new plaintext. Revoke calls `rpc_api_key_revoke` → optimistic UI update marking the row as revoked. `router.refresh()` after each action to revalidate server data.

5. **`app/src/components/dashboard-nav.tsx`** — add `{ href: '/dashboard/settings/api-keys', label: 'API keys' }` nav item between Team & invites and any integration nav item.

**Key implementation constraints from the wireframe:**
- `rate_tier` is read-only in the create modal — derive it from `accounts.plan_code` at page load, pass it as a prop to the form, and send it in the RPC call.
- The dual-window amber notice in each row reads `previous_key_expires_at` from the key row — show when `previous_key_expires_at IS NOT NULL AND previous_key_expires_at > now()`.
- Revoked rows: `is_active = false` (generated column). Show with line-through name, greyed row, no action buttons (only a "Revoked [date]" label).
- "Revoke old key now" in the dual-window notice calls `rpc_api_key_revoke` on the same key (not a separate key) — it clears `previous_key_hash` immediately.

**After the page is built:**
- Manual smoke test: mint key → call `/api/v1/_ping` with it → 200 + org_id in response. Tick off the ADR test-plan item.
- Commit under `feat(ADR-1001): sprint 2.3 — api-keys settings UI`.

---

## Gotchas and constraints discovered this session

### 1. `rpc_api_key_revoke` requires `current_uid()` — service_role client cannot call it
The RPC checks `v_uid := public.current_uid()` and raises `'unauthenticated'` if null. The service_role client has no `current_uid()`. Must call as the key owner's authenticated client. Caught in the test; fixed immediately. Applies to rotate too.

### 2. Next.js 16: `proxy.ts` not `middleware.ts`
Already in cerebrum but worth repeating — the Sprint 2.3 page is a standard server component under `(dashboard)/`, no proxy changes needed for it. The Bearer gate in proxy.ts only intercepts `/api/v1/*`, not dashboard routes.

### 3. ADR-0050 billing track (Terminal A)
`1e8c148` landed from Terminal A — ADR-0050 Sprint 3.1 GST statement + invoice export + search is now committed. The dirty files from that track that were sitting on disk last session are gone. No impact on ADR-1001 work.

### 4. Wireframe rule is non-negotiable; ADR spec text is not a substitute
The user explicitly interrupted the Sprint 2.3 implementation attempt to enforce the wireframe-first rule. Do not start UI code without a committed wireframe regardless of how detailed the ADR deliverables section is.

### 5. `assertScope` returns a NextResponse, not a thrown error
`assertScope(context, scope)` in `context.ts` returns `NextResponse | null`. Route handlers must check the return and `return` it if non-null. It does not throw. This is intentional (no try/catch needed in handlers) but easy to forget on the first handler that uses it.
