import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import type { ApiKeyContext } from './auth'

export const API_HDR = {
  keyId:     'x-api-key-id',
  accountId: 'x-api-account-id',
  orgId:     'x-api-org-id',
  scopes:    'x-api-scopes',
  rateTier:  'x-api-rate-tier',
} as const

// Call from a v1 route handler to read the context injected by proxy.ts.
export async function getApiContext(): Promise<ApiKeyContext> {
  const hdrs = await headers()
  return {
    key_id:     hdrs.get(API_HDR.keyId) ?? '',
    account_id: hdrs.get(API_HDR.accountId) ?? '',
    org_id:     hdrs.get(API_HDR.orgId) ?? null,
    scopes:     (hdrs.get(API_HDR.scopes) ?? '').split(',').filter(Boolean),
    rate_tier:  hdrs.get(API_HDR.rateTier) ?? '',
  }
}

// Returns a 403 response if the resolved key lacks the required scope,
// otherwise returns null (caller should continue).
export function assertScope(
  context: ApiKeyContext,
  required: string,
): NextResponse | null {
  if (!context.scopes.includes(required)) {
    return NextResponse.json(
      {
        type: 'https://consentshield.in/errors/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: `This key does not have the required scope: ${required}`,
      },
      {
        status: 403,
        headers: { 'Content-Type': 'application/problem+json' },
      },
    )
  }
  return null
}

// Builds the set of request headers that proxy.ts injects from a verified context.
export function buildApiContextHeaders(
  base: Headers,
  context: ApiKeyContext,
): Headers {
  const out = new Headers(base)
  out.set(API_HDR.keyId, context.key_id)
  out.set(API_HDR.accountId, context.account_id)
  out.set(API_HDR.orgId, context.org_id ?? '')
  out.set(API_HDR.scopes, context.scopes.join(','))
  out.set(API_HDR.rateTier, context.rate_tier)
  return out
}
