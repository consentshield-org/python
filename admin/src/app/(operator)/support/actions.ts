'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0032 Sprint 1.1 — Support ticket Server Actions.
//
// Wraps the existing ADR-0027 Sprint 3.1 RPCs. The RPC layer enforces
// role (support or platform_operator), reason ≥ 10 chars where
// applicable, and the audit-log insert in same txn.

type ActionResult = { ok: true; messageId?: string } | { ok: false; error: string }

const TICKET_STATUSES = [
  'open',
  'awaiting_customer',
  'awaiting_operator',
  'resolved',
  'closed',
] as const

const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

export async function sendMessage(
  ticketId: string,
  body: string,
  options?: { isInternal?: boolean },
): Promise<ActionResult> {
  if (!body || body.trim().length === 0) {
    return { ok: false, error: 'Message body required.' }
  }

  const supabase = await createServerClient()
  const { data, error } = await supabase
    .schema('admin')
    .rpc('add_support_ticket_message', {
      p_ticket_id: ticketId,
      p_body: body.trim(),
      p_is_internal: options?.isInternal === true,
    })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/support/${ticketId}`)
  revalidatePath('/support')
  return { ok: true, messageId: data as string }
}

export async function changeStatus(
  ticketId: string,
  newStatus: string,
  reason: string,
): Promise<ActionResult> {
  if (!(TICKET_STATUSES as readonly string[]).includes(newStatus)) {
    return { ok: false, error: 'Invalid status.' }
  }
  if (reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('update_support_ticket', {
    p_ticket_id: ticketId,
    p_status: newStatus,
    p_reason: reason.trim(),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/support/${ticketId}`)
  revalidatePath('/support')
  return { ok: true }
}

export async function changePriority(
  ticketId: string,
  newPriority: string,
  reason: string,
): Promise<ActionResult> {
  if (!(TICKET_PRIORITIES as readonly string[]).includes(newPriority)) {
    return { ok: false, error: 'Invalid priority.' }
  }
  if (reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('update_support_ticket', {
    p_ticket_id: ticketId,
    p_priority: newPriority,
    p_reason: reason.trim(),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/support/${ticketId}`)
  revalidatePath('/support')
  return { ok: true }
}

export async function assignTicket(
  ticketId: string,
  assigneeAdminUserId: string,
  reason: string,
): Promise<ActionResult> {
  if (reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('assign_support_ticket', {
      p_ticket_id: ticketId,
      p_assigned_admin_user_id: assigneeAdminUserId,
      p_reason: reason.trim(),
    })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/support/${ticketId}`)
  revalidatePath('/support')
  return { ok: true }
}
