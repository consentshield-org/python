'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

export async function updateOrgIndustry(
  orgId: string,
  industry: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('update_org_industry', {
    p_org_id: orgId,
    p_industry: industry,
  })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/settings/account')
  revalidatePath('/dashboard/template')
  return { ok: true }
}
