-- ADR-1003 Sprint 3.1 — zero-storage hot-row TTL refresh.
--
-- Sprint 1.3 wrote consent_artefact_index rows with a 24h TTL for
-- zero_storage orgs. Sprint 3.1 ships the mechanism that keeps
-- "hot" rows (verified in the last hour) alive, while letting cold
-- rows expire naturally.
--
-- Architectural amendment vs the original ADR-1003 Sprint 3.1
-- proposal:
--
--   The ADR proposed "on read, if entry stale, fetch from customer
--   storage and repopulate". That is incompatible with ADR-1003
--   Sprint 2.1's scope-down invariant — ConsentShield's BYOK
--   credential has PutObject only, NOT GetObject / ListBucket /
--   DeleteObject. We cannot read from the customer's bucket, by
--   design. Attempting to do so would either (a) require relaxing
--   the scope-down invariant, defeating the audit-record
--   immutability guarantee, or (b) require a customer-side
--   infrastructure component (e.g. a Cloudflare Worker that re-signs
--   GET requests for us), which is a larger design decision.
--
-- Sprint 3.1 instead delivers the narrower, architecturally
-- coherent primitive: extend the TTL for rows that are proven hot by
-- recent verify traffic. Cold rows expire → verify returns
-- `never_consented` → the customer is the authoritative source and
-- can re-hydrate by replaying the consent record through
-- /v1/consent/record (Mode B) if they need to restore the cache.
--
-- ═══════════════════════════════════════════════════════════
-- 1/5 · Add last_verified_at column + partial index.
-- ═══════════════════════════════════════════════════════════

alter table public.consent_artefact_index
  add column if not exists last_verified_at timestamptz;

comment on column public.consent_artefact_index.last_verified_at is
  'ADR-1003 Sprint 3.1 — timestamp of the most recent /v1/consent/verify '
  'hit that returned "granted". NULL for rows that have never been '
  'verified. The refresh_zero_storage_index_hot_rows() cron uses this '
  'column to decide whether to extend expires_at: rows with '
  'last_verified_at > now() - 1h are "hot" and their TTL is bumped '
  'another 24h; cold rows expire naturally.';

-- Partial index supports the hot-row query efficiently: only active
-- rows that have ever been verified, ordered by last_verified_at.
-- No partial predicate on storage_mode — that's per-org via a join.
create index if not exists idx_consent_artefact_index_hot_rows
  on public.consent_artefact_index (org_id, last_verified_at desc)
  where validity_state = 'active'
    and last_verified_at is not null;

-- ═══════════════════════════════════════════════════════════
-- 2/5 · rpc_consent_verify — stamp last_verified_at on granted hit.
-- ═══════════════════════════════════════════════════════════
-- Identical in every other respect to ADR-1009 Sprint 1.2's version
-- (migration 20260801000005). The only change is a non-blocking
-- UPDATE of last_verified_at when the resolved status is 'granted'.
-- UPDATE is idempotent; a storm of concurrent verify calls for the
-- same row converges on the same now() value within a second.

create or replace function public.rpc_consent_verify(
  p_key_id          uuid,
  p_org_id          uuid,
  p_property_id     uuid,
  p_identifier      text,
  p_identifier_type text,
  p_purpose_code    text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_hash         text;
  v_row          public.consent_artefact_index%rowtype;
  v_status       text;
  v_evaluated_at timestamptz := now();
begin
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  if not exists (
    select 1 from public.web_properties
     where id = p_property_id and org_id = p_org_id
  ) then
    raise exception 'property_not_found' using errcode = 'P0001';
  end if;

  v_hash := public.hash_data_principal_identifier(p_org_id, p_identifier, p_identifier_type);

  select *
    into v_row
    from public.consent_artefact_index
   where org_id         = p_org_id
     and property_id    = p_property_id
     and identifier_hash = v_hash
     and purpose_code   = p_purpose_code
   order by case validity_state
              when 'active'  then 0
              when 'expired' then 1
              when 'revoked' then 2
              else 3
            end,
            created_at desc
   limit 1;

  if not found then
    return jsonb_build_object(
      'property_id',         p_property_id,
      'identifier_type',     p_identifier_type,
      'purpose_code',        p_purpose_code,
      'status',              'never_consented',
      'active_artefact_id',  null,
      'revoked_at',          null,
      'revocation_record_id', null,
      'expires_at',          null,
      'evaluated_at',        v_evaluated_at
    );
  end if;

  if v_row.validity_state = 'revoked' then
    v_status := 'revoked';
  elsif v_row.validity_state = 'expired' then
    v_status := 'expired';
  elsif v_row.validity_state = 'active' and v_row.expires_at is not null and v_row.expires_at < v_evaluated_at then
    v_status := 'expired';
  else
    v_status := 'granted';
  end if;

  -- ADR-1003 Sprint 3.1 — stamp last_verified_at on granted hits so
  -- the refresh cron can tell hot rows from cold. Unconditional
  -- UPDATE (not filtered by storage_mode) — the extra cost is one
  -- row UPDATE per granted verify; for non-zero_storage orgs the
  -- column is just extra metadata.
  if v_status = 'granted' then
    update public.consent_artefact_index
       set last_verified_at = v_evaluated_at
     where id = v_row.id;
  end if;

  return jsonb_build_object(
    'property_id',         p_property_id,
    'identifier_type',     p_identifier_type,
    'purpose_code',        p_purpose_code,
    'status',              v_status,
    'active_artefact_id',  case when v_status = 'granted' then v_row.artefact_id else null end,
    'revoked_at',          v_row.revoked_at,
    'revocation_record_id', v_row.revocation_record_id,
    'expires_at',          v_row.expires_at,
    'evaluated_at',        v_evaluated_at
  );
end;
$$;

-- Grants unchanged — cs_api already holds execute from ADR-1009
-- Phase 2 (migration 20260801000008). CREATE OR REPLACE preserves
-- existing grants.

comment on function public.rpc_consent_verify(uuid, uuid, uuid, text, text, text) is
  'ADR-1009 Sprint 1.2 + ADR-1003 Sprint 3.1. Returns consent status '
  'for an (org, property, identifier, purpose) tuple. On a granted hit, '
  'stamps last_verified_at = now() so the hot-row refresh cron can '
  'extend TTL for actively-queried zero_storage rows.';

-- ═══════════════════════════════════════════════════════════
-- 3/5 · rpc_consent_verify_batch — stamp last_verified_at on granted
--       hits. Single UPDATE at the end keyed by artefact_ids.
-- ═══════════════════════════════════════════════════════════

create or replace function public.rpc_consent_verify_batch(
  p_key_id          uuid,
  p_org_id          uuid,
  p_property_id     uuid,
  p_identifier_type text,
  p_purpose_code    text,
  p_identifiers     text[]
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_hashes         text[];
  v_evaluated_at   timestamptz := now();
  v_results        jsonb;
  v_count          int;
  v_granted_ids    uuid[];
begin
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  if p_identifiers is null then
    raise exception 'identifiers_empty' using errcode = '22023';
  end if;

  v_count := coalesce(array_length(p_identifiers, 1), 0);

  if v_count = 0 then
    raise exception 'identifiers_empty' using errcode = '22023';
  end if;

  if v_count > 10000 then
    raise exception 'identifiers_too_large: % > 10000', v_count using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.web_properties
     where id = p_property_id and org_id = p_org_id
  ) then
    raise exception 'property_not_found' using errcode = 'P0001';
  end if;

  select array_agg(
           public.hash_data_principal_identifier(p_org_id, t.ident, p_identifier_type)
           order by t.ord
         )
    into v_hashes
    from unnest(p_identifiers) with ordinality as t(ident, ord);

  with input as (
    select ord, p_identifiers[ord] as identifier, v_hashes[ord] as hash
      from generate_series(1, v_count) as ord
  ),
  resolved as (
    select
      input.ord,
      input.identifier,
      best.id            as index_id,
      best.artefact_id,
      best.validity_state,
      best.revoked_at,
      best.revocation_record_id,
      best.expires_at
    from input
    left join lateral (
      select id, artefact_id, validity_state, revoked_at, revocation_record_id, expires_at
        from public.consent_artefact_index r
       where r.org_id          = p_org_id
         and r.property_id     = p_property_id
         and r.identifier_hash = input.hash
         and r.purpose_code    = p_purpose_code
       order by case r.validity_state
                  when 'active'  then 0
                  when 'expired' then 1
                  when 'revoked' then 2
                  else 3
                end,
                r.created_at desc
       limit 1
    ) best on true
  )
  select jsonb_agg(
           jsonb_build_object(
             'identifier',         identifier,
             'status',
               case
                 when validity_state is null                                          then 'never_consented'
                 when validity_state = 'revoked'                                      then 'revoked'
                 when validity_state = 'expired'                                      then 'expired'
                 when validity_state = 'active'
                  and expires_at is not null
                  and expires_at < v_evaluated_at                                     then 'expired'
                 else 'granted'
               end,
             'active_artefact_id',
               case
                 when validity_state = 'active'
                  and (expires_at is null or expires_at >= v_evaluated_at)            then artefact_id
                 else null
               end,
             'revoked_at',           revoked_at,
             'revocation_record_id', revocation_record_id,
             'expires_at',           expires_at
           )
           order by ord
         ),
         array_agg(
           index_id
         ) filter (
           where validity_state = 'active'
             and (expires_at is null or expires_at >= v_evaluated_at)
         )
    into v_results, v_granted_ids
    from resolved;

  -- Single UPDATE covers every granted row in the batch.
  if v_granted_ids is not null and array_length(v_granted_ids, 1) > 0 then
    update public.consent_artefact_index
       set last_verified_at = v_evaluated_at
     where id = any(v_granted_ids);
  end if;

  return jsonb_build_object(
    'property_id',     p_property_id,
    'identifier_type', p_identifier_type,
    'purpose_code',    p_purpose_code,
    'evaluated_at',    v_evaluated_at,
    'results',         coalesce(v_results, '[]'::jsonb)
  );
end;
$$;

comment on function public.rpc_consent_verify_batch(uuid, uuid, uuid, text, text, text[]) is
  'ADR-1009 Sprint 1.2 + ADR-1003 Sprint 3.1. Batch variant of '
  'rpc_consent_verify. Single end-of-batch UPDATE stamps '
  'last_verified_at on every granted row.';

-- ═══════════════════════════════════════════════════════════
-- 4/5 · refresh_zero_storage_index_hot_rows() + grants.
-- ═══════════════════════════════════════════════════════════
-- Extends expires_at for rows where:
--   · the org is zero_storage
--   · validity_state = 'active'
--   · last_verified_at was set in the last hour (hot)
--   · expires_at is within the next hour (about to expire; no point
--     bumping rows that still have > 1h of life)
--
-- Returns a jsonb envelope for the cron log. Non-throwing — any
-- transient error (e.g., a briefly unreachable row lock) is left for
-- the next hourly run.

create or replace function public.refresh_zero_storage_index_hot_rows()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_refreshed_count int := 0;
  v_ran_at          timestamptz := now();
begin
  with zero_storage_orgs as (
    select id from public.organisations
     where coalesce(storage_mode, 'standard') = 'zero_storage'
  ),
  updated as (
    update public.consent_artefact_index cai
       set expires_at = v_ran_at + interval '24 hours'
      from zero_storage_orgs zs
     where cai.org_id = zs.id
       and cai.validity_state = 'active'
       and cai.last_verified_at is not null
       and cai.last_verified_at > v_ran_at - interval '1 hour'
       and cai.expires_at < v_ran_at + interval '1 hour'
     returning cai.id
  )
  select count(*) into v_refreshed_count from updated;

  return jsonb_build_object(
    'ok',               true,
    'refreshed_count',  v_refreshed_count,
    'ran_at',           v_ran_at
  );
end;
$$;

revoke all on function public.refresh_zero_storage_index_hot_rows() from public;
grant execute on function public.refresh_zero_storage_index_hot_rows() to cs_orchestrator;

comment on function public.refresh_zero_storage_index_hot_rows() is
  'ADR-1003 Sprint 3.1 — hot-row TTL refresh for zero_storage orgs. '
  'Called hourly via pg_cron. Extends expires_at by 24h for active '
  'index rows whose last_verified_at is within the last hour AND '
  'whose expires_at is within the next hour. Cold rows (never verified '
  'OR verified > 1h ago) expire naturally. No customer-bucket read is '
  'attempted — the scope-down invariant (Sprint 2.1) makes that '
  'impossible; cold-expired rows re-enter the cache only via customer-'
  'driven /v1/consent/record replays.';

-- ═══════════════════════════════════════════════════════════
-- 5/5 · pg_cron 'refresh-zero-storage-index' every hour at :15.
-- ═══════════════════════════════════════════════════════════
-- :15 so it doesn't collide with the :00 backlog-metrics cron
-- (ADR-1019 Sprint 4.1) or the every-minute storage-mode-kv-sync
-- (Sprint 1.1).

do $$
begin
  perform cron.unschedule('refresh-zero-storage-index');
  exception when others then null;
end $$;

select cron.schedule(
  'refresh-zero-storage-index',
  '15 * * * *',
  $$select public.refresh_zero_storage_index_hot_rows();$$
);

-- ═══════════════════════════════════════════════════════════
-- Verification (after `bunx supabase db push`):
-- ═══════════════════════════════════════════════════════════
--
--   -- Column present + backfilled to null.
--   select count(*) from public.consent_artefact_index where last_verified_at is not null;
--     → 0 initially; rises as verify traffic lands.
--
--   -- Cron registered.
--   select jobname, schedule, active from cron.job
--    where jobname = 'refresh-zero-storage-index';
--     → 1 row, '15 * * * *', active = true.
--
--   -- Ad-hoc dry-run.
--   select public.refresh_zero_storage_index_hot_rows();
--     → { ok: true, refreshed_count: N, ran_at: '<now>' }.
