import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// ADR-1004 Sprint 1.5 — customer-side inspection + override CRUD for the
// Regulatory Exemption Engine.
//
// GET  — returns { platform: [...], overrides: [...] } — platform defaults
//        are readable by every authenticated member; overrides are filtered
//        by RLS to the caller's own org.
// POST — inserts a per-org override. RLS requires current_account_role() =
//        'account_owner' — we pre-check to return 403 with a clear message,
//        but RLS remains the fence.
//
// Platform defaults are immutable from the app per Sprint 1.1 RLS; there is
// no PUT/DELETE for them. DELETE of an override is deferred (future sprint
// — operators rarely want to delete an override, they deactivate it via
// is_active).

const VALID_SECTORS = [
  'saas',
  'edtech',
  'healthcare',
  'ecommerce',
  'hrtech',
  'fintech',
  'bfsi',
  'general',
  'all',
] as const

interface ExemptionRow {
  id: string
  org_id: string | null
  sector: string
  statute: string
  statute_code: string
  data_categories: string[]
  retention_period: string | null
  source_citation: string | null
  precedence: number
  applies_to_purposes: string[] | null
  legal_review_notes: string | null
  reviewed_at: string | null
  reviewer_name: string | null
  reviewer_firm: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

function legalReviewStatus(row: ExemptionRow): 'reviewed' | 'pending' {
  return row.reviewed_at ? 'reviewed' : 'pending'
}

function withLegalReviewStatus(row: ExemptionRow) {
  return { ...row, legal_review_status: legalReviewStatus(row) }
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
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // RLS already fences platform/override visibility; we only need the orgId
  // for the override split below. Membership check is authoritative — if the
  // caller isn't in the org, RLS returns zero override rows anyway and the
  // POST pre-check catches the mutation path.
  const { data, error } = await supabase
    .from('regulatory_exemptions')
    .select(
      'id, org_id, sector, statute, statute_code, data_categories, retention_period, source_citation, precedence, applies_to_purposes, legal_review_notes, reviewed_at, reviewer_name, reviewer_firm, is_active, created_at, updated_at',
    )
    .or(`org_id.is.null,org_id.eq.${orgId}`)
    .order('precedence', { ascending: true })
    .order('statute_code', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as ExemptionRow[]
  const platform = rows.filter((r) => r.org_id === null).map(withLegalReviewStatus)
  const overrides = rows.filter((r) => r.org_id === orgId).map(withLegalReviewStatus)

  return NextResponse.json({ platform, overrides })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: roleData } = await supabase.rpc('current_account_role')
  if (roleData !== 'account_owner') {
    return NextResponse.json(
      { error: 'Only account_owner may create regulatory-exemption overrides' },
      { status: 403 },
    )
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const sector = typeof body.sector === 'string' ? body.sector : null
  const statute = typeof body.statute === 'string' ? body.statute.trim() : ''
  const statute_code =
    typeof body.statute_code === 'string' ? body.statute_code.trim() : ''
  const data_categories = Array.isArray(body.data_categories)
    ? (body.data_categories as unknown[]).filter((v) => typeof v === 'string')
    : []
  const retention_period =
    typeof body.retention_period === 'string' ? body.retention_period : null
  const source_citation =
    typeof body.source_citation === 'string' ? body.source_citation : null
  const precedence =
    typeof body.precedence === 'number' && Number.isInteger(body.precedence)
      ? body.precedence
      : 50
  const applies_to_purposes = Array.isArray(body.applies_to_purposes)
    ? (body.applies_to_purposes as unknown[]).filter((v) => typeof v === 'string')
    : null
  const legal_review_notes =
    typeof body.legal_review_notes === 'string' ? body.legal_review_notes : null

  if (!sector || !VALID_SECTORS.includes(sector as (typeof VALID_SECTORS)[number])) {
    return NextResponse.json(
      { error: `sector must be one of: ${VALID_SECTORS.join(', ')}` },
      { status: 400 },
    )
  }
  if (!statute) {
    return NextResponse.json({ error: 'statute is required' }, { status: 400 })
  }
  if (!statute_code) {
    return NextResponse.json({ error: 'statute_code is required' }, { status: 400 })
  }
  if (data_categories.length === 0) {
    return NextResponse.json(
      { error: 'data_categories must be a non-empty string array' },
      { status: 400 },
    )
  }

  const { data, error } = await supabase
    .from('regulatory_exemptions')
    .insert({
      org_id: orgId,
      sector,
      statute,
      statute_code,
      data_categories,
      retention_period,
      source_citation,
      precedence,
      applies_to_purposes,
      legal_review_notes,
      is_active: true,
    })
    .select(
      'id, org_id, sector, statute, statute_code, data_categories, retention_period, source_citation, precedence, applies_to_purposes, legal_review_notes, reviewed_at, reviewer_name, reviewer_firm, is_active, created_at, updated_at',
    )
    .single()

  if (error) {
    // 23505 = unique violation (statute_code already exists for this org)
    if (error.code === '23505') {
      return NextResponse.json(
        {
          error:
            'An exemption with this statute_code already exists for this org. Update it instead.',
        },
        { status: 409 },
      )
    }
    // 42501 = insufficient_privilege (RLS block — account_owner gate)
    if (error.code === '42501') {
      return NextResponse.json(
        { error: 'Not permitted: only account_owner may create overrides' },
        { status: 403 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    { item: withLegalReviewStatus(data as ExemptionRow) },
    { status: 201 },
  )
}
