// Per-org encryption utilities using pgcrypto via Supabase RPC.
// Uses per-org derived key per the non-negotiable rule:
//   org_key = HMAC-SHA256(MASTER_ENCRYPTION_KEY, org_id || encryption_salt)
//
// The derived key never leaves the Next.js server. Ciphertext stays in the
// DB column. Call sites pass a SupabaseClient (typically the
// authenticated-user client from createServerClient()) — no more internal
// service-role client.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'

// S-6: short-lived derived-key cache. The salt in organisations is stable
// except during an explicit rotation, which is a rare operator action; a
// 60-second TTL caps the exposure of a stale key to the next request window.
const KEY_TTL_MS = 60_000
const keyCache = new Map<string, { key: string; expiresAt: number }>()

async function deriveOrgKey(
  supabase: SupabaseClient,
  orgId: string,
): Promise<string> {
  const masterKey = process.env.MASTER_ENCRYPTION_KEY
  if (!masterKey) {
    throw new Error('MASTER_ENCRYPTION_KEY must be set')
  }

  const cached = keyCache.get(orgId)
  if (cached && cached.expiresAt > Date.now()) return cached.key

  const { data: org, error } = await supabase
    .from('organisations')
    .select('encryption_salt')
    .eq('id', orgId)
    .single()

  if (error || !org) throw new Error(`Org ${orgId} not found`)

  const key = createHmac('sha256', masterKey)
    .update(`${orgId}${org.encryption_salt}`)
    .digest('hex')

  keyCache.set(orgId, { key, expiresAt: Date.now() + KEY_TTL_MS })
  return key
}

export async function encryptForOrg(
  supabase: SupabaseClient,
  orgId: string,
  plaintext: string,
): Promise<Buffer> {
  const key = await deriveOrgKey(supabase, orgId)
  const { data, error } = await supabase.rpc('encrypt_secret', {
    plaintext,
    derived_key: key,
  })
  if (error) throw new Error(`Encryption failed: ${error.message}`)
  if (typeof data === 'string') {
    const hex = data.startsWith('\\x') ? data.slice(2) : data
    return Buffer.from(hex, 'hex')
  }
  return Buffer.from(data as ArrayBuffer)
}

export async function decryptForOrg(
  supabase: SupabaseClient,
  orgId: string,
  ciphertext: Buffer | string,
): Promise<string> {
  const key = await deriveOrgKey(supabase, orgId)

  let encoded: string
  if (Buffer.isBuffer(ciphertext)) {
    encoded = '\\x' + ciphertext.toString('hex')
  } else if (ciphertext.startsWith('\\x')) {
    encoded = ciphertext
  } else {
    encoded = '\\x' + ciphertext
  }

  const { data, error } = await supabase.rpc('decrypt_secret', {
    ciphertext: encoded,
    derived_key: key,
  })
  if (error) throw new Error(`Decryption failed: ${error.message}`)
  return data as string
}
