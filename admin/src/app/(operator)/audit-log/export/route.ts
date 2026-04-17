import { createServerClient } from '@/lib/supabase/server'

// ADR-0028 Sprint 3.1 — CSV export of filtered audit log.
//
// Same filter predicate as /audit-log page. Cap at 10k rows so an
// accidental unfiltered export doesn't try to stream the entire table.
// The export itself calls admin.audit_bulk_export() BEFORE streaming so
// the action is audited regardless of whether the client aborts the
// download mid-stream.

const EXPORT_CAP = 10_000

export async function GET(request: Request) {
  const url = new URL(request.url)
  const params = url.searchParams
  const supabase = await createServerClient()

  let query = supabase
    .schema('admin')
    .from('admin_audit_log')
    .select(
      'id, occurred_at, admin_user_id, action, target_table, target_id, target_pk, org_id, impersonation_session_id, reason, request_ip, api_route',
    )
    .order('occurred_at', { ascending: false })
    .limit(EXPORT_CAP)

  const adminUserId = params.get('admin_user_id')
  const action = params.get('action')
  const orgId = params.get('org_id')
  const fromDate = params.get('from')
  const toDate = params.get('to')

  if (adminUserId) query = query.eq('admin_user_id', adminUserId)
  if (action) query = query.eq('action', action)
  if (orgId) query = query.eq('org_id', orgId)
  if (fromDate) query = query.gte('occurred_at', `${fromDate}T00:00:00Z`)
  if (toDate) {
    const d = new Date(`${toDate}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    query = query.lt('occurred_at', d.toISOString())
  }

  const { data, error } = await query
  if (error) {
    return new Response(`Query failed: ${error.message}`, { status: 500 })
  }

  const rows = data ?? []

  // Audit the export itself BEFORE streaming. If the RPC fails (e.g.
  // the caller isn't admin), the export bails out rather than silently
  // handing over rows.
  const filterJson: Record<string, string> = {}
  if (adminUserId) filterJson.admin_user_id = adminUserId
  if (action) filterJson.action = action
  if (orgId) filterJson.org_id = orgId
  if (fromDate) filterJson.from = fromDate
  if (toDate) filterJson.to = toDate

  const { error: auditErr } = await supabase.schema('admin').rpc('audit_bulk_export', {
    p_target_table: 'admin.admin_audit_log',
    p_filter: filterJson,
    p_row_count: rows.length,
    p_reason: 'ui-csv-export — audit log viewer',
  })
  if (auditErr) {
    return new Response(`Refused: ${auditErr.message}`, { status: 403 })
  }

  const csv = toCsv(rows)
  const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

interface ExportRow {
  id: number
  occurred_at: string
  admin_user_id: string
  action: string
  target_table: string | null
  target_id: string | null
  target_pk: string | null
  org_id: string | null
  impersonation_session_id: string | null
  reason: string
  request_ip: string | null
  api_route: string | null
}

function toCsv(rows: ExportRow[]): string {
  const headers = [
    'id',
    'occurred_at',
    'admin_user_id',
    'action',
    'target_table',
    'target_id',
    'target_pk',
    'org_id',
    'impersonation_session_id',
    'reason',
    'request_ip',
    'api_route',
  ]
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.occurred_at,
        r.admin_user_id,
        r.action,
        r.target_table ?? '',
        r.target_id ?? '',
        r.target_pk ?? '',
        r.org_id ?? '',
        r.impersonation_session_id ?? '',
        csvEscape(r.reason),
        r.request_ip ?? '',
        r.api_route ?? '',
      ].join(','),
    )
  }
  return lines.join('\n') + '\n'
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}
