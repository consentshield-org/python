import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Helpers for admin-side tests. Reuses the Supabase project + env vars
// that tests/rls/helpers.ts uses; adds admin-specific patterns:
//   * createAdminTestUser — signs up a user AND flips is_admin=true in
//     auth.users.raw_app_meta_data so their JWT carries the claim.
//   * cleanupAdminTestUser — deletes the auth user (cascade removes
//     the admin.admin_users row).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error(
    'Missing Supabase env vars for admin tests. Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY.',
  )
}

export function getAdminServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
}

export function getAdminAnonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY)
}

export interface AdminTestUser {
  userId: string
  email: string
  client: SupabaseClient
}

let adminTestCounter = 0

export async function createAdminTestUser(
  role: 'platform_operator' | 'support' | 'read_only' = 'platform_operator',
): Promise<AdminTestUser> {
  adminTestCounter++
  const tag = `admin${adminTestCounter}`
  const email = `admin-test-${tag}-${Date.now()}@test.consentshield.in`
  const password = `AdminTestPass!${Date.now()}`

  const service = getAdminServiceClient()

  // Create the auth user with the is_admin claim already set. Supabase
  // exposes raw_app_meta_data via the admin API's app_metadata field.
  const { data: authData, error: authError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: {
      is_admin: true,
      admin_role: role,
    },
  })
  if (authError) throw new Error(`createUser failed: ${authError.message}`)
  const userId = authData.user.id

  // Sign in as the user to get an authenticated client whose JWT carries
  // the is_admin + admin_role claims.
  const userClient = createClient(SUPABASE_URL, ANON_KEY)
  const { error: signInError } = await userClient.auth.signInWithPassword({
    email,
    password,
  })
  if (signInError) throw new Error(`admin signIn failed: ${signInError.message}`)

  return { userId, email, client: userClient }
}

export async function cleanupAdminTestUser(user: AdminTestUser) {
  const service = getAdminServiceClient()
  await service.auth.admin.deleteUser(user.userId)
}

// Read-only admin tables that Sprint 1.1 lands. Tests assert that admin
// JWT can SELECT and non-admin JWT cannot.
export const adminReadOnlyTables = ['admin_users', 'admin_audit_log'] as const
