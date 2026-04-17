-- ADR-0020 Sprint 1.1 — DEPA purpose_definitions table.
--
-- Part 2 of 9: canonical purpose library per organisation. Banners
-- reference purpose_definition_id from their `purposes` JSONB. Artefacts
-- copy data_scope and default_expiry_days from here at creation time
-- (snapshot semantics — editing a purpose_definition does NOT retroactively
-- change existing artefacts).
--
-- Per §11.4.1 + §11.5 + §11.6 + §11.7. Updated_at trigger per §11.8.
--
-- Mutability: admins can edit descriptions + expiry windows; purpose_code
-- is stable (unique per org per framework). Delete is not allowed —
-- deactivate via is_active = false.

create table purpose_definitions (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  purpose_code          text not null,
  display_name          text not null,
  description           text not null,
  data_scope            text[] not null default '{}',
  default_expiry_days   integer not null default 365,
  auto_delete_on_expiry boolean not null default false,
  is_required           boolean not null default false,
  framework             text not null default 'dpdp',
  abdm_hi_types         text[] default null,
  is_active             boolean not null default true,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique (org_id, purpose_code, framework)
);

comment on table purpose_definitions is
  'Canonical purpose library per organisation. Source of truth for what '
  'each purpose means: what data category it covers, how long consent '
  'lasts, and what to delete on revocation. data_scope is a CATEGORY '
  'list (e.g. ''pan'', ''email_address'') — never actual values '
  '(Rule 3 broadened). Do not delete a purpose_definition that has '
  'active consent_artefacts; deactivate via is_active = false instead.';

comment on column purpose_definitions.data_scope is
  'CATEGORY labels only. Never values. Examples: ''pan'', '
  '''email_address'', ''MedicationRequest''. Snapshotted onto '
  'consent_artefacts.data_scope at artefact creation.';

-- Indexes (§11.5)
create index idx_purpose_defs_org
  on purpose_definitions (org_id);
create index idx_purpose_defs_org_framework
  on purpose_definitions (org_id, framework);
create index idx_purpose_defs_code
  on purpose_definitions (org_id, purpose_code);

-- RLS (§11.6) — admin-managed mutable config. Delete is disallowed.
alter table purpose_definitions enable row level security;

create policy "purpose_defs_select_own"
  on purpose_definitions for select
  using (org_id = current_org_id());

create policy "purpose_defs_insert_admin"
  on purpose_definitions for insert
  with check (org_id = current_org_id() and is_org_admin());

create policy "purpose_defs_update_admin"
  on purpose_definitions for update
  using (org_id = current_org_id() and is_org_admin());

-- Grants (§11.7) — authenticated via RLS; cs_orchestrator for Edge
-- Function reads during artefact creation; cs_delivery for delivery-
-- payload assembly. (cs_admin inherits SELECT via default privileges
-- from ADR-0027 Sprint 1.1.)
grant select, insert, update on purpose_definitions to authenticated;
grant select                 on purpose_definitions to cs_orchestrator, cs_delivery;

-- Updated_at trigger (§11.8)
create trigger trg_purpose_defs_updated_at
  before update on purpose_definitions
  for each row execute function set_updated_at();

-- Verification (§11.11 query 9):
--   select count(*) from information_schema.table_constraints
--    where table_name = 'purpose_definitions' and constraint_type = 'UNIQUE';
--     → >= 1
