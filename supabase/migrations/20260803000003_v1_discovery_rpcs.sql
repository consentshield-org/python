-- ADR-1012 Sprint 1.2 — discovery RPCs for /v1/purposes and /v1/properties.
--
-- Both are simple list reads of org-owned configuration. Orgs have small
-- numbers of purposes (typically 3–15) and web_properties (typically 1–5),
-- so no cursor pagination — full list in a single envelope.
--
-- Fence: assert_api_key_binding(p_key_id, p_org_id) at the top of each.
-- Scope gate happens at the route handler (read:consent).
--
-- Explicitly NOT returned:
--   web_properties.event_signing_secret         — HMAC key (security)
--   web_properties.event_signing_secret_rotated_at — secret-rotation metadata
--   purpose_definitions.abdm_hi_types           — healthcare-specific; V2 exposure
-- These can be added to the envelope later if a concrete use case emerges.

-- ============================================================================
-- 1. rpc_purpose_list — list purpose_definitions for the org
-- ============================================================================

create or replace function public.rpc_purpose_list(
  p_key_id uuid,
  p_org_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_items jsonb;
begin
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',                    pd.id,
               'purpose_code',          pd.purpose_code,
               'display_name',          pd.display_name,
               'description',           pd.description,
               'data_scope',            to_jsonb(coalesce(pd.data_scope, '{}'::text[])),
               'default_expiry_days',   pd.default_expiry_days,
               'auto_delete_on_expiry', pd.auto_delete_on_expiry,
               'is_required',           pd.is_required,
               'framework',             pd.framework,
               'is_active',             pd.is_active,
               'created_at',            pd.created_at,
               'updated_at',            pd.updated_at
             )
             order by pd.purpose_code asc
           ),
           '[]'::jsonb
         )
    into v_items
    from public.purpose_definitions pd
   where pd.org_id = p_org_id;

  return jsonb_build_object('items', v_items);
end;
$$;

revoke all on function public.rpc_purpose_list(uuid, uuid) from public;
revoke execute on function public.rpc_purpose_list(uuid, uuid) from anon, authenticated;
grant execute on function public.rpc_purpose_list(uuid, uuid) to cs_api;

comment on function public.rpc_purpose_list(uuid, uuid) is
  'ADR-1012 Sprint 1.2 — /v1/purposes. Lists purpose_definitions for the '
  'caller''s org. Fenced by assert_api_key_binding. Orders by purpose_code.';

-- ============================================================================
-- 2. rpc_property_list — list web_properties for the org
-- ============================================================================
--
-- event_signing_secret is deliberately excluded: it's an HMAC key used by
-- the Cloudflare Worker to verify inbound events; exposing it via the
-- public API would defeat the whole HMAC-verification story.

create or replace function public.rpc_property_list(
  p_key_id uuid,
  p_org_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_items jsonb;
begin
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',                   wp.id,
               'name',                 wp.name,
               'url',                  wp.url,
               'allowed_origins',      to_jsonb(coalesce(wp.allowed_origins, '{}'::text[])),
               'snippet_verified_at',  wp.snippet_verified_at,
               'snippet_last_seen_at', wp.snippet_last_seen_at,
               'created_at',           wp.created_at,
               'updated_at',           wp.updated_at
             )
             order by wp.created_at asc
           ),
           '[]'::jsonb
         )
    into v_items
    from public.web_properties wp
   where wp.org_id = p_org_id;

  return jsonb_build_object('items', v_items);
end;
$$;

revoke all on function public.rpc_property_list(uuid, uuid) from public;
revoke execute on function public.rpc_property_list(uuid, uuid) from anon, authenticated;
grant execute on function public.rpc_property_list(uuid, uuid) to cs_api;

comment on function public.rpc_property_list(uuid, uuid) is
  'ADR-1012 Sprint 1.2 — /v1/properties. Lists web_properties for the '
  'caller''s org. Fenced. event_signing_secret is deliberately not in the '
  'envelope (HMAC key — must not leak to API consumers).';
