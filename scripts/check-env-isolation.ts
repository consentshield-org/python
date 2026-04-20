#!/usr/bin/env bunx tsx
// ADR-0026 Sprint 4.1 — env-var isolation guard.
//
// Runs in the Vercel build step of each project. Reads the build-time
// environment and fails the deploy if the current project is carrying
// env vars that belong exclusively to the other project.
//
// The project being deployed is detected from the VERCEL_PROJECT_NAME
// env var (set by Vercel at build time) with a fallback to the workspace
// package name derived from process.cwd().
//
// Rules enforced:
//
//   Customer project (`consentshield`, CWD ends with /app):
//     must NOT carry any env var whose name starts with ADMIN_
//
//   Admin project (`consentshield-admin`, CWD ends with /admin):
//     must NOT carry any customer-only secret:
//       - MASTER_ENCRYPTION_KEY      (per-org customer encryption)
//       - DELETION_CALLBACK_SECRET   (customer deletion callback HMAC)
//       - RAZORPAY_WEBHOOK_SECRET    (webhooks post to customer app only)
//       - TURNSTILE_SECRET_KEY       (human-verification on rights portal)
//
// Shared infra (Supabase, Cloudflare, Sentry org) is allowed on both —
// the scoping is at the credential level (admin uses its own Supabase
// connection, Sentry project, etc.).
//
// Shared Razorpay API access: RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET are
// allowed on BOTH projects because the admin side actively calls Razorpay:
// refund issuance (ADR-0034) + dispute contest submission (ADR-0052). The
// customer app also holds them for checkout. Only the webhook receiver
// secret stays customer-only (the admin app does not receive webhooks).
//
// Exit codes:
//   0 — isolation intact
//   1 — isolation violated (prints offending var names; values are NEVER logged)
//   2 — project identity could not be determined

const CUSTOMER_ONLY_SECRETS = [
  'MASTER_ENCRYPTION_KEY',
  'DELETION_CALLBACK_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'TURNSTILE_SECRET_KEY',
] as const

type Project = 'customer' | 'admin'

function detectProject(): Project | null {
  const name = process.env.VERCEL_PROJECT_NAME ?? ''
  if (name === 'consentshield') return 'customer'
  if (name === 'consentshield-admin') return 'admin'

  // Fallback when run outside Vercel (local CI dry-run): infer from CWD.
  const cwd = process.cwd()
  if (cwd.endsWith('/app') || cwd.endsWith('\\app')) return 'customer'
  if (cwd.endsWith('/admin') || cwd.endsWith('\\admin')) return 'admin'

  return null
}

function main(): void {
  const project = detectProject()
  if (project === null) {
    console.error(
      'Could not determine which Vercel project is deploying.\n' +
        'Set VERCEL_PROJECT_NAME, or run this script from app/ or admin/.',
    )
    process.exit(2)
  }

  const offences: string[] = []

  if (project === 'customer') {
    for (const name of Object.keys(process.env)) {
      if (name.startsWith('ADMIN_')) offences.push(name)
    }
  } else {
    for (const name of CUSTOMER_ONLY_SECRETS) {
      if (process.env[name] !== undefined) offences.push(name)
    }
  }

  if (offences.length === 0) {
    console.log(`OK — env isolation intact for project "${project}".`)
    process.exit(0)
  }

  console.error(`FAIL — project "${project}" carries ${offences.length} foreign env var(s):\n`)
  for (const name of offences) console.error(`  ${name}`)
  if (project === 'customer') {
    console.error(
      '\nCustomer project must not carry ADMIN_* env vars. Remove them from the\n' +
        'Vercel project settings (Settings > Environment Variables).',
    )
  } else {
    console.error(
      '\nAdmin project must not carry customer-only secrets. Customer secrets are\n' +
        'scoped to the customer Vercel project; admin has its own connections.',
    )
  }
  process.exit(1)
}

main()
