-- Migration: ADR-1001 Sprint 2.1 — `cs_live_*` Public API keys + Bearer infra
-- Gaps: G-036
-- Extends the Phase-3 `public.api_keys` scaffolding into a production-grade
-- issuance/rotate/revoke surface, adds a day-partitioned `public.api_request_log`
-- for usage auditing, and introduces the `cs_api` minimum-privilege Postgres role
-- that ADR-1002 handlers will run under.
--
-- This migration is additive over 20260413000005 (Phase 3 scaffolding) and
-- assumes ADR-0044 accounts/memberships (migration 20260428000002) is present.

-- ============================================================================
-- 1. Extend public.api_keys
-- ============================================================================

-- Additive columns for v2 issuance/rotate/revoke/audit semantics.
alter table public.api_keys
  add column if not exists account_id uuid references public.accounts(id) on delete cascade,
  add column if not exists rate_tier text not null default 'starter'
    check (rate_tier in ('starter','growth','pro','enterprise','sandbox')),
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references auth.users(id) on delete set null,
  add column if not exists previous_key_hash text,
  add column if not exists previous_key_expires_at timestamptz,
  add column if not exists last_rotated_at timestamptz;

-- The existing `is_active` boolean overlaps with `revoked_at` semantics.
-- Keep both: `revoked_at` is the canonical lifecycle timestamp; `is_active`
-- is maintained by trigger for legacy readers.
create or replace function public.api_keys_sync_is_active()
returns trigger
language plpgsql
as $$
begin
  new.is_active := (new.revoked_at is null);
  return new;
end;
$$;

drop trigger if exists trg_api_keys_sync_is_active on public.api_keys;
create trigger trg_api_keys_sync_is_active
  before insert or update on public.api_keys
  for each row execute function public.api_keys_sync_is_active();

-- Scope allow-list enforced at the DDL boundary. Any /v1/* route declares
-- its required scope; issuance RPC rejects scopes not in this list.
create or replace function public.api_keys_scopes_valid(p_scopes text[])
returns boolean
language sql
immutable
as $$
  select coalesce(
    (select bool_and(s = any (array[
      'read:consent','write:consent',
      'read:artefacts','write:artefacts',
      'read:rights','write:rights',
      'read:deletion','write:deletion',
      'read:tracker','read:audit','read:security','read:probes','read:score'
    ])) from unnest(p_scopes) s),
    true  -- empty array is valid (nothing authorised; used transitionally)
  );
$$;

alter table public.api_keys
  drop constraint if exists api_keys_scopes_check;
alter table public.api_keys
  add constraint api_keys_scopes_check check (public.api_keys_scopes_valid(scopes));

-- Backfill account_id for any orphan rows (none expected in dev; safe in prod).
update public.api_keys k
   set account_id = o.account_id
  from public.organisations o
 where k.org_id = o.id and k.account_id is null;

-- org_id is nullable now — an account-scoped key (no specific org) covers
-- any organisation under the owning account. Org-scoped keys remain valid.
alter table public.api_keys alter column org_id drop not null;

create index if not exists api_keys_account_idx on public.api_keys (account_id);
create index if not exists api_keys_revoked_idx on public.api_keys (revoked_at) where revoked_at is null;
create index if not exists api_keys_prefix_idx on public.api_keys (key_prefix);

-- Column-level read restriction on sensitive columns (belt + braces over RPC gating).
revoke select (key_hash) on public.api_keys from authenticated;
revoke select (previous_key_hash) on public.api_keys from authenticated;

-- ============================================================================
-- 2. Replace RLS policies — direct writes are blocked; reads scoped to caller
-- ============================================================================

drop policy if exists "org_select" on public.api_keys;
drop policy if exists "org_insert" on public.api_keys;
drop policy if exists "org_update" on public.api_keys;
drop policy if exists "org_delete" on public.api_keys;

-- SELECT: account_owner / account_viewer for all keys in their account;
-- org_admin for keys scoped to their org.
create policy "api_keys_select_account_member"
  on public.api_keys
  for select
  using (
    account_id is not null
    and exists (
      select 1 from public.account_memberships am
      where am.account_id = public.api_keys.account_id
        and am.user_id = public.current_uid()
        and am.status = 'active'
        and am.role in ('account_owner','account_viewer')
    )
  );

create policy "api_keys_select_org_admin"
  on public.api_keys
  for select
  using (
    org_id is not null
    and exists (
      select 1 from public.org_memberships om
      where om.org_id = public.api_keys.org_id
        and om.user_id = public.current_uid()
        and om.role in ('org_admin')
    )
  );

-- No INSERT / UPDATE / DELETE for authenticated role. Issuance flows exclusively
-- through the SECURITY DEFINER RPCs below.
revoke insert, update, delete on public.api_keys from authenticated;

-- ============================================================================
-- 3. Issuance / rotation / revocation RPCs (SECURITY DEFINER)
-- ============================================================================

-- Generates `cs_live_` + 32 url-safe bytes (44 base64url chars). Plaintext is
-- returned once only and never stored.
create or replace function public.rpc_api_key_create(
  p_account_id uuid,
  p_org_id uuid,
  p_scopes text[],
  p_rate_tier text,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := public.current_uid();
  v_plaintext text;
  v_prefix text;
  v_hash text;
  v_key_id uuid;
  v_caller_role text;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Caller must be account_owner of the target account OR org_admin of the
  -- target org (if org-scoped) AND the org belongs to the claimed account.
  select am.role into v_caller_role
    from public.account_memberships am
   where am.account_id = p_account_id
     and am.user_id = v_uid
     and am.status = 'active';

  if v_caller_role not in ('account_owner') then
    if p_org_id is null then
      raise exception 'only account_owner may create account-scoped keys'
        using errcode = '42501';
    end if;

    if not exists (
      select 1 from public.org_memberships om
        join public.organisations o on o.id = om.org_id
       where om.org_id = p_org_id
         and om.user_id = v_uid
         and om.role = 'org_admin'
         and o.account_id = p_account_id
    ) then
      raise exception 'not an org_admin of target org'
        using errcode = '42501';
    end if;
  end if;

  if not public.api_keys_scopes_valid(p_scopes) then
    raise exception 'invalid scope in array' using errcode = '22023';
  end if;

  if p_rate_tier not in ('starter','growth','pro','enterprise','sandbox') then
    raise exception 'invalid rate_tier' using errcode = '22023';
  end if;

  -- Generate 32 random bytes → base64url → prefix with cs_live_
  v_plaintext := 'cs_live_' || translate(
    encode(extensions.gen_random_bytes(32), 'base64'),
    '+/=', '-_'
  );
  v_prefix := substring(v_plaintext from 1 for 16);  -- cs_live_XXXXXXXX
  v_hash := encode(extensions.digest(v_plaintext, 'sha256'), 'hex');

  insert into public.api_keys (
    account_id, org_id, key_hash, key_prefix, name, scopes, rate_tier,
    created_by
  ) values (
    p_account_id, p_org_id, v_hash, v_prefix, p_name, p_scopes, p_rate_tier,
    v_uid
  )
  returning id into v_key_id;

  insert into public.audit_log (org_id, actor_id, event_type, entity_type, entity_id, payload)
  values (
    coalesce(p_org_id, (select id from public.organisations where account_id = p_account_id limit 1)),
    v_uid,
    'api_key.created',
    'api_key',
    v_key_id,
    jsonb_build_object(
      'prefix', v_prefix,
      'scopes', p_scopes,
      'rate_tier', p_rate_tier,
      'account_id', p_account_id,
      'org_scoped', p_org_id is not null
    )
  );

  return jsonb_build_object(
    'id', v_key_id,
    'plaintext', v_plaintext,
    'prefix', v_prefix,
    'scopes', p_scopes,
    'rate_tier', p_rate_tier,
    'created_at', now()
  );
end;
$$;

grant execute on function public.rpc_api_key_create(uuid, uuid, text[], text, text)
  to authenticated;

-- Rotation: preserves id; stages previous hash under a 24-hour dual-window;
-- returns new plaintext. After `previous_key_expires_at`, the old plaintext
-- stops working (enforced by `public.rpc_api_key_verify`).
create or replace function public.rpc_api_key_rotate(p_key_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := public.current_uid();
  v_key record;
  v_plaintext text;
  v_new_prefix text;
  v_new_hash text;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select * into v_key from public.api_keys where id = p_key_id;
  if v_key is null then
    raise exception 'key not found' using errcode = '42P01';
  end if;
  if v_key.revoked_at is not null then
    raise exception 'key already revoked' using errcode = '22023';
  end if;

  -- Authorisation: same rules as create.
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
    raise exception 'not authorised to rotate this key' using errcode = '42501';
  end if;

  v_plaintext := 'cs_live_' || translate(
    encode(extensions.gen_random_bytes(32), 'base64'),
    '+/=', '-_'
  );
  v_new_prefix := substring(v_plaintext from 1 for 16);
  v_new_hash := encode(extensions.digest(v_plaintext, 'sha256'), 'hex');

  update public.api_keys
     set previous_key_hash         = key_hash,
         previous_key_expires_at   = now() + interval '24 hours',
         key_hash                  = v_new_hash,
         key_prefix                = v_new_prefix,
         last_rotated_at           = now()
   where id = p_key_id;

  insert into public.audit_log (org_id, actor_id, event_type, entity_type, entity_id, payload)
  values (
    coalesce(v_key.org_id, (select id from public.organisations where account_id = v_key.account_id limit 1)),
    v_uid,
    'api_key.rotated',
    'api_key',
    p_key_id,
    jsonb_build_object('old_prefix', v_key.key_prefix, 'new_prefix', v_new_prefix)
  );

  return jsonb_build_object(
    'id', p_key_id,
    'plaintext', v_plaintext,
    'prefix', v_new_prefix,
    'previous_key_expires_at', now() + interval '24 hours',
    'rotated_at', now()
  );
end;
$$;

grant execute on function public.rpc_api_key_rotate(uuid) to authenticated;

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

  update public.api_keys
     set revoked_at             = now(),
         revoked_by             = v_uid,
         previous_key_hash      = null,
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

grant execute on function public.rpc_api_key_revoke(uuid) to authenticated;

-- Verification helper for the middleware (Sprint 2.2). Returns null if the
-- plaintext does not match any active key (or its unexpired previous hash).
-- Called by the service-role client on every /v1/* request.
create or replace function public.rpc_api_key_verify(p_plaintext text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_hash text;
  v_key record;
begin
  if p_plaintext is null or p_plaintext not like 'cs_live_%' then
    return null;
  end if;

  v_hash := encode(extensions.digest(p_plaintext, 'sha256'), 'hex');

  -- Primary hash match on an active key.
  select * into v_key from public.api_keys
   where key_hash = v_hash and revoked_at is null
   limit 1;

  if v_key is null then
    -- Dual-window: accept previous_key_hash if not expired.
    select * into v_key from public.api_keys
     where previous_key_hash = v_hash
       and previous_key_expires_at is not null
       and previous_key_expires_at > now()
       and revoked_at is null
     limit 1;

    if v_key is null then
      return null;
    end if;
  end if;

  -- Fire-and-forget last_used_at bump (outside the caller's transaction concerns).
  update public.api_keys set last_used_at = now() where id = v_key.id;

  return jsonb_build_object(
    'id', v_key.id,
    'account_id', v_key.account_id,
    'org_id', v_key.org_id,
    'scopes', v_key.scopes,
    'rate_tier', v_key.rate_tier,
    'name', v_key.name,
    'prefix', v_key.key_prefix
  );
end;
$$;

-- Middleware runs as `service_role`; keep this restricted to that role.
revoke execute on function public.rpc_api_key_verify(text) from public;
revoke execute on function public.rpc_api_key_verify(text) from authenticated;
revoke execute on function public.rpc_api_key_verify(text) from anon;
grant execute on function public.rpc_api_key_verify(text) to service_role;

-- Daily cron: clear expired dual-window entries (defence-in-depth; verify()
-- already treats them as expired).
create or replace function public.api_keys_cleanup_rotation_windows()
returns void
language sql
as $$
  update public.api_keys
     set previous_key_hash = null,
         previous_key_expires_at = null
   where previous_key_expires_at is not null
     and previous_key_expires_at <= now();
$$;

-- ============================================================================
-- 4. public.api_request_log — day-partitioned usage audit
-- ============================================================================

create table if not exists public.api_request_log (
  id          uuid not null default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  key_id      uuid references public.api_keys(id) on delete set null,
  account_id  uuid,
  org_id      uuid,
  route       text not null,
  method      text not null,
  status      integer not null,
  latency_ms  integer,
  response_bytes integer,
  user_agent  text,
  primary key (id, occurred_at)
) partition by range (occurred_at);

-- Bootstrap today + tomorrow + yesterday partitions so inserts don't fail on
-- boundary crossings. Daily cron creates the next day's partition going forward.
create or replace function public.api_request_log_partition_name(p_day date)
returns text
language sql
immutable
as $$
  select 'api_request_log_' || to_char(p_day, 'YYYY_MM_DD');
$$;

create or replace function public.api_request_log_ensure_partition(p_day date)
returns void
language plpgsql
as $$
declare
  v_name text := public.api_request_log_partition_name(p_day);
  v_from date := p_day;
  v_to   date := p_day + 1;
begin
  execute format(
    $ddl$
    create table if not exists public.%I
      partition of public.api_request_log
      for values from (%L) to (%L)
    $ddl$,
    v_name,
    v_from::timestamptz,
    v_to::timestamptz
  );
end;
$$;

-- Bootstrap ±1 day around today.
select public.api_request_log_ensure_partition((now() - interval '1 day')::date);
select public.api_request_log_ensure_partition((now())::date);
select public.api_request_log_ensure_partition((now() + interval '1 day')::date);

-- Retention: drop partitions older than 90 days.
create or replace function public.api_request_log_drop_old_partitions()
returns integer
language plpgsql
as $$
declare
  r record;
  v_dropped integer := 0;
  v_cutoff date := (now() - interval '90 days')::date;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname like 'api_request_log_%'
       and c.relname ~ '^api_request_log_[0-9]{4}_[0-9]{2}_[0-9]{2}$'
       and to_date(substring(c.relname from 16), 'YYYY_MM_DD') < v_cutoff
  loop
    execute format('drop table if exists public.%I', r.relname);
    v_dropped := v_dropped + 1;
  end loop;
  return v_dropped;
end;
$$;

-- Middleware writes via service_role; cs_api role gets no direct access.
revoke all on public.api_request_log from public;
revoke all on public.api_request_log from authenticated;
revoke all on public.api_request_log from anon;

-- account_owner / org_admin can read their own usage (RLS).
alter table public.api_request_log enable row level security;

create policy "api_request_log_select_account_member"
  on public.api_request_log
  for select
  using (
    account_id is not null
    and exists (
      select 1 from public.account_memberships am
       where am.account_id = public.api_request_log.account_id
         and am.user_id = public.current_uid()
         and am.status = 'active'
         and am.role in ('account_owner','account_viewer')
    )
  );

create policy "api_request_log_select_org_admin"
  on public.api_request_log
  for select
  using (
    org_id is not null
    and exists (
      select 1 from public.org_memberships om
       where om.org_id = public.api_request_log.org_id
         and om.user_id = public.current_uid()
         and om.role in ('org_admin')
    )
  );

grant select on public.api_request_log to authenticated;

-- ============================================================================
-- 5. cs_api role — minimum-privilege execution context for /v1/* handlers
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'cs_api') then
    create role cs_api noinherit nologin;
  end if;
end $$;

-- The role has no direct table privileges. All data access flows through
-- SECURITY DEFINER RPCs added in ADR-1002 onwards (verify, record, list,
-- revoke, deletion/trigger, etc.). Keeping table privileges empty enforces
-- the "RPC gate" discipline.
revoke all on all tables in schema public from cs_api;
revoke all on all sequences in schema public from cs_api;
revoke all on all functions in schema public from cs_api;

-- One intentional grant: allow cs_api to resolve its own context.
grant execute on function public.current_uid() to cs_api;

-- Document intent.
comment on role cs_api is
  'ADR-1001 G-036 — minimum-privilege role for /api/v1/* handlers. '
  'Executes SECURITY DEFINER RPCs only. No direct table privileges by design.';

-- ============================================================================
-- 6. pg_cron schedules
-- ============================================================================

-- Defensive: ensure pg_cron exists (should already from earlier ADRs).
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    if not exists (select 1 from pg_extension where extname = 'pg_cron') then
      create extension pg_cron;
    end if;
  end if;
end $$;

-- Create tomorrow's partition every day at 23:30 UTC.
select cron.schedule(
  'api-request-log-next-partition',
  '30 23 * * *',
  $$ select public.api_request_log_ensure_partition((now() + interval '1 day')::date) $$
)
where exists (select 1 from pg_extension where extname = 'pg_cron');

-- Drop partitions > 90 days old every day at 02:00 UTC.
select cron.schedule(
  'api-request-log-retention',
  '0 2 * * *',
  $$ select public.api_request_log_drop_old_partitions() $$
)
where exists (select 1 from pg_extension where extname = 'pg_cron');

-- Clear expired rotation windows every day at 03:00 UTC.
select cron.schedule(
  'api-keys-rotation-window-cleanup',
  '0 3 * * *',
  $$ select public.api_keys_cleanup_rotation_windows() $$
)
where exists (select 1 from pg_extension where extname = 'pg_cron');
