import { createHmac, timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// ADR-0049 Phase 2 Sprint 2.1 — Sentry webhook ingestion.
//
// Sentry's internal-integration webhook posts here. We verify the HMAC
// on the raw body using SENTRY_WEBHOOK_SECRET, then upsert a row into
// public.sentry_events. Upsert uses sentry_id as the conflict key so
// Sentry's retry-on-timeout is idempotent.
//
// Resource routing: Sentry posts `event_alert`, `issue`, `error`, and
// other resource types. We handle `error` + `issue` events at severity
// ≥ warning today; extend filters here if operators start wanting
// lower-signal events.
//
// Rule 5 compliant: uses the anon Supabase key (public INSERT grant on
// sentry_events). No service-role in this handler.

export const runtime = 'nodejs'

interface SentryPayload {
  action?: string
  data?: {
    event?: {
      event_id?: string
      project?: string
      level?: string
      title?: string
      culprit?: string
      web_url?: string
      user_count?: number
      [key: string]: unknown
    }
    issue?: {
      id?: string
      project?: { slug?: string }
      level?: string
      title?: string
      culprit?: string
      permalink?: string
      userCount?: number
    }
  }
}

function verifyHmac(secret: string, rawBody: string, header: string | null): boolean {
  if (!header) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(header, 'hex'))
  } catch {
    return false
  }
}

function toLevel(raw: string | undefined): 'fatal' | 'error' | 'warning' | 'info' | 'debug' | null {
  if (!raw) return null
  const v = raw.toLowerCase()
  if (v === 'fatal' || v === 'error' || v === 'warning' || v === 'info' || v === 'debug') {
    return v
  }
  return null
}

export async function POST(request: Request) {
  const secret = process.env.SENTRY_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'SENTRY_WEBHOOK_SECRET not configured' },
      { status: 500 },
    )
  }

  const raw = await request.text()
  const sig = request.headers.get('sentry-hook-signature')
  if (!verifyHmac(secret, raw, sig)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let payload: SentryPayload
  try {
    payload = JSON.parse(raw) as SentryPayload
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  // Extract what we need. Sentry's webhook can carry either an `event`
  // or an `issue` shape depending on the integration + resource type;
  // both paths map to the same row.
  const ev = payload.data?.event
  const issue = payload.data?.issue
  const sentryId = ev?.event_id ?? issue?.id
  const projectSlug = ev?.project ?? issue?.project?.slug ?? 'unknown'
  const level = toLevel(ev?.level ?? issue?.level)
  const title = ev?.title ?? issue?.title ?? 'Untitled'
  const culprit = ev?.culprit ?? issue?.culprit ?? null
  const eventUrl = ev?.web_url ?? issue?.permalink ?? null
  const userCount = ev?.user_count ?? issue?.userCount ?? 0

  if (!sentryId || !level) {
    // Accept but ignore — Sentry may send events we don't persist
    // (e.g. informational resource pings). Return 200 so Sentry doesn't
    // retry; log to console for operator visibility.
    return NextResponse.json({ ok: true, skipped: 'unhandled_shape' }, { status: 200 })
  }

  // Filter to severity ≥ warning. Info/debug events are noise for the
  // Security panel; surface them in V2 if operator need emerges.
  if (level === 'info' || level === 'debug') {
    return NextResponse.json({ ok: true, skipped: 'low_severity' }, { status: 200 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabase = createClient(url, anon)

  const { error } = await supabase.from('sentry_events').upsert(
    {
      sentry_id: sentryId,
      project_slug: projectSlug,
      level,
      title: title.slice(0, 500),
      culprit: culprit?.slice(0, 500) ?? null,
      event_url: eventUrl?.slice(0, 1000) ?? null,
      user_count: typeof userCount === 'number' ? userCount : 0,
      payload: payload as unknown as Record<string, unknown>,
    },
    { onConflict: 'sentry_id', ignoreDuplicates: false },
  )

  if (error) {
    console.error('[sentry-webhook] upsert failed:', error.message)
    return NextResponse.json({ error: 'upsert_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
