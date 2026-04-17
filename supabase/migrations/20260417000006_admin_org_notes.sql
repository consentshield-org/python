-- ADR-0027 Sprint 2.1 — admin.org_notes.
--
-- Free-form admin notes per organisation, pinnable for visibility on the
-- Organisations panel. Admin-only — customer never sees these.
--
-- Per docs/admin/architecture/consentshield-admin-schema.md §3.8.

create table admin.org_notes (
  id              uuid        primary key default gen_random_uuid(),
  org_id          uuid        not null references public.organisations(id) on delete cascade,
  admin_user_id   uuid        not null references admin.admin_users(id),
  body            text        not null,
  pinned          boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index org_notes_org_idx on admin.org_notes (org_id, pinned desc, created_at desc);

alter table admin.org_notes enable row level security;

create policy org_notes_admin on admin.org_notes
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

grant select on admin.org_notes to authenticated;

-- Verification:
--   select count(*) from pg_policies where schemaname='admin' and tablename='org_notes'; → 1
