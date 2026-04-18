import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// ADR-0037 V2-D3 — CSV export for Consent Artefacts.
// Streams text/csv honouring the same filters as the list page
// (/dashboard/artefacts). No pagination — full filtered result set.
// RLS gates the rows; we just membership-check for consistency with
// the other /api/orgs/[orgId]/* routes.

const COLUMNS = [
  'artefact_id',
  'purpose_code',
  'framework',
  'status',
  'data_scope',
  'expires_at',
  'created_at',
] as const

function csvField(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = Array.isArray(v) ? v.join(';') : String(v)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('org_id', orgId)
    .single()
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const framework = url.searchParams.get('framework')
  const purpose = url.searchParams.get('purpose')
  const expiring = url.searchParams.get('expiring')

  let query = supabase
    .from('consent_artefacts')
    .select('artefact_id, purpose_code, framework, status, data_scope, expires_at, created_at')
    .order('created_at', { ascending: false })

  if (status && ['active', 'replaced', 'revoked', 'expired'].includes(status)) {
    query = query.eq('status', status)
  }
  if (framework && ['dpdp', 'abdm', 'gdpr'].includes(framework)) {
    query = query.eq('framework', framework)
  }
  if (purpose) query = query.eq('purpose_code', purpose)
  if (expiring === '30') {
    const in30Days = new Date(Date.now() + 30 * 86_400_000).toISOString()
    query = query.lt('expires_at', in30Days).eq('status', 'active')
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const header = COLUMNS.join(',')
  const rows = (data ?? []).map((r) =>
    COLUMNS.map((c) => csvField((r as Record<string, unknown>)[c])).join(','),
  )
  const body = [header, ...rows].join('\n') + '\n'

  const filename = `consent-artefacts-${orgId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
