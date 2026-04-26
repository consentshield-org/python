import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { API_HDR } from '@/lib/api/context'
import { logApiRequest } from '@/lib/api/log-request'
import type { ApiKeyContext } from '@/lib/api/auth'

// ADR-1001 Sprint 2.2 — Canary endpoint to exercise the Bearer middleware.
// Sprint 2.4 — records request to api_request_log (fire-and-forget).
export async function GET() {
  const hdrs = await headers()
  const t0 = parseInt(hdrs.get(API_HDR.requestStart) ?? '0', 10)

  const context: ApiKeyContext = {
    key_id:     hdrs.get(API_HDR.keyId) ?? '',
    account_id: hdrs.get(API_HDR.accountId) ?? '',
    org_id:     hdrs.get(API_HDR.orgId) || null,
    scopes:     (hdrs.get(API_HDR.scopes) ?? '').split(',').filter(Boolean),
    rate_tier:  hdrs.get(API_HDR.rateTier) ?? '',
  }

  const body = {
    ok: true,
    org_id:     context.org_id,
    account_id: context.account_id,
    scopes:     context.scopes,
    rate_tier:  context.rate_tier,
  }

  const latency = t0 ? Date.now() - t0 : 0
  // Log the public-facing path callers actually use, not the on-disk
  // route — makes api_request_log searches match what customers see.
  logApiRequest(context, '/v1/_ping', 'GET', 200, latency)

  const res = NextResponse.json(body)
  // Echo the inbound trace id so SDK callers can correlate end-to-end.
  const traceId = hdrs.get('x-cs-trace-id')
  if (traceId) res.headers.set('x-cs-trace-id', traceId)
  return res
}
