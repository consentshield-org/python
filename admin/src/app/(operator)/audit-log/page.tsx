import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { AuditLogFilterBar } from '@/components/audit-log/filter-bar'
import { AuditTable } from '@/components/audit-log/audit-table'

// ADR-0028 Sprint 3.1 — Audit Log viewer.
//
// Server Component. URL searchParams drive the filter predicate:
//   ?admin_user_id=<uuid>  — exact match on admin_user_id
//   ?action=<code>         — exact match on action
//   ?org_id=<uuid-prefix>  — prefix match; forwarded through .like()
//   ?from=YYYY-MM-DD       — occurred_at ≥ midnight UTC of date
//   ?to=YYYY-MM-DD         — occurred_at < midnight UTC of (date + 1)
//   ?page=<n>              — zero-indexed, 50 rows per page
//
// CSV export lives at /audit-log/export (same searchParams).

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

// Known admin action codes (sources: ADR-0027 RPC set + customer ticket
// create path). New codes appear in the select once an RPC emits them;
// the filter-bar always shows this fixed list so operators can pick
// actions that haven't fired yet.
const KNOWN_ACTIONS = [
  'add_connector',
  'add_org_note',
  'add_support_ticket_message',
  'add_tracker_signature',
  'assign_support_ticket',
  'bulk_export',
  'create_sectoral_template_draft',
  'customer_create_support_ticket',
  'delete_feature_flag',
  'delete_org_note',
  'deprecate_connector',
  'deprecate_sectoral_template',
  'deprecate_tracker_signature',
  'extend_trial',
  'impersonate_end',
  'impersonate_force_end',
  'impersonate_start',
  'import_tracker_signature_pack',
  'publish_sectoral_template',
  'refresh_platform_metrics',
  'restore_org',
  'set_feature_flag',
  'suspend_org',
  'toggle_kill_switch',
  'update_connector',
  'update_customer_setting',
  'update_org_note',
  'update_sectoral_template_draft',
  'update_support_ticket',
  'update_tracker_signature',
]

interface PageProps {
  searchParams: Promise<{
    admin_user_id?: string
    action?: string
    org_id?: string
    from?: string
    to?: string
    page?: string
  }>
}

export default async function AuditLogPage({ searchParams }: PageProps) {
  const params = await searchParams
  const page = Math.max(0, parseInt(params.page ?? '0', 10) || 0)
  const supabase = await createServerClient()

  let query = supabase
    .schema('admin')
    .from('admin_audit_log')
    .select(
      'id, occurred_at, admin_user_id, action, target_table, target_id, target_pk, org_id, impersonation_session_id, old_value, new_value, reason, request_ip, request_ua, api_route',
      { count: 'exact' },
    )
    .order('occurred_at', { ascending: false })

  if (params.admin_user_id) query = query.eq('admin_user_id', params.admin_user_id)
  if (params.action) query = query.eq('action', params.action)
  if (params.org_id) query = query.ilike('org_id::text', `${params.org_id}%`)
  if (params.from) query = query.gte('occurred_at', `${params.from}T00:00:00Z`)
  if (params.to) {
    const toDate = new Date(`${params.to}T00:00:00Z`)
    toDate.setUTCDate(toDate.getUTCDate() + 1)
    query = query.lt('occurred_at', toDate.toISOString())
  }

  const from = page * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  const { data, count, error } = await query.range(from, to)

  // The ilike on `org_id::text` may not work via PostgREST — fall back
  // to exact match if it errors.
  let rows = data ?? []
  let total = count ?? 0
  if (error && params.org_id) {
    const retry = await supabase
      .schema('admin')
      .from('admin_audit_log')
      .select(
        'id, occurred_at, admin_user_id, action, target_table, target_id, target_pk, org_id, impersonation_session_id, old_value, new_value, reason, request_ip, request_ua, api_route',
        { count: 'exact' },
      )
      .order('occurred_at', { ascending: false })
      .eq('org_id', params.org_id)
      .range(from, to)
    rows = retry.data ?? []
    total = retry.count ?? 0
  }

  // Resolve admin display names for the rendered slice.
  const adminIds = Array.from(new Set(rows.map((r) => r.admin_user_id)))
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

  const rowsWithNames = rows.map((r) => ({
    ...r,
    display_name: nameById.get(r.admin_user_id) ?? null,
  }))

  // Populate the admin select with everyone who has ever appeared in the
  // audit log (not just the current page).
  const { data: allAdmins } = await supabase
    .schema('admin')
    .from('admin_users')
    .select('id, display_name')
    .order('display_name')

  const filterParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value && typeof value === 'string' && key !== 'page') filterParams.set(key, value)
  }
  const exportUrl = `/audit-log/export?${filterParams.toString()}`

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const prevHref = page > 0 ? hrefWithPage(params, page - 1) : null
  const nextHref = page + 1 < totalPages ? hrefWithPage(params, page + 1) : null

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Audit Log</h1>
          <p className="text-xs text-zinc-500">
            Append-only · Rule 22 · CSV export itself is audit-logged
          </p>
        </div>
        <Link
          href={exportUrl}
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
        >
          Export CSV
        </Link>
      </header>

      <AuditLogFilterBar
        admins={allAdmins ?? []}
        actions={KNOWN_ACTIONS}
        initialAdminId={params.admin_user_id ?? ''}
        initialAction={params.action ?? ''}
        initialOrgId={params.org_id ?? ''}
        initialFrom={params.from ?? ''}
        initialTo={params.to ?? ''}
      />

      <p className="text-xs text-zinc-500">
        {total.toLocaleString()} {total === 1 ? 'entry' : 'entries'} · page{' '}
        {page + 1} of {totalPages}
      </p>

      <AuditTable rows={rowsWithNames} />

      <nav className="flex items-center justify-between text-xs text-zinc-600">
        {prevHref ? (
          <Link
            href={prevHref}
            className="rounded border border-zinc-300 bg-white px-3 py-1 hover:bg-zinc-50"
          >
            ← Previous
          </Link>
        ) : (
          <span />
        )}
        {nextHref ? (
          <Link
            href={nextHref}
            className="rounded border border-zinc-300 bg-white px-3 py-1 hover:bg-zinc-50"
          >
            Next →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  )
}

function hrefWithPage(
  params: Record<string, string | undefined>,
  page: number,
): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value && typeof value === 'string' && key !== 'page') sp.set(key, value)
  }
  sp.set('page', String(page))
  return `/audit-log?${sp.toString()}`
}
