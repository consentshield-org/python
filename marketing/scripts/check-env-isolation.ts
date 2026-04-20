#!/usr/bin/env bunx tsx
// ADR-0501 Phase 4 Sprint 4.1 — env-var isolation guard (marketing).
//
// Mirrors scripts/check-env-isolation.ts at the repo root (which guards
// the customer ↔ admin boundary). The marketing site is a third Vercel
// project; its env surface must stay lean.
//
// Runs in `prebuild` so a mis-scoped secret fails the build, not
// production. Variable NAMES are printed on violation; values are NEVER
// logged.
//
// Marketing must NOT carry:
//   · Any ADMIN_* var (admin-only operator secrets).
//   · Customer-app-only secrets:
//       - MASTER_ENCRYPTION_KEY       (per-org customer encryption)
//       - DELETION_CALLBACK_SECRET    (customer deletion callback HMAC)
//       - RAZORPAY_WEBHOOK_SECRET     (webhooks post to customer app)
//       - RAZORPAY_KEY_SECRET         (customer checkout + admin refund)
//       - SUPABASE_SERVICE_ROLE_KEY   (admin-tier DB operations only)
//       - SUPABASE_JWT_SECRET         (JWT signing for customer app)
//
// Marketing may carry (all optional — dev falls back to Turnstile test
// keys / Resend no-op):
//   · NEXT_PUBLIC_TURNSTILE_SITE_KEY  (public site key for widget)
//   · TURNSTILE_SECRET_KEY            (server-side verify)
//   · RESEND_API_KEY                  (contact form submit)
//   · SENTRY_DSN                      (error reporting)
//   · MARKETING_*                     (any marketing-scoped extras)
//
// Exit codes:
//   0 — isolation intact
//   1 — isolation violated (offending var names printed)
//   2 — not running in the marketing workspace (safety net)

const FORBIDDEN_EXACT = [
  'MASTER_ENCRYPTION_KEY',
  'DELETION_CALLBACK_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'RAZORPAY_KEY_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
] as const

const FORBIDDEN_PREFIXES = ['ADMIN_'] as const

function isMarketingWorkspace(): boolean {
  const name = process.env.VERCEL_PROJECT_NAME ?? ''
  if (name === 'consentshield-marketing') return true
  if (name === 'consentshield' || name === 'consentshield-admin') return false
  const cwd = process.cwd()
  return cwd.endsWith('/marketing') || cwd.endsWith('\\marketing')
}

function main(): void {
  if (!isMarketingWorkspace()) {
    console.error(
      'check-env-isolation.ts run outside the marketing workspace.\n' +
        'Set VERCEL_PROJECT_NAME, or run from marketing/.',
    )
    process.exit(2)
  }

  const offences: string[] = []

  for (const name of FORBIDDEN_EXACT) {
    if (process.env[name] !== undefined) offences.push(name)
  }
  for (const name of Object.keys(process.env)) {
    for (const prefix of FORBIDDEN_PREFIXES) {
      if (name.startsWith(prefix)) offences.push(name)
    }
  }

  if (offences.length > 0) {
    console.error('\n❌ marketing env-isolation violation:')
    for (const o of new Set(offences)) {
      console.error(`   · ${o}`)
    }
    console.error(
      '\nThese variables belong to the customer or admin project and must',
      '\nnot be set on the marketing Vercel project. Remove them from the',
      '\nproject env and redeploy.\n',
    )
    process.exit(1)
  }

  console.log('✓ marketing env isolation intact')
}

main()
