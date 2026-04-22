/**
 * ADR-1014 Sprint 1.2 — E2E Supabase test-project bootstrap.
 *
 * Seeds 3 vertical fixture orgs (ecommerce / healthcare / bfsi), each with:
 *   - auth.user (fixture email + password)
 *   - accounts row (trial plan)
 *   - organisations row
 *   - 3 web_properties (demo.*.consentshield.in + localhost probe + sandbox)
 *   - 1 active API key (plaintext cs_test_*, sha256 hash stored)
 *   - account_memberships + org_memberships rows
 *
 * Idempotent: re-running reuses existing fixtures (matched by a fixed name
 * pattern `e2e-fixture-<vertical>`). Generates a new plaintext API key only
 * if no active key exists for the fixture account.
 *
 * Reads env from the repo's root .env.local (same source as tests/rls/helpers.ts):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Writes .env.e2e at the repo root. Never prints the service role key.
 *
 * Usage:
 *   bunx tsx scripts/e2e-bootstrap.ts            # idempotent — default
 *   bunx tsx scripts/e2e-bootstrap.ts --force    # drop + recreate all fixtures
 *
 * NOT for production / customer Supabase projects. This is a test-project
 * helper; it assumes the DB it talks to is disposable.
 */

import { createClient } from '@supabase/supabase-js'
import { config as loadDotenv } from 'dotenv'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')

loadDotenv({ path: resolve(REPO_ROOT, '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  console.error(
    'Missing env. e2e-bootstrap needs NEXT_PUBLIC_SUPABASE_URL, ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.local.'
  )
  process.exit(1)
}

const FORCE = process.argv.includes('--force')

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

// ─── Fixture catalog ─────────────────────────────────────────────────────

interface VerticalSpec {
  slug: 'ecommerce' | 'healthcare' | 'bfsi'
  displayName: string
  accountName: string
  orgName: string
  planCode: string
  demoHost: string
  properties: Array<{ name: string; url: string; allowedOrigins: string[] }>
  fixtureEmail: string
  fixturePassword: string
  envPrefix: string
}

const VERTICALS: VerticalSpec[] = [
  {
    slug: 'ecommerce',
    displayName: 'Demo Apparel Co (E-commerce)',
    accountName: 'e2e-fixture-ecommerce',
    orgName: 'Demo Apparel Co',
    planCode: 'trial_starter',
    demoHost: 'demo-ecommerce.consentshield.in',
    properties: [
      {
        name: 'Storefront',
        url: 'https://demo-ecommerce.consentshield.in',
        allowedOrigins: [
          'https://demo-ecommerce.consentshield.in',
          'http://localhost:4001'
        ]
      },
      {
        name: 'Checkout',
        url: 'https://demo-ecommerce.consentshield.in/checkout',
        allowedOrigins: [
          'https://demo-ecommerce.consentshield.in',
          'http://localhost:4001'
        ]
      },
      {
        name: 'Sandbox probe',
        url: 'http://localhost:4001/sandbox',
        allowedOrigins: ['http://localhost:4001']
      }
    ],
    fixtureEmail: 'e2e-ecom@test.consentshield.in',
    fixturePassword: 'e2e-ECOM-pass-2026-04-22',
    envPrefix: 'ECOM'
  },
  {
    slug: 'healthcare',
    displayName: 'Demo Clinic Care (Healthcare)',
    accountName: 'e2e-fixture-healthcare',
    orgName: 'Demo Clinic Care',
    planCode: 'trial_starter',
    demoHost: 'demo-clinic.consentshield.in',
    properties: [
      {
        name: 'Clinic website',
        url: 'https://demo-clinic.consentshield.in',
        allowedOrigins: [
          'https://demo-clinic.consentshield.in',
          'http://localhost:4002'
        ]
      },
      {
        name: 'Patient portal',
        url: 'https://demo-clinic.consentshield.in/portal',
        allowedOrigins: [
          'https://demo-clinic.consentshield.in',
          'http://localhost:4002'
        ]
      },
      {
        name: 'Sandbox probe',
        url: 'http://localhost:4002/sandbox',
        allowedOrigins: ['http://localhost:4002']
      }
    ],
    fixtureEmail: 'e2e-health@test.consentshield.in',
    fixturePassword: 'e2e-HEALTH-pass-2026-04-22',
    envPrefix: 'HEALTH'
  },
  {
    slug: 'bfsi',
    displayName: 'Demo Fintech (BFSI)',
    accountName: 'e2e-fixture-bfsi',
    orgName: 'Demo Fintech',
    planCode: 'trial_starter',
    demoHost: 'demo-fintech.consentshield.in',
    properties: [
      {
        name: 'Marketing site',
        url: 'https://demo-fintech.consentshield.in',
        allowedOrigins: [
          'https://demo-fintech.consentshield.in',
          'http://localhost:4003'
        ]
      },
      {
        name: 'Onboarding',
        url: 'https://demo-fintech.consentshield.in/onboarding',
        allowedOrigins: [
          'https://demo-fintech.consentshield.in',
          'http://localhost:4003'
        ]
      },
      {
        name: 'Sandbox probe',
        url: 'http://localhost:4003/sandbox',
        allowedOrigins: ['http://localhost:4003']
      }
    ],
    fixtureEmail: 'e2e-bfsi@test.consentshield.in',
    fixturePassword: 'e2e-BFSI-pass-2026-04-22',
    envPrefix: 'BFSI'
  }
]

// ─── Fixture ops ─────────────────────────────────────────────────────────

interface VerticalState {
  spec: VerticalSpec
  accountId: string
  orgId: string
  userId: string
  propertyIds: string[]
  propertySigningSecrets: string[]
  bannerIds: string[]
  apiKeyPlaintext: string
  apiKeyId: string
}

function generateApiKeyPlaintext(): string {
  // Match the cs_live_ prefix convention but use cs_test_ for test fixtures.
  // Base64url (no +/=) for URL-safety in Bearer headers.
  const raw = randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `cs_test_${raw}`
}

function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

async function ensureVertical(spec: VerticalSpec): Promise<VerticalState> {
  console.log(`[${spec.slug}] ensuring fixture`)

  // ─── Auth user ───
  let userId: string | null = null
  const { data: existingUsers } = await admin.auth.admin.listUsers()
  const existingUser = existingUsers?.users.find((u) => u.email === spec.fixtureEmail)
  if (existingUser && !FORCE) {
    userId = existingUser.id
    console.log(`[${spec.slug}] reusing auth.user ${userId}`)
  } else {
    if (existingUser && FORCE) {
      await admin.auth.admin.deleteUser(existingUser.id)
      console.log(`[${spec.slug}] --force: deleted old auth.user`)
    }
    const { data, error } = await admin.auth.admin.createUser({
      email: spec.fixtureEmail,
      password: spec.fixturePassword,
      email_confirm: true,
      user_metadata: { e2e_fixture: spec.slug }
    })
    if (error) throw new Error(`[${spec.slug}] createUser: ${error.message}`)
    userId = data.user.id
    console.log(`[${spec.slug}] created auth.user ${userId}`)
  }

  // ─── Account ───
  let accountId: string
  const { data: existingAccount } = await admin
    .from('accounts')
    .select('id')
    .eq('name', spec.accountName)
    .maybeSingle()
  if (existingAccount && !FORCE) {
    accountId = existingAccount.id
    console.log(`[${spec.slug}] reusing account ${accountId}`)
  } else {
    if (existingAccount && FORCE) {
      await admin.from('accounts').delete().eq('id', existingAccount.id)
      console.log(`[${spec.slug}] --force: deleted old account`)
    }
    const { data, error } = await admin
      .from('accounts')
      .insert({
        name: spec.accountName,
        plan_code: spec.planCode,
        status: 'trial'
      })
      .select('id')
      .single()
    if (error) throw new Error(`[${spec.slug}] createAccount: ${error.message}`)
    accountId = data.id
    console.log(`[${spec.slug}] created account ${accountId}`)
  }

  // ─── Account membership ───
  const { data: existingAcctMember } = await admin
    .from('account_memberships')
    .select('account_id')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!existingAcctMember) {
    const { error } = await admin.from('account_memberships').insert({
      account_id: accountId,
      user_id: userId,
      role: 'account_owner',
      status: 'active',
      accepted_at: new Date().toISOString()
    })
    if (error) throw new Error(`[${spec.slug}] account_memberships: ${error.message}`)
    console.log(`[${spec.slug}] seeded account_memberships`)
  }

  // ─── Organisation ───
  let orgId: string
  const { data: existingOrg } = await admin
    .from('organisations')
    .select('id')
    .eq('name', spec.orgName)
    .eq('account_id', accountId)
    .maybeSingle()
  if (existingOrg && !FORCE) {
    orgId = existingOrg.id
    console.log(`[${spec.slug}] reusing organisation ${orgId}`)
  } else {
    if (existingOrg && FORCE) {
      await admin.from('organisations').delete().eq('id', existingOrg.id)
    }
    const { data, error } = await admin
      .from('organisations')
      .insert({ name: spec.orgName, account_id: accountId })
      .select('id')
      .single()
    if (error) throw new Error(`[${spec.slug}] createOrg: ${error.message}`)
    orgId = data.id
    console.log(`[${spec.slug}] created organisation ${orgId}`)
  }

  // ─── Org membership ───
  const { data: existingOrgMember } = await admin
    .from('org_memberships')
    .select('org_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!existingOrgMember) {
    const { error } = await admin.from('org_memberships').insert({
      org_id: orgId,
      user_id: userId,
      role: 'org_admin'
    })
    if (error) throw new Error(`[${spec.slug}] org_memberships: ${error.message}`)
    console.log(`[${spec.slug}] seeded org_memberships`)
  }

  // ─── Web properties (3 per org) ───
  // Signing secrets are read back alongside the id so the E2E HMAC helper
  // can mirror the Worker's verifier. Secrets are written to .env.e2e in
  // clear; the file is gitignored + mode 0600.
  const propertyIds: string[] = []
  const propertySigningSecrets: string[] = []
  const bannerIds: string[] = []
  for (const prop of spec.properties) {
    const { data: existingProp } = await admin
      .from('web_properties')
      .select('id, event_signing_secret')
      .eq('org_id', orgId)
      .eq('name', prop.name)
      .maybeSingle()
    let propertyId: string
    let signingSecret: string
    if (existingProp) {
      propertyId = existingProp.id
      signingSecret = existingProp.event_signing_secret
    } else {
      const { data, error } = await admin
        .from('web_properties')
        .insert({
          org_id: orgId,
          name: prop.name,
          url: prop.url,
          allowed_origins: prop.allowedOrigins
        })
        .select('id, event_signing_secret')
        .single()
      if (error) throw new Error(`[${spec.slug}] createProperty: ${error.message}`)
      propertyId = data.id
      signingSecret = data.event_signing_secret
      console.log(`[${spec.slug}] created web_property "${prop.name}" ${propertyId}`)
    }
    propertyIds.push(propertyId)
    propertySigningSecrets.push(signingSecret)

    // One consent_banner per property (Sprint 1.3 — needed for the HMAC
    // pipeline test; consent_events has a FK to consent_banners.id).
    const { data: existingBanner } = await admin
      .from('consent_banners')
      .select('id')
      .eq('property_id', propertyId)
      .eq('version', 1)
      .maybeSingle()
    let bannerId: string
    if (existingBanner) {
      bannerId = existingBanner.id
    } else {
      const { data, error } = await admin
        .from('consent_banners')
        .insert({
          org_id: orgId,
          property_id: propertyId,
          version: 1,
          is_active: true,
          headline: 'We value your consent',
          body_copy: 'E2E fixture banner — seeded by scripts/e2e-bootstrap.ts.',
          position: 'bottom-bar',
          purposes: [
            { code: 'essential', required: true },
            { code: 'analytics', required: false },
            { code: 'marketing', required: false }
          ],
          monitoring_enabled: true
        })
        .select('id')
        .single()
      if (error) throw new Error(`[${spec.slug}] createBanner: ${error.message}`)
      bannerId = data.id
      console.log(`[${spec.slug}] created consent_banner ${bannerId} for "${prop.name}"`)
    }
    bannerIds.push(bannerId)
  }

  // ─── API key (plaintext + hash) ───
  // Strategy: if there's an active e2e-tagged key AND .env.e2e already has a
  // plaintext whose hash matches, reuse. Otherwise mint a new key and stash
  // plaintext in the returned state (caller writes it to .env.e2e).
  const existingPlaintext = readExistingPlaintext(spec.envPrefix)
  let apiKeyPlaintext: string | null = null
  let apiKeyId: string | null = null

  if (existingPlaintext && !FORCE) {
    const hash = hashApiKey(existingPlaintext)
    const { data: matched } = await admin
      .from('api_keys')
      .select('id')
      .eq('account_id', accountId)
      .eq('key_hash', hash)
      .is('revoked_at', null)
      .maybeSingle()
    if (matched) {
      apiKeyPlaintext = existingPlaintext
      apiKeyId = matched.id
      console.log(`[${spec.slug}] reusing api_key ${apiKeyId}`)
    }
  }

  if (!apiKeyPlaintext) {
    apiKeyPlaintext = generateApiKeyPlaintext()
    const hash = hashApiKey(apiKeyPlaintext)
    const prefix = apiKeyPlaintext.slice(0, 16)
    const { data, error } = await admin
      .from('api_keys')
      .insert({
        account_id: accountId,
        org_id: orgId,
        key_hash: hash,
        key_prefix: prefix,
        name: `e2e-fixture-${spec.slug}`,
        scopes: [
          'read:consent',
          'write:consent',
          'read:artefacts',
          'write:artefacts',
          'read:rights',
          'write:rights',
          'read:deletion',
          'write:deletion'
        ],
        rate_tier: 'sandbox',
        created_by: userId
      })
      .select('id')
      .single()
    if (error) throw new Error(`[${spec.slug}] createApiKey: ${error.message}`)
    apiKeyId = data.id
    console.log(`[${spec.slug}] minted api_key ${apiKeyId}`)
  }

  return {
    spec,
    accountId,
    orgId,
    userId: userId!,
    propertyIds,
    propertySigningSecrets,
    bannerIds,
    apiKeyPlaintext: apiKeyPlaintext!,
    apiKeyId: apiKeyId!
  }
}

// ─── .env.e2e I/O ────────────────────────────────────────────────────────

const ENV_FILE = resolve(REPO_ROOT, '.env.e2e')

function readExistingPlaintext(prefix: string): string | null {
  if (!existsSync(ENV_FILE)) return null
  const content = readFileSync(ENV_FILE, 'utf8')
  const line = content
    .split('\n')
    .find((l) => l.startsWith(`TEST_API_KEY_${prefix}=`))
  if (!line) return null
  const value = line.slice(line.indexOf('=') + 1).trim()
  return value.length > 0 ? value : null
}

function writeEnvFile(states: VerticalState[]): void {
  const lines: string[] = []
  lines.push('# .env.e2e — seeded by scripts/e2e-bootstrap.ts')
  lines.push(`# Generated: ${new Date().toISOString()}`)
  lines.push(`# Source Supabase: ${SUPABASE_URL}`)
  lines.push('# DO NOT COMMIT. gitignored by default.')
  lines.push('')
  lines.push('# ─── App surfaces (override if you run on non-default ports) ───')
  lines.push('APP_URL=http://localhost:3000')
  lines.push('ADMIN_URL=http://localhost:3001')
  lines.push('MARKETING_URL=http://localhost:3002')
  lines.push('WORKER_URL=http://localhost:8787')
  lines.push('')
  lines.push('# ─── Supabase (copied from .env.local at bootstrap time) ───')
  lines.push(`SUPABASE_URL=${SUPABASE_URL}`)
  lines.push(`SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}`)
  lines.push('')

  for (const state of states) {
    const p = state.spec.envPrefix
    lines.push(`# ─── Fixture: ${state.spec.displayName} ───`)
    lines.push(`FIXTURE_${p}_ACCOUNT_ID=${state.accountId}`)
    lines.push(`FIXTURE_${p}_ORG_ID=${state.orgId}`)
    lines.push(`FIXTURE_${p}_USER_ID=${state.userId}`)
    lines.push(`FIXTURE_${p}_USER_EMAIL=${state.spec.fixtureEmail}`)
    lines.push(`FIXTURE_${p}_USER_PASSWORD=${state.spec.fixturePassword}`)
    state.propertyIds.forEach((id, i) => {
      lines.push(`FIXTURE_${p}_PROPERTY_${i + 1}_ID=${id}`)
      lines.push(`FIXTURE_${p}_PROPERTY_${i + 1}_URL=${state.spec.properties[i].url}`)
      lines.push(`FIXTURE_${p}_PROPERTY_${i + 1}_SECRET=${state.propertySigningSecrets[i]}`)
      lines.push(`FIXTURE_${p}_PROPERTY_${i + 1}_BANNER_ID=${state.bannerIds[i]}`)
    })
    lines.push(`TEST_API_KEY_${p}=${state.apiKeyPlaintext}`)
    lines.push(`TEST_API_KEY_${p}_ID=${state.apiKeyId}`)
    lines.push('')
  }

  writeFileSync(ENV_FILE, lines.join('\n') + '\n', { mode: 0o600 })
  console.log(`\nWrote ${ENV_FILE} (mode 0600)`)
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const start = Date.now()
  console.log(`e2e-bootstrap: target ${SUPABASE_URL} (force=${FORCE})`)

  // Sanity: verify api_keys table exists.
  const { error: schemaError } = await admin
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .limit(1)
  if (schemaError) {
    console.error(
      `\n❌ Schema check failed: ${schemaError.message}\n` +
        `   Run \`bunx supabase db push\` first to apply migrations.`
    )
    process.exit(1)
  }

  const states: VerticalState[] = []
  for (const spec of VERTICALS) {
    states.push(await ensureVertical(spec))
  }

  writeEnvFile(states)

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(
    `\n✓ Bootstrap complete in ${elapsed}s. ${states.length} fixtures ready.`
  )
  console.log(
    `  Fixture accounts: ${states.map((s) => s.spec.accountName).join(', ')}`
  )
  console.log(
    `  Run \`cd tests/e2e && bun run test:smoke\` to verify harness wiring.`
  )
}

main().catch((err) => {
  console.error('e2e-bootstrap failed:', err)
  process.exit(1)
})
