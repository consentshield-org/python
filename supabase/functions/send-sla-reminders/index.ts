// Supabase Edge Function: send-sla-reminders
// Scheduled daily at 08:00 IST via pg_cron (migration 014).
// Sends 7-day and 1-day warnings for unverified rights requests.
// Deduplicates by checking rights_request_events for existing sla_warning_sent.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// S-7: cs_orchestrator key is required. The service-role fallback is gone —
// running this function under the master key would violate rule #5.
const ORCHESTRATOR_KEY = Deno.env.get('SUPABASE_ORCHESTRATOR_ROLE_KEY')
if (!ORCHESTRATOR_KEY) {
  throw new Error(
    'SUPABASE_ORCHESTRATOR_ROLE_KEY is required. Set it as a Supabase Function secret.',
  )
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const RESEND_FROM = Deno.env.get('RESEND_FROM') || 'onboarding@resend.dev'
const APP_URL = Deno.env.get('APP_URL') || 'https://app.consentshield.in'

interface PendingRequest {
  id: string
  org_id: string
  request_type: string
  requestor_name: string
  requestor_email: string
  sla_deadline: string
  status: string
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, ORCHESTRATOR_KEY)

  const now = new Date()
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const in1Day = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString()
  const nowIso = now.toISOString()

  // 7-day warning: deadline in 6-8 days (not completed)
  const sevenDayStart = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString()
  const { data: week7 } = await supabase
    .from('rights_requests')
    .select('id, org_id, request_type, requestor_name, requestor_email, sla_deadline, status')
    .eq('email_verified', true)
    .in('status', ['new', 'in_progress'])
    .gte('sla_deadline', sevenDayStart)
    .lte('sla_deadline', in7Days)

  // 1-day warning
  const { data: day1 } = await supabase
    .from('rights_requests')
    .select('id, org_id, request_type, requestor_name, requestor_email, sla_deadline, status')
    .eq('email_verified', true)
    .in('status', ['new', 'in_progress'])
    .gte('sla_deadline', nowIso)
    .lte('sla_deadline', in1Day)

  // Overdue
  const { data: overdue } = await supabase
    .from('rights_requests')
    .select('id, org_id, request_type, requestor_name, requestor_email, sla_deadline, status')
    .eq('email_verified', true)
    .in('status', ['new', 'in_progress'])
    .lt('sla_deadline', nowIso)

  let sent = 0
  for (const list of [
    { rows: week7 ?? [], threshold: '7-day' },
    { rows: day1 ?? [], threshold: '1-day' },
    { rows: overdue ?? [], threshold: 'overdue' },
  ]) {
    for (const req of list.rows as PendingRequest[]) {
      const alreadySent = await hasReminder(supabase, req.id, list.threshold)
      if (alreadySent) continue

      await sendReminder(supabase, req, list.threshold)
      sent++
    }
  }

  return new Response(JSON.stringify({ sent }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

async function hasReminder(
  supabase: ReturnType<typeof createClient>,
  requestId: string,
  threshold: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('rights_request_events')
    .select('id')
    .eq('request_id', requestId)
    .eq('event_type', `sla_warning_${threshold}`)
    .limit(1)

  return !!data && data.length > 0
}

async function sendReminder(
  supabase: ReturnType<typeof createClient>,
  req: PendingRequest,
  threshold: string,
) {
  // Get org compliance contact
  const { data: org } = await supabase
    .from('organisations')
    .select('name, compliance_contact_email')
    .eq('id', req.org_id)
    .single()

  const to = (org as { name: string; compliance_contact_email: string | null } | null)
    ?.compliance_contact_email
  const orgName = (org as { name: string } | null)?.name ?? 'your organisation'

  if (to && RESEND_API_KEY) {
    const isOverdue = threshold === 'overdue'
    const subject = isOverdue
      ? `⚠️ OVERDUE: ${req.request_type} request from ${req.requestor_name}`
      : `Reminder: ${req.request_type} request SLA in ${threshold}`
    const bodyHtml = isOverdue
      ? `<p>The ${req.request_type} request from <strong>${req.requestor_name}</strong> is overdue. DPDP mandates a 30-day response.</p><p><a href="${APP_URL}/dashboard/rights/${req.id}">Open request</a></p>`
      : `<p>The ${req.request_type} request from <strong>${req.requestor_name}</strong> has ${threshold} remaining under the DPDP 30-day SLA.</p><p><a href="${APP_URL}/dashboard/rights/${req.id}">Open request</a></p>`

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `ConsentShield <${RESEND_FROM}>`,
        to: [to],
        subject,
        html: bodyHtml,
      }),
    })
  }

  // Append rights_request_events so we don't send twice
  await supabase.from('rights_request_events').insert({
    request_id: req.id,
    org_id: req.org_id,
    event_type: `sla_warning_${threshold}`,
    notes: `Reminder sent: ${threshold}`,
  })
}
