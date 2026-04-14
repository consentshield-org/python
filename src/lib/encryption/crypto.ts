// Per-org encryption utilities using pgcrypto via Supabase RPC
// Uses per-org derived key per the non-negotiable rule:
//   org_key = HMAC-SHA256(MASTER_ENCRYPTION_KEY, org_id || encryption_salt)
//
// We never pass the derived key out of the server. Ciphertext stays in the DB.

import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function deriveOrgKey(orgId: string): Promise<string> {
  const masterKey = process.env.MASTER_ENCRYPTION_KEY
  if (!masterKey) {
    throw new Error('MASTER_ENCRYPTION_KEY must be set')
  }

  const admin = service()
  const { data: org, error } = await admin
    .from('organisations')
    .select('encryption_salt')
    .eq('id', orgId)
    .single()

  if (error || !org) throw new Error(`Org ${orgId} not found`)

  return createHmac('sha256', masterKey)
    .update(`${orgId}${org.encryption_salt}`)
    .digest('hex')
}

/**
 * Encrypt a secret for an org. Returns raw bytea (Buffer) suitable for the
 * integration_connectors.config bytea column.
 *
 * Uses pgcrypto's pgp_sym_encrypt via a SQL call so the ciphertext includes
 * the version, salt, iv, and HMAC per the pgcrypto format.
 */
export async function encryptForOrg(orgId: string, plaintext: string): Promise<Buffer> {
  const key = await deriveOrgKey(orgId)
  const admin = service()
  const { data, error } = await admin.rpc('encrypt_secret', {
    plaintext,
    derived_key: key,
  })
  if (error) throw new Error(`Encryption failed: ${error.message}`)
  // pgp_sym_encrypt returns bytea — supabase-js returns it as hex string "\\x...."
  // or as a Buffer depending on config. Normalise to Buffer.
  if (typeof data === 'string') {
    const hex = data.startsWith('\\x') ? data.slice(2) : data
    return Buffer.from(hex, 'hex')
  }
  return Buffer.from(data as ArrayBuffer)
}

export async function decryptForOrg(orgId: string, ciphertext: Buffer | string): Promise<string> {
  const key = await deriveOrgKey(orgId)
  const admin = service()

  // Ensure ciphertext is in a form pgcrypto can use. Supabase REST expects hex
  // with \x prefix for bytea columns.
  let encoded: string
  if (Buffer.isBuffer(ciphertext)) {
    encoded = '\\x' + ciphertext.toString('hex')
  } else if (ciphertext.startsWith('\\x')) {
    encoded = ciphertext
  } else {
    encoded = '\\x' + ciphertext
  }

  const { data, error } = await admin.rpc('decrypt_secret', {
    ciphertext: encoded,
    derived_key: key,
  })
  if (error) throw new Error(`Decryption failed: ${error.message}`)
  return data as string
}
