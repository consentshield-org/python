import { createHash } from 'node:crypto'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

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

// ADR-1001 Sprint 2.2: service_role is used here solely to call
// rpc_api_key_verify, which migration 20260520000001 restricts to service_role
// only. This is the v1-middleware carve-out analogous to the Worker's use of
// the service key for Supabase REST. No other DB surface is accessed through
// this client except the revoked-key fallback query in getKeyStatus().
function makeServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
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
  const client = makeServiceClient()

  const { data, error } = await client.rpc('rpc_api_key_verify', { p_plaintext: plaintext })

  if (error) {
    return { ok: false, status: 401, reason: 'invalid' }
  }

  if (data !== null && data !== undefined) {
    const raw = data as {
      id: string
      account_id: string
      org_id: string | null
      scopes: string[]
      rate_tier: string
    }
    return {
      ok: true,
      context: {
        key_id: raw.id,
        account_id: raw.account_id,
        org_id: raw.org_id ?? null,
        scopes: raw.scopes ?? [],
        rate_tier: raw.rate_tier,
      },
    }
  }

  // rpc_api_key_verify returned null — either truly unknown key or revoked.
  // Distinguish so callers can return 410 (Gone) for revoked keys.
  const status = await getKeyStatus(plaintext, client)
  if (status === 'revoked') {
    return { ok: false, status: 410, reason: 'revoked' }
  }
  return { ok: false, status: 401, reason: 'invalid' }
}

// Queries api_keys directly (service_role bypasses column grants) to determine
// whether a key exists but is revoked. Used only on the failure path of
// verifyBearerToken. Edge case: using the *old* plaintext after rotate+revoke
// returns 'not_found' here because key_hash no longer holds the old hash after
// rotation; the current-plaintext 410 path always works correctly.
async function getKeyStatus(
  plaintext: string,
  client: SupabaseClient,
): Promise<'not_found' | 'revoked'> {
  const hash = sha256Hex(plaintext)
  const { data } = await client
    .from('api_keys')
    .select('revoked_at')
    .eq('key_hash', hash)
    .maybeSingle()

  if (data && data.revoked_at !== null) {
    return 'revoked'
  }
  return 'not_found'
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
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
