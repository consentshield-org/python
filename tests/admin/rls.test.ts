import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAdminTestUser,
  cleanupAdminTestUser,
  getAdminAnonClient,
  AdminTestUser,
} from './helpers'
import { createTestOrg, cleanupTestOrg, TestOrg } from '../rls/helpers'

// The `support`-role admin and its write-denial test move to Sprint 3.1
// tests/admin/rpcs.test.ts — role gating happens at the RPC boundary
// (admin.toggle_kill_switch), not at the RLS write policy (unreachable
// from authenticated JWT without a table-level GRANT).

// ADR-0027 Sprint 2.1 — per-table RLS + customer-side helper tests.
//
// Covers the 9 new operational admin tables (impersonation_sessions,
// sectoral_templates, connector_catalogue, tracker_signature_catalogue,
// support_tickets, support_ticket_messages, org_notes, feature_flags,
// platform_metrics_daily) plus the kill_switches read/write split, and
// the three public-facing helpers that bridge customer JWT → admin data.

let platformOperator: AdminTestUser
let customer: TestOrg

beforeAll(async () => {
  platformOperator = await createAdminTestUser('platform_operator')
  customer = await createTestOrg('sprint21')
})

afterAll(async () => {
  if (platformOperator) await cleanupAdminTestUser(platformOperator)
  if (customer) await cleanupTestOrg(customer)
})

// Tables that follow the uniform admin_all policy pattern: admin sees
// everything, non-admin (customer + anon) sees nothing.
const adminOnlyTables = [
  'sectoral_templates',
  'connector_catalogue',
  'tracker_signature_catalogue',
  'support_tickets',
  'support_ticket_messages',
  'org_notes',
  'feature_flags',
  'platform_metrics_daily',
] as const

describe('ADR-0027 Sprint 2.1 — admin-only tables', () => {
  for (const table of adminOnlyTables) {
    it(`admin JWT can SELECT admin.${table}`, async () => {
      const { data, error } = await platformOperator.client.schema('admin').from(table).select('*')
      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
    })

    it(`customer JWT is denied SELECT on admin.${table}`, async () => {
      const { data, error } = await customer.client.schema('admin').from(table).select('*')
      if (error) {
        expect(error.message.toLowerCase()).toMatch(/permission|policy|denied|not found|rls/)
      } else {
        expect(data).toEqual([])
      }
    })

    it(`anon JWT is denied SELECT on admin.${table}`, async () => {
      const anon = getAdminAnonClient()
      const { data, error } = await anon.schema('admin').from(table).select('*')
      if (error) {
        expect(error.message.toLowerCase()).toMatch(/permission|policy|denied|not found|rls/)
      } else {
        expect(data).toEqual([])
      }
    })
  }
})

describe('ADR-0027 Sprint 2.1 — admin.impersonation_sessions (two policies)', () => {
  it('admin JWT can SELECT all impersonation sessions', async () => {
    const { data, error } = await platformOperator.client
      .schema('admin')
      .from('impersonation_sessions')
      .select('*')
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('customer JWT can SELECT directly from admin.impersonation_sessions (org_view policy) — returns 0 rows initially', async () => {
    const { data, error } = await customer.client
      .schema('admin')
      .from('impersonation_sessions')
      .select('*')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('customer JWT can SELECT via public.org_support_sessions view — returns 0 rows initially', async () => {
    const { data, error } = await customer.client.from('org_support_sessions').select('*')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})

describe('ADR-0027 Sprint 2.1 — admin.kill_switches (split read/write policies)', () => {
  it('admin JWT sees the 4 seeded switches', async () => {
    const { data, error } = await platformOperator.client
      .schema('admin')
      .from('kill_switches')
      .select('switch_key, enabled')
      .order('switch_key')
    expect(error).toBeNull()
    expect(data).toHaveLength(4)
    const keys = data!.map((r) => r.switch_key).sort()
    expect(keys).toEqual([
      'banner_delivery',
      'deletion_dispatch',
      'depa_processing',
      'rights_request_intake',
    ])
    expect(data!.every((r) => r.enabled === false)).toBe(true)
  })

  it('customer JWT is denied SELECT on admin.kill_switches', async () => {
    const { data, error } = await customer.client.schema('admin').from('kill_switches').select('switch_key')
    if (error) {
      expect(error.message.toLowerCase()).toMatch(/permission|policy|denied|not found|rls/)
    } else {
      expect(data).toEqual([])
    }
  })

  it('direct UPDATE is denied for any authenticated JWT (no table-level GRANT; writes go via admin.toggle_kill_switch RPC in Sprint 3.1)', async () => {
    // By design, no INSERT/UPDATE/DELETE grant on admin.kill_switches is
    // given to the authenticated role — all writes flow through a
    // SECURITY DEFINER RPC (admin.toggle_kill_switch, Sprint 3.1). The
    // RLS write policy is defence-in-depth; production never touches the
    // table directly. Role-gating tests (platform_operator vs support)
    // move to Sprint 3.1 against the RPC surface.
    const { error } = await platformOperator.client
      .schema('admin')
      .from('kill_switches')
      .update({ reason: 'rls-test-touch' })
      .eq('switch_key', 'banner_delivery')
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/permission|denied/)
  })
})

describe('ADR-0027 Sprint 2.1 — customer-facing helper functions', () => {
  it('public.list_sectoral_templates_for_sector returns 0 rows when no templates are published', async () => {
    const { data, error } = await customer.client.rpc('list_sectoral_templates_for_sector', {
      p_sector: 'saas',
    })
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('public.get_feature_flag returns NULL when flag is not set', async () => {
    const { data, error } = await customer.client.rpc('get_feature_flag', {
      p_flag_key: 'depa_dashboard_enabled',
    })
    expect(error).toBeNull()
    expect(data).toBeNull()
  })
})

describe('ADR-0027 Sprint 2.1 — customer regression (public.* schema unchanged)', () => {
  it('customer JWT can SELECT from public.integration_connectors (FK column addition is non-breaking)', async () => {
    const { error } = await customer.client
      .from('integration_connectors')
      .select('id, connector_catalogue_id')
      .eq('org_id', customer.orgId)
    expect(error).toBeNull()
  })
})
