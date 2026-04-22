-- ADR-1005 Phase 2 Sprint 2.1 — rpc_test_delete_trigger.
--
-- The customer-facing `POST /v1/integrations/{connector_id}/test_delete`
-- API route lets a customer validate their deletion-webhook handler
-- without touching real principal data. A successful call:
--   * asserts the api_key → org binding (same fence as every other v1
--     mutation, ADR-1009).
--   * verifies the connector belongs to the caller's org.
--   * rate-limits to 10 calls per connector per hour (prevents abuse
--     and accidental runaway from a failing webhook handler).
--   * synthesises `cs_test_principal_<uuid>` and writes a
--     deletion_receipts row with `trigger_type='test_delete'`, linked
--     to the connector, with `request_payload.is_test=true`.
--
-- Downstream semantics:
--   * compute_depa_score (ADR-0025) joins deletion_receipts on
--     artefact_id; test rows have NULL artefact_id so they are
--     automatically excluded from compliance aggregation.
--   * the delivery pipeline picks up status='pending' rows via the
--     same path; customer handlers are expected to inspect
--     `request_payload->>'reason'` and short-circuit test runs.

create or replace function public.rpc_test_delete_trigger(
  p_key_id       uuid,
  p_org_id       uuid,
  p_connector_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_count          int;
  v_connector      public.integration_connectors%rowtype;
  v_principal      text;
  v_hash           text;
  v_receipt_id     uuid;
begin
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  if p_connector_id is null then
    raise exception 'connector_id_missing' using errcode = '22023';
  end if;

  select * into v_connector
    from public.integration_connectors
   where id = p_connector_id
     and org_id = p_org_id;
  if not found then
    raise exception 'connector_not_found' using errcode = 'P0001';
  end if;

  if v_connector.status is distinct from 'active' then
    raise exception 'connector_inactive: %', v_connector.status using errcode = '22023';
  end if;

  -- Rate limit: 10 test deletions per connector per hour.
  select count(*)
    into v_count
    from public.deletion_receipts
   where org_id       = p_org_id
     and connector_id = p_connector_id
     and trigger_type = 'test_delete'
     and created_at   > now() - interval '1 hour';

  if v_count >= 10 then
    raise exception 'rate_limit_exceeded: 10 test_delete per connector per hour'
      using errcode = '22023';
  end if;

  v_principal := 'cs_test_principal_' || gen_random_uuid()::text;
  v_hash      := encode(
    extensions.digest(
      'test_delete:' || p_connector_id::text || ':' || v_principal,
      'sha256'
    ),
    'hex'
  );

  insert into public.deletion_receipts (
    org_id, trigger_type, trigger_id, connector_id,
    target_system, identifier_hash, status, request_payload
  ) values (
    p_org_id,
    'test_delete',
    null,
    p_connector_id,
    v_connector.connector_type,
    v_hash,
    'pending',
    jsonb_build_object(
      'is_test',                   true,
      'reason',                    'test',
      'data_principal_identifier', v_principal,
      'connector_id',              p_connector_id,
      'connector_type',            v_connector.connector_type
    )
  )
  returning id into v_receipt_id;

  return jsonb_build_object(
    'receipt_id',                v_receipt_id,
    'data_principal_identifier', v_principal,
    'reason',                    'test',
    'connector_id',              p_connector_id,
    'connector_type',            v_connector.connector_type,
    'status',                    'pending',
    'note',                      'Customer webhook handler should inspect '
                                  'request_payload->>''reason''=''test'' and '
                                  'short-circuit without deleting real data. '
                                  'Delivery is async; poll /v1/deletion/receipts '
                                  'filtered to this receipt_id to observe.'
  );
end;
$$;

revoke all on function public.rpc_test_delete_trigger(uuid, uuid, uuid) from public;
grant execute on function public.rpc_test_delete_trigger(uuid, uuid, uuid) to service_role;

comment on function public.rpc_test_delete_trigger(uuid, uuid, uuid) is
  'ADR-1005 Phase 2 Sprint 2.1 — round-trip test of a customer deletion '
  'webhook. Synthesises a test principal, writes a deletion_receipts row '
  'with request_payload.is_test=true, rate-limited 10/connector/hour. '
  'Test rows have NULL artefact_id so compliance aggregations skip them.';
