/**
 * ADR-1014 Sprint 1.2 — idempotent E2E state reset.
 *
 * Clears buffer tables and any non-fixture auth.users created by a previous
 * E2E run. Fixture orgs/accounts/web_properties/api_keys (seeded by
 * e2e-bootstrap.ts) are preserved.
 *
 * Target: complete in under 20s on a dev-sized Supabase project.
 *
 * Usage:
 *   bunx tsx scripts/e2e-reset.ts
 */

import { createClient } from '@supabase/supabase-js'
import { config as loadDotenv } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
loadDotenv({ path: resolve(REPO_ROOT, '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('e2e-reset: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

// Tables wiped between E2E runs. Ordered so that FK children come before
// parents. Buffer tables proper (Rule-1 sense) plus DEPA artefact state
// generated during tests — not customer data.
const CLEAR_TABLES = [
  // DEPA artefact children (ref consent_artefacts)
  'consent_expiry_queue',
  'artefact_revocations',
  'consent_artefact_index',
  'consent_artefacts',
  // Event-table children before consent_events
  'consent_events',
  // Independent buffers
  'tracker_observations',
  'audit_log',
  'processing_log',
  'rights_request_events',
  'delivery_buffer',
  'deletion_receipts',
  'withdrawal_verifications',
  'security_scans',
  'consent_probe_runs'
] as const

// Fixture account names from e2e-bootstrap.ts — preserved across resets.
const FIXTURE_ACCOUNT_NAMES = [
  'e2e-fixture-ecommerce',
  'e2e-fixture-healthcare',
  'e2e-fixture-bfsi'
] as const

// Fixture user emails — preserved across resets.
const FIXTURE_EMAILS = [
  'e2e-ecom@test.consentshield.in',
  'e2e-health@test.consentshield.in',
  'e2e-bfsi@test.consentshield.in'
] as const

async function truncateBuffers(): Promise<void> {
  for (const table of CLEAR_TABLES) {
    // `neq('id', '00000000-0000-0000-0000-000000000000')` deletes all rows
    // (ids never match the zero UUID).
    const { error } = await admin
      .from(table)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) {
      console.warn(`  ${table}: ${error.message}`)
    } else {
      console.log(`  ✓ ${table} cleared`)
    }
  }
}

async function deleteNonFixtureUsers(): Promise<void> {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (error) {
    console.warn(`  listUsers: ${error.message}`)
    return
  }
  const fixtures = new Set<string>(FIXTURE_EMAILS)
  let deleted = 0
  for (const user of data.users) {
    const email = user.email ?? ''
    // Preserve fixtures AND any user NOT tagged as an E2E run.
    // Run-created users carry user_metadata.e2e_run === true.
    const isFixture = fixtures.has(email)
    const isE2eRunUser = user.user_metadata?.e2e_run === true
    if (isFixture) continue
    if (!isE2eRunUser) continue
    const { error: delErr } = await admin.auth.admin.deleteUser(user.id)
    if (delErr) {
      console.warn(`  deleteUser(${email}): ${delErr.message}`)
    } else {
      deleted++
    }
  }
  console.log(`  ✓ deleted ${deleted} non-fixture E2E users`)
}

async function main(): Promise<void> {
  const start = Date.now()
  console.log(`e2e-reset: target ${SUPABASE_URL}`)
  console.log(
    `  preserving fixture accounts: ${FIXTURE_ACCOUNT_NAMES.join(', ')}`
  )

  console.log('\nBuffer tables:')
  await truncateBuffers()

  console.log('\nAuth users (non-fixture, E2E-tagged only):')
  await deleteNonFixtureUsers()

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\n✓ Reset complete in ${elapsed}s.`)
}

main().catch((err) => {
  console.error('e2e-reset failed:', err)
  process.exit(1)
})
