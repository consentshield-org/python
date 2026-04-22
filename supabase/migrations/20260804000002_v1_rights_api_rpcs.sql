-- ADR-1005 Sprint 5.1 — v1 Rights API RPCs.
--
-- Two new SECURITY DEFINER RPCs for the public Bearer-gated Rights API:
--
--   rpc_rights_request_create_api — POST /v1/rights/requests
--     Mirrors rpc_rights_request_create (20260424000003) but drops the
--     OTP + Turnstile fields (API-key holder attests identity). Sets
--     identity_verified=true, identity_method=<caller attestation>,
--     captured_via=api (or caller-supplied if operator-side channel),
--     created_by_api_key_id=p_key_id so audit queries can attribute every
--     API-created request to the specific key that created it.
--
--   rpc_rights_request_list — GET /v1/rights/requests
--     Cursor-paginated list with filters on status, request_type,
--     created_after/before, and captured_via. Keyset cursor matches the
--     rpc_event_list format: base64(jsonb {c: created_at, i: id}).
--
-- Both RPCs are fenced by assert_api_key_binding(p_key_id, p_org_id) — if
-- the key was revoked between ADR-1001 Bearer verification and this RPC
-- call, or the handler dropped the wrong org_id, the DB blocks the write.
--
-- Grants to cs_api are in 20260804000003.

-- ============================================================================
-- 1. rpc_rights_request_create_api
-- ============================================================================

drop function if exists public.rpc_rights_request_create_api(
  uuid, uuid, text, text, text, text, text, text
);

create or replace function public.rpc_rights_request_create_api(
  p_key_id               uuid,
  p_org_id               uuid,
  p_request_type         text,
  p_requestor_name       text,
  p_requestor_email      text,
  p_request_details      text,
  p_identity_verified_by text,
  p_captured_via         text default 'api'
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_request_id   uuid;
  v_sla_deadline timestamptz;
  v_created_at   timestamptz;
  v_now          timestamptz := now();
begin
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  if p_request_type not in ('erasure', 'access', 'correction', 'nomination') then
    raise exception 'invalid_request_type' using errcode = '22023';
  end if;

  if p_requestor_name is null or length(btrim(p_requestor_name)) = 0 then
    raise exception 'requestor_name_missing' using errcode = '22023';
  end if;

  if p_requestor_email is null or p_requestor_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'invalid_requestor_email' using errcode = '22023';
  end if;

  if p_identity_verified_by is null or length(btrim(p_identity_verified_by)) = 0 then
    raise exception 'identity_verified_by_missing' using errcode = '22023';
  end if;

  -- captured_via defaults to 'api'; the CHECK constraint on the column
  -- rejects unknown values, so no extra validation here.

  insert into public.rights_requests (
    org_id,
    request_type,
    requestor_name,
    requestor_email,
    requestor_message,
    turnstile_verified,
    email_verified,
    email_verified_at,
    identity_verified,
    identity_verified_at,
    identity_method,
    status,
    captured_via,
    created_by_api_key_id
  ) values (
    p_org_id,
    p_request_type,
    btrim(p_requestor_name),
    lower(btrim(p_requestor_email)),
    p_request_details,
    true,   -- API-key gate substitutes for Turnstile
    true,   -- API-key gate substitutes for email OTP
    v_now,
    true,   -- identity attested by API caller
    v_now,
    btrim(p_identity_verified_by),
    'new',
    coalesce(p_captured_via, 'api'),
    p_key_id
  )
  returning id, sla_deadline, created_at
      into v_request_id, v_sla_deadline, v_created_at;

  -- Audit event: marks this row as API-created for DPB audit filtering.
  insert into public.rights_request_events (
    request_id, org_id, actor_id, event_type, notes, metadata
  ) values (
    v_request_id,
    p_org_id,
    null,
    'created_via_api',
    'Rights request created via /v1/rights/requests',
    jsonb_build_object(
      'api_key_id',           p_key_id,
      'identity_verified_by', btrim(p_identity_verified_by),
      'captured_via',         coalesce(p_captured_via, 'api')
    )
  );

  return jsonb_build_object(
    'id',                    v_request_id,
    'status',                'new',
    'request_type',          p_request_type,
    'captured_via',          coalesce(p_captured_via, 'api'),
    'identity_verified',     true,
    'identity_verified_by',  btrim(p_identity_verified_by),
    'sla_deadline',          v_sla_deadline,
    'created_at',            v_created_at
  );
end;
$$;

revoke all on function public.rpc_rights_request_create_api(
  uuid, uuid, text, text, text, text, text, text
) from public;

comment on function public.rpc_rights_request_create_api(
  uuid, uuid, text, text, text, text, text, text
) is
  'ADR-1005 Sprint 5.1 — POST /v1/rights/requests. Creates a rights_requests '
  'row with identity_verified=true (API caller attests via p_identity_verified_by). '
  'Appends a rights_request_events audit row of type created_via_api.';

-- ============================================================================
-- 2. rpc_rights_request_list
-- ============================================================================

drop function if exists public.rpc_rights_request_list(
  uuid, uuid, text, text, timestamptz, timestamptz, text, text, int
);

create or replace function public.rpc_rights_request_list(
  p_key_id         uuid,
  p_org_id         uuid,
  p_status         text        default null,
  p_request_type   text        default null,
  p_created_after  timestamptz default null,
  p_created_before timestamptz default null,
  p_captured_via   text        default null,
  p_cursor         text        default null,
  p_limit          int         default 50
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
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));

  if p_status is not null
     and p_status not in ('new', 'in_progress', 'completed', 'rejected') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  if p_request_type is not null
     and p_request_type not in ('erasure', 'access', 'correction', 'nomination') then
    raise exception 'invalid_request_type' using errcode = '22023';
  end if;

  if p_cursor is not null and length(p_cursor) > 0 then
    begin
      v_cursor_jsonb   := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
      v_cursor_created := (v_cursor_jsonb->>'c')::timestamptz;
      v_cursor_id      := (v_cursor_jsonb->>'i')::uuid;
    exception when others then
      raise exception 'bad_cursor' using errcode = '22023';
    end;
  end if;

  with filtered as (
    select id, request_type, requestor_name, requestor_email,
           status, captured_via, identity_verified, identity_verified_at,
           identity_method, sla_deadline, response_sent_at,
           created_by_api_key_id, created_at, updated_at
      from public.rights_requests
     where org_id = p_org_id
       and (p_status         is null or status       = p_status)
       and (p_request_type   is null or request_type = p_request_type)
       and (p_captured_via   is null or captured_via = p_captured_via)
       and (p_created_after  is null or created_at >= p_created_after)
       and (p_created_before is null or created_at <= p_created_before)
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
          'request_type',            request_type,
          'requestor_name',          requestor_name,
          'requestor_email',         requestor_email,
          'status',                  status,
          'captured_via',            captured_via,
          'identity_verified',       identity_verified,
          'identity_verified_at',    identity_verified_at,
          'identity_method',         identity_method,
          'sla_deadline',            sla_deadline,
          'response_sent_at',        response_sent_at,
          'created_by_api_key_id',   created_by_api_key_id,
          'created_at',              created_at,
          'updated_at',              updated_at
        )
        order by created_at desc, id desc
      ) as items,
      count(*) as cnt
    from ordered
  )
  select items, cnt into v_items, v_count from agg;

  if v_items is null then
    v_items := '[]'::jsonb;
  end if;

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
  end if;

  return jsonb_build_object(
    'items',       v_items,
    'next_cursor', v_next_cursor
  );
end;
$$;

revoke all on function public.rpc_rights_request_list(
  uuid, uuid, text, text, timestamptz, timestamptz, text, text, int
) from public;

comment on function public.rpc_rights_request_list(
  uuid, uuid, text, text, timestamptz, timestamptz, text, text, int
) is
  'ADR-1005 Sprint 5.1 — GET /v1/rights/requests. Keyset-paginated list of '
  'rights_requests for the caller''s org. Filters: status, request_type, '
  'captured_via, created_after, created_before. Cursor format matches '
  'rpc_event_list (base64 jsonb with c=created_at + i=id).';
