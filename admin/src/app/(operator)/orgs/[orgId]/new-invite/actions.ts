'use server'

import { createServerClient } from '@/lib/supabase/server'

// ADR-0044 Phase 2.3 — org_admin promotion invite (operator /
// account_owner). Wraps public.create_invitation(...) with
// p_role='org_admin', p_org_id=<org>, p_account_id=<org's account>.
// The RPC's own gate enforces the account_owner / is_admin check.

export interface CreateOrgAdminInviteInput {
  orgId: string
  accountId: string
  email: string
  expiresInDays: number
}

export type CreateInviteResult =
  | { ok: true; invitationId: string; token: string; acceptUrl: string; expiresAt: string }
  | { ok: false; error: string }

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_CUSTOMER_APP_URL ??
    'https://app.consentshield.in'
  )
}

export async function createOrgAdminInvite(
  input: CreateOrgAdminInviteInput,
): Promise<CreateInviteResult> {
  const email = input.email.trim().toLowerCase()
  if (email.length < 3 || !email.includes('@')) {
    return { ok: false, error: 'A valid email is required' }
  }
  if (
    input.expiresInDays < 1 ||
    input.expiresInDays > 90 ||
    !Number.isInteger(input.expiresInDays)
  ) {
    return { ok: false, error: 'Expiry must be an integer between 1 and 90 days' }
  }

  const supabase = await createServerClient()

  const { data, error } = await supabase.rpc('create_invitation', {
    p_email: email,
    p_role: 'org_admin',
    p_account_id: input.accountId,
    p_org_id: input.orgId,
    p_plan_code: null,
    p_trial_days: null,
    p_default_org_name: null,
    p_expires_in_days: input.expiresInDays,
  })

  if (error) return { ok: false, error: error.message }

  const row = Array.isArray(data) ? data[0] : data
  if (!row?.token || !row?.id) {
    return { ok: false, error: 'RPC returned no invitation — check role on this account' }
  }

  const expiresAt = new Date(
    Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
  ).toISOString()

  return {
    ok: true,
    invitationId: row.id,
    token: row.token,
    acceptUrl: `${appBaseUrl()}/signup?invite=${row.token}`,
    expiresAt,
  }
}
