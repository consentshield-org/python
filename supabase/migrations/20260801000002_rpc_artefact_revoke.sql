-- ADR-1002 Sprint 3.2 — rpc_artefact_revoke RPC.
--
-- Wraps the existing artefact_revocations INSERT path (ADR-0022 cascade fires
-- on insert — trg_artefact_revocation_cascade flips consent_artefacts.status
-- to 'revoked' and ADR-1002 Sprint 1.1 trigger rewrite updates
-- consent_artefact_index rather than deleting).
--
-- API-layer actor_type → DB revoked_by_type mapping:
--   user     → data_principal
--   operator → organisation
--   system   → system
--
-- Idempotency: calling revoke on an already-revoked artefact returns the
-- existing revocation_record_id (200, not 409). Calling revoke on a
-- terminal state (expired / replaced) raises artefact_terminal_state (409).

create or replace function public.rpc_artefact_revoke(
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
  -- Validate artefact belongs to org.
  select artefact_id, status
    into v_art
    from public.consent_artefacts
   where artefact_id = p_artefact_id and org_id = p_org_id;

  if not found then
    raise exception 'artefact_not_found' using errcode = 'P0001';
  end if;

  -- Idempotent replay for already-revoked artefacts.
  if v_art.status = 'revoked' then
    select revocation_record_id into v_existing_rev_id
      from public.consent_artefact_index
     where artefact_id = p_artefact_id and org_id = p_org_id
     limit 1;

    if v_existing_rev_id is null then
      -- Fall back to scanning artefact_revocations directly (older rows may
      -- predate the Sprint 1.1 index-preservation fix).
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

  -- Terminal states: expired and replaced cannot be revoked.
  if v_art.status in ('expired', 'replaced') then
    raise exception 'artefact_terminal_state: %', v_art.status using errcode = '22023';
  end if;

  if p_reason_code is null or length(trim(p_reason_code)) = 0 then
    raise exception 'reason_code_missing' using errcode = '22023';
  end if;

  if p_actor_type not in ('user', 'operator', 'system') then
    raise exception 'unknown_actor_type: %', p_actor_type using errcode = '22023';
  end if;

  -- Map API actor_type to DB revoked_by_type.
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

revoke all on function public.rpc_artefact_revoke(uuid, text, text, text, text, text) from public;
grant execute on function public.rpc_artefact_revoke(uuid, text, text, text, text, text) to service_role;

comment on function public.rpc_artefact_revoke(uuid, text, text, text, text, text) is
  'ADR-1002 Sprint 3.2 — revoke a consent artefact. Idempotent on already-'
  'revoked; raises artefact_terminal_state for expired/replaced. Inserts '
  'artefact_revocations row — the ADR-0022 cascade trigger (plus Sprint 1.1 '
  'index-preservation fix) handles consent_artefacts.status and '
  'consent_artefact_index.validity_state transitions.';
