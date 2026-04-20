// ADR-1002 Sprint 3.1 — shared response helpers for /v1/* handlers.

import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { API_HDR } from './context'
import { problemJson } from './auth'
import { logApiRequest } from './log-request'
import type { ApiKeyContext } from './auth'

export const PROBLEM_JSON_HEADERS = { 'Content-Type': 'application/problem+json' }

export async function readContext(): Promise<{ context: ApiKeyContext; t0: number }> {
  const hdrs = await headers()
  const t0 = parseInt(hdrs.get(API_HDR.requestStart) ?? '0', 10)
  return {
    t0,
    context: {
      key_id:     hdrs.get(API_HDR.keyId) ?? '',
      account_id: hdrs.get(API_HDR.accountId) ?? '',
      org_id:     hdrs.get(API_HDR.orgId) || null,
      scopes:     (hdrs.get(API_HDR.scopes) ?? '').split(',').filter(Boolean),
      rate_tier:  hdrs.get(API_HDR.rateTier) ?? '',
    },
  }
}

export function respondV1(
  context: ApiKeyContext,
  route: string,
  method: string,
  status: number,
  body: unknown,
  t0: number,
  isProblem = false,
): NextResponse {
  const latency = t0 ? Date.now() - t0 : 0
  logApiRequest(context, route, method, status, latency)
  return NextResponse.json(body, { status, headers: isProblem ? PROBLEM_JSON_HEADERS : {} })
}

export function gateScopeOrProblem(
  context: ApiKeyContext,
  required: string,
): { body: ReturnType<typeof problemJson>; status: 403 } | null {
  if (!context.scopes.includes(required)) {
    return {
      body: problemJson(403, 'Forbidden', `This key does not have the required scope: ${required}`),
      status: 403,
    }
  }
  return null
}

export function requireOrgOrProblem(
  context: ApiKeyContext,
  route: string,
): { body: ReturnType<typeof problemJson>; status: 400 } | null {
  if (!context.org_id) {
    return {
      body: problemJson(400, 'Bad Request', `API key is account-scoped — ${route} requires an org-scoped key`),
      status: 400,
    }
  }
  return null
}
