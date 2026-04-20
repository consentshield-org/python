-- ADR-1002 Sprint 2.1 — Mode B server-to-server consent capture.
--
-- Schema changes:
--   1. consent_events / consent_artefacts: banner_id, banner_version,
--      session_fingerprint relaxed to NULLABLE (API events carry an identifier
--      instead of a browser fingerprint + banner).
--   2. consent_events: add source ('web'|'api'|'sdk'),
--      data_principal_identifier_hash, identifier_type, client_request_id.
--   3. Partial unique index on (org_id, client_request_id) for idempotency.
--   4. rpc_consent_record RPC — all-in-one: validates, hashes, inserts event
--      + artefacts + index rows in a single transaction. No Edge Function
--      roundtrip for API-sourced consent (the trigger still fires but the
--      Edge Function's 23505 idempotency absorbs the duplicate).

-- ── 1. Relax NOT NULL on consent_events browser-only columns ─────────────────

alter table public.consent_events
  alter column banner_id          drop not null,
  alter column banner_version     drop not null,
  alter column session_fingerprint drop not null;

-- Add Mode B columns.
alter table public.consent_events
  add column if not exists source            text not null default 'web'
    check (source in ('web','api','sdk')),
  add column if not exists data_principal_identifier_hash text,
  add column if not exists identifier_type   text
    check (identifier_type is null or identifier_type in ('email','phone','pan','aadhaar','custom')),
  add column if not exists client_request_id text;

-- Shape constraint: web events must have banner+fingerprint; api events must
-- carry an identifier hash + type. Existing rows (default source='web') all
-- already have banner_id + session_fingerprint populated (not-null before).
alter table public.consent_events
  drop constraint if exists consent_events_shape_by_source_check;

alter table public.consent_events
  add constraint consent_events_shape_by_source_check check (
    (source = 'web' and banner_id is not null and session_fingerprint is not null)
    or
    (source = 'api' and data_principal_identifier_hash is not null and identifier_type is not null)
    or
    (source = 'sdk') -- SDK shape TBD in ADR-1006
  );

-- Idempotency: same (org_id, client_request_id) returns the same event.
create unique index if not exists consent_events_client_request_uniq
  on public.consent_events (org_id, client_request_id)
  where client_request_id is not null;

-- ── 2. Relax NOT NULL on consent_artefacts browser-only columns ──────────────

alter table public.consent_artefacts
  alter column banner_id          drop not null,
  alter column banner_version     drop not null,
  alter column session_fingerprint drop not null;

-- ── 3. rpc_consent_record ────────────────────────────────────────────────────

create or replace function public.rpc_consent_record(
  p_org_id                       uuid,
  p_property_id                  uuid,
  p_identifier                   text,
  p_identifier_type              text,
  p_purpose_definition_ids       uuid[],
  p_rejected_purpose_definition_ids uuid[],
  p_captured_at                  timestamptz,
  p_client_request_id            text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_event_id       uuid;
  v_now            timestamptz := now();
  v_identifier_hash text;
  v_existing_event record;
  v_purpose        record;
  v_invalid_ids    uuid[];
  v_artefact_id    text;
  v_artefact_ids   jsonb := '[]'::jsonb;
  v_created_at     timestamptz;
  v_accepted_payload jsonb;
  v_rejected_payload jsonb;
begin
  -- Validate property belongs to org.
  if not exists (
    select 1 from public.web_properties
     where id = p_property_id and org_id = p_org_id
  ) then
    raise exception 'property_not_found' using errcode = 'P0001';
  end if;

  -- Validate captured_at is within ±15 minutes of server.
  if p_captured_at is null then
    raise exception 'captured_at_missing' using errcode = '22023';
  end if;
  if abs(extract(epoch from (v_now - p_captured_at))) > 900 then
    raise exception 'captured_at_stale: %', p_captured_at using errcode = '22023';
  end if;

  -- Validate all purpose_definition_ids belong to this org.
  if p_purpose_definition_ids is null or array_length(p_purpose_definition_ids, 1) is null then
    raise exception 'purposes_empty' using errcode = '22023';
  end if;

  select array_agg(bad_id)
    into v_invalid_ids
    from unnest(p_purpose_definition_ids) bad_id
   where not exists (
           select 1 from public.purpose_definitions pd
            where pd.id = bad_id and pd.org_id = p_org_id
         );

  if v_invalid_ids is not null and array_length(v_invalid_ids, 1) > 0 then
    raise exception 'invalid_purpose_definition_ids: %', v_invalid_ids using errcode = '22023';
  end if;

  -- Validate rejected purpose IDs (if provided) also belong to the org.
  if p_rejected_purpose_definition_ids is not null then
    select array_agg(bad_id)
      into v_invalid_ids
      from unnest(p_rejected_purpose_definition_ids) bad_id
     where not exists (
             select 1 from public.purpose_definitions pd
              where pd.id = bad_id and pd.org_id = p_org_id
           );

    if v_invalid_ids is not null and array_length(v_invalid_ids, 1) > 0 then
      raise exception 'invalid_rejected_purpose_definition_ids: %', v_invalid_ids using errcode = '22023';
    end if;
  end if;

  -- Idempotency: if client_request_id was used before, return the same envelope.
  if p_client_request_id is not null then
    select id, created_at
      into v_existing_event
      from public.consent_events
     where org_id = p_org_id
       and client_request_id = p_client_request_id;

    if found then
      select coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'purpose_definition_id', ca.purpose_definition_id,
                   'purpose_code',          ca.purpose_code,
                   'artefact_id',           ca.artefact_id,
                   'status',                ca.status
                 )
               ),
               '[]'::jsonb
             )
        into v_artefact_ids
        from public.consent_artefacts ca
       where ca.consent_event_id = v_existing_event.id;

      return jsonb_build_object(
        'event_id',     v_existing_event.id,
        'created_at',   v_existing_event.created_at,
        'artefact_ids', v_artefact_ids,
        'idempotent_replay', true
      );
    end if;
  end if;

  -- Hash the identifier (raises 22023 on empty / unknown type).
  v_identifier_hash := public.hash_data_principal_identifier(
    p_org_id, p_identifier, p_identifier_type
  );

  -- Build purposes_accepted / purposes_rejected payload for consent_events.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'purpose_definition_id', pd.id,
               'purpose_code',          pd.purpose_code
             )
           ),
           '[]'::jsonb
         )
    into v_accepted_payload
    from public.purpose_definitions pd
   where pd.id = any(p_purpose_definition_ids);

  if p_rejected_purpose_definition_ids is not null
     and array_length(p_rejected_purpose_definition_ids, 1) > 0 then
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'purpose_definition_id', pd.id,
                 'purpose_code',          pd.purpose_code
               )
             ),
             '[]'::jsonb
           )
      into v_rejected_payload
      from public.purpose_definitions pd
     where pd.id = any(p_rejected_purpose_definition_ids);
  else
    v_rejected_payload := '[]'::jsonb;
  end if;

  -- Insert the consent_events row.
  insert into public.consent_events (
    org_id, property_id, source, event_type,
    purposes_accepted, purposes_rejected,
    data_principal_identifier_hash, identifier_type,
    client_request_id, created_at
  )
  values (
    p_org_id, p_property_id, 'api', 'accept',
    v_accepted_payload, v_rejected_payload,
    v_identifier_hash, p_identifier_type,
    p_client_request_id, v_now
  )
  returning id, created_at into v_event_id, v_created_at;

  -- Create one artefact + index row per accepted purpose.
  for v_purpose in
    select pd.id, pd.purpose_code, pd.data_scope,
           pd.default_expiry_days, pd.framework
      from public.purpose_definitions pd
     where pd.id = any(p_purpose_definition_ids)
  loop
    insert into public.consent_artefacts (
      org_id, property_id, consent_event_id,
      purpose_definition_id, purpose_code,
      data_scope, framework, expires_at
    )
    values (
      p_org_id, p_property_id, v_event_id,
      v_purpose.id, v_purpose.purpose_code,
      v_purpose.data_scope, v_purpose.framework,
      case
        when v_purpose.default_expiry_days = 0 then null
        else v_now + (v_purpose.default_expiry_days || ' days')::interval
      end
    )
    returning artefact_id into v_artefact_id;

    insert into public.consent_artefact_index (
      org_id, property_id, artefact_id, consent_event_id,
      identifier_hash, identifier_type,
      validity_state, framework, purpose_code, expires_at
    )
    values (
      p_org_id, p_property_id, v_artefact_id, v_event_id,
      v_identifier_hash, p_identifier_type,
      'active', v_purpose.framework, v_purpose.purpose_code,
      case
        when v_purpose.default_expiry_days = 0 then null
        else v_now + (v_purpose.default_expiry_days || ' days')::interval
      end
    );

    v_artefact_ids := v_artefact_ids || jsonb_build_object(
      'purpose_definition_id', v_purpose.id,
      'purpose_code',          v_purpose.purpose_code,
      'artefact_id',           v_artefact_id,
      'status',                'active'
    );
  end loop;

  -- Stamp consent_events.artefact_ids for symmetry with the Edge Function path.
  update public.consent_events
     set artefact_ids = (
           select coalesce(array_agg(ca.artefact_id), '{}')
             from public.consent_artefacts ca
            where ca.consent_event_id = v_event_id
         )
   where id = v_event_id;

  return jsonb_build_object(
    'event_id',     v_event_id,
    'created_at',   v_created_at,
    'artefact_ids', v_artefact_ids,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.rpc_consent_record(uuid, uuid, text, text, uuid[], uuid[], timestamptz, text) from public;
grant execute on function public.rpc_consent_record(uuid, uuid, text, text, uuid[], uuid[], timestamptz, text) to service_role;

comment on function public.rpc_consent_record(uuid, uuid, text, text, uuid[], uuid[], timestamptz, text) is
  'ADR-1002 Sprint 2.1 — Mode B consent capture. Single-transaction insert of '
  'consent_events + consent_artefacts + consent_artefact_index for every '
  'granted purpose. Idempotent when client_request_id is reused. Raises: '
  'property_not_found (P0001), captured_at_missing / captured_at_stale / '
  'purposes_empty / invalid_purpose_definition_ids / invalid_rejected_* / '
  'identifier errors (22023).';
