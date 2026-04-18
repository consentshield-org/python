'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0048 Sprint 1.2 — Accounts Server Actions.

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

export async function suspendAccountAction(input: {
  accountId: string
  reason: string
}): Promise<ActionResult<{ flippedOrgCount: number }>> {
  if (!input.accountId) return { ok: false, error: 'Account id required.' }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }
  const supabase = await createServerClient()
  const { data, error } = await supabase.schema('admin').rpc('suspend_account', {
    p_account_id: input.accountId,
    p_reason: input.reason.trim(),
  })
  if (error) return { ok: false, error: error.message }
  const payload = data as { flipped_org_count?: number } | null
  revalidatePath('/accounts')
  revalidatePath(`/accounts/${input.accountId}`)
  revalidatePath('/billing')
  return { ok: true, data: { flippedOrgCount: payload?.flipped_org_count ?? 0 } }
}

export async function restoreAccountAction(input: {
  accountId: string
  reason: string
}): Promise<ActionResult<{ restoredOrgCount: number }>> {
  if (!input.accountId) return { ok: false, error: 'Account id required.' }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }
  const supabase = await createServerClient()
  const { data, error } = await supabase.schema('admin').rpc('restore_account', {
    p_account_id: input.accountId,
    p_reason: input.reason.trim(),
  })
  if (error) return { ok: false, error: error.message }
  const payload = data as { restored_org_count?: number } | null
  revalidatePath('/accounts')
  revalidatePath(`/accounts/${input.accountId}`)
  revalidatePath('/billing')
  return {
    ok: true,
    data: { restoredOrgCount: payload?.restored_org_count ?? 0 },
  }
}
