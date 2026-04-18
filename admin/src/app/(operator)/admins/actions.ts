'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { ServiceClientEnvError } from '@/lib/supabase/service'
import {
  AdminRole,
  changeAdminRole,
  disableAdmin,
  inviteAdmin,
  LifecycleError,
} from '@/lib/admin/lifecycle'

// ADR-0045 Sprint 2.1 — Admin Users Server Actions.
// Delegate orchestration to lib/admin/lifecycle.ts so the Route Handler
// + Server Action paths share the same ordering + rollback invariants.

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

function normaliseError(e: unknown): string {
  if (e instanceof LifecycleError) return e.message
  if (e instanceof ServiceClientEnvError) return e.message
  if (e instanceof Error) return e.message
  return 'Unknown error'
}

export async function inviteAdminAction(input: {
  email: string
  displayName: string
  adminRole: AdminRole
  reason: string
}): Promise<
  ActionResult<{
    adminId: string
    emailDispatched: boolean
    emailDispatchReason?: string
  }>
> {
  const email = input.email.trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, error: 'Valid email required.' }
  }
  if (input.displayName.trim().length < 1) {
    return { ok: false, error: 'Display name required.' }
  }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }
  if (
    input.adminRole !== 'platform_operator' &&
    input.adminRole !== 'support' &&
    input.adminRole !== 'read_only'
  ) {
    return { ok: false, error: 'Unknown role.' }
  }

  const authed = await createServerClient()
  const { data: callerRes } = await authed.auth.getUser()
  const callerId = callerRes.user?.id
  if (!callerId) return { ok: false, error: 'Not signed in.' }

  // Rule 5 carve-out: inviter display_name read via the caller's JWT +
  // cs_admin RLS. Service-role is reserved strictly for auth.admin.*
  // calls inside inviteAdmin().
  const { data: inviterRow } = await authed
    .schema('admin')
    .from('admin_users')
    .select('display_name')
    .eq('id', callerId)
    .maybeSingle()
  const inviterDisplayName = inviterRow?.display_name ?? 'A ConsentShield operator'

  try {
    const outcome = await inviteAdmin({
      authedClient: authed,
      email,
      displayName: input.displayName.trim(),
      adminRole: input.adminRole,
      reason: input.reason.trim(),
      inviterDisplayName,
    })
    revalidatePath('/admins')
    return {
      ok: true,
      data: {
        adminId: outcome.adminId,
        emailDispatched: outcome.emailDispatched,
        emailDispatchReason: outcome.emailDispatchReason,
      },
    }
  } catch (e) {
    return { ok: false, error: normaliseError(e) }
  }
}

export async function changeAdminRoleAction(input: {
  adminId: string
  newRole: AdminRole
  reason: string
}): Promise<ActionResult<{ authSyncUpdated: boolean; syncError?: string }>> {
  if (!input.adminId) return { ok: false, error: 'Admin id required.' }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }
  if (
    input.newRole !== 'platform_operator' &&
    input.newRole !== 'support' &&
    input.newRole !== 'read_only'
  ) {
    return { ok: false, error: 'Unknown role.' }
  }

  const authed = await createServerClient()
  try {
    const outcome = await changeAdminRole({
      authedClient: authed,
      adminId: input.adminId,
      newRole: input.newRole,
      reason: input.reason.trim(),
    })
    revalidatePath('/admins')
    return {
      ok: true,
      data: { authSyncUpdated: outcome.authSyncUpdated, syncError: outcome.syncError },
    }
  } catch (e) {
    return { ok: false, error: normaliseError(e) }
  }
}

export async function disableAdminAction(input: {
  adminId: string
  reason: string
}): Promise<ActionResult<{ authSyncUpdated: boolean; syncError?: string }>> {
  if (!input.adminId) return { ok: false, error: 'Admin id required.' }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }

  const authed = await createServerClient()
  try {
    const outcome = await disableAdmin({
      authedClient: authed,
      adminId: input.adminId,
      reason: input.reason.trim(),
    })
    revalidatePath('/admins')
    return {
      ok: true,
      data: { authSyncUpdated: outcome.authSyncUpdated, syncError: outcome.syncError },
    }
  } catch (e) {
    return { ok: false, error: normaliseError(e) }
  }
}
