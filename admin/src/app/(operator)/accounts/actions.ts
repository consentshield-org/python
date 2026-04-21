'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0048 Sprint 1.2 — Accounts Server Actions.

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

type RequiredActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

// ADR-0058 Sprint 1.5 — operator-initiated intake. Thin wrapper around
// `admin.create_operator_intake`. The RPC itself validates plan_code,
// Rule 12 / single-account invariants, and raises loudly on any bad
// input (caller is an admin who wants feedback).
export async function createOperatorIntakeAction(input: {
  email: string
  planCode: string
  orgName: string | null
}): Promise<RequiredActionResult<{ id: string; token: string }>> {
  const email = input.email.trim().toLowerCase()
  if (!email || email.length < 5) {
    return { ok: false, error: 'Valid email required.' }
  }
  if (!input.planCode) {
    return { ok: false, error: 'plan_code required.' }
  }

  const supabase = await createServerClient()
  const { data, error } = await supabase
    .schema('admin')
    .rpc('create_operator_intake', {
      p_email: email,
      p_plan_code: input.planCode,
      p_org_name: input.orgName,
    })
  if (error) return { ok: false, error: error.message }

  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') {
    return { ok: false, error: 'RPC returned no row.' }
  }
  const record = row as { id?: string; token?: string }
  if (!record.id || !record.token) {
    return { ok: false, error: 'RPC returned an unexpected shape.' }
  }

  // ADR-0058 follow-up — synchronous dispatch. The old DB trigger
  // that fired email via net.http_post is gone (migration
  // 20260803000007); admin now tells the app to dispatch
  // immediately. Failure here is telemetry, not a UX blocker — the
  // invitation row is already written and the operator can manually
  // re-fire from the admin console if needed.
  await fireDispatch(record.id).catch((err) => {
    console.error(
      'admin.create_operator_intake.dispatch.threw',
      err instanceof Error ? err.message : String(err),
    )
  })

  revalidatePath('/accounts')
  return { ok: true, data: { id: record.id, token: record.token } }
}

async function fireDispatch(invitationId: string): Promise<void> {
  const appBase =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.NODE_ENV === 'production'
      ? 'https://app.consentshield.in'
      : 'http://localhost:3000')
  const secret = process.env.INVITATION_DISPATCH_SECRET ?? ''
  if (!secret) {
    console.warn(
      'admin.create_operator_intake.dispatch.skipped',
      'INVITATION_DISPATCH_SECRET not set on admin env',
    )
    return
  }
  const res = await fetch(`${appBase}/api/internal/invitation-dispatch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ invitation_id: invitationId }),
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.warn(
      'admin.create_operator_intake.dispatch.nonfatal',
      res.status,
      body.slice(0, 300),
    )
  }
}

export async function suspendAccountAction(input: {
  accountId: string
  reason: string
}): Promise<ActionResult<{ flippedOrgCount: number }>> {
  if (!input.accountId) return { ok: false, error: 'Account id required.' }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }
  const supabase = await createServerClient()
  const { data, error } = await supabase.schema('admin').rpc('suspend_account', {
    p_account_id: input.accountId,
    p_reason: input.reason.trim(),
  })
  if (error) return { ok: false, error: error.message }
  const payload = data as { flipped_org_count?: number } | null
  revalidatePath('/accounts')
  revalidatePath(`/accounts/${input.accountId}`)
  revalidatePath('/billing')
  return { ok: true, data: { flippedOrgCount: payload?.flipped_org_count ?? 0 } }
}

export async function restoreAccountAction(input: {
  accountId: string
  reason: string
}): Promise<ActionResult<{ restoredOrgCount: number }>> {
  if (!input.accountId) return { ok: false, error: 'Account id required.' }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }
  const supabase = await createServerClient()
  const { data, error } = await supabase.schema('admin').rpc('restore_account', {
    p_account_id: input.accountId,
    p_reason: input.reason.trim(),
  })
  if (error) return { ok: false, error: error.message }
  const payload = data as { restored_org_count?: number } | null
  revalidatePath('/accounts')
  revalidatePath(`/accounts/${input.accountId}`)
  revalidatePath('/billing')
  return {
    ok: true,
    data: { restoredOrgCount: payload?.restored_org_count ?? 0 },
  }
}

// ADR-0055 Sprint 1.1 — account-scoped impersonation start.
// Mirrors the org-scoped startImpersonation Server Action. Stays thin:
// validates inputs, calls the RPC, returns the new session id. The admin
// app cookie / banner live in `@/lib/impersonation/cookie` (one active
// session at a time — account-scoped sessions share the same slot).
export async function startAccountImpersonationAction(input: {
  accountId: string
  accountName: string
  reason: string
  reasonDetail: string
  durationMinutes: number
}): Promise<{ ok: true; data: { sessionId: string } } | { ok: false; error: string }> {
  if (!input.accountId) return { ok: false, error: 'Account id required.' }
  if (input.reasonDetail.trim().length < 10) {
    return { ok: false, error: 'Reason detail must be at least 10 characters.' }
  }
  if (input.durationMinutes < 1 || input.durationMinutes > 120) {
    return { ok: false, error: 'Duration must be 1–120 minutes.' }
  }

  const supabase = await createServerClient()
  const { data, error } = await supabase
    .schema('admin')
    .rpc('start_impersonation_account', {
      p_account_id: input.accountId,
      p_reason: input.reason,
      p_reason_detail: input.reasonDetail.trim(),
      p_duration_minutes: input.durationMinutes,
    })
  if (error) return { ok: false, error: error.message }
  if (typeof data !== 'string') {
    return { ok: false, error: 'RPC returned no session id.' }
  }

  revalidatePath('/accounts')
  revalidatePath(`/accounts/${input.accountId}`)
  return { ok: true, data: { sessionId: data } }
}
