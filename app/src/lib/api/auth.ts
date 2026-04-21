// ADR-1009 Phase 2 Sprint 2.3 — Bearer verification over the cs_api pool.
//
// Previously (ADR-1001 Sprint 2.2): verifyBearerToken used a service-role
// Supabase REST client to call rpc_api_key_verify, and getKeyStatus did a
// direct api_keys SELECT on the same client.
//
// Now: v1 handlers run as cs_api via direct Postgres (postgres.js pool).
// rpc_api_key_verify + rpc_api_key_status are granted to cs_api; api_keys
// has zero table grants for cs_api. Rule 5 is honoured — no service-role
// key in the customer-app runtime. See ADR-1009 Phase 2.

import { csApi } from './cs-api-client'

export type ApiKeyContext = {
  key_id: string
  account_id: string
  org_id: string | null
  scopes: string[]
  rate_tier: string
}

export type VerifyResult =
  | { ok: true; context: ApiKeyContext }
  | { ok: false; status: 401 | 410; reason: 'missing' | 'malformed' | 'invalid' | 'revoked' }

type VerifyRow = {
  id: string
  account_id: string
  org_id: string | null
  scopes: string[] | null
  rate_tier: string
}

export async function verifyBearerToken(authHeader: string | null): Promise<VerifyResult> {
  if (!authHeader) {
    return { ok: false, status: 401, reason: 'missing' }
  }

  const match = /^Bearer (cs_live_\S+)$/.exec(authHeader)
  if (!match) {
    return { ok: false, status: 401, reason: 'malformed' }
  }

  const plaintext = match[1]
  const sql = csApi()

  try {
    const rows = await sql<Array<{ result: VerifyRow | null }>>`
      select rpc_api_key_verify(${plaintext}::text) as result
    `
    const data = rows[0]?.result ?? null

    if (data !== null) {
      return {
        ok: true,
        context: {
          key_id: data.id,
          account_id: data.account_id,
          org_id: data.org_id ?? null,
          scopes: data.scopes ?? [],
          rate_tier: data.rate_tier,
        },
      }
    }

    // rpc_api_key_verify returned null — either unknown or revoked. Ask
    // rpc_api_key_status to distinguish so callers can return 410 (Gone)
    // for revoked keys vs 401 (Unauthorized) for unknown.
    const status = await getKeyStatus(plaintext)
    if (status === 'revoked') {
      return { ok: false, status: 410, reason: 'revoked' }
    }
    return { ok: false, status: 401, reason: 'invalid' }
  } catch {
    return { ok: false, status: 401, reason: 'invalid' }
  }
}

// ADR-1009 Phase 2: replaces the direct api_keys table SELECT. cs_api has no
// table grants; the lookup is exclusively through rpc_api_key_status, which
// also handles the rotation dual-window (previous_key_hash) automatically.
async function getKeyStatus(plaintext: string): Promise<'not_found' | 'revoked'> {
  const sql = csApi()
  try {
    const rows = await sql<Array<{ result: 'active' | 'revoked' | 'not_found' }>>`
      select rpc_api_key_status(${plaintext}::text) as result
    `
    const value = rows[0]?.result
    return value === 'revoked' ? 'revoked' : 'not_found'
  } catch {
    return 'not_found'
  }
}

// RFC 7807 problem+json body builder.
export function problemJson(
  status: number,
  title: string,
  detail: string,
  extra?: Record<string, unknown>,
) {
  return {
    type: `https://consentshield.in/errors/${title.toLowerCase().replace(/\s+/g, '-')}`,
    title,
    status,
    detail,
    ...extra,
  }
}
