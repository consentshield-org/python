-- ADR-1002 Sprint 3.1 — fixes for rpc_artefact_get + rpc_event_list.
--
-- Bugs in 20260720000003:
--   1. rpc_artefact_get accessed record v_rev.id without prior assignment
--      when no revocation existed → 55000 "record is not assigned yet".
--      Fix: subquery-driven jsonb build (returns null naturally).
--   2. rpc_event_list had a stray `max(id) filter (where true)` on uuid
--      → 42883 "function max(uuid) does not exist".
--      Fix: remove the leftover placeholder column.

create or replace function public.rpc_artefact_get(
  p_org_id      uuid,
  p_artefact_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_art      record;
  v_cai      record;
  v_chain    jsonb := '[]'::jsonb;
begin
  select * into v_art
    from public.consent_artefacts
   where artefact_id = p_artefact_id and org_id = p_org_id;

  if not found then
    return null;
  end if;

  select * into v_cai
    from public.consent_artefact_index
   where artefact_id = p_artefact_id and org_id = p_org_id
   limit 1;

  with recursive backward as (
    select artefact_id, replaced_by, created_at, 1 as depth
      from public.consent_artefacts
     where replaced_by = p_artefact_id and org_id = p_org_id
    union all
    select ca.artefact_id, ca.replaced_by, ca.created_at, b.depth + 1
      from public.consent_artefacts ca
      join backward b on ca.replaced_by = b.artefact_id
     where ca.org_id = p_org_id
       and b.depth < 100
  ),
  forward as (
    select artefact_id, replaced_by, created_at, 1 as depth
      from public.consent_artefacts
     where artefact_id = v_art.replaced_by
       and org_id = p_org_id
    union all
    select ca.artefact_id, ca.replaced_by, ca.created_at, f.depth + 1
      from public.consent_artefacts ca
      join forward f on ca.artefact_id = f.replaced_by
     where ca.org_id = p_org_id
       and f.depth < 100
  ),
  combined as (
    select artefact_id, created_at from backward
    union all
    select p_artefact_id, v_art.created_at
    union all
    select artefact_id, created_at from forward
  )
  select coalesce(
           jsonb_agg(artefact_id order by created_at asc),
           jsonb_build_array(p_artefact_id)
         )
    into v_chain
    from combined;

  return jsonb_build_object(
    'artefact_id',          v_art.artefact_id,
    'property_id',          v_art.property_id,
    'purpose_code',         v_art.purpose_code,
    'purpose_definition_id', v_art.purpose_definition_id,
    'data_scope',           v_art.data_scope,
    'framework',            v_art.framework,
    'status',               v_art.status,
    'expires_at',           v_art.expires_at,
    'replaced_by',          v_art.replaced_by,
    'created_at',           v_art.created_at,
    'identifier_type',      v_cai.identifier_type,
    'revocation', (
      select jsonb_build_object(
               'id',              r.id,
               'reason',          r.reason,
               'revoked_by_type', r.revoked_by_type,
               'revoked_by_ref',  r.revoked_by_ref,
               'created_at',      r.created_at
             )
        from public.artefact_revocations r
       where r.id = v_cai.revocation_record_id
    ),
    'replacement_chain', v_chain
  );
end;
$$;

grant execute on function public.rpc_artefact_get(uuid, text) to service_role;

-- ── rpc_event_list — remove stray max(id) ────────────────────────────────────

create or replace function public.rpc_event_list(
  p_org_id         uuid,
  p_property_id    uuid default null,
  p_created_after  timestamptz default null,
  p_created_before timestamptz default null,
  p_source         text default null,
  p_cursor         text default null,
  p_limit          int default 50
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_limit          int;
  v_cursor_jsonb   jsonb;
  v_cursor_created timestamptz;
  v_cursor_id      uuid;
  v_items          jsonb;
  v_count          int;
  v_next_cursor    text;
begin
  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));

  if p_cursor is not null and length(p_cursor) > 0 then
    begin
      v_cursor_jsonb := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
      v_cursor_created := (v_cursor_jsonb->>'c')::timestamptz;
      v_cursor_id := (v_cursor_jsonb->>'i')::uuid;
    exception when others then
      raise exception 'bad_cursor' using errcode = '22023';
    end;
  end if;

  with filtered as (
    select id, property_id, source, event_type,
           jsonb_array_length(coalesce(purposes_accepted, '[]'::jsonb)) as purposes_accepted_count,
           jsonb_array_length(coalesce(purposes_rejected, '[]'::jsonb)) as purposes_rejected_count,
           identifier_type,
           array_length(coalesce(artefact_ids, '{}'::text[]), 1) as artefact_count,
           created_at
      from public.consent_events
     where org_id = p_org_id
       and (p_property_id    is null or property_id = p_property_id)
       and (p_created_after  is null or created_at >= p_created_after)
       and (p_created_before is null or created_at <= p_created_before)
       and (p_source         is null or source = p_source)
  ),
  keyset as (
    select * from filtered
     where v_cursor_created is null
        or (created_at, id) < (v_cursor_created, v_cursor_id)
     order by created_at desc, id desc
     limit v_limit + 1
  ),
  ordered as (
    select * from keyset order by created_at desc, id desc
  ),
  agg as (
    select
      jsonb_agg(
        jsonb_build_object(
          'id',                      id,
          'property_id',             property_id,
          'source',                  source,
          'event_type',              event_type,
          'purposes_accepted_count', purposes_accepted_count,
          'purposes_rejected_count', purposes_rejected_count,
          'identifier_type',         identifier_type,
          'artefact_count',          coalesce(artefact_count, 0),
          'created_at',              created_at
        )
        order by created_at desc, id desc
      ) as items,
      count(*) as cnt
    from ordered
  )
  select items, cnt into v_items, v_count from agg;

  if v_count > v_limit then
    v_items := v_items - v_limit;
    v_next_cursor := encode(
      convert_to(
        jsonb_build_object(
          'c', ((v_items -> (v_limit - 1))->>'created_at')::timestamptz,
          'i', ((v_items -> (v_limit - 1))->>'id')::uuid
        )::text,
        'UTF8'
      ),
      'base64'
    );
  else
    v_next_cursor := null;
  end if;

  return jsonb_build_object(
    'items',       coalesce(v_items, '[]'::jsonb),
    'next_cursor', v_next_cursor
  );
end;
$$;

grant execute on function public.rpc_event_list(uuid, uuid, timestamptz, timestamptz, text, text, int) to service_role;
