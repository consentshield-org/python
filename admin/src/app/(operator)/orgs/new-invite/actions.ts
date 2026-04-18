'use server'

import { createServerClient } from '@/lib/supabase/server'

// ADR-0044 Phase 2.3 — account-creating invitation (operator only).
//
// Wraps public.create_invitation(...) for p_role='account_owner' with
// p_account_id = p_org_id = null. The RPC's own gate requires an
// is_admin JWT claim, so the admin /proxy.ts Rule 21 check is the
// front-line guard and the RPC rejects everything else.

export interface CreateAccountInviteInput {
  email: string
  planCode: string
  trialDaysOverride: number | null
  defaultOrgName: string | null
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

export async function createAccountInvite(
  input: CreateAccountInviteInput,
): Promise<CreateInviteResult> {
  const email = input.email.trim().toLowerCase()
  if (email.length < 3 || !email.includes('@')) {
    return { ok: false, error: 'A valid email is required' }
  }
  if (!input.planCode) {
    return { ok: false, error: 'Plan is required' }
  }
  if (
    input.expiresInDays < 1 ||
    input.expiresInDays > 90 ||
    !Number.isInteger(input.expiresInDays)
  ) {
    return { ok: false, error: 'Expiry must be an integer between 1 and 90 days' }
  }
  if (
    input.trialDaysOverride !== null &&
    (input.trialDaysOverride < 0 ||
      input.trialDaysOverride > 90 ||
      !Number.isInteger(input.trialDaysOverride))
  ) {
    return { ok: false, error: 'Trial days must be an integer between 0 and 90' }
  }

  const supabase = await createServerClient()

  const { data, error } = await supabase.rpc('create_invitation', {
    p_email: email,
    p_role: 'account_owner',
    p_account_id: null,
    p_org_id: null,
    p_plan_code: input.planCode,
    p_trial_days: input.trialDaysOverride,
    p_default_org_name: input.defaultOrgName?.trim() || null,
    p_expires_in_days: input.expiresInDays,
  })

  if (error) return { ok: false, error: error.message }

  const row = Array.isArray(data) ? data[0] : data
  if (!row?.token || !row?.id) {
    return { ok: false, error: 'RPC returned no invitation — check admin JWT + plan_code' }
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
