-- ADR-1003 Sprint 1.2 — zero-storage preconditions + mode-flip gate.
--
-- Sprint 1.2 ships the Worker branch for zero_storage orgs: on every
-- event, the Worker POSTs the payload to /api/internal/zero-storage-event
-- and returns 202 immediately. The bridge route uploads the canonical
-- JSON to the customer's R2 bucket (pulled from export_configurations).
-- Nothing lands in consent_events / consent_artefacts / delivery_buffer
-- for a zero_storage org.
--
-- For that to be safe, an org MUST have a verified export_configurations
-- row BEFORE it flips to zero_storage — otherwise the bridge has no R2
-- target and events would be lost. This migration amends
-- admin.set_organisation_storage_mode to enforce that precondition.
--
-- Sprint 1.3 (next session) will add the consent_artefact_index TTL
-- path so the /v1/consent/verify endpoint can answer "did this org
-- consent to purpose X" for zero_storage orgs without reaching into
-- customer storage on every call. Until 1.3 lands, verify reads for
-- zero_storage events will return "not found" — a feature gap, not
-- data loss: the event IS in customer R2, just not indexed on our
-- side.

-- ═══════════════════════════════════════════════════════════
-- 1/1 · Amend admin.set_organisation_storage_mode with a
--       zero_storage precondition check.
-- ═══════════════════════════════════════════════════════════
-- Same shape as the Sprint 1.1 version plus one guard: refuse
-- flipping to zero_storage unless public.export_configurations for
-- the org has is_verified=true. Standard / Insulated flips are
-- unrestricted (they don't need customer R2).

create or replace function admin.set_organisation_storage_mode(
  p_org_id    uuid,
  p_new_mode  text,
  p_reason    text
)
returns jsonb
language plpgsql
security definer
set search_path = admin, public, pg_catalog
as $$
declare
  v_admin       uuid := auth.uid();
  v_old_mode    text;
  v_request_id  bigint;
  v_r2_verified boolean;
begin
  perform admin.require_admin('platform_operator');

  if p_reason is null or length(p_reason) < 10 then
    raise exception 'reason must be at least 10 characters'
      using errcode = '22023';
  end if;

  if p_new_mode not in ('standard', 'insulated', 'zero_storage') then
    raise exception 'storage_mode must be standard | insulated | zero_storage, got %',
      p_new_mode
      using errcode = '22023';
  end if;

  select storage_mode into v_old_mode
    from public.organisations
   where id = p_org_id
   for update;

  if v_old_mode is null then
    raise exception 'organisation not found: %', p_org_id
      using errcode = 'P0002';
  end if;

  -- Precondition for zero_storage: customer MUST have a verified R2
  -- target. Without it, the Sprint 1.2 bridge route has nowhere to
  -- PUT the canonical event JSON and events are silently dropped.
  if p_new_mode = 'zero_storage' and v_old_mode <> 'zero_storage' then
    select exists (
      select 1 from public.export_configurations
       where org_id = p_org_id
         and is_verified = true
    ) into v_r2_verified;

    if not v_r2_verified then
      raise exception 'cannot flip to zero_storage: org % has no verified export_configurations row (is_verified=true). Provision customer storage first.', p_org_id
        using errcode = '42501';
    end if;
  end if;

  if v_old_mode = p_new_mode then
    insert into admin.admin_audit_log (
      admin_user_id, action, target_table, target_id, org_id,
      old_value, new_value, reason
    ) values (
      v_admin, 'adr1003_storage_mode_noop',
      'public.organisations', p_org_id, p_org_id,
      jsonb_build_object('storage_mode', v_old_mode),
      jsonb_build_object('storage_mode', p_new_mode),
      p_reason
    );
    return jsonb_build_object(
      'changed',  false,
      'org_id',   p_org_id,
      'old_mode', v_old_mode,
      'new_mode', p_new_mode
    );
  end if;

  update public.organisations
     set storage_mode = p_new_mode,
         updated_at   = now()
   where id = p_org_id;

  insert into admin.admin_audit_log (
    admin_user_id, action, target_table, target_id, org_id,
    old_value, new_value, reason
  ) values (
    v_admin, 'adr1003_storage_mode_change',
    'public.organisations', p_org_id, p_org_id,
    jsonb_build_object('storage_mode', v_old_mode),
    jsonb_build_object('storage_mode', p_new_mode),
    p_reason
  );

  begin
    v_request_id := public.dispatch_storage_mode_sync();
  exception when others then
    v_request_id := null;
  end;

  return jsonb_build_object(
    'changed',        true,
    'org_id',         p_org_id,
    'old_mode',       v_old_mode,
    'new_mode',       p_new_mode,
    'net_request_id', v_request_id
  );
end;
$$;

comment on function admin.set_organisation_storage_mode(uuid, text, text) is
  'ADR-1003 Sprint 1.2 (amended from Sprint 1.1). Single gated write '
  'surface for organisations.storage_mode. platform_operator+ only; '
  'audit-logged; fires KV dispatch. Additional precondition: flipping '
  'TO zero_storage requires a verified public.export_configurations '
  'row (is_verified=true) for the org — otherwise the Sprint 1.2 '
  'bridge route has nowhere to PUT event JSON.';

-- Grant unchanged from Sprint 1.1 (already in place), but re-issuing
-- is idempotent.
grant execute on function admin.set_organisation_storage_mode(uuid, text, text)
  to cs_admin;
