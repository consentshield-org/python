-- ADR-0050 Sprint 3.1 — admin.billing_invoice_export_manifest + admin.billing_invoice_search
--
-- 1. export_manifest — snapshot of the invoice rows an operator is about
--    to bundle into a ZIP. Snapshots issuer_legal_name + account_name at
--    query time so the manifest remains meaningful even if issuers are
--    retired or account names change afterwards. Caller then iterates
--    the list, fetches each pdf_r2_key, and assembles the ZIP; the
--    audit row for the export is emitted by a separate
--    admin.billing_invoice_export_audit RPC after ZIP assembly (so the
--    audit row can include the ZIP SHA-256).
--
-- 2. invoice_search — scope-gated search for the /billing/search page.
--    Filters: q (invoice_number prefix), account_id, date range.
--    Paged via limit + offset. Same scope rule as billing_invoice_list.
--
-- Both RPCs use the shared admin._billing_active_issuer_id helper.

-- ═══════════════════════════════════════════════════════════
-- 1 · admin.billing_invoice_export_manifest
-- ═══════════════════════════════════════════════════════════

create or replace function admin.billing_invoice_export_manifest(
  p_issuer_id   uuid default null,
  p_fy_year     text default null,
  p_account_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = admin, public, billing, pg_catalog
as $$
declare
  v_operator        uuid := auth.uid();
  v_role            text;
  v_active_issuer   uuid;
  v_effective_scope uuid; -- null = all issuers (owner only)
  v_rows            jsonb;
  v_summary         jsonb;
begin
  perform admin.require_admin('platform_operator');

  select admin_role into v_role from admin.admin_users where id = v_operator;
  v_active_issuer := admin._billing_active_issuer_id();

  if v_role = 'platform_operator' then
    if p_issuer_id is null then
      v_effective_scope := v_active_issuer;
    elsif p_issuer_id = v_active_issuer then
      v_effective_scope := p_issuer_id;
    else
      raise exception 'platform_operator may only export invoices for the currently-active issuer'
        using errcode = '42501';
    end if;
    if v_effective_scope is null then
      raise exception 'No active issuer — activate one before preparing an export'
        using errcode = '22023';
    end if;
  else
    v_effective_scope := p_issuer_id; -- null = all issuers for owner
  end if;

  with scoped as (
    select
      i.*,
      e.legal_name as issuer_legal_name_snap,
      e.is_active  as issuer_is_active,
      a.name       as account_name_snap
    from public.invoices i
      join billing.issuer_entities e on e.id = i.issuer_entity_id
      join public.accounts a         on a.id = i.account_id
    where (v_effective_scope is null or i.issuer_entity_id = v_effective_scope)
      and (p_fy_year is null or i.fy_year = p_fy_year)
      and (p_account_id is null or i.account_id = p_account_id)
      and i.status in ('issued', 'paid', 'partially_paid', 'overdue', 'void', 'refunded')
    order by i.issue_date asc, i.fy_sequence asc, i.created_at asc
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',                  s.id,
          'invoice_number',      s.invoice_number,
          'fy_year',             s.fy_year,
          'fy_sequence',         s.fy_sequence,
          'issue_date',          s.issue_date,
          'status',              s.status,
          'total_paise',         s.total_paise,
          'pdf_r2_key',          s.pdf_r2_key,
          'pdf_sha256',          s.pdf_sha256,
          'issuer_id',           s.issuer_entity_id,
          'issuer_is_active',    s.issuer_is_active,
          'issuer_legal_name',   s.issuer_legal_name_snap,
          'account_id',          s.account_id,
          'account_name',        s.account_name_snap
        )
      ),
      '[]'::jsonb
    ),
    jsonb_build_object(
      'count',          count(*),
      'total_paise',    coalesce(sum(s.total_paise), 0)::bigint,
      'pdf_available',  count(*) filter (where s.pdf_r2_key is not null),
      'pdf_missing',    count(*) filter (where s.pdf_r2_key is null)
    )
  into v_rows, v_summary
  from scoped s;

  return jsonb_build_object(
    'rows',    v_rows,
    'summary', v_summary,
    'scope',   jsonb_build_object(
      'caller_role',      v_role,
      'issuer_id',        v_effective_scope,
      'all_issuers',      v_effective_scope is null,
      'fy_year',          p_fy_year,
      'account_id',       p_account_id
    )
  );
end;
$$;

revoke all on function admin.billing_invoice_export_manifest(uuid, text, uuid) from public;
grant execute on function admin.billing_invoice_export_manifest(uuid, text, uuid)
  to cs_admin, authenticated;

comment on function admin.billing_invoice_export_manifest(uuid, text, uuid) is
  'ADR-0050 Sprint 3.1. Snapshot of invoices an operator is about to ZIP-export, with issuer_legal_name + account_name frozen at query time.';

-- ═══════════════════════════════════════════════════════════
-- 2 · admin.billing_invoice_export_audit — separate RPC, post-ZIP
-- ═══════════════════════════════════════════════════════════
-- Records the caller role + filter params + row count + ZIP SHA-256 on
-- admin.admin_audit_log so the export event itself is tamper-evident.

create or replace function admin.billing_invoice_export_audit(
  p_issuer_id   uuid,
  p_fy_year     text,
  p_account_id  uuid,
  p_row_count   integer,
  p_zip_sha256  text
)
returns void
language plpgsql
security definer
set search_path = admin, public, billing, pg_catalog
as $$
declare
  v_operator uuid := auth.uid();
  v_role     text;
begin
  perform admin.require_admin('platform_operator');

  if coalesce(length(p_zip_sha256), 0) <> 64 then
    raise exception 'zip_sha256 must be a 64-character hex digest' using errcode = '22023';
  end if;
  if p_row_count is null or p_row_count < 0 then
    raise exception 'row_count must be non-negative' using errcode = '22023';
  end if;

  select admin_role into v_role from admin.admin_users where id = v_operator;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id,
     old_value, new_value, reason)
  values
    (v_operator, 'billing_invoice_export', 'public.invoices', null, null,
     null,
     jsonb_build_object(
       'issuer_id',   p_issuer_id,
       'fy_year',     p_fy_year,
       'account_id',  p_account_id,
       'row_count',   p_row_count,
       'zip_sha256',  p_zip_sha256,
       'caller_role', v_role
     ),
     'invoice export ZIP generated');
end;
$$;

revoke all on function admin.billing_invoice_export_audit(uuid, text, uuid, integer, text) from public;
grant execute on function admin.billing_invoice_export_audit(uuid, text, uuid, integer, text)
  to cs_admin, authenticated;

comment on function admin.billing_invoice_export_audit(uuid, text, uuid, integer, text) is
  'ADR-0050 Sprint 3.1. Records an invoice-export event with the ZIP SHA-256 for tamper-evidence.';

-- ═══════════════════════════════════════════════════════════
-- 3 · admin.billing_invoice_search
-- ═══════════════════════════════════════════════════════════

create or replace function admin.billing_invoice_search(
  p_q             text default null,
  p_account_id    uuid default null,
  p_date_from     date default null,
  p_date_to       date default null,
  p_limit         integer default 50,
  p_offset        integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = admin, public, billing, pg_catalog
as $$
declare
  v_operator       uuid := auth.uid();
  v_role           text;
  v_active_issuer  uuid;
  v_rows           jsonb;
  v_total          integer;
begin
  perform admin.require_admin('platform_operator');

  if p_limit is null or p_limit < 1 or p_limit > 200 then
    p_limit := 50;
  end if;
  if p_offset is null or p_offset < 0 then
    p_offset := 0;
  end if;

  select admin_role into v_role from admin.admin_users where id = v_operator;
  v_active_issuer := admin._billing_active_issuer_id();

  with scoped as (
    select i.*, a.name as account_name_snap
    from public.invoices i
      join public.accounts a on a.id = i.account_id
    where (v_role = 'platform_owner' or i.issuer_entity_id = v_active_issuer)
      and (p_q is null or p_q = '' or i.invoice_number ilike (p_q || '%'))
      and (p_account_id is null or i.account_id = p_account_id)
      and (p_date_from is null or i.issue_date >= p_date_from)
      and (p_date_to   is null or i.issue_date <= p_date_to)
  ),
  ordered as (
    select *
    from scoped
    order by issue_date desc, fy_sequence desc, created_at desc
  ),
  paged as (
    select *
    from ordered
    limit p_limit offset p_offset
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',               p.id,
          'invoice_number',   p.invoice_number,
          'fy_year',          p.fy_year,
          'issue_date',       p.issue_date,
          'total_paise',      p.total_paise,
          'status',           p.status,
          'account_id',       p.account_id,
          'account_name',     p.account_name_snap,
          'issuer_entity_id', p.issuer_entity_id,
          'issuer_is_active', p.issuer_entity_id = v_active_issuer,
          'pdf_r2_key',       p.pdf_r2_key
        )
        order by p.issue_date desc, p.fy_sequence desc, p.created_at desc
      ),
      '[]'::jsonb
    ),
    (select count(*)::int from scoped)
  into v_rows, v_total
  from paged p;

  return jsonb_build_object(
    'rows',   v_rows,
    'total',  v_total,
    'limit',  p_limit,
    'offset', p_offset
  );
end;
$$;

revoke all on function admin.billing_invoice_search(text, uuid, date, date, integer, integer) from public;
grant execute on function admin.billing_invoice_search(text, uuid, date, date, integer, integer)
  to cs_admin, authenticated;

comment on function admin.billing_invoice_search(text, uuid, date, date, integer, integer) is
  'ADR-0050 Sprint 3.1. Paged invoice search within caller scope (operator → active issuer; owner → all). Filters: q (invoice_number prefix), account_id, date range.';
