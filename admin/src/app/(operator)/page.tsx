import { createServerClient } from '@/lib/supabase/server'
import { MetricTile } from '@/components/ops-dashboard/metric-tile'
import { KillSwitchesCard } from '@/components/ops-dashboard/kill-switches-card'
import { CronStatusCard } from '@/components/ops-dashboard/cron-status-card'
import { RecentActivityCard } from '@/components/ops-dashboard/recent-activity-card'
import { RefreshButton } from '@/components/ops-dashboard/refresh-button'
import { PlanDistributionCard } from '@/components/ops-dashboard/plan-distribution-card'

// ADR-0028 Sprint 2.1 — Operations Dashboard.
// ADR-1027 Sprint 1.2 — account-tier tile row + plan-distribution card.
//
// Server Component. A single admin.admin_dashboard_tiles() call returns
// both org-tier snapshot (from platform_metrics_daily) and account-tier
// live metrics. kill_switches / cron snapshot / recent audit remain
// separate queries since they belong to independent panels.

export const dynamic = 'force-dynamic'

interface OrgTierMetrics {
  metric_date: string
  refreshed_at: string
  total_orgs: number
  active_orgs: number
  total_consents: number
  total_artefacts_active: number
  total_artefacts_revoked: number
  total_rights_requests_open: number
  rights_requests_breached: number
  worker_errors_24h: number
  delivery_buffer_max_age_min: number
}

interface AccountPlanRow {
  plan_code: string
  display_name: string
  count: number
}

interface AccountStatusRow {
  status: string
  count: number
}

interface AccountTierMetrics {
  accounts_total: number
  accounts_by_plan: AccountPlanRow[]
  accounts_by_status: AccountStatusRow[]
  orgs_per_account_p50: number
  orgs_per_account_p90: number
  orgs_per_account_max: number
  trial_to_paid_rate_30d: number | null
  trial_to_paid_numerator: number
  trial_to_paid_denominator: number
}

interface DashboardTiles {
  generated_at: string
  org_tier: OrgTierMetrics | null
  account_tier: AccountTierMetrics
}

interface KillSwitch {
  switch_key: string
  display_name: string
  description: string
  enabled: boolean
  reason: string | null
  set_at: string | null
}

interface CronJobSnapshot {
  jobname: string
  schedule: string
  active: boolean
  last_run_at: string | null
  last_status: string | null
  last_run_ago_seconds: number | null
}

interface AuditRowRaw {
  id: number
  occurred_at: string
  action: string
  reason: string
  admin_user_id: string
  target_table: string | null
  org_id: string | null
}

export default async function OperationsDashboard() {
  const supabase = await createServerClient()

  const [tilesRes, switchesRes, cronRes, auditRes] = await Promise.all([
    supabase.schema('admin').rpc('admin_dashboard_tiles'),
    supabase
      .schema('admin')
      .from('kill_switches')
      .select('switch_key, display_name, description, enabled, reason, set_at')
      .order('switch_key'),
    supabase.rpc('admin_cron_snapshot'),
    supabase
      .schema('admin')
      .from('admin_audit_log')
      .select('id, occurred_at, action, reason, admin_user_id, target_table, org_id')
      .order('occurred_at', { ascending: false })
      .limit(10),
  ])

  const tiles = (tilesRes.data as DashboardTiles | null) ?? null
  const orgTier = tiles?.org_tier ?? null
  const accountTier = tiles?.account_tier ?? {
    accounts_total: 0,
    accounts_by_plan: [],
    accounts_by_status: [],
    orgs_per_account_p50: 0,
    orgs_per_account_p90: 0,
    orgs_per_account_max: 0,
    trial_to_paid_rate_30d: null,
    trial_to_paid_numerator: 0,
    trial_to_paid_denominator: 0,
  }

  const switches = (switchesRes.data ?? []) as KillSwitch[]
  const cronJobs = (cronRes.data ?? []) as CronJobSnapshot[]
  const auditRows = (auditRes.data ?? []) as AuditRowRaw[]

  // Resolve display_name per unique admin_user_id in the audit slice.
  const adminIds = Array.from(new Set(auditRows.map((r) => r.admin_user_id)))
  const { data: adminUsers } =
    adminIds.length > 0
      ? await supabase
          .schema('admin')
          .from('admin_users')
          .select('id, display_name')
          .in('id', adminIds)
      : { data: [] as Array<{ id: string; display_name: string | null }> }

  const nameById = new Map(
    (adminUsers ?? []).map((u) => [u.id, u.display_name ?? null]),
  )

  const rowsWithNames = auditRows.map((r) => ({
    ...r,
    display_name: nameById.get(r.admin_user_id) ?? null,
  }))

  const trialDenominator = accountTier.trial_to_paid_denominator
  const trialRate = accountTier.trial_to_paid_rate_30d
  const trialCaption =
    trialDenominator === 0
      ? 'No trials ended in last 30d'
      : `${accountTier.trial_to_paid_numerator}/${trialDenominator} converted`

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Operations Dashboard</h1>
          <p className="text-xs text-text-3">
            {orgTier
              ? `Refreshed ${new Date(orgTier.refreshed_at).toLocaleString('en-IN', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })} · metric_date ${orgTier.metric_date}`
              : 'No metrics row yet — click Refresh to compute.'}
          </p>
        </div>
        <RefreshButton />
      </header>

      {/* Account-tier (ADR-1027 Sprint 1.2) */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-3">
            Accounts
          </h2>
          <span className="text-xs text-text-3">
            {accountTier.accounts_total}{' '}
            {accountTier.accounts_total === 1 ? 'account' : 'accounts'} ·{' '}
            median {Math.round(accountTier.orgs_per_account_p50)} org/account ·
            p90 {Math.round(accountTier.orgs_per_account_p90)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MetricTile
            label="Accounts total"
            value={accountTier.accounts_total}
          />
          <MetricTile
            label="Orgs per account"
            value={`${Math.round(accountTier.orgs_per_account_p50)} · ${Math.round(
              accountTier.orgs_per_account_p90,
            )} · ${accountTier.orgs_per_account_max}`}
            caption="p50 · p90 · max"
          />
          <MetricTile
            label="Trial→paid (30d)"
            value={trialRate === null ? '—' : `${trialRate}%`}
            caption={trialCaption}
            tone={
              trialRate === null
                ? 'default'
                : trialRate >= 40
                  ? 'green'
                  : trialRate >= 20
                    ? 'amber'
                    : 'red'
            }
          />
          <MetricTile
            label="Suspended accounts"
            value={
              accountTier.accounts_by_status.find(
                (s) => s.status === 'suspended',
              )?.count ?? 0
            }
            caption={
              (accountTier.accounts_by_status.find((s) => s.status === 'past_due')
                ?.count ?? 0) > 0
                ? `+${accountTier.accounts_by_status.find(
                    (s) => s.status === 'past_due',
                  )?.count} past due`
                : 'no past_due'
            }
            tone={
              (accountTier.accounts_by_status.find(
                (s) => s.status === 'suspended',
              )?.count ?? 0) > 0
                ? 'red'
                : 'default'
            }
          />
        </div>
        <PlanDistributionCard rows={accountTier.accounts_by_plan} />
      </section>

      {/* Org-tier */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-3">
          Organisations
        </h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <MetricTile label="Total orgs" value={orgTier?.total_orgs ?? 0} />
          <MetricTile
            label="Active (7d)"
            value={orgTier?.active_orgs ?? 0}
            caption={
              orgTier && orgTier.total_orgs > 0
                ? `${Math.round((orgTier.active_orgs / orgTier.total_orgs) * 100)}% of total`
                : undefined
            }
          />
          <MetricTile label="Consents 24h" value={orgTier?.total_consents ?? 0} />
          <MetricTile
            label="Artefacts active"
            value={formatLarge(orgTier?.total_artefacts_active ?? 0)}
            caption="DEPA model"
          />
          <MetricTile
            label="Rights open"
            value={orgTier?.total_rights_requests_open ?? 0}
            caption={
              orgTier && orgTier.rights_requests_breached > 0
                ? `${orgTier.rights_requests_breached} SLA-breached`
                : 'no SLA breaches'
            }
            tone={orgTier && orgTier.rights_requests_breached > 0 ? 'red' : 'default'}
          />
          <MetricTile
            label="Worker errors 24h"
            value={orgTier?.worker_errors_24h ?? 0}
            tone={orgTier && orgTier.worker_errors_24h === 0 ? 'green' : 'amber'}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CronStatusCard jobs={cronJobs} />
        </div>
        <div className="space-y-6">
          <KillSwitchesCard switches={switches} />
          <RecentActivityCard rows={rowsWithNames} />
        </div>
      </div>
    </div>
  )
}

function formatLarge(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
