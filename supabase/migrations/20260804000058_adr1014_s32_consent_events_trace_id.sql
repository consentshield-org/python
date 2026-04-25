-- ADR-1014 Sprint 3.2 closeout — consent_events.trace_id column.
--
-- Closes the only remaining `[~]` partial in ADR-1014: Sprint 3.2's
-- "Banner → Worker HMAC → buffer → delivery → R2" pipeline test had
-- no way to correlate a single event across the four hops because the
-- buffer table didn't carry a trace identifier. The Worker now reads
-- `X-CS-Trace-Id` from the inbound POST (or generates one if absent),
-- writes it onto the consent_events row, and echoes it back via the
-- response header so the test harness can stitch the four hops
-- together by trace_id.
--
-- Properties:
--   · Nullable + opt-in. Pre-trace-id rows stay valid (no backfill
--     needed). Future producers that don't set the header land NULL.
--   · Free-form text (no UUID/ULID format check at the DB layer).
--     The Worker generates 16-char hex by default but partners can
--     send anything stringy; the column accepts whatever they send.
--   · Indexed only WHERE trace_id IS NOT NULL — the partial-index
--     pattern matches the existing `delivered_at` indexes on this
--     table and keeps the unindexed bulk of pre-trace-id history
--     out of the index pages.
--   · No RLS change required — consent_events RLS already filters
--     on org_id / property_id; adding a column doesn't change
--     visibility.
--   · No grant change required — cs_worker already has INSERT on
--     consent_events; the new column inherits the grant.

alter table public.consent_events
  add column if not exists trace_id text;

comment on column public.consent_events.trace_id is
  'ADR-1014 Sprint 3.2. Opt-in opaque trace identifier the Worker '
  'reads from the X-CS-Trace-Id request header (or generates if '
  'absent) and echoes back in the response. Lets E2E suites correlate '
  'a single event across banner → Worker → buffer → delivery → R2 hops.';

create index if not exists idx_consent_events_trace_id
  on public.consent_events (trace_id)
  where trace_id is not null;

-- ───────────────────────────────────────────────────────────
-- Verification (Section 9 pattern from the schema doc)
-- ───────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'consent_events'
       and column_name  = 'trace_id'
       and data_type    = 'text'
       and is_nullable  = 'YES'
  ) then
    raise exception 'ADR-1014 Sprint 3.2: trace_id column missing or wrong shape';
  end if;
  if not exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename  = 'consent_events'
       and indexname  = 'idx_consent_events_trace_id'
  ) then
    raise exception 'ADR-1014 Sprint 3.2: trace_id partial index missing';
  end if;
end$$;
