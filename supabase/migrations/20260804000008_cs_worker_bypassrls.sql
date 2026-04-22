-- ADR-1010 Phase 2 Sprint 2.1 — grant BYPASSRLS to cs_worker.
--
-- cs_worker uses column-level GRANTs as its authoritative fence (INSERT
-- on consent_events / tracker_observations / worker_errors; SELECT on
-- consent_banners / web_properties; UPDATE on web_properties
-- .snippet_last_seen_at only). Additional RLS on those tables currently
-- references auth.jwt() via public.current_org_id(), which cs_worker
-- cannot call (no USAGE on schema auth). The existing PostgREST path
-- sidestepped this because SUPABASE_WORKER_KEY resolves to the service
-- role, which has BYPASSRLS implicitly.
--
-- The ADR-1010 migration replaces the service-role shortcut with a
-- proper cs_worker direct-Postgres connection. For that to work, cs_worker
-- needs BYPASSRLS, matching the pattern established for cs_orchestrator
-- and cs_delivery (both of which have rolbypassrls = true).
--
-- Attack-surface impact: near-zero. cs_worker's column-level grant set
-- is already the minimum-privilege definition. BYPASSRLS lets it skip
-- RLS evaluation but does not broaden which tables/columns it can touch.

alter role cs_worker bypassrls;

comment on role cs_worker is
  'ADR-1010 Phase 2 — Cloudflare Worker scoped role. BYPASSRLS enabled '
  '2026-04-22: authoritative fence is the column-level grant set '
  '(INSERT consent_events/tracker_observations/worker_errors; SELECT '
  'consent_banners/web_properties; UPDATE web_properties.snippet_last_seen_at). '
  'No USAGE on schema auth by design.';
