'use server'

// ADR-0024 Sprint 1.1/1.2 — server actions for Purpose Definitions + Connector Mappings.
// RLS enforces the org boundary and admin-only gating (pd_insert_admin,
// pd_update_admin per ADR-0020 §11.6). We never use the service role key.

import { createServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

interface ActionResult {
  success?: true
  error?: string
}

function trimOrEmpty(v: FormDataEntryValue | null): string {
  return typeof v === 'string' ? v.trim() : ''
}

function parseChips(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== 'string') return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export async function createPurpose(formData: FormData): Promise<ActionResult> {
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

  const purpose_code = trimOrEmpty(formData.get('purpose_code'))
  const display_name = trimOrEmpty(formData.get('display_name'))
  const description = trimOrEmpty(formData.get('description'))
  const framework = trimOrEmpty(formData.get('framework')) || 'dpdp'
  const data_scope = parseChips(formData.get('data_scope'))
  const default_expiry_days = Number(formData.get('default_expiry_days')) || 365
  const auto_delete_on_expiry = formData.get('auto_delete_on_expiry') === 'on'

  if (!purpose_code || !display_name || !description) {
    return { error: 'purpose_code, display_name, and description are required' }
  }
  if (!/^[a-z][a-z0-9_]*$/.test(purpose_code)) {
    return { error: 'purpose_code must be lowercase snake_case' }
  }

  const { error } = await supabase.from('purpose_definitions').insert({
    org_id: membership.org_id,
    purpose_code,
    display_name,
    description,
    framework,
    data_scope,
    default_expiry_days,
    auto_delete_on_expiry,
  })
  if (error) return { error: error.message }

  revalidatePath('/dashboard/purposes')
  return { success: true }
}

export async function updatePurpose(
  purposeId: string,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const display_name = trimOrEmpty(formData.get('display_name'))
  const description = trimOrEmpty(formData.get('description'))
  const data_scope = parseChips(formData.get('data_scope'))
  const default_expiry_days = Number(formData.get('default_expiry_days')) || 365
  const auto_delete_on_expiry = formData.get('auto_delete_on_expiry') === 'on'

  if (!display_name || !description) {
    return { error: 'display_name and description are required' }
  }

  const { error } = await supabase
    .from('purpose_definitions')
    .update({
      display_name,
      description,
      data_scope,
      default_expiry_days,
      auto_delete_on_expiry,
      updated_at: new Date().toISOString(),
    })
    .eq('id', purposeId)
  if (error) return { error: error.message }

  revalidatePath('/dashboard/purposes')
  return { success: true }
}

export async function togglePurposeActive(
  purposeId: string,
  nextActive: boolean,
): Promise<ActionResult> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const { error } = await supabase
    .from('purpose_definitions')
    .update({ is_active: nextActive, updated_at: new Date().toISOString() })
    .eq('id', purposeId)
  if (error) return { error: error.message }

  revalidatePath('/dashboard/purposes')
  return { success: true }
}

// ═══════════════════════════════════════════════════════════
// Connector mappings (ADR-0024 Sprint 1.2)
// ═══════════════════════════════════════════════════════════

export async function createMapping(formData: FormData): Promise<ActionResult> {
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

  const purpose_definition_id = trimOrEmpty(formData.get('purpose_definition_id'))
  const connector_id = trimOrEmpty(formData.get('connector_id'))
  const data_categories = parseChips(formData.get('data_categories'))

  if (!purpose_definition_id || !connector_id || data_categories.length === 0) {
    return { error: 'purpose, connector, and at least one data category are required' }
  }

  // Verify data_categories ⊆ purpose.data_scope (server-side guard).
  const { data: purpose } = await supabase
    .from('purpose_definitions')
    .select('data_scope')
    .eq('id', purpose_definition_id)
    .single()
  if (!purpose) return { error: 'Purpose not found' }
  const scope: string[] = (purpose.data_scope as string[]) ?? []
  const stray = data_categories.filter((c) => !scope.includes(c))
  if (stray.length > 0) {
    return {
      error: `data_categories must be a subset of the purpose's data_scope. Stray: ${stray.join(', ')}`,
    }
  }

  const { error } = await supabase.from('purpose_connector_mappings').insert({
    org_id: membership.org_id,
    purpose_definition_id,
    connector_id,
    data_categories,
  })
  if (error) return { error: error.message }

  revalidatePath('/dashboard/purposes')
  return { success: true }
}

export async function deleteMapping(mappingId: string): Promise<ActionResult> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const { error } = await supabase
    .from('purpose_connector_mappings')
    .delete()
    .eq('id', mappingId)
  if (error) return { error: error.message }

  revalidatePath('/dashboard/purposes')
  return { success: true }
}
