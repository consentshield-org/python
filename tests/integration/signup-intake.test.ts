// ADR-0058 Sprint 1.5 (deferred) → ADR-1014 Phase 3 Sprint 3.1.
//
// Closes ADR-0058's open integration test item. Tests the 6 branches of
// `public.create_signup_intake(email, plan_code, org_name, ip)` at the RPC
// level (the Node route handler adds Turnstile + rate-limit wrappers on top;
// those are tested elsewhere).
//
// Branches covered (migration 20260803000006_signup_intake_explicit_status.sql):
//   created              — fresh email + active plan → invitation row + token
//   already_invited      — duplicate within the 14-day pending window
//   existing_customer    — email belongs to a non-admin auth.users row
//   admin_identity       — email belongs to an admin-flagged user (Rule 12)
//   invalid_email        — shape check fails
//   invalid_plan         — plan_code missing or inactive

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getServiceClient } from '../rls/helpers'

const admin = getServiceClient()

interface IntakeResult {
  branch:
    | 'created'
    | 'already_invited'
    | 'existing_customer'
    | 'admin_identity'
    | 'invalid_email'
    | 'invalid_plan'
  id?: string
  token?: string
}

async function callIntakeRpc(
  email: string,
  planCode: string,
  orgName: string | null = null,
): Promise<IntakeResult> {
  const { data, error } = await admin.rpc('create_signup_intake', {
    p_email: email,
    p_plan_code: planCode,
    p_org_name: orgName,
    p_ip: null,
  })
  if (error) throw new Error(`create_signup_intake RPC: ${error.message}`)
  return data as IntakeResult
}

// Track everything we create so afterAll can purge — tests fail cleanly
// even if they bail mid-assertion.
const createdEmails = new Set<string>()
const createdAuthUserIds = new Set<string>()

function uniqueEmail(tag: string): string {
  const email =
    `signup-intake-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` +
    '@test.consentshield.in'
  createdEmails.add(email.toLowerCase())
  return email
}

async function seedAuthUser(
  email: string,
  opts: { isAdmin: boolean },
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: `dummy-${Math.random().toString(36).slice(2, 14)}`,
    email_confirm: true,
    app_metadata: opts.isAdmin ? { is_admin: true } : {},
  })
  if (error) throw new Error(`seedAuthUser ${email}: ${error.message}`)
  const id = data.user!.id
  createdAuthUserIds.add(id)
  return id
}

beforeAll(async () => {
  // Sanity: service-role client is reachable + the RPC exists.
  const { error } = await admin.rpc('create_signup_intake', {
    p_email: 'ping@invalid', // will return invalid_email; we just want to prove the RPC is callable
    p_plan_code: 'growth',
    p_org_name: null,
    p_ip: null,
  })
  if (error) {
    throw new Error(
      `create_signup_intake RPC not reachable: ${error.message} — ` +
        'check that migration 20260803000006 has been applied to this DB.',
    )
  }
}, 30_000)

afterAll(async () => {
  // Purge invitations by any of our emails (includes the sanity `ping@invalid`
  // — harmless if it never wrote a row).
  if (createdEmails.size > 0) {
    await admin
      .from('invitations')
      .delete()
      .in('invited_email', Array.from(createdEmails))
  }
  // Purge seeded auth.users rows we created.
  for (const id of createdAuthUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {
      // Swallow — afterAll must not fail the suite.
    })
  }
}, 60_000)

describe('create_signup_intake — ADR-0058 branches', () => {
  it('created — fresh email returns branch=created with id+token and writes an invitation row', async () => {
    const email = uniqueEmail('happy')
    const result = await callIntakeRpc(email, 'growth', 'Acme Demo Corp')

    expect(result.branch).toBe('created')
    expect(result.id).toBeTruthy()
    // Token is `gen_random_bytes(24)` hex-encoded → 48 hex chars.
    expect(result.token).toMatch(/^[0-9a-f]{48}$/)

    const { data: inv, error } = await admin
      .from('invitations')
      .select(
        'invited_email, plan_code, origin, role, account_id, org_id, default_org_name, accepted_at, revoked_at, expires_at, token',
      )
      .eq('id', result.id!)
      .single()
    if (error) throw new Error(`fetch invitation: ${error.message}`)

    expect(inv.invited_email).toBe(email.toLowerCase())
    expect(inv.plan_code).toBe('growth')
    expect(inv.origin).toBe('marketing_intake')
    expect(inv.role).toBe('account_owner')
    expect(inv.account_id).toBeNull()
    expect(inv.org_id).toBeNull()
    expect(inv.default_org_name).toBe('Acme Demo Corp')
    expect(inv.accepted_at).toBeNull()
    expect(inv.revoked_at).toBeNull()
    expect(inv.token).toBe(result.token)

    // Expires roughly 14 days out — guard against both drift and zero-TTL.
    const expiresAt = new Date(inv.expires_at as string).getTime()
    const now = Date.now()
    const days = (expiresAt - now) / (1000 * 60 * 60 * 24)
    expect(days).toBeGreaterThan(13)
    expect(days).toBeLessThan(15)
  })

  it('created — null / empty org_name stores as null (trimmed)', async () => {
    const email = uniqueEmail('null-org')
    const result = await callIntakeRpc(email, 'starter', '   ') // whitespace → null
    expect(result.branch).toBe('created')
    const { data: inv } = await admin
      .from('invitations')
      .select('default_org_name')
      .eq('id', result.id!)
      .single()
    expect(inv!.default_org_name).toBeNull()
  })

  it('already_invited — same email submitted twice returns the existing invitation id without a new row', async () => {
    const email = uniqueEmail('dupe')
    const first = await callIntakeRpc(email, 'starter')
    expect(first.branch).toBe('created')

    const second = await callIntakeRpc(email, 'pro', 'Doesnt Matter')
    expect(second.branch).toBe('already_invited')
    expect(second.id).toBe(first.id)
    // token not leaked on already_invited
    expect(second.token).toBeUndefined()

    // Only one row exists for this email.
    const { data: rows } = await admin
      .from('invitations')
      .select('id')
      .eq('invited_email', email.toLowerCase())
    expect(rows).toHaveLength(1)
  })

  it('existing_customer — email belongs to a non-admin auth.users row returns existing_customer and creates no invitation', async () => {
    const email = uniqueEmail('existing')
    await seedAuthUser(email, { isAdmin: false })

    const result = await callIntakeRpc(email, 'growth')
    expect(result.branch).toBe('existing_customer')
    expect(result.id).toBeUndefined()
    expect(result.token).toBeUndefined()

    const { data: rows } = await admin
      .from('invitations')
      .select('id')
      .eq('invited_email', email.toLowerCase())
    expect(rows).toHaveLength(0)
  })

  it('admin_identity — email belongs to an admin-flagged user returns admin_identity and creates no invitation (Rule 12)', async () => {
    const email = uniqueEmail('admin')
    await seedAuthUser(email, { isAdmin: true })

    const result = await callIntakeRpc(email, 'growth')
    expect(result.branch).toBe('admin_identity')
    expect(result.id).toBeUndefined()
    expect(result.token).toBeUndefined()

    const { data: rows } = await admin
      .from('invitations')
      .select('id')
      .eq('invited_email', email.toLowerCase())
    expect(rows).toHaveLength(0)
  })

  it('invalid_email — malformed input returns invalid_email', async () => {
    const result = await callIntakeRpc('not-an-email', 'growth')
    expect(result.branch).toBe('invalid_email')
    expect(result.id).toBeUndefined()
  })

  it('invalid_email — empty string returns invalid_email', async () => {
    const result = await callIntakeRpc('', 'growth')
    expect(result.branch).toBe('invalid_email')
  })

  it('invalid_plan — unknown plan_code returns invalid_plan', async () => {
    // Plan check runs first; email is never reached.
    const result = await callIntakeRpc(
      'doesnt-matter@test.consentshield.in',
      'ultra_nonexistent_plan',
    )
    expect(result.branch).toBe('invalid_plan')
    expect(result.id).toBeUndefined()
  })

  it('invalid_plan — null plan_code returns invalid_plan', async () => {
    // @ts-expect-error — exercising the null-guard branch
    const result = await callIntakeRpc('doesnt-matter@test.consentshield.in', null)
    expect(result.branch).toBe('invalid_plan')
  })

  it('branch precedence — invalid_plan is checked before invalid_email (matches RPC source order)', async () => {
    // Both email + plan are bad. RPC should return invalid_plan because
    // it's evaluated first in the function body.
    const result = await callIntakeRpc('also-bad', 'nope_nope')
    expect(result.branch).toBe('invalid_plan')
  })

  it('case-insensitive email match — Uppercase email collides with existing lowercase invitation', async () => {
    const emailLower = uniqueEmail('case').toLowerCase()
    const emailUpper = emailLower.toUpperCase()
    // Track the upper-case string too so cleanup doesn't miss it (shouldn't
    // exist, but belt + braces).
    createdEmails.add(emailUpper.toLowerCase())

    const first = await callIntakeRpc(emailLower, 'starter')
    expect(first.branch).toBe('created')

    const second = await callIntakeRpc(emailUpper, 'starter')
    expect(second.branch).toBe('already_invited')
    expect(second.id).toBe(first.id)
  })
})
