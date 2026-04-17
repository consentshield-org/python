// ADR-0030 Sprint 3.1 — customer-side sectoral-template application.
//
// Verifies public.apply_sectoral_template:
//   - Writes to the caller's org only (no cross-tenant spill).
//   - Picks the latest published version of a template_code.
//   - Rejects unknown template codes.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanupTestOrg,
  createTestOrg,
  getServiceClient,
  type TestOrg,
} from './helpers'

const TEMPLATE_CODE = `rls_test_tpl_${Date.now()}`

describe('ADR-0030 sectoral template apply', () => {
  let orgA: TestOrg
  let orgB: TestOrg
  let templateIdV1: string
  let adminBootstrapId: string

  beforeAll(async () => {
    const service = getServiceClient()

    // Locate an admin_users row to satisfy the created_by FK. Use the
    // bootstrap admin (any row works).
    const { data: anyAdmin } = await service
      .schema('admin')
      .from('admin_users')
      .select('id')
      .limit(1)
      .single()
    if (!anyAdmin) {
      throw new Error(
        'no admin.admin_users rows — cannot seed a sectoral template',
      )
    }
    adminBootstrapId = anyAdmin.id

    // Seed a published template v1 (service-role bypasses RLS).
    const { data: t1, error: tErr } = await service
      .schema('admin')
      .from('sectoral_templates')
      .insert({
        template_code: TEMPLATE_CODE,
        display_name: 'RLS Test Template',
        description: 'Seeded for sectoral-template apply isolation tests.',
        sector: 'general',
        version: 1,
        status: 'published',
        purpose_definitions: [
          { purpose_code: 'essential', display_name: 'Essential' },
        ],
        created_by: adminBootstrapId,
        published_by: adminBootstrapId,
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (tErr) throw tErr
    templateIdV1 = t1.id

    orgA = await createTestOrg('tplA')
    orgB = await createTestOrg('tplB')
  }, 60000)

  afterAll(async () => {
    const service = getServiceClient()
    if (orgA) await cleanupTestOrg(orgA)
    if (orgB) await cleanupTestOrg(orgB)
    if (templateIdV1) {
      await service
        .schema('admin')
        .from('sectoral_templates')
        .delete()
        .eq('id', templateIdV1)
    }
  })

  it('apply_sectoral_template writes to caller org settings', async () => {
    const { data, error } = await orgA.client.rpc('apply_sectoral_template', {
      p_template_code: TEMPLATE_CODE,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ code: TEMPLATE_CODE, version: 1 })

    // Verify via service-role that org A's settings carries the pointer.
    const service = getServiceClient()
    const { data: aRow } = await service
      .from('organisations')
      .select('settings')
      .eq('id', orgA.orgId)
      .single()
    expect(aRow?.settings?.sectoral_template?.code).toBe(TEMPLATE_CODE)
    expect(aRow?.settings?.sectoral_template?.version).toBe(1)

    // Org B should be unaffected.
    const { data: bRow } = await service
      .from('organisations')
      .select('settings')
      .eq('id', orgB.orgId)
      .single()
    expect(bRow?.settings?.sectoral_template).toBeUndefined()
  })

  it('apply_sectoral_template rejects unknown template code', async () => {
    const { error } = await orgA.client.rpc('apply_sectoral_template', {
      p_template_code: `${TEMPLATE_CODE}_does_not_exist`,
    })
    expect(error?.message ?? '').toMatch(/no published template/i)
  })

  it('apply_sectoral_template picks latest published version', async () => {
    const service = getServiceClient()

    // Seed v2 published — v1 auto-deprecates only via the RPC pathway,
    // so we manually deprecate v1 here to mirror the real flow.
    const { data: t2, error: t2Err } = await service
      .schema('admin')
      .from('sectoral_templates')
      .insert({
        template_code: TEMPLATE_CODE,
        display_name: 'RLS Test Template v2',
        description: 'v2 seed.',
        sector: 'general',
        version: 2,
        status: 'published',
        purpose_definitions: [
          { purpose_code: 'essential', display_name: 'Essential' },
          { purpose_code: 'analytics', display_name: 'Analytics' },
        ],
        created_by: adminBootstrapId,
        published_by: adminBootstrapId,
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (t2Err) throw t2Err

    try {
      await service
        .schema('admin')
        .from('sectoral_templates')
        .update({ status: 'deprecated', deprecated_at: new Date().toISOString() })
        .eq('id', templateIdV1)

      const { data, error } = await orgA.client.rpc('apply_sectoral_template', {
        p_template_code: TEMPLATE_CODE,
      })
      expect(error).toBeNull()
      expect(data).toMatchObject({ code: TEMPLATE_CODE, version: 2 })
    } finally {
      await service
        .schema('admin')
        .from('sectoral_templates')
        .delete()
        .eq('id', t2.id)
      // Revert v1 back to published so other tests don't pick up a deprecated seed.
      await service
        .schema('admin')
        .from('sectoral_templates')
        .update({ status: 'published', deprecated_at: null })
        .eq('id', templateIdV1)
    }
  })
})
