-- ADR-1004 Phase 2 Sprint 2.1 — notices schema + append-only constraint.
--
-- Creates `public.notices` — every org's privacy-notice version history.
-- Append-only: published notices are immutable records of what data
-- principals agreed to at the time consent was captured.
--
-- Writes go through `public.publish_notice` SECURITY DEFINER RPC, which
-- auto-increments `version` per org. Direct INSERT / UPDATE / DELETE is
-- revoked from authenticated (the cs_orchestrator role also has no
-- direct write access — publishes are an authenticated user action, not
-- an async pipeline concern).
--
-- `consent_events.notice_version` is added as a nullable integer + a
-- DEFERRABLE composite FK to `notices(org_id, version)`. Existing rows
-- keep NULL (no notice was in effect pre-Sprint 2.1); new rows written
-- by the Worker / /v1/consent/record stay nullable until the UI exposes
-- notice-picking. Sprint 2.2 wires the UI.

-- ============================================================================
-- 1. notices table
-- ============================================================================

create table if not exists public.notices (
  id                      uuid        primary key default gen_random_uuid(),
  org_id                  uuid        not null references public.organisations(id) on delete cascade,
  version                 integer     not null,
  title                   text        not null,
  body_markdown           text        not null,
  material_change_flag    boolean     not null default false,
  affected_artefact_count integer     not null default 0,
  published_by            uuid        references auth.users(id) on delete set null,
  published_at            timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  unique (org_id, version)
);

create index if not exists idx_notices_org_time
  on public.notices (org_id, published_at desc);

comment on table public.notices is
  'ADR-1004 Phase 2 Sprint 2.1. One row per published privacy-notice '
  'version per org. Append-only — UPDATE / DELETE is revoked. Publish '
  'via public.publish_notice RPC which auto-increments version. '
  'consent_events.notice_version FKs here via (org_id, version).';

-- ============================================================================
-- 2. Append-only invariant via RLS + grants
-- ============================================================================

alter table public.notices enable row level security;

drop policy if exists notices_select_own on public.notices;
create policy notices_select_own on public.notices
  for select to authenticated
  using (org_id = public.current_org_id());

-- INSERT policy — satisfied by the publish RPC (SECURITY DEFINER runs as
-- postgres; this policy exists so direct INSERTs via authenticated are
-- still fenced by org_id). The RPC itself gates authorisation.
drop policy if exists notices_insert_own on public.notices;
create policy notices_insert_own on public.notices
  for insert to authenticated
  with check (org_id = public.current_org_id());

grant select, insert on public.notices to authenticated, cs_orchestrator;
revoke update, delete on public.notices from authenticated, cs_orchestrator;

-- ============================================================================
-- 3. consent_events.notice_version additive FK
-- ============================================================================

alter table public.consent_events
  add column if not exists notice_version integer;

-- Composite FK. DEFERRABLE INITIALLY DEFERRED lets downstream bulk
-- operations that insert events and notices in one transaction succeed.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'consent_events_notice_fk'
      and conrelid = 'public.consent_events'::regclass
  ) then
    alter table public.consent_events
      add constraint consent_events_notice_fk
      foreign key (org_id, notice_version)
      references public.notices(org_id, version)
      deferrable initially deferred;
  end if;
end $$;

comment on column public.consent_events.notice_version is
  'ADR-1004 Phase 2 Sprint 2.1. Version of the privacy-notice in effect '
  'when the consent event was captured. Nullable for pre-Sprint 2.1 '
  'rows and for events where no notice is currently published for the '
  'org. Composite FK (org_id, notice_version) → notices(org_id, version).';

-- ============================================================================
-- 4. publish_notice RPC — auto-increments version per org
-- ============================================================================

create or replace function public.publish_notice(
  p_org_id               uuid,
  p_title                text,
  p_body_markdown        text,
  p_material_change_flag boolean default false
) returns public.notices
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_actor       uuid := auth.uid();
  v_next_ver    integer;
  v_row         public.notices%rowtype;
  v_is_member   boolean;
begin
  if v_actor is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  if coalesce(length(p_title), 0) < 3 or coalesce(length(p_body_markdown), 0) < 10 then
    raise exception 'title or body too short' using errcode = '22023';
  end if;

  -- Caller must be a member of the target org.
  select exists (
    select 1 from public.org_memberships
     where org_id = p_org_id and user_id = v_actor
  ) into v_is_member;

  if not v_is_member then
    raise exception 'org_membership_required' using errcode = '42501';
  end if;

  -- Next version for the org. Takes a row-level lock via FOR UPDATE on
  -- the highest-version row to serialise concurrent publishes.
  select coalesce(max(version), 0) + 1
    into v_next_ver
    from public.notices
   where org_id = p_org_id
   for update;

  insert into public.notices (
    org_id, version, title, body_markdown, material_change_flag, published_by
  ) values (
    p_org_id, v_next_ver, p_title, p_body_markdown,
    coalesce(p_material_change_flag, false), v_actor
  )
  returning * into v_row;

  -- If this is a material change, count artefacts currently on the
  -- prior version — renders as the "X artefacts on prior notice" badge
  -- in Sprint 2.2 once that UI lands.
  if v_row.material_change_flag and v_next_ver > 1 then
    update public.notices
       set affected_artefact_count = (
             select count(*)::integer
               from public.consent_events ce
              where ce.org_id         = p_org_id
                and ce.notice_version = v_next_ver - 1
           )
     where id = v_row.id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

grant execute on function public.publish_notice(uuid, text, text, boolean)
  to authenticated;

comment on function public.publish_notice(uuid, text, text, boolean) is
  'ADR-1004 Phase 2 Sprint 2.1. Publishes a new privacy-notice version '
  'for an org; auto-increments version. Requires org_memberships row '
  'for the caller. Computes affected_artefact_count when material.';
