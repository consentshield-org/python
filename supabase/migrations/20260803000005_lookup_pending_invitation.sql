-- ADR-0058 follow-up — email-first signup lookup.
--
-- The /signup page lets a visitor type their email and, if a pending
-- invitation exists for that email, redirects them into the right
-- flow (intake wizard or operator-invite acceptance). This RPC backs
-- that lookup.
--
-- Existence-leak trade-off: unlike `create_signup_intake` (which is
-- branch-hidden for anti-enumeration), this RPC *does* disclose
-- whether an invitation exists for an email. The product owner made
-- this call explicitly — the UX win (clear "no invitation found"
-- message) outweighs the enumeration risk, mitigated by per-IP +
-- per-email rate limits on the calling endpoint.
--
-- Returns at most one row (the most recently created pending,
-- unaccepted, unrevoked, unexpired invitation).

create or replace function public.lookup_pending_invitation_by_email(
  p_email text
)
returns table (
  token   text,
  origin  text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select i.token, i.origin
    from public.invitations i
   where i.invited_email = lower(trim(p_email))
     and i.accepted_at is null
     and i.revoked_at is null
     and i.expires_at > now()
   order by i.created_at desc
   limit 1
$$;

revoke execute on function public.lookup_pending_invitation_by_email(text) from public;
grant  execute on function public.lookup_pending_invitation_by_email(text) to anon, authenticated;

comment on function public.lookup_pending_invitation_by_email(text) is
  'ADR-0058 follow-up: email-first signup lookup. Discloses pending-invitation existence by design; rate-limited upstream.';
