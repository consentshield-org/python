-- ADR-1017 follow-up — add readiness-flag rows for the deferred internal
-- sprints surfaced during the 2026-04-22 session so the ops console
-- reflects every pending item, not just external blockers.
--
-- blocker_type='other' covers deferred-internal-work that isn't a
-- legal / partner / infra / contract / hiring concern. These are
-- tracked here so they don't fall off the back of session handoffs
-- when Terminal B rotates tasks; resolving them is pure code.

insert into admin.ops_readiness_flags (
  title, description, source_adr, blocker_type, severity, status, owner
) values
  (
    'ADR-1017 Sprint 1.3 — tests + runbook for ops_readiness_flags',
    'Sprint 1.3 was deferred when Sprints 1.1 + 1.2 shipped 2026-04-22. '
    'Outstanding deliverables: (1) unit/integration tests on '
    'admin.list_ops_readiness_flags() + admin.set_ops_readiness_flag_status() '
    '— role-gating (support vs platform_operator/owner), audit-log row '
    'emission, invalid-status rejection. (2) docs/runbooks/ops-readiness-flags.md '
    '— how to add new flags, blocker_type semantics, manual resolution flow. '
    'Pure code; no external blocker.',
    'ADR-1017 Sprint 1.3',
    'other',
    'low',
    'pending',
    'claude-code (Terminal B)'
  ),
  (
    'ADR-1018 Sprint 1.4 — status-page probe cron + Edge Function',
    'Schema + admin panel + public page shipped 2026-04-22; automated '
    'probes still to wire. Build supabase/functions/run-status-probes '
    'iterating public.status_subsystems, hitting each health_url, '
    'inserting public.status_checks rows; 3 consecutive fails flip '
    'current_state operational -> degraded -> down. Register pg_cron '
    '`*/5 * * * *` via net.http_post (same pattern as send-sla-reminders). '
    'Until this ships, subsystem state is operator-maintained only via '
    'admin panel — which is adequate for real incident comms but not for '
    'automated uptime proof.',
    'ADR-1018 Sprint 1.4',
    'other',
    'medium',
    'pending',
    'claude-code (Terminal B)'
  ),
  (
    'ADR-1018 Sprint 1.5 — status.consentshield.in DNS + Vercel alias',
    'Public page already renders at app.consentshield.in/status. This '
    'sprint is the DNS cutover: add CNAME status.consentshield.in -> '
    'cname.vercel-dns.com; add status.consentshield.in as an alias on '
    'the app Vercel project; wire host-based rewrite so '
    'status.consentshield.in/* resolves to /status/* (via vercel.ts or '
    'middleware — Option A in docs/runbooks/status-page-setup.md §3). '
    'Operator step; claude-code can execute with operator confirmation '
    'but the DNS record lives outside the code repo.',
    'ADR-1018 Sprint 1.5',
    'infra',
    'medium',
    'pending',
    'Sudhindra / claude-code'
  );
