import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// ADR-0025 — DEPA score read endpoint.
// Returns the cached depa_compliance_metrics row for the caller's org.
// Falls back to a live compute_depa_score RPC call when the cache row is
// absent (new org; nightly refresh hasn't run yet). Flags stale if the
// cached row is older than 25 hours.

const STALE_AFTER_HOURS = 25

interface DepaScoreResponse {
  total: number
  coverage_score: number
  expiry_score: number
  freshness_score: number
  revocation_score: number
  computed_at: string
  stale: boolean
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: membership } = await supabase
    .from('organisation_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('org_id', orgId)
    .single()
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Cached row — populated nightly by refresh_depa_compliance_metrics().
  const { data: cached, error: cacheErr } = await supabase
    .from('depa_compliance_metrics')
    .select('total_score, coverage_score, expiry_score, freshness_score, revocation_score, computed_at')
    .eq('org_id', orgId)
    .maybeSingle()

  if (cacheErr) {
    return NextResponse.json({ error: cacheErr.message }, { status: 500 })
  }

  if (cached) {
    const ageHours = (Date.now() - new Date(cached.computed_at).getTime()) / 3_600_000
    const response: DepaScoreResponse = {
      total: Number(cached.total_score),
      coverage_score: Number(cached.coverage_score),
      expiry_score: Number(cached.expiry_score),
      freshness_score: Number(cached.freshness_score),
      revocation_score: Number(cached.revocation_score),
      computed_at: cached.computed_at,
      stale: ageHours > STALE_AFTER_HOURS,
    }
    return NextResponse.json(response)
  }

  // Fallback: fresh compute when the cache is empty.
  const { data: fresh, error: rpcErr } = await supabase.rpc('compute_depa_score', {
    p_org_id: orgId,
  })
  if (rpcErr || !fresh) {
    return NextResponse.json({ error: rpcErr?.message ?? 'score unavailable' }, { status: 500 })
  }
  const f = fresh as Record<string, unknown>
  const response: DepaScoreResponse = {
    total: Number(f.total ?? 0),
    coverage_score: Number(f.coverage_score ?? 0),
    expiry_score: Number(f.expiry_score ?? 0),
    freshness_score: Number(f.freshness_score ?? 0),
    revocation_score: Number(f.revocation_score ?? 0),
    computed_at: new Date().toISOString(),
    stale: true,
  }
  return NextResponse.json(response)
}
