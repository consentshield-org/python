-- ADR-0032 deviation follow-up — internal operator-to-operator notes on support tickets.
--
-- The wireframe's "Internal note" button (panel §3) was specified but the
-- original schema (migration 20260417000005) modelled only author_kind
-- in (admin, customer, system) with no visibility flag. Without this
-- amendment, any admin-authored reply is customer-visible — which
-- defeats the point of an internal-note channel.
--
-- Amendment:
--   1. Add admin.support_ticket_messages.is_internal boolean default false.
--   2. Update admin.add_support_ticket_message to accept p_is_internal;
--      internal notes skip the status auto-transition (a private note
--      shouldn't nudge the ticket to awaiting_customer).
--   3. Update public.list_support_ticket_messages to filter out internal
--      notes for customer-side callers.

alter table admin.support_ticket_messages
  add column if not exists is_internal boolean not null default false;

-- The existing signature (uuid, text, jsonb) has EXECUTE granted to
-- authenticated via the ADR-0027 Sprint 3.1 dynamic grant migration.
-- We DROP + CREATE to extend the signature; the GRANT is re-issued
-- below.
drop function if exists admin.add_support_ticket_message(uuid, text, jsonb);

create or replace function admin.add_support_ticket_message(
  p_ticket_id uuid,
  p_body text,
  p_attachments jsonb default null,
  p_is_internal boolean default false
) returns uuid
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_msg_id uuid;
  v_ticket admin.support_tickets%rowtype;
begin
  perform admin.require_admin('support');
  if length(coalesce(p_body, '')) = 0 then raise exception 'body required'; end if;
  select * into v_ticket from admin.support_tickets where id = p_ticket_id;
  if v_ticket.id is null then raise exception 'ticket not found'; end if;

  insert into admin.support_ticket_messages
    (ticket_id, author_kind, author_id, body, attachments, is_internal)
  values
    (p_ticket_id, 'admin', v_admin, p_body, p_attachments, p_is_internal)
  returning id into v_msg_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, new_value, reason)
  values
    (v_admin,
     case when p_is_internal then 'add_support_ticket_internal_note'
          else 'add_support_ticket_message' end,
     'admin.support_ticket_messages', v_msg_id, v_ticket.org_id,
     jsonb_build_object('ticket_id', p_ticket_id, 'body_length', length(p_body), 'is_internal', p_is_internal),
     case when p_is_internal then 'operator internal note on ticket'
          else 'operator reply on ticket' end);

  -- Status transition hint — skipped for internal notes so a private
  -- comment doesn't nudge the ticket into awaiting_customer.
  if not p_is_internal then
    update admin.support_tickets
       set status = 'awaiting_customer'
     where id = p_ticket_id and status in ('open','awaiting_operator');
  end if;

  return v_msg_id;
end;
$$;

grant execute on function admin.add_support_ticket_message(uuid, text, jsonb, boolean) to authenticated;

-- Customer-side read helper must filter internal notes out.
create or replace function public.list_support_ticket_messages(p_ticket_id uuid)
returns table (
  id           uuid,
  ticket_id    uuid,
  author_kind  text,
  author_id    uuid,
  body         text,
  created_at   timestamptz
)
language plpgsql
security definer
set search_path = admin, public
as $$
declare
  v_ticket_org uuid;
  v_caller_org uuid := public.current_org_id();
begin
  select t.org_id into v_ticket_org
    from admin.support_tickets t
   where t.id = p_ticket_id;

  if v_ticket_org is null then
    raise exception 'ticket not found';
  end if;

  if v_caller_org is null or v_caller_org <> v_ticket_org then
    raise exception 'forbidden: ticket does not belong to the caller''s org';
  end if;

  return query
    select m.id, m.ticket_id, m.author_kind, m.author_id, m.body, m.created_at
      from admin.support_ticket_messages m
     where m.ticket_id = p_ticket_id
       and m.is_internal = false
     order by m.created_at;
end;
$$;

-- Verification:
--   select count(*) from information_schema.columns
--     where table_schema='admin' and table_name='support_ticket_messages' and column_name='is_internal'; → 1
--   select proargnames from pg_proc
--     where proname='add_support_ticket_message' and pronamespace='admin'::regnamespace; → {p_ticket_id,p_body,p_attachments,p_is_internal}
