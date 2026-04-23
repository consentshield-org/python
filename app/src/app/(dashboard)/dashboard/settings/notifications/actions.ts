'use server'

// ADR-1005 Phase 6 Sprint 6.4 — server actions for the notifications
// settings UI. CRUD over notification_channels + a test-send that
// dispatches a synthetic event through the registered adapter.
//
// Imports the adapter barrel as a side-effect so the registry is
// populated before getAdapter() is called inside dispatchEvent().

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { dispatchEvent } from '@/lib/notifications/dispatch'
import type {
  ChannelType,
  NotificationChannel,
  NotificationEvent,
} from '@/lib/notifications/adapters/types'
import '@/lib/notifications/adapters' // side-effect: registers all five adapters

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

interface AuthedContext {
  orgId: string
  userId: string
}

async function authedOrgContext(): Promise<
  | { ok: true; ctx: AuthedContext }
  | { ok: false; error: string }
> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'auth_required' }
  const { data: m } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .single()
  if (!m) return { ok: false, error: 'no_org' }
  return { ok: true, ctx: { orgId: (m as { org_id: string }).org_id, userId: user.id } }
}

export async function createChannelAction(input: {
  channelType: ChannelType
  config: Record<string, unknown>
  alertTypes: string[]
}): Promise<ActionResult<{ id: string }>> {
  const a = await authedOrgContext()
  if (!a.ok) return a
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('notification_channels')
    .insert({
      org_id: a.ctx.orgId,
      channel_type: input.channelType,
      config: input.config,
      alert_types: input.alertTypes,
      is_active: true,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  revalidatePath('/dashboard/settings/notifications')
  return { ok: true, data: { id: (data as { id: string }).id } }
}

export async function updateChannelAction(input: {
  channelId: string
  patch: {
    config?: Record<string, unknown>
    alert_types?: string[]
    is_active?: boolean
  }
}): Promise<ActionResult> {
  const a = await authedOrgContext()
  if (!a.ok) return a
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('notification_channels')
    .update(input.patch)
    .eq('id', input.channelId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/dashboard/settings/notifications')
  return { ok: true }
}

export async function deleteChannelAction(input: {
  channelId: string
}): Promise<ActionResult> {
  const a = await authedOrgContext()
  if (!a.ok) return a
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('notification_channels')
    .delete()
    .eq('id', input.channelId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/dashboard/settings/notifications')
  return { ok: true }
}

export async function testSendAction(input: {
  channelId: string
}): Promise<ActionResult<{
  ok: boolean
  channel_type: string
  attempts: number
  error?: string
  total_latency_ms: number
}>> {
  const a = await authedOrgContext()
  if (!a.ok) return a
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('notification_channels')
    .select('id, org_id, channel_type, config, alert_types, is_active')
    .eq('id', input.channelId)
    .eq('org_id', a.ctx.orgId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'channel_not_found' }
  const channel = data as NotificationChannel

  // Synthetic test event. We force-include 'test_send' in alert_types
  // for the dispatcher's filter regardless of what the channel is
  // configured to receive — operators expect "test send" to ignore
  // routing.
  const testKind = 'test_send'
  const channelForDispatch: NotificationChannel = {
    ...channel,
    alert_types: [...new Set([...channel.alert_types, testKind])],
    is_active: true,
  }

  const event: NotificationEvent = {
    kind: testKind,
    severity: 'info',
    subject: 'ConsentShield notification test',
    body:
      'If you can see this, the channel config is valid and the adapter '
      + 'reached your endpoint. This is a one-shot operator-triggered '
      + 'test. No real ConsentShield event is associated.',
    occurred_at: new Date().toISOString(),
    org_id: channel.org_id,
    context: { triggered_by: a.ctx.userId, channel_id: channel.id },
    idempotency_key: `test-send-${channel.id}-${Date.now()}`,
  }

  const report = await dispatchEvent(event, [channelForDispatch])
  const outcome = report.outcomes[0]
  if (!outcome) {
    return { ok: false, error: 'no_outcome' }
  }
  return {
    ok: true,
    data: {
      ok: outcome.ok,
      channel_type: outcome.channel_type,
      attempts: outcome.attempts,
      error: outcome.error,
      total_latency_ms: outcome.total_latency_ms,
    },
  }
}
