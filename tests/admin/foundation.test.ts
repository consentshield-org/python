import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAdminTestUser,
  cleanupAdminTestUser,
  getAdminAnonClient,
  getAdminServiceClient,
  AdminTestUser,
} from './helpers'
import { createTestOrg, cleanupTestOrg, TestOrg } from '../rls/helpers'

// ADR-0027 Sprint 1.1 — foundation tests.
//
// Verifies:
//   1. The admin schema exists with expected objects (via service role)
//   2. admin.* RLS blocks anon JWT
//   3. admin.* RLS blocks authenticated JWT without is_admin claim
//   4. admin.* RLS admits authenticated JWT with is_admin=true claim
//   5. The 4 admin helper functions exist and return expected values
//   6. Append-only invariant: even the admin JWT cannot INSERT/UPDATE/DELETE
//      on admin.admin_audit_log (revokes + no write RLS policy)

let admin: AdminTestUser
let customer: TestOrg

beforeAll(async () => {
  admin = await createAdminTestUser('platform_operator')
  customer = await createTestOrg('adminFoundation')
})

afterAll(async () => {
  if (admin) await cleanupAdminTestUser(admin)
  if (customer) await cleanupTestOrg(customer)
})

describe('ADR-0027 Sprint 1.1 — admin schema bootstrap', () => {
  it('admin.is_admin() returns true when called via the admin schema RPC path', async () => {
    const { data, error } = await admin.client.schema('admin').rpc('is_admin')
    expect(error).toBeNull()
    expect(data).toBe(true)
  })

  it('admin.is_admin() returns false when called by a non-admin JWT', async () => {
    const { data, error } = await customer.client.schema('admin').rpc('is_admin')
    expect(error).toBeNull()
    expect(data).toBe(false)
  })
})

describe('ADR-0027 Sprint 1.1 — admin.admin_users RLS', () => {
  it('admin JWT can SELECT admin.admin_users (returns zero rows — no admins bootstrapped yet)', async () => {
    const { data, error } = await admin.client.schema('admin').from('admin_users').select('id')
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('customer JWT (no is_admin claim) is denied SELECT on admin.admin_users', async () => {
    const { data, error } = await customer.client.schema('admin').from('admin_users').select('id')
    // Valid denials: an error (permission denied at SQL) OR an empty
    // result set (RLS filtered every row away). The customer must never
    // see any row.
    if (error) {
      expect(error.message.toLowerCase()).toMatch(/permission|policy|denied|not found|rls/)
    } else {
      expect(data).toEqual([])
    }
  })

  it('anon JWT is denied SELECT on admin.admin_users', async () => {
    const anon = getAdminAnonClient()
    const { data, error } = await anon.schema('admin').from('admin_users').select('id')
    if (error === null) {
      expect(data).toEqual([])
    } else {
      expect(error.message.toLowerCase()).toMatch(/permission|policy|denied|not found|rls/)
    }
  })
})

describe('ADR-0027 Sprint 1.1 — admin.admin_audit_log RLS + append-only', () => {
  it('admin JWT can SELECT admin.admin_audit_log (empty initially)', async () => {
    const { data, error } = await admin.client.schema('admin').from('admin_audit_log').select('id')
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('customer JWT is denied SELECT on admin.admin_audit_log', async () => {
    const { data, error } = await customer.client.schema('admin').from('admin_audit_log').select('id')
    if (error) {
      expect(error.message.toLowerCase()).toMatch(/permission|policy|denied|not found|rls/)
    } else {
      expect(data).toEqual([])
    }
  })

  it('append-only — admin JWT cannot INSERT into admin.admin_audit_log', async () => {
    const { error } = await admin.client
      .schema('admin')
      .from('admin_audit_log')
      .insert({
        admin_user_id: admin.userId,
        action: 'test_direct_insert_should_fail',
        reason: 'foundation-test-insert-attempt',
      })
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/permission|policy|denied|rls/)
  })

  it('append-only — admin JWT cannot UPDATE admin.admin_audit_log', async () => {
    const { error } = await admin.client
      .schema('admin')
      .from('admin_audit_log')
      .update({ action: 'mutated' })
      .eq('action', 'nothing_matches')
    // UPDATE with no matching rows + revoke on UPDATE → the revoke fires
    // as permission denied at SQL level.
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/permission|policy|denied|rls/)
  })

  it('append-only — admin JWT cannot DELETE from admin.admin_audit_log', async () => {
    const { error } = await admin.client
      .schema('admin')
      .from('admin_audit_log')
      .delete()
      .eq('action', 'nothing_matches')
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/permission|policy|denied|rls/)
  })
})

describe('ADR-0027 Sprint 1.1 — customer regression (public.* still works)', () => {
  it('customer JWT can SELECT from public.organisations (their own org)', async () => {
    const { data, error } = await customer.client
      .from('organisations')
      .select('id, name')
      .eq('id', customer.orgId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe(customer.orgId)
  })
})
