import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
} from '../admin/helpers'

// ADR-0050 Sprint 2.3 — billing.issuer_entities identity-field immutability.
//
// Complementary to tests/admin/billing-issuer-rpcs.test.ts (which covers the
// full CRUD surface). This file lives under tests/billing/ per the ADR's
// testing-plan checklist and focuses on the Rule-19 immutability contract:
//   · patches on legal_name / gstin / pan / registered_state_code /
//     invoice_prefix / fy_start_month raise with the documented guidance
//     ("retire + create")
//   · patches on registered_address / signatory_name / bank_account_masked
//     succeed and are audit-logged

let owner: AdminTestUser
let issuerId: string

let gstinSeed = Date.now() % 100_000
function nextGstin(): string {
  gstinSeed = (gstinSeed + 1) % 100_000
  return `29AAAAA${String(gstinSeed).padStart(5, '0').slice(-5)}B1Z`
}

async function patch(patch: Record<string, unknown>) {
  return owner.client
    .schema('admin')
    .rpc('billing_issuer_update', { p_id: issuerId, p_patch: patch })
}

async function readDetail() {
  const { data } = await owner.client
    .schema('admin')
    .rpc('billing_issuer_detail', { p_id: issuerId })
  return (data as { issuer: Record<string, unknown> }).issuer
}

beforeAll(async () => {
  owner = await createAdminTestUser('platform_owner')

  const { data: id, error } = await owner.client
    .schema('admin')
    .rpc('billing_issuer_create', {
      p_legal_name: 'Immutability Test LLP',
      p_gstin: nextGstin(),
      p_pan: 'AAAAA1234B',
      p_registered_state_code: '29',
      p_registered_address: '1 Immutable Road, Bangalore',
      p_invoice_prefix: 'IMX',
      p_fy_start_month: 4,
      p_signatory_name: 'Original Signatory',
      p_signatory_designation: 'Director',
      p_bank_account_masked: '**** 0001',
      p_logo_r2_key: null,
    })
  if (error || typeof id !== 'string') {
    throw new Error(`issuer create failed: ${error?.message}`)
  }
  issuerId = id
})

afterAll(async () => {
  if (issuerId) {
    try {
      await owner.client
        .schema('admin')
        .rpc('billing_issuer_hard_delete', { p_id: issuerId })
    } catch {
      // best effort
    }
  }
  if (owner) await cleanupAdminTestUser(owner)
})

describe('ADR-0050 Sprint 2.3 — identity fields are immutable', () => {
  const identityFields: Array<{ key: string; value: unknown }> = [
    { key: 'legal_name', value: 'Changed LLP' },
    { key: 'gstin', value: '29ZZZZZ99999Z1Z' },
    { key: 'pan', value: 'ZZZZZ9999Z' },
    { key: 'registered_state_code', value: '27' },
    { key: 'invoice_prefix', value: 'NEW' },
    { key: 'fy_start_month', value: 1 },
  ]

  for (const field of identityFields) {
    it(`rejects a patch touching \`${field.key}\` with retire-and-create guidance`, async () => {
      const { error } = await patch({ [field.key]: field.value })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(
        new RegExp(
          `${field.key}.*(retire.*create|immutable)`,
          'i',
        ),
      )
    })
  }
})

describe('ADR-0050 Sprint 2.3 — operational fields are mutable', () => {
  it('registered_address can be patched and persists', async () => {
    const newAddress = `2 Updated Road, Bangalore — ${Date.now()}`
    const { error } = await patch({ registered_address: newAddress })
    expect(error).toBeNull()
    const issuer = await readDetail()
    expect(issuer.registered_address).toBe(newAddress)
  })

  it('signatory_name can be patched and persists', async () => {
    const newSignatory = `Updated Signatory ${Date.now()}`
    const { error } = await patch({ signatory_name: newSignatory })
    expect(error).toBeNull()
    const issuer = await readDetail()
    expect(issuer.signatory_name).toBe(newSignatory)
  })

  it('bank_account_masked can be patched and persists', async () => {
    const { error } = await patch({ bank_account_masked: '**** 9999' })
    expect(error).toBeNull()
    const issuer = await readDetail()
    expect(issuer.bank_account_masked).toBe('**** 9999')
  })

  it('unknown field raises', async () => {
    const { error } = await patch({ nonexistent_field: 'anything' })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/unknown|not allowed|invalid/i)
  })
})
