-- ADR-0058 Sprint 1.1 — invitations.origin column.
--
-- Distinguishes the three intake patterns that all live in
-- public.invitations. The shape of the row is identical across them;
-- the column is a hint that drives:
--   · email CTA URL routing (intakes → /onboarding, invites → /signup)
--   · email subject + body copy
--   · admin / analytics filtering
--
-- Variants:
--   operator_invite   admin invites someone INTO an existing org
--                     (account_id + org_id set). Existing default.
--   operator_intake   admin creates a NEW account for a contracted
--                     customer (account_id=null, org_id=null,
--                     plan_code=set, default_org_name=set).
--   marketing_intake  visitor self-serves on consentshield.in
--                     (same row shape as operator_intake).

alter table public.invitations
  add column if not exists origin text not null
    default 'operator_invite'
    check (origin in (
      'operator_invite',
      'operator_intake',
      'marketing_intake'
    ));

comment on column public.invitations.origin is
  'ADR-0058: where the invitation came from. Drives email CTA URL + copy.';

-- Backfill: existing rows are operator-invites by definition (no other
-- creation path existed pre-ADR-0058). The default already covers them
-- but we set explicitly for clarity in any subsequent re-inserts.
update public.invitations
   set origin = 'operator_invite'
 where origin is null;

-- Partial index for the dispatcher's lookup pattern: pending invites by
-- email + origin (used to enforce the "one pending intake per email"
-- soft rule when retries arrive).
create index if not exists invitations_pending_by_origin_idx
  on public.invitations (lower(invited_email), origin)
  where accepted_at is null and revoked_at is null;
