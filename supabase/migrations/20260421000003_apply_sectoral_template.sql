-- ADR-0030 Sprint 3.1 — customer-side sectoral-template application.
--
-- Adds a SECURITY DEFINER RPC so customers can pick a published
-- sectoral template and record the choice on their org. The chosen
-- (code, version) is written into public.organisations.settings as
-- `settings.sectoral_template = { code, version, applied_at }`.
--
-- This RPC DOES NOT materialise the template's purposes into
-- public.purpose_definitions — that's a future DEPA sprint. Today the
-- reference on settings is the pointer; when a DEPA expansion lands,
-- it'll walk org.settings and fan the purposes out.

create or replace function public.apply_sectoral_template(
  p_template_code text
) returns jsonb
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  v_org_id     uuid := public.current_org_id();
  v_user_id    uuid := auth.uid();
  v_template   admin.sectoral_templates%rowtype;
  v_new_settings jsonb;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  if v_org_id is null then
    raise exception 'no org on current session';
  end if;

  -- Pick the latest published version of the template_code.
  select * into v_template
    from admin.sectoral_templates
   where template_code = p_template_code
     and status = 'published'
   order by version desc
   limit 1;

  if v_template.id is null then
    raise exception 'no published template with code %', p_template_code;
  end if;

  update public.organisations
     set settings = coalesce(settings, '{}'::jsonb)
       || jsonb_build_object(
            'sectoral_template',
            jsonb_build_object(
              'code', v_template.template_code,
              'version', v_template.version,
              'applied_at', now(),
              'applied_by', v_user_id
            )
          )
   where id = v_org_id;

  select jsonb_build_object(
    'code', v_template.template_code,
    'version', v_template.version,
    'display_name', v_template.display_name,
    'purpose_count', jsonb_array_length(v_template.purpose_definitions)
  ) into v_new_settings;

  return v_new_settings;
end;
$$;

grant execute on function public.apply_sectoral_template(text) to authenticated;

-- Verification:
--   select count(*) from pg_proc
--     where proname='apply_sectoral_template' and pronamespace='public'::regnamespace; → 1
