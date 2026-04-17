#!/usr/bin/env bunx tsx
// ADR-0027 Sprint 4.1 — admin bootstrap one-shot.
//
// Promotes an existing auth.users row to the initial platform_operator
// admin. Idempotent: refuses to run if any admin.admin_users row
// already has bootstrap_admin=true.
//
// Usage:
//
//   BOOTSTRAP_ADMIN_EMAIL=a.d.sudhindra@gmail.com \
//   BOOTSTRAP_ADMIN_DISPLAY_NAME="Sudhindra Anegondhi" \
//   bunx tsx scripts/bootstrap-admin.ts --i-understand-this-is-a-one-time-action
//
// Preconditions:
//   * The email already has an auth.users row (user must sign up via
//     admin app /login first — the script does NOT create auth users).
//   * No admin.admin_users row exists with bootstrap_admin=true.
//
// The script runs under the Supabase service role key (.env.local's
// SUPABASE_SERVICE_ROLE_KEY) — Rule 5 carve-out: the service role key
// is for migrations and one-shot operator scripts, not running
// application code. This script qualifies.

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const SAFETY_FLAG = '--i-understand-this-is-a-one-time-action'

interface AuthUserRow {
  id: string
  email: string
  app_metadata: Record<string, unknown>
}

async function main(): Promise<void> {
  if (!process.argv.includes(SAFETY_FLAG)) {
    console.error(`Refusing to run without the explicit safety flag.\n\nUsage:\n  bunx tsx scripts/bootstrap-admin.ts ${SAFETY_FLAG}`)
    process.exit(2)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL
  const displayName = process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME

  if (!supabaseUrl || !serviceKey) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).')
    process.exit(2)
  }
  if (!email) {
    console.error('BOOTSTRAP_ADMIN_EMAIL is required.')
    process.exit(2)
  }
  if (!displayName) {
    console.error('BOOTSTRAP_ADMIN_DISPLAY_NAME is required.')
    process.exit(2)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── 1) Idempotency check ──────────────────────────────────────
  const { data: existingBootstrap, error: checkErr } = await supabase
    .schema('admin')
    .from('admin_users')
    .select('id, display_name, created_at')
    .eq('bootstrap_admin', true)
    .limit(1)
  if (checkErr) {
    console.error('Failed to query admin.admin_users:', checkErr.message)
    process.exit(1)
  }
  if (existingBootstrap && existingBootstrap.length > 0) {
    const row = existingBootstrap[0]
    console.error(
      `Refusing: a bootstrap admin already exists (id=${row.id}, display_name=${row.display_name}, created_at=${row.created_at}). This script is strictly one-shot.`,
    )
    process.exit(3)
  }

  // ── 2) Auth user lookup ───────────────────────────────────────
  //    listUsers doesn't have a server-side email filter; paginate
  //    defensively. Under realistic admin bootstrap scale (< a few
  //    thousand users), the first page is almost always enough.
  let authUser: AuthUserRow | null = null
  let page = 1
  const pageSize = 1000
  while (page <= 10) {
    const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ page, perPage: pageSize })
    if (listErr) {
      console.error('Failed to list auth users:', listErr.message)
      process.exit(1)
    }
    const match = list.users.find((u) => u.email === email)
    if (match) {
      authUser = {
        id: match.id,
        email: match.email ?? email,
        app_metadata: (match.app_metadata ?? {}) as Record<string, unknown>,
      }
      break
    }
    if (list.users.length < pageSize) break
    page += 1
  }
  if (!authUser) {
    console.error(
      `Refusing: no auth.users row with email ${email}. Sign up via the admin app's /login page first, then re-run this script.`,
    )
    process.exit(4)
  }
  console.log(`Resolved auth.users id for ${email}: ${authUser.id}`)

  // ── 3) Update raw_app_meta_data (merged, preserving existing keys) ─
  const nextAppMeta = {
    ...authUser.app_metadata,
    is_admin: true,
    admin_role: 'platform_operator' as const,
  }
  const { error: updErr } = await supabase.auth.admin.updateUserById(authUser.id, {
    app_metadata: nextAppMeta,
  })
  if (updErr) {
    console.error('Failed to update auth.users.raw_app_meta_data:', updErr.message)
    process.exit(1)
  }
  console.log(`Set app_metadata.is_admin=true + admin_role=platform_operator on ${authUser.id}`)

  // ── 4) Insert admin.admin_users row ───────────────────────────
  const { error: insErr } = await supabase.schema('admin').from('admin_users').insert({
    id: authUser.id,
    display_name: displayName,
    admin_role: 'platform_operator',
    bootstrap_admin: true,
    status: 'active',
  })
  if (insErr) {
    console.error('Failed to insert admin.admin_users:', insErr.message)
    console.error('The auth.users claims were updated but the admin_users row is missing. Re-run after resolving the error — the idempotency check reads bootstrap_admin, not claims.')
    process.exit(1)
  }
  console.log('Inserted admin.admin_users row with bootstrap_admin=true.')

  // ── 5) Confirmation ───────────────────────────────────────────
  const { data: finalRow } = await supabase
    .schema('admin')
    .from('admin_users')
    .select('id, display_name, admin_role, bootstrap_admin, status, created_at')
    .eq('id', authUser.id)
    .single()

  console.log('\nBootstrap complete.')
  console.log('  admin_users row:', finalRow)
  console.log('\nNext steps:')
  console.log('  1. Sign out and sign in on the admin app to refresh JWT claims (is_admin, admin_role).')
  console.log('  2. Verify the Operations Dashboard renders your display name.')
  console.log('  3. Register a second hardware key before enabling AAL2 enforcement (ADMIN_HARDWARE_KEY_ENFORCED=true).')
}

main().catch((err) => {
  console.error('Bootstrap failed with an uncaught error:', err)
  process.exit(1)
})
