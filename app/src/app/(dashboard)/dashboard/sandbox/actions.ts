'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ADR-1003 Sprint 5.1 — sandbox provisioning Server Action. Wraps
// public.rpc_provision_sandbox_org. Only callable by an account_owner;
// the RPC raises 42501 otherwise. When p_template_code is provided the
// Sprint 4.1 storage-mode gate may raise P0004 — surface verbatim so
// the caller learns to ask their admin to flip storage_mode first.

export type ProvisionResult =
  | {
      ok: true
      data: {
        org_id: string
        account_id: string
        sandbox: true
        template_applied: { code: string; version: number; display_name: string } | null
        storage_mode: 'standard' | 'insulated' | 'zero_storage'
      }
    }
  | { ok: false; error: string; code?: string }

export async function provisionSandboxOrg(
  name: string,
  templateCode: string | null,
): Promise<ProvisionResult> {
  if (!name.trim()) {
    return { ok: false, error: 'Sandbox org name is required.' }
  }
  if (name.trim().length > 120) {
    return { ok: false, error: 'Sandbox org name must be 120 characters or fewer.' }
  }

  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('rpc_provision_sandbox_org', {
    p_name: name.trim(),
    p_template_code: templateCode?.trim() || null,
  })

  if (error) {
    return { ok: false, error: error.message, code: error.code }
  }

  revalidatePath('/dashboard/sandbox')
  return {
    ok: true,
    data: data as ProvisionResult extends { ok: true; data: infer D } ? D : never,
  }
}
