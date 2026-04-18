import { createServerClient } from '@/lib/supabase/server'
import { SecurityTabs, type SecurityData } from './security-tabs'

// ADR-0033 Sprint 2.2 — Abuse & Security panel.
//
// Five tabs:
//   · Rate-limit triggers (stub — ingestion pending, V2-S2)
//   · HMAC failures (worker_errors filtered by 'hmac' substring)
//   · Origin failures (worker_errors filtered by 'origin' substring)
//   · Sentry escalations (link-out only, v1)
//   · Blocked IPs (public.blocked_ips, with Block/Unblock modal)
//
// Worker enforcement of blocked IPs ships in Sprint 2.3 — for now the
// table populates and admins can manage entries, but Worker traffic
// isn't yet filtered.

export const dynamic = 'force-dynamic'

export default async function SecurityPage() {
  const supabase = await createServerClient()

  const [rateLimit, hmac, origin, blocked, sentry, user] = await Promise.all([
    supabase.schema('admin').rpc('security_rate_limit_triggers', {
      p_window_hours: 24,
    }),
    supabase.schema('admin').rpc('security_worker_reasons_list', {
      p_reason_prefix: 'hmac',
      p_window_hours: 24,
      p_limit: 100,
    }),
    supabase.schema('admin').rpc('security_worker_reasons_list', {
      p_reason_prefix: 'origin',
      p_window_hours: 24,
      p_limit: 100,
    }),
    supabase.schema('admin').rpc('security_blocked_ips_list'),
    // ADR-0049 Phase 2 — Sentry events now read from the DB, not link-out only.
    supabase.schema('admin').rpc('security_sentry_events_list', {
      p_window_hours: 24,
    }),
    supabase.auth.getUser(),
  ])

  const errors = [
    rateLimit.error?.message,
    hmac.error?.message,
    origin.error?.message,
    blocked.error?.message,
    sentry.error?.message,
  ].filter((e): e is string => !!e)

  const adminRole =
    (user.data.user?.app_metadata?.admin_role as
      | 'platform_operator'
      | 'support'
      | 'read_only'
      | undefined) ?? 'read_only'
  const canWrite = adminRole === 'platform_operator'

  const data: SecurityData = {
    rateLimit: (rateLimit.data ?? []) as SecurityData['rateLimit'],
    hmacFailures: (hmac.data ?? []) as SecurityData['hmacFailures'],
    originFailures: (origin.data ?? []) as SecurityData['originFailures'],
    blockedIps: (blocked.data ?? []) as SecurityData['blockedIps'],
    sentryEvents: (sentry.data ?? []) as SecurityData['sentryEvents'],
  }

  const sentryOrg = process.env.NEXT_PUBLIC_SENTRY_ORG ?? ''

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Abuse &amp; Security</h1>
          <p className="text-sm text-text-2">
            Rate-limit signals, Worker auth failures, Sentry escalations, and
            the global IP block list.
          </p>
        </div>
        <span className="rounded-full border border-[color:var(--border)] bg-bg px-3 py-1 text-[11px] text-text-3">
          Worker enforcement — ADR-0033 Sprint 2.3
        </span>
      </header>

      {errors.length > 0 ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      ) : null}

      <SecurityTabs data={data} canWrite={canWrite} sentryOrg={sentryOrg} />
    </div>
  )
}
