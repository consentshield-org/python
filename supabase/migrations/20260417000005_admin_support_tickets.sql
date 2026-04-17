-- ADR-0027 Sprint 2.1 — admin.support_tickets + admin.support_ticket_messages.
--
-- Ticket + message thread backing the customer-facing support flow and
-- the admin Support Tickets panel. Customer-side ticket creation flows
-- through a public endpoint that calls admin.create_support_ticket()
-- (Sprint 3.1) — customers never query admin.support_tickets directly.
--
-- Per docs/admin/architecture/consentshield-admin-schema.md §3.7.

create table admin.support_tickets (
  id                       uuid        primary key default gen_random_uuid(),
  org_id                   uuid        references public.organisations(id),
  subject                  text        not null,
  status                   text        not null default 'open' check (status in ('open','awaiting_customer','awaiting_operator','resolved','closed')),
  priority                 text        not null default 'normal' check (priority in ('low','normal','high','urgent')),
  category                 text,
  assigned_admin_user_id   uuid        references admin.admin_users(id),
  reporter_email           text        not null,
  reporter_name            text,
  created_at               timestamptz not null default now(),
  resolved_at              timestamptz,
  resolution_summary       text
);

create table admin.support_ticket_messages (
  id           uuid        primary key default gen_random_uuid(),
  ticket_id    uuid        not null references admin.support_tickets(id) on delete cascade,
  author_kind  text        not null check (author_kind in ('admin','customer','system')),
  author_id    uuid,
  body         text        not null,
  attachments  jsonb,
  created_at   timestamptz not null default now()
);

create index support_tickets_status_idx
  on admin.support_tickets (status, priority desc, created_at desc)
  where status not in ('resolved','closed');
create index support_tickets_org_idx
  on admin.support_tickets (org_id, created_at desc)
  where org_id is not null;
create index support_ticket_messages_ticket_idx
  on admin.support_ticket_messages (ticket_id, created_at);

alter table admin.support_tickets enable row level security;
alter table admin.support_ticket_messages enable row level security;

create policy support_tickets_admin on admin.support_tickets
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

create policy support_ticket_messages_admin on admin.support_ticket_messages
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

grant select on admin.support_tickets, admin.support_ticket_messages to authenticated;

-- Verification:
--   select count(*) from pg_policies where schemaname='admin'
--     and tablename in ('support_tickets','support_ticket_messages'); → 2
