'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0036 Sprint 1.1 — Feature Flags & Kill Switches Server Actions.
//
// Wrappers over the three ADR-0027 Sprint 3.1 RPCs. The RPC layer is
// the authoritative gate (reason length, role check, audit insert in
// the same transaction). Client-side validation fails fast so the
// operator sees errors without a round-trip, but the DB-side checks
// are the source of truth.

type ActionResult = { ok: true } | { ok: false; error: string }

type FlagValue =
  | { type: 'boolean'; value: boolean }
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }

export async function setFeatureFlag(input: {
  flagKey: string
  scope: 'global' | 'org'
  orgId: string | null
  value: FlagValue
  description: string
  reason: string
}): Promise<ActionResult> {
  const key = input.flagKey.trim()
  if (!/^[a-z0-9_]+$/.test(key)) {
    return { ok: false, error: 'Flag key must be snake_case (a-z, 0-9, underscore).' }
  }
  if (input.scope === 'org' && !input.orgId) {
    return { ok: false, error: 'Org-scope flags require an org.' }
  }
  if (input.scope === 'global' && input.orgId) {
    return { ok: false, error: 'Global-scope flags must not carry an org id.' }
  }
  if (input.description.trim().length === 0) {
    return { ok: false, error: 'Description required.' }
  }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('set_feature_flag', {
    p_flag_key: key,
    p_scope: input.scope,
    p_value: input.value.value,
    p_description: input.description.trim(),
    p_org_id: input.orgId,
    p_reason: input.reason.trim(),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/flags')
  return { ok: true }
}

export async function deleteFeatureFlag(input: {
  flagKey: string
  scope: 'global' | 'org'
  orgId: string | null
  reason: string
}): Promise<ActionResult> {
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('delete_feature_flag', {
    p_flag_key: input.flagKey,
    p_scope: input.scope,
    p_org_id: input.orgId,
    p_reason: input.reason.trim(),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/flags')
  return { ok: true }
}

export async function toggleKillSwitch(input: {
  switchKey: string
  enabled: boolean
  reason: string
}): Promise<ActionResult> {
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('toggle_kill_switch', {
    p_switch_key: input.switchKey,
    p_enabled: input.enabled,
    p_reason: input.reason.trim(),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/flags')
  revalidatePath('/')
  return { ok: true }
}
