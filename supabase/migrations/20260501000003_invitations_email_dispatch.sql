-- ADR-0044 Phase 2.5 — invitation email dispatch primitive.
--
-- Pattern: hybrid trigger + safety-net cron.
--   1. AFTER INSERT on public.invitations fires net.http_post to the
--      Next.js /api/internal/invitation-dispatch endpoint.
--   2. pg_cron('invitation-dispatch-retry') runs every 5 minutes and
--      re-fires the same call for any invite that hasn't been
--      dispatched yet (within a 1-hour / 5-attempt cap).
--   3. The dispatcher endpoint is idempotent — the first write wins
--      on email_dispatched_at, retries only set email_last_error +
--      increment email_dispatch_attempts.
--
-- Vault secrets (operator action, outside this migration):
--   select vault.create_secret('<secret>', 'cs_invitation_dispatch_secret');
--   select vault.create_secret('<https://.../api/internal/invitation-dispatch>',
--                              'cs_invitation_dispatch_url');

-- ═══════════════════════════════════════════════════════════
-- 1/4 · Tracking columns on public.invitations
-- ═══════════════════════════════════════════════════════════

alter table public.invitations
  add column if not exists email_dispatched_at     timestamptz,
  add column if not exists email_dispatch_attempts int not null default 0,
  add column if not exists email_last_error        text;

create index if not exists invitations_dispatch_pending_idx
  on public.invitations (created_at)
  where accepted_at is null
    and revoked_at is null
    and email_dispatched_at is null
    and email_dispatch_attempts < 5;

-- ═══════════════════════════════════════════════════════════
-- 2/4 · public.dispatch_invitation_email(p_id uuid)
-- ═══════════════════════════════════════════════════════════
-- Fires net.http_post to the dispatcher endpoint. Reads URL + secret
-- from Vault so no credentials live in source. Returns the pg_net
-- request id so the trigger / cron can be inspected.

create or replace function public.dispatch_invitation_email(p_id uuid)
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
   where name = 'cs_invitation_dispatch_url'
   limit 1;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'cs_invitation_dispatch_secret'
   limit 1;

  if v_url is null or v_secret is null then
    -- Missing Vault secret — treat as a soft failure. The cron
    -- safety-net will retry once the operator configures them.
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('invitation_id', p_id)
  ) into v_request_id;

  return v_request_id;
end;
$$;

-- Only postgres / cs_orchestrator call this directly; never exposed
-- to authenticated.
revoke execute on function public.dispatch_invitation_email(uuid) from public;

-- ═══════════════════════════════════════════════════════════
-- 3/4 · AFTER INSERT trigger
-- ═══════════════════════════════════════════════════════════

create or replace function public.invitations_after_insert_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Only dispatch for freshly-created, live invites. Revoked /
  -- already-accepted rows are never re-sent.
  if new.revoked_at is null and new.accepted_at is null then
    perform public.dispatch_invitation_email(new.id);
  end if;
  return null; -- AFTER trigger; return value is ignored
end;
$$;

drop trigger if exists invitations_dispatch_after_insert on public.invitations;

create trigger invitations_dispatch_after_insert
  after insert on public.invitations
  for each row
  execute function public.invitations_after_insert_dispatch();

-- ═══════════════════════════════════════════════════════════
-- 4/4 · pg_cron safety-net — every 5 minutes
-- ═══════════════════════════════════════════════════════════
-- Re-fires dispatch_invitation_email for any invite that:
--   * was created > 1 minute ago (gives the trigger a chance first),
--   * hasn't been dispatched yet,
--   * has fewer than 5 attempts,
--   * isn't accepted or revoked.
-- Caps at 50 invites per run so a stuck endpoint can't stampede.

do $$
begin
  perform cron.unschedule('invitation-dispatch-retry');
  exception when others then null;
end $$;

select cron.schedule(
  'invitation-dispatch-retry',
  '*/5 * * * *',
  $$
  select public.dispatch_invitation_email(i.id)
    from public.invitations i
   where i.accepted_at is null
     and i.revoked_at is null
     and i.email_dispatched_at is null
     and i.email_dispatch_attempts < 5
     and i.created_at < now() - interval '1 minute'
     and i.created_at > now() - interval '1 hour'
   order by i.created_at asc
   limit 50;
  $$
);

-- Verification queries:
--   select pg_get_functiondef('public.dispatch_invitation_email(uuid)'::regprocedure);
--   select tgname from pg_trigger where tgrelid = 'public.invitations'::regclass;
--     → expect invitations_dispatch_after_insert
--   select jobname from cron.job where jobname = 'invitation-dispatch-retry';
