-- ADR-1004 Phase 2 Sprints 2.2 + 2.3 are blocked on wireframes per the
-- project's wireframes-before-ADRs rule. Track them on the operator
-- console so they do not fall off the back of session handoffs.
--
-- Idempotent — `on conflict do nothing` via title uniqueness would
-- require an index; we use a DO NOT RE-INSERT check on source_adr +
-- title.

insert into admin.ops_readiness_flags (
  title, description, source_adr, blocker_type, severity, status, owner
)
select * from (values
  (
    'ADR-1004 Phase 2 Sprint 2.2 — /dashboard/notices UI + material-change + CSV export',
    'Schema landed 2026-04-22 via migration 20260804000024 + publish RPC fix in '
    '20260804000025 (notices table, append-only, consent_events.notice_version FK, '
    'publish_notice auto-versioning). UI is the next step: `/dashboard/notices` list + '
    'publish form + material_change_flag toggle, affected-artefact badge, and CSV '
    'export of (identifier, email, last_consent_date, purposes_affected). Blocked '
    'on wireframes per the feedback_wireframes_before_adrs rule. Author wireframes in '
    '`docs/design/screen designs and ux/` first; then resolve this flag and build.',
    'ADR-1004 Phase 2 Sprint 2.2',
    'other',
    'medium',
    'pending',
    'Sudhindra (design) then claude-code (impl)'
  ),
  (
    'ADR-1004 Phase 2 Sprint 2.3 — replaced_by chain + reconsent_campaigns tracking UI',
    'Depends on Sprint 2.2 shipping first. New work: (a) record-consent + '
    '/v1/consent/record writers observe `notice_version` on incoming events and, when '
    'a principal has an active artefact on an older version, populate '
    'consent_artefacts.replaced_by on the old artefact + set status=''replaced''; '
    '(b) `public.reconsent_campaigns` table tracking (notice_id, affected_count, '
    'responded_count, revoked_count, no_response_count) updated nightly by pg_cron; '
    '(c) `/dashboard/notices/[id]/campaign` UI with time-series counts. UI is blocked '
    'on the same wireframes dependency as Sprint 2.2.',
    'ADR-1004 Phase 2 Sprint 2.3',
    'other',
    'medium',
    'pending',
    'Sudhindra (design) then claude-code (impl)'
  )
) as v(title, description, source_adr, blocker_type, severity, status, owner)
where not exists (
  select 1 from admin.ops_readiness_flags f
   where f.source_adr = v.source_adr
);
