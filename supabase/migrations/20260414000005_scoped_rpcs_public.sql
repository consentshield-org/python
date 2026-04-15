-- ADR-0009 Sprint 1.1 — security-definer RPCs for public-surface buffer writes.
-- These functions let `anon` callers perform narrow mutations via PostgREST
-- without handing them the service role key (closes B-4 for the three
-- highest-risk routes). Each function is owned by cs_orchestrator and
-- validates its inputs. Input validation mirrors the checks previously
-- performed in the Next.js routes.

-- Note: the migration role (postgres) is already a member of cs_orchestrator
-- via migration 010 (scoped_roles) — ALTER FUNCTION ... OWNER TO cs_orchestrator
-- succeeds directly. If run under a role without membership, grant it first:
--   grant cs_orchestrator to <migration_role>;

-- -----------------------------------------------------------------------------
-- Grant extensions. The original cs_orchestrator grants (migration 010) did
-- not cover INSERT on rights_requests nor the OTP columns, because the
-- previous implementation routed those writes through the service role.
-- -----------------------------------------------------------------------------

grant insert on rights_requests to cs_orchestrator;
grant update (
  status,
  assignee_id,
  email_verified,
  email_verified_at,
  otp_hash,
  otp_expires_at,
  otp_attempts
) on rights_requests to cs_orchestrator;

-- -----------------------------------------------------------------------------
-- rpc_rights_request_create
-- Called from POST /api/public/rights-request. Validates the org and creates
-- a rights_requests row with email_verified=false. Returns the new id and
-- the org's display name so the route can send the OTP email without a
-- second round-trip.
-- -----------------------------------------------------------------------------

create or replace function public.rpc_rights_request_create(
  p_org_id uuid,
  p_request_type text,
  p_requestor_name text,
  p_requestor_email text,
  p_requestor_message text,
  p_otp_hash text,
  p_otp_expires_at timestamptz
)
returns table (request_id uuid, org_name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org_name text;
  v_request_id uuid;
begin
  if p_request_type not in ('erasure', 'access', 'correction', 'nomination') then
    raise exception 'invalid request_type: %', p_request_type using errcode = '22023';
  end if;

  if p_requestor_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'invalid requestor_email' using errcode = '22023';
  end if;

  select name into v_org_name from organisations where id = p_org_id;
  if v_org_name is null then
    raise exception 'unknown organisation' using errcode = 'P0002';
  end if;

  insert into rights_requests (
    org_id, request_type, requestor_name, requestor_email, requestor_message,
    turnstile_verified, email_verified, otp_hash, otp_expires_at, status
  ) values (
    p_org_id, p_request_type, p_requestor_name, p_requestor_email, p_requestor_message,
    true, false, p_otp_hash, p_otp_expires_at, 'new'
  ) returning id into v_request_id;

  return query select v_request_id, v_org_name;
end;
$$;

alter function public.rpc_rights_request_create(uuid, text, text, text, text, text, timestamptz)
  owner to cs_orchestrator;
revoke all on function public.rpc_rights_request_create(uuid, text, text, text, text, text, timestamptz) from public;
grant execute on function public.rpc_rights_request_create(uuid, text, text, text, text, text, timestamptz) to anon;

-- -----------------------------------------------------------------------------
-- rpc_rights_request_verify_otp
-- Called from POST /api/public/rights-request/verify-otp. Verifies the OTP,
-- marks the row as email_verified, appends a rights_request_events row, and
-- writes an audit_log entry — all atomically. Returns a jsonb envelope.
-- -----------------------------------------------------------------------------

create or replace function public.rpc_rights_request_verify_otp(
  p_request_id uuid,
  p_otp_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_req rights_requests%rowtype;
  v_org_name text;
  v_compliance_email text;
begin
  select * into v_req from rights_requests where id = p_request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_req.email_verified then
    return jsonb_build_object('ok', false, 'error', 'already_verified');
  end if;

  if v_req.otp_hash is null or v_req.otp_expires_at is null then
    return jsonb_build_object('ok', false, 'error', 'no_otp_issued');
  end if;

  if v_req.otp_expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  if coalesce(v_req.otp_attempts, 0) >= 5 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  if v_req.otp_hash <> p_otp_hash then
    update rights_requests
      set otp_attempts = coalesce(otp_attempts, 0) + 1
      where id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'invalid_otp');
  end if;

  update rights_requests set
    email_verified = true,
    email_verified_at = now(),
    otp_hash = null,
    otp_expires_at = null,
    otp_attempts = 0,
    status = 'new'
  where id = p_request_id;

  insert into rights_request_events (request_id, org_id, event_type, notes)
    values (p_request_id, v_req.org_id, 'created', 'Rights request submitted and email verified');

  insert into audit_log (org_id, event_type, entity_type, entity_id, payload)
    values (
      v_req.org_id,
      'rights_request_created',
      'rights_request',
      p_request_id,
      jsonb_build_object('request_type', v_req.request_type)
    );

  select name, compliance_contact_email into v_org_name, v_compliance_email
    from organisations where id = v_req.org_id;

  return jsonb_build_object(
    'ok', true,
    'org_id', v_req.org_id,
    'org_name', v_org_name,
    'compliance_contact_email', v_compliance_email,
    'request_type', v_req.request_type,
    'requestor_name', v_req.requestor_name,
    'requestor_email', v_req.requestor_email
  );
end;
$$;

alter function public.rpc_rights_request_verify_otp(uuid, text) owner to cs_orchestrator;
revoke all on function public.rpc_rights_request_verify_otp(uuid, text) from public;
grant execute on function public.rpc_rights_request_verify_otp(uuid, text) to anon;

-- -----------------------------------------------------------------------------
-- rpc_deletion_receipt_confirm
-- Called from POST /api/v1/deletion-receipts/[id]. Signature is verified in
-- the Node route. This RPC enforces the state machine (B-6): it only accepts
-- the update when the current status is 'awaiting_callback'. Replays return
-- already_confirmed=true without mutating.
-- -----------------------------------------------------------------------------

create or replace function public.rpc_deletion_receipt_confirm(
  p_receipt_id uuid,
  p_reported_status text,
  p_records_deleted integer,
  p_systems_affected jsonb,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org_id uuid;
  v_status text;
  v_new_status text;
  v_updated int;
begin
  select org_id, status into v_org_id, v_status
    from deletion_receipts where id = p_receipt_id;
  if v_org_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_status in ('confirmed', 'completed') then
    return jsonb_build_object('ok', true, 'already_confirmed', true);
  end if;

  if v_status <> 'awaiting_callback' then
    return jsonb_build_object('ok', false, 'error', 'invalid_state', 'current', v_status);
  end if;

  if p_reported_status not in ('completed', 'partial', 'failed') then
    v_new_status := 'confirmed';
  else
    v_new_status := case when p_reported_status = 'completed' then 'confirmed' else p_reported_status end;
  end if;

  update deletion_receipts set
    status = v_new_status,
    confirmed_at = coalesce(p_completed_at, now()),
    response_payload = jsonb_build_object(
      'status', p_reported_status,
      'records_deleted', coalesce(p_records_deleted, 0),
      'systems_affected', coalesce(p_systems_affected, '[]'::jsonb)
    )
    where id = p_receipt_id and status = 'awaiting_callback';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'race');
  end if;

  insert into audit_log (org_id, event_type, entity_type, entity_id, payload)
    values (
      v_org_id,
      'deletion_confirmed',
      'deletion_receipt',
      p_receipt_id,
      jsonb_build_object(
        'reported_status', p_reported_status,
        'records_deleted', coalesce(p_records_deleted, 0)
      )
    );

  return jsonb_build_object('ok', true, 'receipt_id', p_receipt_id, 'status', v_new_status);
end;
$$;

alter function public.rpc_deletion_receipt_confirm(uuid, text, integer, jsonb, timestamptz)
  owner to cs_orchestrator;
revoke all on function public.rpc_deletion_receipt_confirm(uuid, text, integer, jsonb, timestamptz) from public;
grant execute on function public.rpc_deletion_receipt_confirm(uuid, text, integer, jsonb, timestamptz) to anon;
