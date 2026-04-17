-- ADR-0020 Sprint 1.1 — DEPA purpose_connector_mappings table.
--
-- Part 3 of 9: links (purpose_definition × data_scope category) to
-- deletion connectors. When an artefact is revoked, this table
-- determines which connectors handle which data categories.
--
-- Per §11.4.2 + §11.5 + §11.6 + §11.7.
--
-- Depends on: purpose_definitions (20260418000002), integration_connectors
-- (pre-existing).

create table purpose_connector_mappings (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  purpose_definition_id uuid not null references purpose_definitions(id) on delete cascade,
  connector_id          uuid not null references integration_connectors(id) on delete cascade,
  data_categories       text[] not null default '{}',
  created_at            timestamptz default now(),
  unique (purpose_definition_id, connector_id)
);

comment on table purpose_connector_mappings is
  'Links purpose data_scope categories to deletion connectors. When an '
  'artefact is revoked, this table determines which connectors handle '
  'which data categories. Without a mapping, the revocation alert fires '
  'but automated deletion cannot execute.';

comment on column purpose_connector_mappings.data_categories is
  'SUBSET of the purpose_definitions.data_scope array. What this '
  'connector is responsible for when handling revocation or expiry '
  'for this purpose.';

-- Indexes (§11.5)
create index idx_pcm_purpose_def on purpose_connector_mappings (purpose_definition_id);
create index idx_pcm_connector   on purpose_connector_mappings (connector_id);

-- RLS (§11.6) — admin-managed. DELETE allowed (unlike purpose_definitions)
-- because mappings are ephemeral wiring, not historical configuration.
alter table purpose_connector_mappings enable row level security;

create policy "pcm_select_own"
  on purpose_connector_mappings for select
  using (org_id = current_org_id());

create policy "pcm_insert_admin"
  on purpose_connector_mappings for insert
  with check (org_id = current_org_id() and is_org_admin());

create policy "pcm_delete_admin"
  on purpose_connector_mappings for delete
  using (org_id = current_org_id() and is_org_admin());

-- Grants (§11.7) — authenticated via RLS; cs_orchestrator reads mappings
-- inside the process-artefact-revocation Edge Function (ADR-0022).
grant select, insert, delete on purpose_connector_mappings to authenticated;
grant select                 on purpose_connector_mappings to cs_orchestrator;
