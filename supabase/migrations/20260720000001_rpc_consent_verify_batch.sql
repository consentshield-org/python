-- ADR-1002 Sprint 1.3 — rpc_consent_verify_batch RPC.
--
-- Batched counterpart to rpc_consent_verify (Sprint 1.2). §5.3 spec:
--   - Single property_id per batch.
--   - Single identifier_type per batch.
--   - Single purpose_code per batch.
--   - Up to 10,000 identifiers; the route handler enforces the limit and
--     returns 413, but this RPC caps at 10,000 too as defense-in-depth.
--   - Response preserves input order.

create or replace function public.rpc_consent_verify_batch(
  p_org_id          uuid,
  p_property_id     uuid,
  p_identifier_type text,
  p_purpose_code    text,
  p_identifiers     text[]
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_hashes       text[];
  v_evaluated_at timestamptz := now();
  v_results      jsonb;
  v_count        int;
begin
  if p_identifiers is null then
    raise exception 'identifiers_empty' using errcode = '22023';
  end if;

  v_count := coalesce(array_length(p_identifiers, 1), 0);

  if v_count = 0 then
    raise exception 'identifiers_empty' using errcode = '22023';
  end if;

  if v_count > 10000 then
    raise exception 'identifiers_too_large: % > 10000', v_count using errcode = '22023';
  end if;

  -- Validate property ownership (same rule as single-verify).
  if not exists (
    select 1 from public.web_properties
     where id = p_property_id and org_id = p_org_id
  ) then
    raise exception 'property_not_found' using errcode = 'P0001';
  end if;

  -- Hash each identifier in input order. hash_data_principal_identifier
  -- raises 22023 on empty / unknown type; we propagate — the whole batch
  -- fails fast rather than returning a partial result (callers should
  -- pre-sanitise client-side or accept an all-or-nothing semantic).
  select array_agg(
           public.hash_data_principal_identifier(p_org_id, t.ident, p_identifier_type)
           order by t.ord
         )
    into v_hashes
    from unnest(p_identifiers) with ordinality as t(ident, ord);

  -- One ordered result per input identifier via LATERAL LIMIT 1 against the
  -- hot-path partial index. Rows that don't match → status=never_consented.
  with input as (
    select ord, p_identifiers[ord] as identifier, v_hashes[ord] as hash
      from generate_series(1, v_count) as ord
  ),
  resolved as (
    select
      input.ord,
      input.identifier,
      best.artefact_id,
      best.validity_state,
      best.revoked_at,
      best.revocation_record_id,
      best.expires_at
    from input
    left join lateral (
      select artefact_id, validity_state, revoked_at, revocation_record_id, expires_at
        from public.consent_artefact_index r
       where r.org_id          = p_org_id
         and r.property_id     = p_property_id
         and r.identifier_hash = input.hash
         and r.purpose_code    = p_purpose_code
       order by case r.validity_state
                  when 'active'  then 0
                  when 'expired' then 1
                  when 'revoked' then 2
                  else 3
                end,
                r.created_at desc
       limit 1
    ) best on true
  )
  select jsonb_agg(
           jsonb_build_object(
             'identifier',         identifier,
             'status',
               case
                 when validity_state is null                                          then 'never_consented'
                 when validity_state = 'revoked'                                      then 'revoked'
                 when validity_state = 'expired'                                      then 'expired'
                 when validity_state = 'active'
                  and expires_at is not null
                  and expires_at < v_evaluated_at                                     then 'expired'
                 else 'granted'
               end,
             'active_artefact_id',
               case
                 when validity_state = 'active'
                  and (expires_at is null or expires_at >= v_evaluated_at)            then artefact_id
                 else null
               end,
             'revoked_at',           revoked_at,
             'revocation_record_id', revocation_record_id,
             'expires_at',           expires_at
           )
           order by ord
         )
    into v_results
    from resolved;

  return jsonb_build_object(
    'property_id',     p_property_id,
    'identifier_type', p_identifier_type,
    'purpose_code',    p_purpose_code,
    'evaluated_at',    v_evaluated_at,
    'results',         coalesce(v_results, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.rpc_consent_verify_batch(uuid, uuid, text, text, text[]) from public;
grant execute on function public.rpc_consent_verify_batch(uuid, uuid, text, text, text[]) to service_role;

comment on function public.rpc_consent_verify_batch(uuid, uuid, text, text, text[]) is
  'ADR-1002 Sprint 1.3 — batched single-identifier_type + single-purpose_code '
  'consent verification. Up to 10000 identifiers. Response preserves input '
  'order. Raises identifiers_empty / identifiers_too_large (22023), '
  'property_not_found (P0001), or propagates hash_data_principal_identifier '
  'errors on malformed individual identifiers.';
