-- ADR-0020 Sprint 1.1 — DEPA helper functions.
--
-- Part 1 of 9: the two DEPA §11.2 helpers that do NOT call net.http_post.
-- Dispatch-firing functions (trigger_process_consent_event,
-- trigger_process_artefact_revocation, safety_net_process_consent_events)
-- are deferred to ADR-0021/0022.
-- Expiry-pipeline functions (send_expiry_alerts, enforce_artefact_expiry)
-- are deferred to ADR-0023.
--
-- Per `docs/architecture/consentshield-complete-schema-design.md` §11.2.
--
-- Function bodies reference tables that do not exist at this migration's
-- apply time (purpose_definitions, consent_artefacts, artefact_revocations,
-- deletion_receipts.artefact_id). plpgsql validates bodies at first
-- execution, not at CREATE time, so this is safe as long as downstream
-- migrations (000002..000008) land before the functions are invoked.

-- ═══════════════════════════════════════════════════════════
-- generate_artefact_id() — stable, time-sortable external ID.
-- Format: 'cs_art_' (7 chars) + 10 time-derived + 16 random = 33 chars.
-- Stored as text so time-ordered retrieval doesn't need a created_at
-- index on large artefact tables.
-- ═══════════════════════════════════════════════════════════
create or replace function generate_artefact_id()
returns text language plpgsql as $$
declare
  t bigint;
  r text := '';
  chars text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  i int;
begin
  t := extract(epoch from now()) * 1000;
  for i in 1..10 loop
    r := substring(chars from (t % 32)::int + 1 for 1) || r;
    t := t / 32;
  end loop;
  for i in 1..16 loop
    r := r || substring(chars from (floor(random() * 32))::int + 1 for 1);
  end loop;
  return 'cs_art_' || r;
end;
$$;

comment on function generate_artefact_id() is
  'Generates a 33-character external artefact id: cs_art_ prefix + 10-char '
  'time-derived + 16-char random. Used as the default for '
  'consent_artefacts.artefact_id.';

-- ═══════════════════════════════════════════════════════════
-- compute_depa_score(p_org_id uuid) — returns a 0–20 DEPA quality score
-- as jsonb {total, coverage_score, expiry_score, freshness_score,
-- revocation_score, computed_at}. Called by the depa-score-refresh-nightly
-- cron job (scheduled in ADR-0025).
--
-- SECURITY DEFINER so the function owner's privileges apply; this lets
-- the score query cross RLS boundaries safely — the function accepts an
-- org_id argument and scopes every query to it.
-- ═══════════════════════════════════════════════════════════
create or replace function compute_depa_score(p_org_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_coverage_score   numeric;
  v_expiry_score     numeric;
  v_freshness_score  numeric;
  v_revocation_score numeric;
  v_total            numeric;
begin
  -- Sub-metric 1: Artefact coverage — % of active purpose_definitions
  -- with a populated data_scope.
  select case
    when count(*) = 0 then 0
    else round((count(*) filter (where array_length(data_scope, 1) > 0)::numeric / count(*)) * 5, 1)
  end
  into v_coverage_score
  from purpose_definitions
  where org_id = p_org_id and is_active = true;

  -- Sub-metric 2: Expiry definition — % of active purpose_definitions with
  -- an explicitly set expiry (not the 365-day system default).
  select case
    when count(*) = 0 then 0
    else round((count(*) filter (where default_expiry_days != 365)::numeric / count(*)) * 5, 1)
  end
  into v_expiry_score
  from purpose_definitions
  where org_id = p_org_id and is_active = true;

  -- Sub-metric 3: Artefact freshness — % of active artefacts that expire
  -- more than 90 days in the future.
  select case
    when count(*) = 0 then 5
    else round((count(*) filter (where expires_at > now() + interval '90 days')::numeric / count(*)) * 5, 1)
  end
  into v_freshness_score
  from consent_artefacts
  where org_id = p_org_id and status = 'active';

  -- Sub-metric 4: Revocation chain completeness — % of recent revocations
  -- with a confirmed deletion_receipt within 30 days.
  select case
    when count(*) = 0 then 5
    else round((count(dr.id)::numeric / count(ar.id)) * 5, 1)
  end
  into v_revocation_score
  from artefact_revocations ar
  left join deletion_receipts dr
    on dr.artefact_id = ar.artefact_id
   and dr.status = 'completed'
   and dr.created_at < ar.revoked_at + interval '30 days'
  where ar.org_id = p_org_id
    and ar.revoked_at > now() - interval '90 days';

  v_total := coalesce(v_coverage_score, 0)
           + coalesce(v_expiry_score, 0)
           + coalesce(v_freshness_score, 0)
           + coalesce(v_revocation_score, 0);

  return jsonb_build_object(
    'total',             v_total,
    'coverage_score',    v_coverage_score,
    'expiry_score',      v_expiry_score,
    'freshness_score',   v_freshness_score,
    'revocation_score',  v_revocation_score,
    'computed_at',       now()
  );
end;
$$;

comment on function compute_depa_score(uuid) is
  'Computes the four DEPA sub-scores and total for an organisation. '
  'Returns jsonb with keys total (0-20), coverage_score, expiry_score, '
  'freshness_score, revocation_score (each 0-5), computed_at. Scheduled '
  'nightly by the depa-score-refresh-nightly cron job (ADR-0025).';

-- Grants — authenticated needs compute_depa_score to render the dashboard
-- score panel (ADR-0025). cs_orchestrator needs it to run the nightly
-- refresh. generate_artefact_id runs only inside INSERTs via the column
-- default, so no explicit grants are needed.
grant execute on function compute_depa_score(uuid) to authenticated, cs_orchestrator;

-- Verification (§11.11 query 8, 12):
--   select generate_artefact_id() like 'cs_art_%' as has_prefix,
--          length(generate_artefact_id()) as id_length;
--     → has_prefix = true, id_length = 33
--
-- compute_depa_score cannot be verified until the new tables and the
-- §11.3 deletion_receipts.artefact_id column exist. See §11.11 query 12;
-- run after migration 20260418000008 applies.
