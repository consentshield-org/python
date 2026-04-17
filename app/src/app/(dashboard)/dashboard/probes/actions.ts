'use server'

// ADR-0041 Sprint 1.4 — probe CRUD server actions.
// RLS gates the org boundary. Admin-role gating in the action itself.

import { createServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

interface ActionResult {
  success?: true
  error?: string
  id?: string
}

const VALID_SCHEDULES = ['hourly', 'daily', 'weekly'] as const

function trim(v: FormDataEntryValue | null): string {
  return typeof v === 'string' ? v.trim() : ''
}

function parseConsentState(raw: FormDataEntryValue | null): Record<string, boolean> {
  const obj: Record<string, boolean> = {}
  if (typeof raw !== 'string') return obj
  for (const line of raw.split(/[,\n]/)) {
    const [kRaw, vRaw] = line.split(':').map((s) => s.trim())
    if (!kRaw) continue
    const v = (vRaw ?? '').toLowerCase()
    obj[kRaw] = v === 'true' || v === '1' || v === 'yes'
  }
  return obj
}

async function requireAdmin() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' as const }

  const { data: membership } = await supabase
    .from('organisation_members')
    .select('org_id, role')
    .eq('user_id', user.id)
    .single()
  if (!membership) return { error: 'No organisation' as const }
  if (membership.role !== 'admin' && membership.role !== 'owner') {
    return { error: 'Admin or owner role required' as const }
  }
  return { supabase, orgId: membership.org_id as string }
}

export async function createProbe(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return { error: ctx.error }

  const property_id = trim(formData.get('property_id'))
  const probe_type = trim(formData.get('probe_type')) || 'default'
  const schedule = trim(formData.get('schedule')) || 'weekly'
  const consent_state = parseConsentState(formData.get('consent_state'))

  if (!property_id) return { error: 'property_id is required' }
  if (!VALID_SCHEDULES.includes(schedule as (typeof VALID_SCHEDULES)[number])) {
    return { error: `schedule must be one of: ${VALID_SCHEDULES.join(', ')}` }
  }

  const { data, error } = await ctx.supabase
    .from('consent_probes')
    .insert({
      org_id: ctx.orgId,
      property_id,
      probe_type,
      consent_state,
      schedule,
      is_active: true,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidatePath('/dashboard/probes')
  return { success: true, id: data.id as string }
}

export async function updateProbe(
  probeId: string,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return { error: ctx.error }

  const schedule = trim(formData.get('schedule'))
  const consent_state = parseConsentState(formData.get('consent_state'))
  const is_active = formData.get('is_active') === 'on'

  const patch: Record<string, unknown> = {
    consent_state,
    is_active,
    updated_at: new Date().toISOString(),
  }
  if (schedule && VALID_SCHEDULES.includes(schedule as (typeof VALID_SCHEDULES)[number])) {
    patch.schedule = schedule
  }

  const { error } = await ctx.supabase
    .from('consent_probes')
    .update(patch)
    .eq('id', probeId)
  if (error) return { error: error.message }

  revalidatePath('/dashboard/probes')
  revalidatePath(`/dashboard/probes/${probeId}`)
  return { success: true }
}

export async function deleteProbe(probeId: string): Promise<ActionResult> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return { error: ctx.error }

  const { error } = await ctx.supabase
    .from('consent_probes')
    .delete()
    .eq('id', probeId)
  if (error) return { error: error.message }

  revalidatePath('/dashboard/probes')
  return { success: true }
}

export async function toggleProbeActive(
  probeId: string,
  nextActive: boolean,
): Promise<ActionResult> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return { error: ctx.error }

  const { error } = await ctx.supabase
    .from('consent_probes')
    .update({ is_active: nextActive, updated_at: new Date().toISOString() })
    .eq('id', probeId)
  if (error) return { error: error.message }

  revalidatePath('/dashboard/probes')
  return { success: true }
}
