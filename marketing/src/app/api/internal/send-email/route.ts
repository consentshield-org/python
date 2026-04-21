import { NextResponse } from 'next/server'
import {
  INVITATION_DISPATCH_SECRET,
  INVITE_FROM,
  RESEND_API_KEY,
  RESEND_ENABLED,
} from '@/lib/env'

// ADR-0058 follow-up — thin email relay.
//
// Called by the customer app's invitation dispatcher. Accepts a
// pre-rendered email payload + an explicit Bearer token; relays to
// Resend and returns Resend's result. No DB access, no business
// logic. The point of this file is to keep the Resend key off the
// customer-app surface — marketing is the only workspace that holds
// transactional-email credentials.
//
// Failure modes returned verbatim:
//   401  — bad / missing bearer
//   400  — malformed body
//   503  — RESEND_API_KEY not set on this deployment
//   502  — Resend returned non-2xx
//   200  — email accepted by Resend (body: { id })
//
// Scope limits:
//   - to[] capped at 10 recipients (invite emails are always 1)
//   - subject capped at 200 chars
//   - html + text each capped at 200 KB

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_RECIPIENTS = 10
const MAX_SUBJECT = 200
const MAX_BODY_BYTES = 200 * 1024

interface SendEmailBody {
  to?: unknown
  subject?: unknown
  html?: unknown
  text?: unknown
  reply_to?: unknown
  from?: unknown
}

interface Clean {
  to: string[]
  subject: string
  html: string
  text: string
  replyTo?: string
  from: string
}

export async function POST(request: Request) {
  if (!INVITATION_DISPATCH_SECRET) {
    return NextResponse.json(
      { error: 'relay_not_configured' },
      { status: 503 },
    )
  }

  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const provided = auth.slice('Bearer '.length).trim()
  if (provided !== INVITATION_DISPATCH_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const clean = shape(raw as SendEmailBody)
  if ('error' in clean) {
    return NextResponse.json({ error: clean.error }, { status: 400 })
  }

  if (!RESEND_ENABLED) {
    // Dev / unconfigured — log the send intent and 503 so the caller
    // can retry later. Consistent with the contact form's dev-log.
    console.log('\n[send-email/dev-log] RESEND_API_KEY unset — logging:')
    console.log(`  To:      ${clean.to.join(', ')}`)
    console.log(`  Subject: ${clean.subject}`)
    console.log(clean.text)
    return NextResponse.json(
      { error: 'resend_not_configured' },
      { status: 503 },
    )
  }

  let res: Response
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: clean.from,
        to: clean.to,
        subject: clean.subject,
        html: clean.html,
        text: clean.text,
        ...(clean.replyTo ? { reply_to: clean.replyTo } : {}),
      }),
      cache: 'no-store',
    })
  } catch (err) {
    console.error('send-email.resend.network', err)
    return NextResponse.json(
      { error: 'resend_network' },
      { status: 502 },
    )
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('send-email.resend.failed', res.status, body.slice(0, 400))
    return NextResponse.json(
      { error: 'resend_failed', status: res.status },
      { status: 502 },
    )
  }

  const resendBody = (await res.json().catch(() => null)) as
    | { id?: string }
    | null
  return NextResponse.json({ ok: true, id: resendBody?.id ?? null })
}

function shape(body: SendEmailBody): Clean | { error: string } {
  const rawTo = body.to
  const toList = Array.isArray(rawTo)
    ? rawTo.map((x) => (typeof x === 'string' ? x.trim() : ''))
    : typeof rawTo === 'string'
      ? [rawTo.trim()]
      : []
  const to = toList.filter((s) => s.length > 0 && isPlausibleEmail(s))
  if (to.length === 0) return { error: 'to_required' }
  if (to.length > MAX_RECIPIENTS) return { error: 'too_many_recipients' }

  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  if (!subject) return { error: 'subject_required' }
  if (subject.length > MAX_SUBJECT) return { error: 'subject_too_long' }

  const html = typeof body.html === 'string' ? body.html : ''
  const text = typeof body.text === 'string' ? body.text : ''
  if (!html && !text) return { error: 'body_required' }
  if (byteLen(html) > MAX_BODY_BYTES) return { error: 'html_too_large' }
  if (byteLen(text) > MAX_BODY_BYTES) return { error: 'text_too_large' }

  const replyTo =
    typeof body.reply_to === 'string' && isPlausibleEmail(body.reply_to)
      ? body.reply_to
      : undefined

  const from =
    typeof body.from === 'string' && body.from.trim().length > 0
      ? body.from.trim()
      : INVITE_FROM

  return { to, subject, html, text, replyTo, from }
}

function isPlausibleEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function byteLen(s: string): number {
  return Buffer.byteLength(s, 'utf8')
}
