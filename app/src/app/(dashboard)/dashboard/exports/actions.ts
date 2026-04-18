'use server'

// ADR-0040 Sprint 1.2 — export_configurations CRUD + verify.
// RLS gates the org boundary; admin-role gating comes from the existing
// export_configurations RLS policies (authored in ADR-0013 / ADR-0017 area).
// Credentials stored via encryptForOrg (per-org key derivation).

import { createServerClient } from '@/lib/supabase/server'
import { encryptForOrg, decryptForOrg } from '@consentshield/encryption'
import { putObject } from '@/lib/storage/sigv4'
import { revalidatePath } from 'next/cache'

interface ActionResult {
  success?: true
  error?: string
  verify_status?: 'verified' | 'failed'
  verify_detail?: string
}

function trim(v: FormDataEntryValue | null): string {
  return typeof v === 'string' ? v.trim() : ''
}

export async function saveR2Config(formData: FormData): Promise<ActionResult> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id, role')
    .eq('user_id', user.id)
    .single()
  if (!membership) return { error: 'No organisation' }
  if (membership.role !== 'org_admin') {
    return { error: 'org_admin role required' }
  }

  const bucket_name = trim(formData.get('bucket_name'))
  const path_prefix = trim(formData.get('path_prefix'))
  const endpoint = trim(formData.get('endpoint'))
  const access_key_id = trim(formData.get('access_key_id'))
  const secret_access_key = trim(formData.get('secret_access_key'))
  const region = trim(formData.get('region')) || 'auto'

  if (!bucket_name || !endpoint || !access_key_id || !secret_access_key) {
    return { error: 'bucket_name, endpoint, access_key_id, secret_access_key are required' }
  }
  if (!/^https:\/\/[^/]+/.test(endpoint)) {
    return { error: 'endpoint must be an https URL' }
  }

  const credentialJson = JSON.stringify({
    endpoint,
    access_key_id,
    secret_access_key,
  })
  const encrypted = await encryptForOrg(supabase, membership.org_id, credentialJson)

  const { error: upsertError } = await supabase
    .from('export_configurations')
    .upsert(
      {
        org_id: membership.org_id,
        storage_provider: 'r2',
        bucket_name,
        path_prefix,
        region,
        write_credential_enc: encrypted,
        is_verified: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id' },
    )
  if (upsertError) return { error: upsertError.message }

  revalidatePath('/dashboard/exports')
  revalidatePath('/dashboard/exports/settings')
  return { success: true }
}

export async function verifyR2Config(): Promise<ActionResult> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .single()
  if (!membership) return { error: 'No organisation' }

  const { data: cfg } = await supabase
    .from('export_configurations')
    .select('bucket_name, path_prefix, region, write_credential_enc')
    .eq('org_id', membership.org_id)
    .single()
  if (!cfg) return { error: 'No R2 configuration found' }

  let credentials: { endpoint: string; access_key_id: string; secret_access_key: string }
  try {
    const plaintext = await decryptForOrg(supabase, membership.org_id, cfg.write_credential_enc)
    credentials = JSON.parse(plaintext)
  } catch (e) {
    return {
      error: 'Unable to decrypt stored credentials',
      verify_status: 'failed',
      verify_detail: e instanceof Error ? e.message : 'unknown',
    }
  }

  const markerKey =
    (cfg.path_prefix ?? '') +
    `audit-exports/${membership.org_id}/verify-${Date.now()}.txt`

  try {
    await putObject({
      endpoint: credentials.endpoint,
      region: cfg.region ?? 'auto',
      bucket: cfg.bucket_name,
      key: markerKey,
      accessKeyId: credentials.access_key_id,
      secretAccessKey: credentials.secret_access_key,
      body: Buffer.from('ConsentShield R2 verification marker\n'),
      contentType: 'text/plain',
    })
  } catch (e) {
    await supabase
      .from('export_configurations')
      .update({ is_verified: false, updated_at: new Date().toISOString() })
      .eq('org_id', membership.org_id)
    return {
      verify_status: 'failed',
      verify_detail: e instanceof Error ? e.message : 'unknown',
      error: 'PUT to R2 failed — check bucket name, endpoint, and credentials',
    }
  }

  await supabase
    .from('export_configurations')
    .update({ is_verified: true, updated_at: new Date().toISOString() })
    .eq('org_id', membership.org_id)

  revalidatePath('/dashboard/exports')
  revalidatePath('/dashboard/exports/settings')
  return { success: true, verify_status: 'verified' }
}

export async function deleteR2Config(): Promise<ActionResult> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id, role')
    .eq('user_id', user.id)
    .single()
  if (!membership) return { error: 'No organisation' }
  if (membership.role !== 'org_admin') {
    return { error: 'org_admin role required' }
  }

  const { error } = await supabase
    .from('export_configurations')
    .delete()
    .eq('org_id', membership.org_id)
  if (error) return { error: error.message }

  revalidatePath('/dashboard/exports')
  revalidatePath('/dashboard/exports/settings')
  return { success: true }
}
