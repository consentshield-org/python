-- ADR-1002 Sprint 3.1 — Artefact + event read endpoints.
--
-- Three RPCs, all SECURITY DEFINER + service_role:
--   rpc_artefact_list — cursor-paginated list with 6 filters
--   rpc_artefact_get  — single artefact + revocation + replacement chain
--   rpc_event_list    — cursor-paginated event summary with date filters

-- Cursors: keyset pagination using (created_at, id) tuple. Callers treat
-- cursors as opaque strings. Decoded server-side as JSON; malformed
-- cursors raise `bad_cursor` (22023) so the handler can return 422.

-- ── 1. rpc_artefact_list ──────────────────────────────────────────────────────

create or replace function public.rpc_artefact_list(
  p_org_id          uuid,
  p_property_id     uuid default null,
  p_identifier      text default null,
  p_identifier_type text default null,
  p_status          text default null,          -- 'active' | 'revoked' | 'expired' | 'replaced'
  p_purpose_code    text default null,
  p_expires_before  timestamptz default null,
  p_expires_after   timestamptz default null,
  p_cursor          text default null,
  p_limit           int default 50
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
  v_identifier_hash text;
  v_items          jsonb;
  v_last_row       record;
  v_next_cursor    text;
  v_count          int;
begin
  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));

  -- Optional identifier → hash. When both identifier & type supplied, we can
  -- join against consent_artefact_index to filter by identity.
  if p_identifier is not null and p_identifier_type is not null then
    v_identifier_hash := public.hash_data_principal_identifier(
      p_org_id, p_identifier, p_identifier_type
    );
  elsif p_identifier is not null or p_identifier_type is not null then
    raise exception 'identifier_requires_both_fields' using errcode = '22023';
  end if;

  -- Decode cursor if present.
  if p_cursor is not null and length(p_cursor) > 0 then
    begin
      v_cursor_jsonb := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
      v_cursor_created := (v_cursor_jsonb->>'c')::timestamptz;
      v_cursor_id := (v_cursor_jsonb->>'i')::uuid;
    exception when others then
      raise exception 'bad_cursor' using errcode = '22023';
    end;
  end if;

  -- Build result set. Join consent_artefact_index only when we need identity
  -- filtering — otherwise stay on consent_artefacts for simpler plans.
  with filtered as (
    select
      ca.id,
      ca.artefact_id,
      ca.property_id,
      ca.purpose_code,
      ca.purpose_definition_id,
      ca.data_scope,
      ca.framework,
      ca.status,
      ca.expires_at,
      ca.replaced_by,
      ca.created_at,
      cai.identifier_type,
      cai.revoked_at,
      cai.revocation_record_id,
      case
        when ca.status = 'revoked'                                    then 'revoked'
        when ca.status = 'replaced'                                   then 'replaced'
        when ca.status = 'active'
         and ca.expires_at is not null
         and ca.expires_at < now()                                    then 'expired'
        when ca.status = 'expired'                                    then 'expired'
        else 'active'
      end as effective_status
    from public.consent_artefacts ca
    left join public.consent_artefact_index cai
      on cai.artefact_id = ca.artefact_id
    where ca.org_id = p_org_id
      and (p_property_id  is null or ca.property_id  = p_property_id)
      and (p_purpose_code is null or ca.purpose_code = p_purpose_code)
      and (p_expires_before is null or ca.expires_at < p_expires_before)
      and (p_expires_after  is null or ca.expires_at > p_expires_after)
      and (v_identifier_hash is null or cai.identifier_hash = v_identifier_hash)
  ),
  status_filtered as (
    select * from filtered
     where p_status is null or effective_status = p_status
  ),
  keyset as (
    select * from status_filtered
     where v_cursor_created is null
        or (created_at, id) < (v_cursor_created, v_cursor_id)
     order by created_at desc, id desc
     limit v_limit + 1
  )
  select
    jsonb_agg(
      jsonb_build_object(
        'artefact_id',          artefact_id,
        'property_id',          property_id,
        'purpose_code',         purpose_code,
        'purpose_definition_id', purpose_definition_id,
        'data_scope',           data_scope,
        'framework',            framework,
        'status',               effective_status,
        'expires_at',           expires_at,
        'revoked_at',           revoked_at,
        'revocation_record_id', revocation_record_id,
        'replaced_by',          replaced_by,
        'identifier_type',      identifier_type,
        'created_at',           created_at
      )
      order by created_at desc, id desc
    ),
    count(*)
    into v_items, v_count
    from keyset
   where true;

  -- If we fetched limit+1, drop the last item and emit a cursor pointing
  -- at the last *emitted* item for the next page.
  if v_count > v_limit then
    v_items := (v_items - (v_limit));      -- drop index v_limit (the extra one)
    select into v_last_row
           (v_items -> (v_limit - 1))->>'created_at' as last_created,
           (v_items -> (v_limit - 1))->>'artefact_id' as last_artefact_id;

    -- We paginate on (ca.created_at, ca.id) — but the item doesn't carry
    -- ca.id. Re-fetch id by artefact_id to produce the cursor.
    declare
      v_id uuid;
    begin
      select id into v_id from public.consent_artefacts
       where artefact_id = (v_items -> (v_limit - 1))->>'artefact_id' and org_id = p_org_id;

      v_next_cursor := encode(
        convert_to(
          jsonb_build_object(
            'c', ((v_items -> (v_limit - 1))->>'created_at')::timestamptz,
            'i', v_id
          )::text,
          'UTF8'
        ),
        'base64'
      );
    end;
  else
    v_next_cursor := null;
  end if;

  return jsonb_build_object(
    'items',       coalesce(v_items, '[]'::jsonb),
    'next_cursor', v_next_cursor
  );
end;
$$;

revoke all on function public.rpc_artefact_list(uuid, uuid, text, text, text, text, timestamptz, timestamptz, text, int) from public;
grant execute on function public.rpc_artefact_list(uuid, uuid, text, text, text, text, timestamptz, timestamptz, text, int) to service_role;

-- ── 2. rpc_artefact_get ───────────────────────────────────────────────────────
-- Returns the artefact envelope + revocation record (if any) + full
-- replacement chain [earliest, ..., this, ..., latest]. Cross-org → null.

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
  v_rev      record;
  v_chain    jsonb := '[]'::jsonb;
  v_current  text := p_artefact_id;
  v_depth    int := 0;
begin
  select * into v_art
    from public.consent_artefacts
   where artefact_id = p_artefact_id and org_id = p_org_id;

  if not found then
    return null;
  end if;

  -- consent_artefact_index sibling (revocation pointer + identifier_type).
  select * into v_cai
    from public.consent_artefact_index
   where artefact_id = p_artefact_id and org_id = p_org_id
   limit 1;

  -- Revocation record if any.
  if v_cai.revocation_record_id is not null then
    select id, reason, revoked_by_type, revoked_by_ref, created_at
      into v_rev
      from public.artefact_revocations
     where id = v_cai.revocation_record_id;
  end if;

  -- Replacement chain.
  with recursive backward as (
    -- Walk predecessors: rows whose replaced_by points at us.
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
    -- Walk successors: follow replaced_by.
    select artefact_id, replaced_by, created_at, 1 as depth
      from public.consent_artefacts
     where artefact_id = (select replaced_by from public.consent_artefacts
                           where artefact_id = p_artefact_id and org_id = p_org_id)
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
    'revocation',
      case when v_rev.id is null then null
           else jsonb_build_object(
                  'id',              v_rev.id,
                  'reason',          v_rev.reason,
                  'revoked_by_type', v_rev.revoked_by_type,
                  'revoked_by_ref',  v_rev.revoked_by_ref,
                  'created_at',      v_rev.created_at
                )
      end,
    'replacement_chain', v_chain
  );
end;
$$;

revoke all on function public.rpc_artefact_get(uuid, text) from public;
grant execute on function public.rpc_artefact_get(uuid, text) to service_role;

-- ── 3. rpc_event_list ─────────────────────────────────────────────────────────

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
  v_last_id        uuid;
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
      count(*) as cnt,
      max(id) filter (where true) as nothing  -- placeholder
    from ordered
  )
  select items, cnt into v_items, v_count from agg;

  if v_count > v_limit then
    -- Drop the extra item and get the last emitted row's id/created_at for the cursor.
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

revoke all on function public.rpc_event_list(uuid, uuid, timestamptz, timestamptz, text, text, int) from public;
grant execute on function public.rpc_event_list(uuid, uuid, timestamptz, timestamptz, text, text, int) to service_role;
