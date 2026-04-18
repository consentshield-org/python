import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env vars for RLS tests. Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY.')
}

export function getServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
}

export function getAnonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY)
}

export interface TestOrg {
  orgId: string
  accountId: string
  userId: string
  email: string
  client: SupabaseClient
}

let testCounter = 0

export async function createTestOrg(suffix?: string): Promise<TestOrg> {
  testCounter++
  const tag = suffix || `test${testCounter}`
  const email = `rls-test-${tag}-${Date.now()}@test.consentshield.in`
  const password = `TestPass!${Date.now()}`

  const admin = getServiceClient()

  // Create auth user
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (authError) throw new Error(`createUser failed: ${authError.message}`)
  const userId = authData.user.id

  // ADR-0044 Phase 0 — organisations now require an account_id FK.
  const { data: account, error: accountError } = await admin
    .from('accounts')
    .insert({ name: `Test Account ${tag}`, plan_code: 'trial_starter', status: 'trial' })
    .select('id')
    .single()
  if (accountError) throw new Error(`createAccount failed: ${accountError.message}`)

  // Create org under the account
  const { data: org, error: orgError } = await admin
    .from('organisations')
    .insert({ name: `Test Org ${tag}`, account_id: account.id })
    .select('id')
    .single()
  if (orgError) throw new Error(`createOrg failed: ${orgError.message}`)

  // Link user as org_admin (ADR-0044 Phase 1 role taxonomy: org_admin is
  // the owner-tier of a specific org).
  const { error: memberError } = await admin
    .from('org_memberships')
    .insert({ org_id: org.id, user_id: userId, role: 'org_admin' })
  if (memberError) throw new Error(`linkMember failed: ${memberError.message}`)

  // And seed the account-tier membership so requireOrgAccess() sees the
  // caller as account_owner when inheritance matters.
  const { error: acctMemberError } = await admin
    .from('account_memberships')
    .insert({ account_id: account.id, user_id: userId, role: 'account_owner', accepted_at: new Date().toISOString() })
  if (acctMemberError) throw new Error(`linkAccountMember failed: ${acctMemberError.message}`)

  // Sign in as the user to get an authenticated client
  const userClient = createClient(SUPABASE_URL, ANON_KEY)
  const { error: signInError } = await userClient.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`)

  // Force token refresh so JWT picks up org_id claim from the hook
  await userClient.auth.refreshSession()

  return { orgId: org.id, accountId: account.id, userId, email, client: userClient }
}

export async function cleanupTestOrg(testOrg: TestOrg) {
  const admin = getServiceClient()
  // Cascade delete handles org_memberships and all org-scoped data;
  // the account row is cleaned up after the org because the FK is
  // ON DELETE RESTRICT from org → account.
  await admin.from('organisations').delete().eq('id', testOrg.orgId)
  await admin.from('accounts').delete().eq('id', testOrg.accountId)
  await admin.auth.admin.deleteUser(testOrg.userId)
}

// Tables grouped by type for test generation
export const operationalTables = [
  'web_properties',
  'consent_banners',
  'data_inventory',
  'breach_notifications',
  'export_configurations',
  'tracker_overrides',
  'integration_connectors',
  'retention_rules',
  'notification_channels',
  'consent_artefact_index',
  'consent_probes',
  'api_keys',
  'gdpr_configurations',
  'dpo_engagements',
  'cross_border_transfers',
  'white_label_configs',
] as const

export const bufferTables = [
  'consent_events',
  'tracker_observations',
  'audit_log',
  'processing_log',
  'rights_request_events',
  'delivery_buffer',
  'deletion_receipts',
  'withdrawal_verifications',
  'security_scans',
  'consent_probe_runs',
] as const
