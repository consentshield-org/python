// ADR-0044 Phase 1 — Server-side role gate with account_owner inheritance.
//
// Usage:
//   const { supabase, orgId } = await requireOrgAccess(request.orgId, ['org_admin', 'admin'])
//
// Semantics:
//   * Reads the caller's effective role for the given org via the
//     public.effective_org_role(p_org_id uuid) SQL helper, which folds
//     account_owner (→ 'org_admin') and account_viewer (→ 'viewer')
//     inheritance.
//   * Throws if the caller is unauthenticated, not a member of the
//     org's account, or not in the allowed role set.
//   * Returns the authenticated Supabase server client + the resolved
//     org id so callers don't have to re-create it.
//
// v1 assumes one-account-per-user; the helper is future-proof for
// multi-account (reads via current_account_id() which derives from
// current_org_id() today and will flip to a cookie in v2).

import { createServerClient } from '@/lib/supabase/server'

export type OrgRole = 'org_admin' | 'admin' | 'viewer'

export class OrgAccessDeniedError extends Error {
  constructor(
    public readonly reason: 'unauthenticated' | 'not_a_member' | 'insufficient_role',
    public readonly effectiveRole: OrgRole | null = null,
  ) {
    super(`Org access denied: ${reason}`)
    this.name = 'OrgAccessDeniedError'
  }
}

export async function requireOrgAccess(
  orgId: string,
  allowed: OrgRole[],
) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new OrgAccessDeniedError('unauthenticated')

  const { data, error } = await supabase.rpc('effective_org_role', {
    p_org_id: orgId,
  })
  if (error) {
    throw new OrgAccessDeniedError('not_a_member')
  }

  const role = (data as OrgRole | null) ?? null
  if (role == null) throw new OrgAccessDeniedError('not_a_member')
  if (!allowed.includes(role)) {
    throw new OrgAccessDeniedError('insufficient_role', role)
  }

  return { supabase, user, orgId, role }
}
