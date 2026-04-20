-- ADR-1009 Sprint 1.1 — DB-level tenant fence for v1 API mutating RPCs.
--
-- Context: ADR-1001 + ADR-1002 shipped with the /v1/* handlers trusting that
-- every route correctly passes `context.org_id` from the verified Bearer key
-- (via `rpc_api_key_verify`) into `p_org_id` on each SECURITY DEFINER RPC. A
-- single handler bug that reads `org_id` from the body or URL instead would
-- silently permit cross-tenant writes. Phase 1 of ADR-1009 adds the `p_key_id`
-- parameter to every mutating RPC and calls `assert_api_key_binding` at the
-- top, so the DB — not the route handler — is the final fence.
--
-- This migration covers mutations: rpc_consent_record, rpc_artefact_revoke,
-- rpc_deletion_trigger. Reads (rpc_consent_verify, verify_batch, list/get,
-- deletion_receipts_list) follow in Sprint 1.2.
--
-- Grants remain on service_role only; the role swap to cs_api is Phase 2.

-- ============================================================================
-- 1. assert_api_key_binding(p_key_id, p_org_id) — the fence
-- ============================================================================

create or replace function public.assert_api_key_binding(
  p_key_id uuid,
  p_org_id uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_key_account uuid;
  v_key_org     uuid;
  v_key_revoked timestamptz;
  v_org_account uuid;
begin
  if p_key_id is null then
    raise exception 'api_key_id_missing' using errcode = '42501';
  end if;
  if p_org_id is null then
    raise exception 'org_id_missing' using errcode = '42501';
  end if;

  select account_id, org_id, revoked_at
    into v_key_account, v_key_org, v_key_revoked
    from public.api_keys
   where id = p_key_id;

  if not found then
    raise exception 'api_key_not_found' using errcode = '42501';
  end if;

  if v_key_revoked is not null then
    raise exception 'api_key_revoked' using errcode = '42501';
  end if;

  -- Org-scoped key: org_id must match exactly.
  if v_key_org is not null then
    if v_key_org <> p_org_id then
      raise exception 'api_key_not_authorised_for_org' using errcode = '42501';
    end if;
    return;
  end if;

  -- Account-scoped key (v_key_org is null): p_org_id must belong to the
  -- same account as the key.
  select account_id into v_org_account
    from public.organisations
   where id = p_org_id;

  if not found then
    raise exception 'org_not_found' using errcode = '42501';
  end if;

  if v_org_account is null or v_org_account <> v_key_account then
    raise exception 'api_key_not_authorised_for_org' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.assert_api_key_binding(uuid, uuid) from public;
grant execute on function public.assert_api_key_binding(uuid, uuid) to service_role;

comment on function public.assert_api_key_binding(uuid, uuid) is
  'ADR-1009 Sprint 1.1 — DB tenant fence. Raises 42501 when the api_key '
  'referenced by p_key_id does not authorise access to p_org_id '
  '(revoked, not found, wrong org, or wrong account for account-scoped keys).';

-- ============================================================================
-- 2. rpc_consent_record — add p_key_id; assert before any work
-- ============================================================================

drop function if exists public.rpc_consent_record(
  uuid, uuid, text, text, uuid[], uuid[], timestamptz, text
);

create or replace function public.rpc_consent_record(
  p_key_id                       uuid,
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
  -- ADR-1009 fence: reject before touching any tenant data.
  perform public.assert_api_key_binding(p_key_id, p_org_id);

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

  -- Idempotency replay.
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

  v_identifier_hash := public.hash_data_principal_identifier(
    p_org_id, p_identifier, p_identifier_type
  );

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

revoke all on function public.rpc_consent_record(
  uuid, uuid, uuid, text, text, uuid[], uuid[], timestamptz, text
) from public;
grant execute on function public.rpc_consent_record(
  uuid, uuid, uuid, text, text, uuid[], uuid[], timestamptz, text
) to service_role;

comment on function public.rpc_consent_record(
  uuid, uuid, uuid, text, text, uuid[], uuid[], timestamptz, text
) is
  'ADR-1009 Sprint 1.1 — Mode B consent capture with DB tenant fence. '
  'p_key_id is the verified API key id; assert_api_key_binding runs first '
  'and raises 42501 if the key does not authorise p_org_id.';

-- ============================================================================
-- 3. rpc_artefact_revoke — add p_key_id; assert before any work
-- ============================================================================

drop function if exists public.rpc_artefact_revoke(
  uuid, text, text, text, text, text
);

create or replace function public.rpc_artefact_revoke(
  p_key_id       uuid,
  p_org_id       uuid,
  p_artefact_id  text,
  p_reason_code  text,
  p_reason_notes text default null,
  p_actor_type   text default 'user',
  p_actor_ref    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_art        record;
  v_existing_rev_id uuid;
  v_new_rev_id uuid;
  v_revoked_by_type text;
begin
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  select artefact_id, status
    into v_art
    from public.consent_artefacts
   where artefact_id = p_artefact_id and org_id = p_org_id;

  if not found then
    raise exception 'artefact_not_found' using errcode = 'P0001';
  end if;

  if v_art.status = 'revoked' then
    select revocation_record_id into v_existing_rev_id
      from public.consent_artefact_index
     where artefact_id = p_artefact_id and org_id = p_org_id
     limit 1;

    if v_existing_rev_id is null then
      select id into v_existing_rev_id
        from public.artefact_revocations
       where artefact_id = p_artefact_id and org_id = p_org_id
       order by revoked_at desc
       limit 1;
    end if;

    return jsonb_build_object(
      'artefact_id',          p_artefact_id,
      'status',               'revoked',
      'revocation_record_id', v_existing_rev_id,
      'idempotent_replay',    true
    );
  end if;

  if v_art.status in ('expired', 'replaced') then
    raise exception 'artefact_terminal_state: %', v_art.status using errcode = '22023';
  end if;

  if p_reason_code is null or length(trim(p_reason_code)) = 0 then
    raise exception 'reason_code_missing' using errcode = '22023';
  end if;

  if p_actor_type not in ('user', 'operator', 'system') then
    raise exception 'unknown_actor_type: %', p_actor_type using errcode = '22023';
  end if;

  v_revoked_by_type := case p_actor_type
    when 'user'     then 'data_principal'
    when 'operator' then 'organisation'
    else                 'system'
  end;

  insert into public.artefact_revocations (
    org_id, artefact_id, reason, revoked_by_type, revoked_by_ref, notes
  ) values (
    p_org_id, p_artefact_id,
    p_reason_code, v_revoked_by_type, p_actor_ref, p_reason_notes
  )
  returning id into v_new_rev_id;

  return jsonb_build_object(
    'artefact_id',          p_artefact_id,
    'status',               'revoked',
    'revocation_record_id', v_new_rev_id,
    'idempotent_replay',    false
  );
end;
$$;

revoke all on function public.rpc_artefact_revoke(
  uuid, uuid, text, text, text, text, text
) from public;
grant execute on function public.rpc_artefact_revoke(
  uuid, uuid, text, text, text, text, text
) to service_role;

comment on function public.rpc_artefact_revoke(
  uuid, uuid, text, text, text, text, text
) is
  'ADR-1009 Sprint 1.1 — artefact revocation with DB tenant fence.';

-- ============================================================================
-- 4. rpc_deletion_trigger — add p_key_id; assert before any work
-- ============================================================================

drop function if exists public.rpc_deletion_trigger(
  uuid, uuid, text, text, text, text[], text[], text, text
);

create or replace function public.rpc_deletion_trigger(
  p_key_id            uuid,
  p_org_id            uuid,
  p_property_id       uuid,
  p_identifier        text,
  p_identifier_type   text,
  p_reason            text,
  p_purpose_codes     text[] default null,
  p_scope_override    text[] default null,
  p_actor_type        text default 'user',
  p_actor_ref         text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_hash           text;
  v_artefact_ids   text[];
  v_revoked_ids    text[] := '{}'::text[];
  v_artefact_id    text;
  v_new_rev_id     uuid;
  v_reason_code    text;
  v_revoked_by     text;
begin
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  if not exists (
    select 1 from public.web_properties
     where id = p_property_id and org_id = p_org_id
  ) then
    raise exception 'property_not_found' using errcode = 'P0001';
  end if;

  if p_reason not in ('consent_revoked', 'erasure_request', 'retention_expired') then
    raise exception 'unknown_reason: %', p_reason using errcode = '22023';
  end if;

  if p_reason = 'retention_expired' then
    raise exception 'retention_mode_not_yet_implemented' using errcode = '22023';
  end if;

  if p_reason = 'consent_revoked' then
    if p_purpose_codes is null or array_length(p_purpose_codes, 1) is null then
      raise exception 'purpose_codes_required_for_consent_revoked' using errcode = '22023';
    end if;
  end if;

  if p_actor_type not in ('user', 'operator', 'system') then
    raise exception 'unknown_actor_type: %', p_actor_type using errcode = '22023';
  end if;

  v_hash := public.hash_data_principal_identifier(p_org_id, p_identifier, p_identifier_type);

  if p_reason = 'consent_revoked' then
    select array_agg(ca.artefact_id)
      into v_artefact_ids
      from public.consent_artefact_index cai
      join public.consent_artefacts     ca on ca.artefact_id = cai.artefact_id
     where cai.org_id          = p_org_id
       and cai.property_id     = p_property_id
       and cai.identifier_hash = v_hash
       and cai.purpose_code    = any(p_purpose_codes)
       and ca.status           = 'active'
       and cai.validity_state  = 'active';
  else  -- erasure_request
    select array_agg(ca.artefact_id)
      into v_artefact_ids
      from public.consent_artefact_index cai
      join public.consent_artefacts     ca on ca.artefact_id = cai.artefact_id
     where cai.org_id          = p_org_id
       and cai.property_id     = p_property_id
       and cai.identifier_hash = v_hash
       and ca.status           = 'active'
       and cai.validity_state  = 'active';
  end if;

  v_artefact_ids := coalesce(v_artefact_ids, '{}'::text[]);

  v_reason_code := case p_reason
    when 'consent_revoked' then 'user_preference_change'
    when 'erasure_request' then 'user_withdrawal'
  end;

  v_revoked_by := case p_actor_type
    when 'user'     then 'data_principal'
    when 'operator' then 'organisation'
    else                 'system'
  end;

  foreach v_artefact_id in array v_artefact_ids
  loop
    insert into public.artefact_revocations (
      org_id, artefact_id, reason, revoked_by_type, revoked_by_ref, notes
    ) values (
      p_org_id, v_artefact_id, v_reason_code, v_revoked_by,
      p_actor_ref,
      'Triggered via /v1/deletion/trigger reason=' || p_reason
    )
    returning id into v_new_rev_id;

    v_revoked_ids := v_revoked_ids || v_artefact_id;
  end loop;

  return jsonb_build_object(
    'reason',               p_reason,
    'revoked_artefact_ids', v_revoked_ids,
    'revoked_count',        array_length(v_revoked_ids, 1),
    'initial_status',       'pending',
    'note',                 'deletion_receipts are created asynchronously by the process-artefact-revocation pipeline; poll /v1/deletion/receipts with artefact_id or issued_after to observe.'
  );
end;
$$;

revoke all on function public.rpc_deletion_trigger(
  uuid, uuid, uuid, text, text, text, text[], text[], text, text
) from public;
grant execute on function public.rpc_deletion_trigger(
  uuid, uuid, uuid, text, text, text, text[], text[], text, text
) to service_role;

comment on function public.rpc_deletion_trigger(
  uuid, uuid, uuid, text, text, text, text[], text[], text, text
) is
  'ADR-1009 Sprint 1.1 — deletion orchestration with DB tenant fence.';
