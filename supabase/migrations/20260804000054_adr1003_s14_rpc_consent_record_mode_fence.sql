-- ADR-1003 Sprint 1.4 — rpc_consent_record storage_mode fence + Mode B
-- zero-storage preparation RPC.
--
-- Problem. Sprint 1.3 closed the invariant on the Worker path (Mode A):
-- zero_storage orgs have zero rows in the buffer tables after any number
-- of banner events, because the Worker hands off to the Next.js bridge
-- (processZeroStorageEvent) which uploads to customer R2 and seeds
-- consent_artefact_index without writing to consent_events / artefacts
-- / delivery_buffer.
--
-- The Mode B path (POST /v1/consent/record → rpc_consent_record) still
-- writes to those buffer tables, violating the same invariant for
-- server-to-server consent capture. This migration closes that gap in
-- two complementary moves:
--
-- 1/3. rpc_consent_record gains a top-of-function storage_mode check.
--      If the org is zero_storage, the RPC raises
--      'storage_mode_requires_bridge' with errcode P0003 BEFORE any
--      table read or write. This is the defense-in-depth fence: even
--      if a future Node caller forgets to branch, the SQL refuses.
--
-- 2/3. rpc_consent_record_prepare_zero_storage — new SECURITY DEFINER
--      RPC granted to cs_api. Runs the SAME validation surface as
--      rpc_consent_record (api_key_binding, property, captured_at,
--      purposes, identifier normalisation + hash) but writes nothing.
--      Returns the canonical jsonb envelope the Node helper needs to
--      (a) build a BridgeRequest and (b) respond to the API caller
--      without a second round-trip.
--
-- 3/3. Deterministic event_fingerprint. The returned fingerprint is
--      a short hex digest of (org_id, property_id, identifier_hash,
--      client_request_id or captured_at). Same inputs → same
--      fingerprint → same deterministic artefact_ids
--      ('zs-<fingerprint>-<purpose_code>') → ON CONFLICT DO NOTHING
--      on the index gives idempotent replay semantics without touching
--      consent_events.
--
-- What this does NOT change:
--   · Buffer tables still exist for Standard / Insulated orgs.
--   · The Worker path (Sprint 1.2 bridge) is untouched.
--   · Validation rules (±15min captured_at, purpose validation,
--     identifier normalisation) are identical across both paths —
--     copied from rpc_consent_record so the contract matches.
--
-- Downstream behaviour (in the Node helper app/src/lib/consent/record.ts):
--   · Before calling rpc_consent_record, check get_storage_mode(org).
--   · Zero_storage → call rpc_consent_record_prepare_zero_storage
--     (cs_api) → feed the returned payload to processZeroStorageEvent
--     (cs_orchestrator). Bridge populates identifier_hash +
--     identifier_type in the index row (Sprint 1.4 bridge extension),
--     so /v1/consent/verify can answer for Mode B zero_storage events.
--   · Standard / Insulated → rpc_consent_record as before.
--   · Race (mode flipped between check and RPC call) → catch P0003 and
--     fall through to the zero-storage branch.

-- ═══════════════════════════════════════════════════════════
-- 1/3 · Amend rpc_consent_record with the storage_mode fence.
-- ═══════════════════════════════════════════════════════════

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

  -- ADR-1003 Sprint 1.4 fence: zero_storage orgs must not land rows in
  -- consent_events / consent_artefacts. The Node caller is expected to
  -- have checked get_storage_mode and routed to the bridge; this check
  -- is the structural backstop. errcode P0003 so the Node helper can
  -- distinguish a mode flip from other plpgsql exceptions.
  if public.get_storage_mode(p_org_id) = 'zero_storage' then
    raise exception 'storage_mode_requires_bridge'
      using errcode = 'P0003',
            detail  = 'rpc_consent_record refused: org is in zero_storage mode. '
                      'Callers must route through rpc_consent_record_prepare_zero_storage '
                      'and the Next.js bridge (app/src/lib/delivery/zero-storage-bridge.ts).';
  end if;

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

comment on function public.rpc_consent_record(
  uuid, uuid, uuid, text, text, uuid[], uuid[], timestamptz, text
) is
  'ADR-1009 Sprint 1.1 + ADR-1003 Sprint 1.4 — Mode B consent capture '
  'with DB tenant fence and storage_mode gate. p_key_id is verified via '
  'assert_api_key_binding (raises 42501 if the key does not authorise '
  'p_org_id). If the org is in zero_storage mode, raises '
  'storage_mode_requires_bridge (P0003) before any table access — '
  'callers must use rpc_consent_record_prepare_zero_storage + the '
  'Next.js bridge instead.';

-- ═══════════════════════════════════════════════════════════
-- 2/3 · rpc_consent_record_prepare_zero_storage — validation-only RPC
--       for the Mode B zero-storage path.
-- ═══════════════════════════════════════════════════════════

create or replace function public.rpc_consent_record_prepare_zero_storage(
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
  v_now               timestamptz := now();
  v_identifier_hash   text;
  v_invalid_ids       uuid[];
  v_event_fingerprint text;
  v_fingerprint_seed  text;
  v_accepted_payload  jsonb;
  v_rejected_payload  jsonb;
  v_artefact_ids      jsonb := '[]'::jsonb;
  v_purpose           record;
  v_artefact_id       text;
  v_expires_at        timestamptz;
begin
  -- Same fence ordering as rpc_consent_record.
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  -- Mirror-image of the rpc_consent_record fence: this RPC is ONLY
  -- for zero_storage orgs. A standard/insulated caller landing here
  -- is a bug in the Node helper; refuse loudly.
  if public.get_storage_mode(p_org_id) <> 'zero_storage' then
    raise exception 'storage_mode_not_zero_storage'
      using errcode = 'P0003',
            detail  = 'rpc_consent_record_prepare_zero_storage requires '
                      'zero_storage mode; use rpc_consent_record instead.';
  end if;

  -- Validate property belongs to org.
  if not exists (
    select 1 from public.web_properties
     where id = p_property_id and org_id = p_org_id
  ) then
    raise exception 'property_not_found' using errcode = 'P0001';
  end if;

  -- captured_at ±15 minutes of server.
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

  -- Identifier normalisation + per-org hash (same helper the Worker
  -- verify path uses, so Mode A + Mode B verify against the same
  -- hash for the same (org, identifier, type) tuple).
  v_identifier_hash := public.hash_data_principal_identifier(
    p_org_id, p_identifier, p_identifier_type
  );

  -- Deterministic fingerprint. Same client_request_id → same
  -- fingerprint → ON CONFLICT DO NOTHING on the index. Without
  -- client_request_id, captured_at serves as the dedup key (same
  -- instant = same fingerprint; different instant = different).
  v_fingerprint_seed := p_org_id::text
                    || ':' || p_property_id::text
                    || ':' || v_identifier_hash
                    || ':' || coalesce(p_client_request_id, to_char(p_captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  v_event_fingerprint := substr(
    encode(extensions.digest(v_fingerprint_seed, 'sha256'), 'hex'),
    1, 32
  );

  -- Build the jsonb payload mirroring rpc_consent_record's shape so
  -- downstream verify / audit surfaces can round-trip through the
  -- same parser.
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

  -- Build deterministic artefact_ids. expires_at matches the Mode A
  -- purpose default — but note the index row's expires_at is CAPPED
  -- at 24h by the bridge's best-effort TTL write (Sprint 1.3). The
  -- envelope expiry reported here reflects the purpose definition,
  -- not the index cache TTL.
  for v_purpose in
    select pd.id, pd.purpose_code, pd.framework, pd.default_expiry_days
      from public.purpose_definitions pd
     where pd.id = any(p_purpose_definition_ids)
     order by pd.purpose_code
  loop
    v_artefact_id := 'zs-' || v_event_fingerprint || '-' || v_purpose.purpose_code;
    if v_purpose.default_expiry_days = 0 then
      v_expires_at := null;
    else
      v_expires_at := v_now + (v_purpose.default_expiry_days || ' days')::interval;
    end if;
    v_artefact_ids := v_artefact_ids || jsonb_build_object(
      'purpose_definition_id', v_purpose.id,
      'purpose_code',          v_purpose.purpose_code,
      'artefact_id',           v_artefact_id,
      'status',                'active'
    );
  end loop;

  return jsonb_build_object(
    'event_fingerprint',   v_event_fingerprint,
    'captured_at',         v_now,
    'identifier_hash',     v_identifier_hash,
    'identifier_type',     p_identifier_type,
    'property_id',         p_property_id,
    'purposes_accepted',   v_accepted_payload,
    'purposes_rejected',   v_rejected_payload,
    'artefact_ids',        v_artefact_ids
  );
end;
$$;

revoke all on function public.rpc_consent_record_prepare_zero_storage(
  uuid, uuid, uuid, text, text, uuid[], uuid[], timestamptz, text
) from public;
grant execute on function public.rpc_consent_record_prepare_zero_storage(
  uuid, uuid, uuid, text, text, uuid[], uuid[], timestamptz, text
) to cs_api;

comment on function public.rpc_consent_record_prepare_zero_storage(
  uuid, uuid, uuid, text, text, uuid[], uuid[], timestamptz, text
) is
  'ADR-1003 Sprint 1.4 — validation-only prepare RPC for the Mode B '
  'zero-storage path. Runs the same fence + validation surface as '
  'rpc_consent_record but writes nothing. Returns a canonical jsonb '
  'envelope the Node caller feeds to processZeroStorageEvent. Raises '
  'storage_mode_not_zero_storage (P0003) if invoked against a non-'
  'zero_storage org. Refuse rather than silently fall through — the '
  'RPC existing at all is the contract signal that the caller is on '
  'the zero-storage branch.';
