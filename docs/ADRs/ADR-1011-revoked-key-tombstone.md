# ADR-1011: Revoked-key tombstone — rotate+revoke plaintexts return 410

**Status:** Completed
**Date proposed:** 2026-04-21
**Date completed:** 2026-04-21
**Superseded by:** —

---

## Context

ADR-1001 Sprint 3.1's security review flagged **finding C-1**: the rotated-then-revoked edge case.

The flow:

1. `rpc_api_key_create` issues plaintext **P1** with hash **H1** → `api_keys(key_hash=H1, previous_key_hash=null)`.
2. `rpc_api_key_rotate` moves H1 to `previous_key_hash`, inserts new hash H2 → `api_keys(key_hash=H2, previous_key_hash=H1, previous_key_expires_at=now+24h)`. Both **P1** and the new **P2** plaintext verify during the 24h dual-window.
3. `rpc_api_key_revoke` sets `revoked_at=now()` AND clears `previous_key_hash=null` → `api_keys(key_hash=H2, previous_key_hash=null, revoked_at=<ts>)`.

After step 3:
- **P2** (the rotated plaintext) → `rpc_api_key_status` finds H2 in slot 1 → returns `'revoked'` → middleware returns **410 Gone**. ✅
- **P1** (the original plaintext) → `rpc_api_key_status` finds H1 nowhere (slot 1 has H2; slot 2 is null) → returns `'not_found'` → middleware returns **401 Unauthorized**. ❌

Operators who revoke a rotated key expect *all* plaintexts ever associated with the key to return 410. Both tokens block the call today (P1 gets 401; the call still fails), so this was categorized as informational-only and deferred to V2. With ADR-1009 Phase 2 done and a grep-gate enforcing Rule 5, closing small backlog items became cheap; C-1 landed here.

## Decision

Add a **tombstone table** (`public.revoked_api_key_hashes`) that stores every `key_hash` and `previous_key_hash` associated with a revoked key. `rpc_api_key_revoke` inserts both hashes BEFORE clearing `previous_key_hash`. `rpc_api_key_status` consults the tombstone as a third lookup after the two `api_keys` slots.

Every plaintext ever associated with a now-revoked key surfaces as `'revoked'` → 410 Gone.

## Consequences

- Precise 401 vs 410 semantics across rotation history. Operators diagnosing "why did this token stop working?" get an unambiguous answer.
- One small append-only table. Grows at the rate of revocations (low).
- `api_keys ON DELETE CASCADE → revoked_api_key_hashes` ensures hard-deletes (rare: org deletion) clean up transparently.
- No impact on the active-key path — tombstone is consulted only on the fallback leg of `rpc_api_key_status`.

## Implementation

Single migration: `supabase/migrations/20260801000010_revoked_key_tombstone.sql`.

**Schema:**
```sql
create table public.revoked_api_key_hashes (
  key_hash    text primary key,
  key_id      uuid not null references public.api_keys(id) on delete cascade,
  revoked_at  timestamptz not null default now()
);
```
RLS enabled, zero policies, zero grants — only `SECURITY DEFINER` RPCs touch it.

**`rpc_api_key_revoke` change:** inserts `v_key.key_hash` (always) and `v_key.previous_key_hash` (if non-null) into the tombstone before the UPDATE that clears `previous_key_hash`. `on conflict (key_hash) do nothing` handles idempotency if the same key is revoked multiple times (second call is a no-op via the existing `revoked_at is not null → return` guard, but the conflict clause is belt + braces).

**`rpc_api_key_status` change:** adds a third lookup after the two `api_keys` slots. If the tombstone has a row for the hashed plaintext, return `'revoked'`. This is the only new SQL path on the hot 410 leg.

---

## Test Results

### Inline — 2026-04-21

- **New assertion in `tests/integration/cs-api-role.test.ts`:** seed a key with hash H1 → simulate rotation (key_hash=H2, previous_key_hash=H1) → call real `rpc_api_key_revoke` as an authenticated org_admin → verify `rpc_api_key_status(P1) = 'revoked'` AND `rpc_api_key_status(P2) = 'revoked'` AND the tombstone holds exactly `{H1, H2}` for this key_id. Passes.
- **Existing assertion flipped in `tests/integration/api-keys.e2e.test.ts`:** the "original plaintext returns 401/invalid after rotate+revoke (known edge case)" test renamed to "returns 410/revoked (ADR-1011 fix)" and asserts `result.status === 410 && result.reason === 'revoked'`. Passes.
- Full integration: 108/108 PASS.

---

## Changelog References

- CHANGELOG-schema.md — 2026-04-21 entry for migration 20260801000010.
- CHANGELOG-api.md — none (no API shape change; 401 → 410 is a response-code tightening, not a schema change).
