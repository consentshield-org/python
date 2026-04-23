// ADR-1005 Phase 6 Sprint 6.4 — /dashboard/settings/notifications.
//
// Per-channel CRUD + alert-type subscription matrix + test-send.
// Email channel stays on Resend and does not appear here.

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ChannelsManager, type ChannelRow } from './channels'

export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .single()
  if (!membership) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-600">No organisation found. Complete signup.</p>
      </main>
    )
  }
  const orgId = (membership as { org_id: string }).org_id

  const { data: channelsRaw } = await supabase
    .from('notification_channels')
    .select('id, channel_type, config, alert_types, is_active')
    .eq('org_id', orgId)
    .order('channel_type')
    .order('id')

  const channels = (channelsRaw ?? []) as ChannelRow[]

  return (
    <main className="p-8 space-y-6 max-w-4xl">
      <header>
        <h1 className="text-2xl font-bold">Notification channels</h1>
        <p className="text-sm text-gray-600 mt-1">
          Configure where ConsentShield delivers operational alerts. Each channel
          subscribes to one or more alert types; events fan out to every active
          channel whose subscription includes the event kind. Email alerts go via
          Resend and are configured separately.
        </p>
      </header>

      <ChannelsManager initialChannels={channels} />

      <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900">
        <strong>Test-send</strong> dispatches a synthetic <code>test_send</code>{' '}
        event through the adapter pipeline (HMAC-signed for custom webhooks; Block
        Kit / Adaptive Card / embed for chat channels; Events API v2 for PagerDuty).
        The result line shows latency + retry count + any error verbatim from the
        adapter.
      </div>
    </main>
  )
}
