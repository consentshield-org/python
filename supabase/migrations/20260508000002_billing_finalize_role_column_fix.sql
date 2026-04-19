-- ADR-0050 Sprint 2.2 follow-up — column-name fix on billing_finalize_*.
--
-- 20260508000001 referenced admin.admin_users.role; the actual column is
-- admin.admin_users.admin_role (per 20260416000014_admin_users.sql). This
-- migration re-creates billing_finalize_invoice_pdf and
-- billing_stamp_invoice_email with the correct column.

create or replace function admin.billing_finalize_invoice_pdf(
  p_invoice_id    uuid,
  p_pdf_r2_key    text,
  p_pdf_sha256    text
)
returns void
language plpgsql
security definer
set search_path = admin, public, billing, pg_catalog
as $$
declare
  v_operator       uuid := auth.uid();
  v_role           text;
  v_invoice        public.invoices%rowtype;
  v_active_issuer  uuid;
begin
  perform admin.require_admin('platform_operator');

  if p_invoice_id is null then
    raise exception 'invoice_id required' using errcode = '22023';
  end if;
  if coalesce(length(p_pdf_r2_key), 0) = 0 then
    raise exception 'pdf_r2_key required' using errcode = '22023';
  end if;
  if coalesce(length(p_pdf_sha256), 0) <> 64 then
    raise exception 'pdf_sha256 must be a 64-character hex digest' using errcode = '22023';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found: %', p_invoice_id using errcode = '22023';
  end if;
  if v_invoice.status <> 'draft' then
    raise exception 'Invoice % is already % — only drafts can be finalized', p_invoice_id, v_invoice.status
      using errcode = '22023';
  end if;

  select admin_role into v_role from admin.admin_users where id = v_operator;
  if v_role = 'platform_operator' then
    select id into v_active_issuer from billing.issuer_entities where is_active = true;
    if v_invoice.issuer_entity_id is distinct from v_active_issuer then
      raise exception 'Invoice belongs to a non-active issuer — finalization requires platform_owner'
        using errcode = '42501';
    end if;
  end if;

  update public.invoices
    set status     = 'issued',
        issued_at  = now(),
        pdf_r2_key = p_pdf_r2_key,
        pdf_sha256 = p_pdf_sha256
    where id = p_invoice_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'billing_finalize_invoice_pdf', 'public.invoices', p_invoice_id, null,
     jsonb_build_object('status', 'draft'),
     jsonb_build_object(
       'status', 'issued',
       'pdf_r2_key', p_pdf_r2_key,
       'pdf_sha256', p_pdf_sha256
     ),
     'invoice issued');
end;
$$;

create or replace function admin.billing_stamp_invoice_email(
  p_invoice_id       uuid,
  p_email_message_id text
)
returns void
language plpgsql
security definer
set search_path = admin, public, billing, pg_catalog
as $$
declare
  v_operator       uuid := auth.uid();
  v_role           text;
  v_invoice        public.invoices%rowtype;
  v_active_issuer  uuid;
begin
  perform admin.require_admin('platform_operator');

  if p_invoice_id is null then
    raise exception 'invoice_id required' using errcode = '22023';
  end if;
  if coalesce(length(p_email_message_id), 0) = 0 then
    raise exception 'email_message_id required' using errcode = '22023';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found: %', p_invoice_id using errcode = '22023';
  end if;
  if v_invoice.status = 'draft' then
    raise exception 'Invoice % is still draft — finalize the PDF first', p_invoice_id
      using errcode = '22023';
  end if;

  select admin_role into v_role from admin.admin_users where id = v_operator;
  if v_role = 'platform_operator' then
    select id into v_active_issuer from billing.issuer_entities where is_active = true;
    if v_invoice.issuer_entity_id is distinct from v_active_issuer then
      raise exception 'Invoice belongs to a non-active issuer — operation requires platform_owner'
        using errcode = '42501';
    end if;
  end if;

  update public.invoices
    set email_message_id = p_email_message_id
    where id = p_invoice_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'billing_stamp_invoice_email', 'public.invoices', p_invoice_id, null,
     jsonb_build_object('email_message_id', v_invoice.email_message_id),
     jsonb_build_object('email_message_id', p_email_message_id),
     'invoice email dispatched');
end;
$$;
