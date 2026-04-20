-- Migration: ADR-0057 Sprint 1.1 — `public.update_org_industry(p_org_id, p_industry)`.
--
-- Makes `organisations.industry` editable after signup. Role gate:
-- effective_org_role in ('org_admin','admin') — account_owner inheritance covers
-- the account-tier. Whitelist matches the sector set used by
-- list_sectoral_templates_for_sector + the sector hints on admin.sectoral_templates.

create or replace function public.update_org_industry(
  p_org_id   uuid,
  p_industry text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text;
begin
  v_role := public.effective_org_role(p_org_id);
  if v_role is null or v_role not in ('org_admin', 'admin') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_industry is null or p_industry not in (
    'saas', 'edtech', 'healthcare', 'ecommerce', 'hrtech', 'fintech', 'bfsi', 'general'
  ) then
    raise exception 'invalid_industry: must be one of saas / edtech / healthcare / ecommerce / hrtech / fintech / bfsi / general';
  end if;

  update public.organisations
     set industry   = p_industry,
         updated_at = now()
   where id = p_org_id;
end;
$$;

revoke execute on function public.update_org_industry(uuid, text) from public;
grant execute on function public.update_org_industry(uuid, text) to authenticated;
