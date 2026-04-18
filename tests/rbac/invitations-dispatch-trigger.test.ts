import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createTestOrg, cleanupTestOrg, type TestOrg } from '../rls/helpers'

// ADR-0044 Phase 2.5 — invitation email dispatch primitives.
//
// End-to-end Resend dispatch can't run in CI (no real email target,
// no Vault secret). These tests cover the deterministic pieces:
//   * new columns exist and default to sane values
//   * dispatch_invitation_email RPC is defined
//   * service-role simulation of the dispatcher's success path
//     (email_dispatched_at set → list_pending_invitations still
//     surfaces the invite because acceptance, not dispatch, is what
//     removes it from the pending view)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
}

describe('ADR-0044 Phase 2.5 — dispatch primitives', () => {
  let owner: TestOrg

  beforeAll(async () => {
    owner = await createTestOrg('phase25')
  }, 60000)

  afterAll(async () => {
    await cleanupTestOrg(owner)
  }, 60000)

  it('new invitations have null email_dispatched_at and 0 attempts', async () => {
    const { data: created } = await owner.client.rpc('create_invitation', {
      p_email: `d1-${Date.now()}@test.consentshield.in`,
      p_role: 'viewer',
      p_account_id: owner.accountId,
      p_org_id: owner.orgId,
    })
    const invitationId = (created as Array<{ id: string }>)[0].id

    const { data: row } = await serviceClient()
      .from('invitations')
      .select('email_dispatched_at, email_dispatch_attempts, email_last_error')
      .eq('id', invitationId)
      .single()

    expect(row).toBeTruthy()
    expect(row!.email_dispatched_at).toBeNull()
    expect(row!.email_dispatch_attempts).toBe(0)
    expect(row!.email_last_error).toBeNull()
  })

  it('simulated dispatcher success sets email_dispatched_at', async () => {
    const { data: created } = await owner.client.rpc('create_invitation', {
      p_email: `d2-${Date.now()}@test.consentshield.in`,
      p_role: 'viewer',
      p_account_id: owner.accountId,
      p_org_id: owner.orgId,
    })
    const invitationId = (created as Array<{ id: string }>)[0].id

    // Simulate the dispatcher route handler's success-path update.
    await serviceClient()
      .from('invitations')
      .update({
        email_dispatched_at: new Date().toISOString(),
        email_dispatch_attempts: 1,
        email_last_error: null,
      })
      .eq('id', invitationId)

    const { data: row } = await serviceClient()
      .from('invitations')
      .select('email_dispatched_at, email_dispatch_attempts')
      .eq('id', invitationId)
      .single()
    expect(row!.email_dispatched_at).not.toBeNull()
    expect(row!.email_dispatch_attempts).toBe(1)

    // Still pending from the UI's perspective (dispatch is orthogonal
    // to pending/accepted).
    const { data: pending } = await owner.client.rpc('list_pending_invitations')
    const ids = ((pending ?? []) as Array<{ id: string }>).map((r) => r.id)
    expect(ids).toContain(invitationId)
  })

  it('dispatch_invitation_email returns gracefully when Vault secrets are absent', async () => {
    // In a fresh dev DB, the Vault secrets cs_invitation_dispatch_url +
    // cs_invitation_dispatch_secret may not be configured. The helper
    // must return NULL (soft failure) rather than raising — the cron
    // retry will pick it up once the operator configures them.
    const { data: created } = await owner.client.rpc('create_invitation', {
      p_email: `d3-${Date.now()}@test.consentshield.in`,
      p_role: 'viewer',
      p_account_id: owner.accountId,
      p_org_id: owner.orgId,
    })
    const invitationId = (created as Array<{ id: string }>)[0].id

    // Invocation via service-role (not exposed to authenticated). The
    // function signature is (uuid) -> bigint so null is a valid return.
    const { error } = await serviceClient().rpc('dispatch_invitation_email', {
      p_id: invitationId,
    })
    // If Vault is configured, the call succeeds and posts. If not,
    // the function returns null. Either way, no error should surface.
    expect(error).toBeNull()
  })
})
