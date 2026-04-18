// ADR-0042 — signup bootstrap extracted into a pure helper so the
// idempotency guard can be unit-tested.
//
// Behaviour identical to the inline code previously in
// app/src/app/auth/callback/route.ts:
//   1. If the user has any org_memberships row → return skipped.
//   2. Else if user_metadata.org_name is present → call
//      rpc_signup_bootstrap_org; return bootstrapped (or error).
//   3. Else → return skipped ("/dashboard empty state handles it").

import type { SupabaseClient, User } from '@supabase/supabase-js'

export type BootstrapResult =
  | { action: 'skipped'; reason: 'existing_member' | 'no_metadata' }
  | { action: 'bootstrapped' }
  | { action: 'failed'; error: string }

export async function ensureOrgBootstrap(
  supabase: SupabaseClient,
  user: User,
): Promise<BootstrapResult> {
  const { data: existing } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (existing) return { action: 'skipped', reason: 'existing_member' }

  const meta = (user.user_metadata ?? {}) as {
    org_name?: string
    industry?: string | null
  }
  if (!meta.org_name) return { action: 'skipped', reason: 'no_metadata' }

  const { error } = await supabase.rpc('rpc_signup_bootstrap_org', {
    p_org_name: meta.org_name,
    p_industry: meta.industry ?? null,
  })
  if (error) return { action: 'failed', error: error.message }
  return { action: 'bootstrapped' }
}
