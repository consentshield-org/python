# Security Review — API Key Surface (ADR-1001 Sprint 3.1)

**Date:** 2026-04-20
**Scope:** `cs_live_*` Bearer token issuance, verification, rotation, revocation, rate limiting, and request logging (ADR-1001 Sprints 2.1–2.4)
**Reviewer:** Sudhindra Anegondhi

---

## 1. Threat Model

### Assets
- `cs_live_*` plaintext tokens — if stolen, an attacker can call any `/api/v1/*` endpoint on behalf of the org, within the token's scopes.
- `api_keys.key_hash` — SHA-256 of the plaintext; if exfiltrated with enough traffic, theoretically allows a timing attack against the hash lookup.
- `api_request_log` rows — metadata (path, status, latency) only; no user PII.

### Threat actors
| Actor | Goal | Likelihood |
|---|---|---|
| External attacker | Steal a plaintext token from transit, logs, or source | Medium |
| Compromised customer developer | Leak a token they created | High |
| Rogue Supabase query | Read `key_hash` from DB directly | Low (column-level REVOKE) |
| Token brute-force | Guess a valid `cs_live_*` token | Negligible (256-bit entropy) |

### Attack surface
- Transit: `Authorization: Bearer cs_live_*` header on every request
- Storage: DB column `key_hash` (SHA-256 hex); plaintext never stored
- Logs: Sentry error payloads; server-side console; `api_request_log`
- Source control: `.env.local` / secrets management

---

## 2. Checklist

### 2.1 Token generation and entropy

- [x] **256-bit entropy.** Plaintext = `cs_live_` + base64url(32 random bytes) = 256 bits. E2e test verifies body length ≥ 43 chars and base64url charset. Far exceeds the 64-bit minimum floor.
- [x] **No sequential/predictable prefix beyond `cs_live_`.** The body is `crypto.getRandomValues` via Postgres `gen_random_bytes(32)`.
- [x] **Prefix stored for search ergonomics.** `key_prefix` = first 16 chars of plaintext — enough to identify the key in UI without exposing the secret body.
- [x] **Plaintext returned once only.** `rpc_api_key_create` returns `{ plaintext }` in-flight; the DB only stores `key_hash = SHA-256(plaintext)`. No subsequent RPC returns plaintext.

### 2.2 Token-in-URL avoidance

- [x] **Token is in the `Authorization` header, not the URL.** The proxy pattern `Bearer cs_live_*` is RFC 6750 compliant. The OpenAPI spec at `app/public/openapi.yaml` documents this scheme.
- [x] **No query-parameter fallback.** `proxy.ts` reads only `request.headers.get('authorization')`. No `?token=` or `?key=` path exists.
- [x] **`/api/v1/*` routes are server-side only.** The Next.js proxy gate runs before any route handler; no client component can call these routes with credentials embedded in a URL.
- [x] **Sentry `beforeSend` strips query parameters.** `sentry.server.config.ts` and `sentry.client.config.ts` both run `beforeSend` hooks that strip request bodies, headers, cookies, and query strings before any event reaches Sentry (Rule 18).

### 2.3 Logging redaction

- [x] **`api_request_log` stores no plaintext.** Columns: `key_id` (UUID), `route`, `method`, `status`, `latency_ms`. No `Authorization` header, no token fragment, no user PII.
- [x] **`key_prefix` (16 chars) is safe to log.** It identifies the key in UI but cannot be used to authenticate — the verifier requires the full `cs_live_*` token.
- [x] **`logApiRequest` swallows errors silently.** `rpc_api_request_log_insert` catches all exceptions server-side; failures never surface error details to callers.
- [x] **Console logging in `verifyBearerToken` and `logApiRequest` contains no token body.** Verified by code review — no `console.log(plaintext)` or `console.log(authHeader)` in the auth or log-request paths.
- [x] **Rotation audit log stores only prefix (not new plaintext).** `rpc_api_key_rotate` inserts into `public.audit_log` with `{ old_prefix, new_prefix }` — never the plaintext or hash.

### 2.4 Key prefix search ergonomics

- [x] **`key_prefix` index exists.** `api_keys_prefix_idx` on `(key_prefix)` allows O(log n) prefix lookups in the admin or user UI without scanning `key_hash`.
- [x] **Prefix collision risk is negligible.** The prefix is 8 chars of the base64url body (after `cs_live_`). With 32 random bytes, the chance of two keys sharing the same 8-char prefix is 1 in 2^48 — effectively impossible in a dev DB.
- [x] **Users see prefix, not hash.** The dashboard list page (`api-keys-panel.tsx`) displays `key_prefix`; `key_hash` and `previous_key_hash` are never selected or returned to the browser.

### 2.5 Lifecycle security

- [x] **Revocation is immediate for both current and previous hash.** `rpc_api_key_revoke` sets `revoked_at` AND clears `previous_key_hash`, so the dual-window plaintext stops working immediately on revoke (not after 24h).
- [x] **Rotation issues a new plaintext without invalidating the old one for 24h.** `previous_key_expires_at = now() + 24h`; `rpc_api_key_verify` checks both hashes.
- [x] **`rpc_api_key_rotate` refuses to rotate an already-revoked key.** Returns error `22023` ("key already revoked"). Verified by `tests/rls/api-keys.test.ts`.
- [x] **Column-level REVOKE on `key_hash` + `previous_key_hash`.** Migration `20260520000003` re-issues explicit REVOKE on both `authenticated` and `anon` roles. E2e test confirms authenticated SELECT cannot read the hash value.
- [x] **`rpc_api_key_verify` is service_role only.** Migration grants: `service_role` only. `authenticated` and `anon` cannot call it directly.

### 2.6 Rate limiting

- [x] **Bucket key is `api_key:<key_id>`, not IP.** Prevents rate-limit bypass by rotating IPs; ties limits to the token, not the caller's network position.
- [x] **Per-tier limits are enforced at proxy time** (before route handlers run), so a burst test against any `/api/v1/*` endpoint triggers the limit uniformly.
- [x] **429 response includes `Retry-After` and `X-RateLimit-Limit`.** RFC 6585 compliant.
- [x] **No rate-limit bypass for `/api/v1/deletion-receipts/*`.** This path uses HMAC callback verification (ADR-0009) and is excluded from the Bearer gate but has its own HMAC check.

### 2.7 Constant-time verification

- [x] **SHA-256 lookup is effectively constant-time.** `rpc_api_key_verify` computes `SHA-256(plaintext)` in Postgres and matches against `key_hash` via a B-tree index equality scan. SHA-256 itself is constant-time in OpenSSL. The index lookup does not branch on whether the hash exists before comparing — it either finds the row or not.
- [ ] **Formal timing test pending.** A statistical timing probe (1000+ requests, miss vs hit, t-test) would confirm no measurable timing difference. Deferred to V2 security audit (pre-production launch).

---

## 3. Findings

### Blocking
*None.*

### Should-fix
*None.*

### Cosmetic / future
- **C-1:** The `rotate+revoke` edge case (original plaintext returns 401 instead of 410) is documented in `auth.ts` and the e2e test. Consider a `revoked_hashes` tombstone table in V2 so all plaintexts for a revoked key return 410 regardless of rotation order.
- **C-2:** The static `RATE_TIER_LIMITS` map in `rate-limits.ts` must be kept in sync with `public.plans` manually. Consider a build-time check that queries the DB and asserts the values match.

---

## 4. Outcome

**PASS.** No blocking or should-fix findings. The API key surface meets the security requirements for ADR-1001 Phase 2 (CC-D prep). The two cosmetic items are logged in `docs/V2-BACKLOG.md`.
