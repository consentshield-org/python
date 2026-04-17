'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0030 Sprint 3.1 — customer Server Action to apply a sectoral
// template. Wraps public.apply_sectoral_template. The RPC picks the
// latest published version for the given template_code.

type ActionResult = { ok: true; applied: unknown } | { ok: false; error: string }

export async function applyTemplate(templateCode: string): Promise<ActionResult> {
  if (!templateCode.trim()) {
    return { ok: false, error: 'Template code required.' }
  }

  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('apply_sectoral_template', {
    p_template_code: templateCode.trim(),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/dashboard/template')
  revalidatePath('/dashboard')
  return { ok: true, applied: data }
}
