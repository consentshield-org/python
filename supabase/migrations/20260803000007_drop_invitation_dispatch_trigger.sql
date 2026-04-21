-- ADR-0058 follow-up — drop the AFTER INSERT trigger + pg_cron
-- safety-net that used to drive invitation-email dispatch.
--
-- Rationale: every caller now dispatches synchronously in-process
-- (signup-intake route, admin operator-intake action). The trigger
-- pinged a route via pg_net → Vault URL which was awkward in dev
-- (Supabase cloud can't reach localhost) and added a hop we don't
-- need now that the originating code paths know the invitation id
-- at insert time.
--
-- Preserved for optional manual use:
--   * public.dispatch_invitation_email(uuid) — function kept;
--     callable ad-hoc by an operator SQL session.
--   * /api/internal/invitation-dispatch — route kept for bearer-gated
--     manual retries and the admin operator-intake call path.
--
-- Removed:
--   * trigger invitations_dispatch_after_insert
--   * function public.invitations_after_insert_dispatch() (no other
--     caller)
--   * pg_cron job invitation-dispatch-retry
--
-- The Vault secrets cs_invitation_dispatch_url /
-- cs_invitation_dispatch_secret become vestigial after this migration
-- — you can leave them in place or drop them via
--   select vault.delete_secret('cs_invitation_dispatch_url');
--   select vault.delete_secret('cs_invitation_dispatch_secret');
-- (operator-discretion; the migration doesn't touch Vault so that the
-- same file is safe to replay on a shared dev DB).

drop trigger if exists invitations_dispatch_after_insert
  on public.invitations;

drop function if exists public.invitations_after_insert_dispatch();

do $$
begin
  perform cron.unschedule('invitation-dispatch-retry');
  exception when others then null;
end $$;
