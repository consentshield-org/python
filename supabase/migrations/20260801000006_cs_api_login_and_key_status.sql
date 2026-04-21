-- ADR-1009 Phase 2 Sprint 2.1 — cs_api role activation + rpc_api_key_status.
--
-- Scope-amendment context: the original Phase 2 plan minted an HS256 JWT for
-- cs_api (same pattern as SUPABASE_WORKER_KEY). Supabase is rotating the
-- project JWT signing keys to ECC P-256; the legacy HS256 secret is flagged
-- "Previously used" and slated for revocation. HS256-signed scoped-role JWTs
-- have a shelf life. Direct Postgres connections as scoped roles are
-- unaffected by the rotation, so cs_api switches to LOGIN + pool
-- (same pattern cs_delivery/cs_orchestrator already use from Edge Functions).
--
-- This migration:
--   1. Flips cs_api NOLOGIN → LOGIN with a placeholder password. User
--      immediately rotates via:
--        alter role cs_api with password '<strong random>';
--      and stores the rotated value in .secrets + Vercel.
--   2. Adds rpc_api_key_status: SECURITY DEFINER replacement for the direct
--      api_keys SELECT currently in app/src/lib/api/auth.ts getKeyStatus.
--   3. Keeps all grants + table privileges unchanged. Sprint 2.2 grants v1
--      RPCs to cs_api; Sprint 2.4 revokes from service_role.

-- ============================================================================
-- 1. Flip cs_api to LOGIN. Placeholder password — rotate via psql before use.
-- ============================================================================

-- Note: password ‘cs_api_change_me’ matches the cs_worker seed pattern
-- (migration 20260413000010). The migration is idempotent-ish: if the role
-- is already LOGIN with a different password, this RESETS it to the
-- placeholder, forcing the rotation ritual. In dev-only mode this is fine.
alter role cs_api with login password 'cs_api_change_me';

comment on role cs_api is
  'ADR-1009 Phase 2 — LOGIN-enabled minimum-privilege role for /api/v1/* '
  'handlers. Connects via Supavisor pooler. No table privileges by design; '
  'data access only through whitelisted SECURITY DEFINER RPCs. Password '
  'rotated out-of-band after migration (see .secrets SUPABASE_CS_API_PASSWORD).';

-- ============================================================================
-- 2. rpc_api_key_status — SECURITY DEFINER replacement for direct table read
-- ============================================================================
--
-- Callers: app/src/lib/api/auth.ts getKeyStatus() on the 401/410 fallback.
-- Input: the plaintext Bearer token (same as rpc_api_key_verify).
-- Output: 'active' | 'revoked' | 'not_found'.
--
-- Why not extend rpc_api_key_verify? That function returns the full context
-- on success and NULL on any non-match; callers then can't distinguish
-- "unknown key" from "revoked key" without a second lookup. Splitting is
-- clearer and scopes the RPC surface narrowly.

create or replace function public.rpc_api_key_status(p_plaintext text)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_hash   text;
  v_row    record;
begin
  if p_plaintext is null or length(p_plaintext) = 0 then
    return 'not_found';
  end if;

  v_hash := encode(extensions.digest(p_plaintext, 'sha256'), 'hex');

  -- Primary lookup: current key_hash.
  select revoked_at
    into v_row
    from public.api_keys
   where key_hash = v_hash
   limit 1;

  if found then
    return case when v_row.revoked_at is null then 'active' else 'revoked' end;
  end if;

  -- Fallback: previous_key_hash (rotation dual-window).
  select revoked_at
    into v_row
    from public.api_keys
   where previous_key_hash = v_hash
     and previous_key_expires_at is not null
     and previous_key_expires_at > now()
   limit 1;

  if found then
    return case when v_row.revoked_at is null then 'active' else 'revoked' end;
  end if;

  return 'not_found';
end;
$$;

revoke all on function public.rpc_api_key_status(text) from public;
revoke execute on function public.rpc_api_key_status(text) from anon, authenticated;
grant execute on function public.rpc_api_key_status(text) to service_role;
grant execute on function public.rpc_api_key_status(text) to cs_api;

comment on function public.rpc_api_key_status(text) is
  'ADR-1009 Phase 2 — returns the lifecycle state of an api_keys row by '
  'plaintext lookup. Replaces the direct api_keys SELECT in '
  'app/src/lib/api/auth.ts getKeyStatus. Returns active | revoked | not_found.';
