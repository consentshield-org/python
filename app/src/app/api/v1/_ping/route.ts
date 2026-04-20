import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { API_HDR } from '@/lib/api/context'

// ADR-1001 Sprint 2.2 — Canary endpoint to exercise the Bearer middleware.
// Returns the resolved org_id so callers can confirm the key was accepted and
// the context was injected correctly. No DB query needed here — context comes
// from the headers proxy.ts injected.
export async function GET() {
  const hdrs = await headers()
  return NextResponse.json({
    ok: true,
    org_id: hdrs.get(API_HDR.orgId) || null,
    account_id: hdrs.get(API_HDR.accountId) || null,
    scopes: (hdrs.get(API_HDR.scopes) ?? '').split(',').filter(Boolean),
    rate_tier: hdrs.get(API_HDR.rateTier) || null,
  })
}
