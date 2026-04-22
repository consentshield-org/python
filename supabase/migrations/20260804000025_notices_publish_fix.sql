-- ADR-1004 Phase 2 Sprint 2.1 — fix publish_notice concurrency.
--
-- Previous body used `select max(version) ... for update` which is
-- not valid SQL (Postgres refuses FOR UPDATE alongside aggregates).
-- Replace with pg_advisory_xact_lock keyed on org_id so concurrent
-- publishes for the same org serialise. Signature unchanged — no
-- grant redo required.

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

  select exists (
    select 1 from public.org_memberships
     where org_id = p_org_id and user_id = v_actor
  ) into v_is_member;

  if not v_is_member then
    raise exception 'org_membership_required' using errcode = '42501';
  end if;

  -- Serialise concurrent publishes for the same org.
  perform pg_advisory_xact_lock(
    ('x' || substr(md5('notice:' || p_org_id::text), 1, 16))::bit(64)::bigint
  );

  select coalesce(max(version), 0) + 1
    into v_next_ver
    from public.notices
   where org_id = p_org_id;

  insert into public.notices (
    org_id, version, title, body_markdown, material_change_flag, published_by
  ) values (
    p_org_id, v_next_ver, p_title, p_body_markdown,
    coalesce(p_material_change_flag, false), v_actor
  )
  returning * into v_row;

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
