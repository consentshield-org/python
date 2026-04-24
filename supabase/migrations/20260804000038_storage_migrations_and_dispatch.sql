-- ADR-1025 Phase 3 Sprint 3.2 — storage migration state + dispatch pipeline.
--
-- Adds the table that tracks in-flight BYOK migrations, the dispatch
-- function + trigger + cron that drive them, and the admin RPC for
-- operator-triggered migrations.
--
-- State machine:
--   queued   → row created, dispatcher pending
--   copying  → actively processing (chunk in flight or between chunks)
--   completed → all objects copied + atomic pointer swap done
--   failed   → terminal error; operator re-invocation required
--
-- Vault secrets reused from Sprint 2.1:
--   cs_provision_storage_secret  (shared bearer)
--   ** cs_migrate_storage_url **   (new — operator must seed)
--
-- Operator seed (one-time, in Supabase Studio SQL Editor):
--   select vault.create_secret(
--     'https://app.consentshield.in/api/internal/migrate-storage',
--     'cs_migrate_storage_url'
--   );
-- The bearer is shared with provision-storage (same STORAGE_PROVISION_SECRET).

-- ═══════════════════════════════════════════════════════════
-- 1/6 · public.storage_migrations
-- ═══════════════════════════════════════════════════════════

create table if not exists public.storage_migrations (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organisations(id) on delete cascade,

  -- Source config at migration start. Snapshotted so the row is
  -- self-contained even if export_configurations later updates.
  from_config_id         uuid not null references public.export_configurations(id),
  from_config_snapshot   jsonb not null,

  -- Target destination. `to_config` is the public shape ({provider,
  -- bucket, region, endpoint}); `to_credential_enc` is the encrypted
  -- access-key+secret blob, wiped on terminal state.
  to_config              jsonb not null,
  to_credential_enc      bytea,

  -- Mode: forward_only = pointer swap only; copy_existing = stream
  -- every object before the pointer swap.
  mode                   text not null check (mode in ('forward_only', 'copy_existing')),

  -- State machine.
  state                  text not null default 'queued' check (state in (
                           'queued', 'copying', 'completed', 'failed'
                         )),

  -- Progress counters. objects_total is null until the first
  -- ListObjectsV2 call runs (copy_existing only); forward_only never
  -- populates these.
  objects_total          integer,
  objects_copied         integer not null default 0,
  last_copied_key        text,  -- cursor for resumption

  -- Retention deadline for the old CS-managed bucket after a successful
  -- forward_only migration. populated at cutover; Phase 4 cron cleans up
  -- buckets past this timestamp.
  retention_until        timestamptz,

  started_at             timestamptz not null default now(),
  last_activity_at       timestamptz not null default now(),
  completed_at           timestamptz,
  error_text             text,
  created_at             timestamptz not null default now(),

  -- Only one active migration per org at a time. Terminal states
  -- (completed, failed) are allowed alongside an active row for history.
  constraint storage_migrations_active_unique
    exclude using btree (org_id with =)
    where (state in ('queued', 'copying'))
);

create index if not exists storage_migrations_org_idx
  on public.storage_migrations (org_id, started_at desc);
create index if not exists storage_migrations_active_idx
  on public.storage_migrations (state, last_activity_at)
  where state in ('queued', 'copying');

-- updated_at pattern: last_activity_at auto-bumps on any UPDATE so the
-- cron can detect stuck-copying rows.
create or replace function public.touch_storage_migration_activity()
returns trigger language plpgsql as $$
begin
  if new.state in ('queued', 'copying') then
    new.last_activity_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_touch_storage_migration on public.storage_migrations;
create trigger trg_touch_storage_migration
  before update on public.storage_migrations
  for each row execute function public.touch_storage_migration_activity();

comment on table public.storage_migrations is
  'ADR-1025 Phase 3 Sprint 3.2. Tracks BYOK migrations from CS-managed R2 '
  'to customer-owned R2/S3. Exclusion constraint guarantees at most one '
  'active migration per org — terminal rows (completed/failed) stay as '
  'history.';

-- ═══════════════════════════════════════════════════════════
-- 2/6 · RLS
-- ═══════════════════════════════════════════════════════════

alter table public.storage_migrations enable row level security;

-- Customer users can SEE their own org's migrations (status display in UI).
-- No INSERT/UPDATE/DELETE from authenticated — the cs_orchestrator route owns writes.
create policy "org_select" on public.storage_migrations
  for select to authenticated
  using (org_id = public.current_org_id());

-- ═══════════════════════════════════════════════════════════
-- 3/6 · Grants
-- ═══════════════════════════════════════════════════════════

grant usage on schema public to cs_orchestrator;
grant select, insert, update on public.storage_migrations to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 4/6 · Dispatch function (mirrors dispatch_provision_storage)
-- ═══════════════════════════════════════════════════════════

create or replace function public.dispatch_migrate_storage(p_migration_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets
   where name = 'cs_migrate_storage_url'
   limit 1;

  -- Re-use the provision-storage bearer (same shared-secret pattern).
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'cs_provision_storage_secret'
   limit 1;

  if v_url is null or v_secret is null then
    return null;  -- soft-fail; cron safety-net picks up once vault is seeded
  end if;

  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object('migration_id', p_migration_id)
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke execute on function public.dispatch_migrate_storage(uuid) from public;
grant  execute on function public.dispatch_migrate_storage(uuid) to cs_orchestrator;

comment on function public.dispatch_migrate_storage(uuid) is
  'ADR-1025 Sprint 3.2. Fires net.http_post to /api/internal/migrate-storage. '
  'Soft-fails NULL on missing vault. Called by: (a) AFTER INSERT trigger '
  'on storage_migrations, (b) route itself after chunk completion, '
  '(c) safety-net cron for stuck migrations, (d) admin.storage_migrate RPC.';

-- ═══════════════════════════════════════════════════════════
-- 5/6 · AFTER INSERT trigger — fire first dispatch on row creation
-- ═══════════════════════════════════════════════════════════

create or replace function public.storage_migrations_after_insert_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Only dispatch for rows in queued state (the normal entry point).
  -- Terminal rows inserted via history-backfill paths won't fire.
  if new.state = 'queued' then
    begin
      perform public.dispatch_migrate_storage(new.id);
    exception when others then
      null;  -- never block the insert; cron catches it
    end;
  end if;
  return null;
end;
$$;

drop trigger if exists storage_migrations_dispatch_after_insert
  on public.storage_migrations;
create trigger storage_migrations_dispatch_after_insert
  after insert on public.storage_migrations
  for each row
  execute function public.storage_migrations_after_insert_dispatch();

-- ═══════════════════════════════════════════════════════════
-- 6/6 · pg_cron safety-net — re-kick stuck migrations every 1 min
-- ═══════════════════════════════════════════════════════════

do $$
begin
  perform cron.unschedule('storage-migration-retry');
  exception when others then null;
end $$;

select cron.schedule(
  'storage-migration-retry',
  '* * * * *',  -- every minute — object copy is paced by dispatch chain
  $$
  select public.dispatch_migrate_storage(sm.id)
    from public.storage_migrations sm
   where sm.state in ('queued', 'copying')
     and sm.last_activity_at < now() - interval '2 minutes'
     and sm.started_at > now() - interval '24 hours'
   order by sm.started_at asc
   limit 20;
  $$
);

-- ═══════════════════════════════════════════════════════════
-- admin.storage_migrate — operator-triggered migration
-- ═══════════════════════════════════════════════════════════

create or replace function admin.storage_migrate(
  p_org_id             uuid,
  p_to_config          jsonb,
  p_to_credential_enc  bytea,
  p_mode               text,
  p_reason             text
)
returns jsonb
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
  v_from_config public.export_configurations%rowtype;
  v_migration_id uuid;
  v_active_count int;
begin
  perform admin.require_admin('support');

  if p_reason is null or length(p_reason) < 10 then
    raise exception 'reason must be at least 10 characters';
  end if;
  if p_mode not in ('forward_only', 'copy_existing') then
    raise exception 'mode must be forward_only or copy_existing (got %)', p_mode;
  end if;
  if p_to_config is null or p_to_config = '{}'::jsonb then
    raise exception 'to_config required';
  end if;
  if p_to_credential_enc is null then
    raise exception 'to_credential_enc required';
  end if;

  -- Guard against double-enqueue.
  select count(*) into v_active_count
    from public.storage_migrations
   where org_id = p_org_id and state in ('queued', 'copying');
  if v_active_count > 0 then
    raise exception 'migration already active for org % (% rows)', p_org_id, v_active_count;
  end if;

  -- Snapshot the source config.
  select * into v_from_config
    from public.export_configurations
   where org_id = p_org_id;
  if v_from_config.id is null then
    raise exception 'no source export_configurations row for org %', p_org_id;
  end if;

  insert into public.storage_migrations
    (org_id, from_config_id, from_config_snapshot, to_config, to_credential_enc, mode, state)
  values (
    p_org_id,
    v_from_config.id,
    jsonb_build_object(
      'provider',     v_from_config.storage_provider,
      'bucket',       v_from_config.bucket_name,
      'region',       v_from_config.region,
      'path_prefix',  v_from_config.path_prefix
    ),
    p_to_config,
    p_to_credential_enc,
    p_mode,
    'queued'
  )
  returning id into v_migration_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id,
     old_value, new_value, reason)
  values (
    v_admin, 'adr1025_storage_migrate',
    'public.storage_migrations', v_migration_id, p_org_id,
    jsonb_build_object('from_config_id', v_from_config.id),
    jsonb_build_object('migration_id', v_migration_id, 'mode', p_mode),
    p_reason
  );

  return jsonb_build_object(
    'enqueued',     true,
    'migration_id', v_migration_id,
    'mode',         p_mode
  );
end;
$$;

grant execute on function admin.storage_migrate(uuid, jsonb, bytea, text, text) to cs_admin;

comment on function admin.storage_migrate(uuid, jsonb, bytea, text, text) is
  'ADR-1025 Sprint 3.2. Operator-triggered migration. The INSERT trigger '
  'auto-fires the dispatch; nothing else required. Audit-logged with '
  'operator-supplied reason. Raises if a migration is already active '
  'for the org.';

-- ═══════════════════════════════════════════════════════════
-- Verification queries (run after `bunx supabase db push`):
-- ═══════════════════════════════════════════════════════════
-- select pg_get_functiondef('public.dispatch_migrate_storage(uuid)'::regprocedure);
-- select pg_get_functiondef('admin.storage_migrate(uuid,jsonb,bytea,text,text)'::regprocedure);
-- select tgname from pg_trigger
--  where tgrelid = 'public.storage_migrations'::regclass;
--     → storage_migrations_dispatch_after_insert + trg_touch_storage_migration
-- select jobname, schedule, active from cron.job where jobname = 'storage-migration-retry';
--     → expect 1 row, '* * * * *', active = true
