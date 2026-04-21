-- ADR-1001 V2 C-1 — tombstone table for revoked api_key hashes so that the
-- original plaintext (from before a rotation) returns 410 Gone after revoke
-- instead of 401 Unauthorized.
--
-- The bug being fixed: rpc_api_key_revoke clears previous_key_hash (so
-- rotation metadata is wiped at revoke time). That means the original
-- plaintext — which was moved to previous_key_hash during rotation — no
-- longer appears in either slot of api_keys after revoke. rpc_api_key_status
-- can't find it and returns 'not_found' → the middleware returns 401. The
-- rotated plaintext correctly returns 410.
--
-- Fix: at revoke time, insert BOTH the current key_hash and (if rotated) the
-- previous_key_hash into a tombstone table. rpc_api_key_status consults the
-- tombstone as a third lookup after the two api_keys slots.

-- ============================================================================
-- 1. Tombstone table
-- ============================================================================

create table if not exists public.revoked_api_key_hashes (
  key_hash    text primary key,
  key_id      uuid not null references public.api_keys(id) on delete cascade,
  revoked_at  timestamptz not null default now()
);

-- Lookup index (primary key already covers exact-match lookup by key_hash).
create index if not exists revoked_api_key_hashes_key_id_idx
  on public.revoked_api_key_hashes (key_id);

-- RLS enabled + zero policies → no direct access from any client role.
-- Only rpc_api_key_status (SECURITY DEFINER) reads it; only rpc_api_key_revoke
-- (SECURITY DEFINER) writes it.
alter table public.revoked_api_key_hashes enable row level security;

revoke all on public.revoked_api_key_hashes from public;
revoke all on public.revoked_api_key_hashes from anon, authenticated;

comment on table public.revoked_api_key_hashes is
  'ADR-1001 V2 C-1 — tombstone of revoked api_key hashes (current + previous). '
  'rpc_api_key_revoke inserts here before clearing previous_key_hash, so '
  'rpc_api_key_status can return revoked for rotated-then-revoked plaintexts.';

-- ============================================================================
-- 2. rpc_api_key_revoke — insert tombstone rows BEFORE clearing
-- ============================================================================

create or replace function public.rpc_api_key_revoke(p_key_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := public.current_uid();
  v_key record;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select * into v_key from public.api_keys where id = p_key_id;
  if v_key is null then
    raise exception 'key not found' using errcode = '42P01';
  end if;
  if v_key.revoked_at is not null then
    return;  -- idempotent
  end if;

  if not exists (
    select 1 from public.account_memberships am
     where am.account_id = v_key.account_id
       and am.user_id = v_uid
       and am.status = 'active'
       and am.role = 'account_owner'
  ) and not (
    v_key.org_id is not null
    and exists (
      select 1 from public.org_memberships om
       where om.org_id = v_key.org_id
         and om.user_id = v_uid
         and om.role = 'org_admin'
    )
  ) then
    raise exception 'not authorised to revoke this key' using errcode = '42501';
  end if;

  -- ADR-1001 V2 C-1: tombstone both the current and (if rotated) previous
  -- hash BEFORE the UPDATE clears previous_key_hash. Without this, the
  -- original plaintext (the rotation's previous hash) returns 'not_found'
  -- after revoke — the caller gets 401 instead of 410.
  insert into public.revoked_api_key_hashes (key_hash, key_id)
    values (v_key.key_hash, p_key_id)
    on conflict (key_hash) do nothing;

  if v_key.previous_key_hash is not null then
    insert into public.revoked_api_key_hashes (key_hash, key_id)
      values (v_key.previous_key_hash, p_key_id)
      on conflict (key_hash) do nothing;
  end if;

  update public.api_keys
     set revoked_at              = now(),
         revoked_by              = v_uid,
         previous_key_hash       = null,
         previous_key_expires_at = null
   where id = p_key_id;

  insert into public.audit_log (org_id, actor_id, event_type, entity_type, entity_id, payload)
  values (
    coalesce(v_key.org_id, (select id from public.organisations where account_id = v_key.account_id limit 1)),
    v_uid,
    'api_key.revoked',
    'api_key',
    p_key_id,
    jsonb_build_object('prefix', v_key.key_prefix)
  );
end;
$$;

-- Existing grant to authenticated still applies — no change needed.

comment on function public.rpc_api_key_revoke(uuid) is
  'ADR-1001 Sprint 2.1 + V2 C-1 — revoke an api_key. Idempotent. Inserts '
  'both the current and previous hash into revoked_api_key_hashes BEFORE '
  'clearing previous_key_hash so rpc_api_key_status returns revoked for '
  'every plaintext ever associated with the key.';

-- ============================================================================
-- 3. rpc_api_key_status — consult the tombstone on fallback
-- ============================================================================

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

  -- Slot 1: current key_hash.
  select revoked_at
    into v_row
    from public.api_keys
   where key_hash = v_hash
   limit 1;
  if found then
    return case when v_row.revoked_at is null then 'active' else 'revoked' end;
  end if;

  -- Slot 2: previous_key_hash (live rotation dual-window).
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

  -- Slot 3 (ADR-1001 V2 C-1): revoked tombstone. Any plaintext ever
  -- associated with a now-revoked key lives here permanently. Surfaces
  -- 'revoked' rather than 'not_found' so the middleware returns 410.
  if exists (select 1 from public.revoked_api_key_hashes where key_hash = v_hash) then
    return 'revoked';
  end if;

  return 'not_found';
end;
$$;

comment on function public.rpc_api_key_status(text) is
  'ADR-1009 Phase 2 + ADR-1001 V2 C-1 — returns active | revoked | not_found. '
  'Three-slot lookup: current key_hash, live previous_key_hash, then the '
  'revoked_api_key_hashes tombstone so rotated-then-revoked plaintexts '
  'surface as revoked (not not_found).';
