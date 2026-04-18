import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
} from './helpers'

// ADR-0050 Sprint 2.1 chunk 2 — billing.issuer_entities CRUD RPCs.
//
// Verification reads go through admin.billing_issuer_detail rather than
// direct `service.schema('billing')` — the billing schema is not exposed
// by PostgREST (admin-RPC-only by design). Cleanup uses the owner-gated
// admin.billing_issuer_hard_delete so no table exposure is required.

let owner: AdminTestUser
let operator: AdminTestUser
let support: AdminTestUser

// Unique-per-run GSTIN generator. Starts at a wallclock-derived seed so
// re-runs don't collide on the issuer_entities_gstin_uniq constraint.
// GSTIN shape here: 2-digit state + 5 letters + 5-digit sequence + 'B1Z' = 15.
let gstinCounter = Date.now() % 100_000
function nextGstin(): string {
  gstinCounter = (gstinCounter + 1) % 100_000
  const s = String(gstinCounter).padStart(5, '0').slice(-5)
  return `29AAAAA${s}B1Z`
}

const createdIds: string[] = []

async function hardDelete(id: string) {
  await owner.client
    .schema('admin')
    .rpc('billing_issuer_hard_delete', { p_id: id })
}

async function fetchIssuer(id: string): Promise<{
  is_active: boolean
  retired_at: string | null
  retired_reason: string | null
  registered_address: string
  signatory_name: string
} | null> {
  const { data, error } = await owner.client
    .schema('admin')
    .rpc('billing_issuer_detail', { p_id: id })
  if (error) return null
  const env = data as { issuer: Record<string, unknown> }
  return {
    is_active: env.issuer.is_active as boolean,
    retired_at: (env.issuer.retired_at as string | null) ?? null,
    retired_reason: (env.issuer.retired_reason as string | null) ?? null,
    registered_address: env.issuer.registered_address as string,
    signatory_name: env.issuer.signatory_name as string,
  }
}

beforeAll(async () => {
  owner = await createAdminTestUser('platform_owner')
  operator = await createAdminTestUser('platform_operator')
  support = await createAdminTestUser('support')
})

afterAll(async () => {
  for (const id of createdIds) {
    try {
      await hardDelete(id)
    } catch {
      // Already deleted (hard_delete test) or gone — ignore.
    }
  }
  if (owner) await cleanupAdminTestUser(owner)
  if (operator) await cleanupAdminTestUser(operator)
  if (support) await cleanupAdminTestUser(support)
})

async function createIssuer(
  caller: AdminTestUser,
  params: Partial<{
    legal_name: string
    gstin: string
    pan: string
    state_code: string
    address: string
    prefix: string
    fy_start: number
    signatory: string
  }> = {},
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await caller.client
    .schema('admin')
    .rpc('billing_issuer_create', {
      p_legal_name: params.legal_name ?? `Test Issuer ${gstinCounter}`,
      p_gstin: params.gstin ?? nextGstin(),
      p_pan: params.pan ?? 'AAAAA1234B',
      p_registered_state_code: params.state_code ?? '29',
      p_registered_address:
        params.address ?? '123 Test Street, Bangalore, Karnataka',
      p_invoice_prefix: params.prefix ?? 'TST',
      p_fy_start_month: params.fy_start ?? 4,
      p_signatory_name: params.signatory ?? 'Founder Test',
      p_signatory_designation: 'Director',
      p_bank_account_masked: '**** 1234',
      p_logo_r2_key: null,
    })
  if (data && typeof data === 'string') createdIds.push(data)
  return { id: (data as string) ?? null, error: error?.message ?? null }
}

describe('ADR-0050 Sprint 2.1 chunk 2 — billing.issuer_entities RPCs', () => {
  describe('role gating', () => {
    it('operator cannot create (platform_owner required)', async () => {
      const { id, error } = await createIssuer(operator)
      expect(id).toBeNull()
      expect(error).toMatch(/platform_owner role required/i)
    })

    it('support cannot create', async () => {
      const { id, error } = await createIssuer(support)
      expect(id).toBeNull()
      expect(error).not.toBeNull()
    })

    it('operator can read list', async () => {
      const { error } = await operator.client
        .schema('admin')
        .rpc('billing_issuer_list')
      expect(error).toBeNull()
    })

    it('support cannot read list (below platform_operator tier)', async () => {
      const { error } = await support.client
        .schema('admin')
        .rpc('billing_issuer_list')
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/platform_operator role required/i)
    })

    it('owner can create and read the envelope', async () => {
      const { id, error } = await createIssuer(owner)
      expect(error).toBeNull()
      expect(id).toBeDefined()
      const detail = await owner.client
        .schema('admin')
        .rpc('billing_issuer_detail', { p_id: id! })
      expect(detail.error).toBeNull()
      const env = detail.data as {
        issuer: { id: string; is_active: boolean }
        invoice_count: number
      }
      expect(env.issuer.id).toBe(id)
      expect(env.issuer.is_active).toBe(false)
      expect(env.invoice_count).toBe(0)
    })
  })

  describe('required-field validation on create', () => {
    it('empty legal_name raises', async () => {
      const { error } = await createIssuer(owner, { legal_name: '' })
      expect(error).toMatch(/legal_name required/i)
    })

    it('short gstin raises', async () => {
      const { error } = await createIssuer(owner, { gstin: '123' })
      expect(error).toMatch(/gstin must be 15/i)
    })

    it('bad fy_start_month raises', async () => {
      const { error } = await createIssuer(owner, { fy_start: 13 })
      expect(error).toMatch(/fy_start_month must be between 1 and 12/i)
    })
  })

  describe('update — mutable vs immutable', () => {
    let issuerId: string
    beforeAll(async () => {
      const { id, error } = await createIssuer(owner, { prefix: 'UPD' })
      if (error) throw new Error(`setup create failed: ${error}`)
      issuerId = id!
    })

    it('owner can patch registered_address', async () => {
      const { error } = await owner.client
        .schema('admin')
        .rpc('billing_issuer_update', {
          p_id: issuerId,
          p_patch: { registered_address: '456 New Street, Bangalore, Karnataka' },
        })
      expect(error).toBeNull()
      const row = await fetchIssuer(issuerId)
      expect(row?.registered_address).toMatch(/456 New Street/)
    })

    it('owner can patch signatory_name', async () => {
      const { error } = await owner.client
        .schema('admin')
        .rpc('billing_issuer_update', {
          p_id: issuerId,
          p_patch: { signatory_name: 'Successor Test' },
        })
      expect(error).toBeNull()
      const row = await fetchIssuer(issuerId)
      expect(row?.signatory_name).toBe('Successor Test')
    })

    it('patching legal_name raises with immutable message', async () => {
      const { error } = await owner.client
        .schema('admin')
        .rpc('billing_issuer_update', {
          p_id: issuerId,
          p_patch: { legal_name: 'Renamed Entity LLP' },
        })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/immutable field .?legal_name/i)
      expect(error?.message).toMatch(/retire the current issuer/i)
    })

    it('patching gstin raises', async () => {
      const { error } = await owner.client
        .schema('admin')
        .rpc('billing_issuer_update', {
          p_id: issuerId,
          p_patch: { gstin: nextGstin() },
        })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/immutable field .?gstin/i)
    })

    it('operator cannot update (platform_owner required)', async () => {
      const { error } = await operator.client
        .schema('admin')
        .rpc('billing_issuer_update', {
          p_id: issuerId,
          p_patch: { registered_address: 'should be denied' },
        })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/platform_owner role required/i)
    })

    it('unknown field raises', async () => {
      const { error } = await owner.client
        .schema('admin')
        .rpc('billing_issuer_update', {
          p_id: issuerId,
          p_patch: { made_up_field: 'nope' },
        })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/unknown or non-editable field/i)
    })
  })

  describe('activate — single active invariant', () => {
    it('activate flips previous active off', async () => {
      const a = await createIssuer(owner, { prefix: 'ACT1' })
      const b = await createIssuer(owner, { prefix: 'ACT2' })
      expect(a.id).toBeDefined()
      expect(b.id).toBeDefined()

      const r1 = await owner.client
        .schema('admin')
        .rpc('billing_issuer_activate', { p_id: a.id! })
      expect(r1.error).toBeNull()

      const r2 = await owner.client
        .schema('admin')
        .rpc('billing_issuer_activate', { p_id: b.id! })
      expect(r2.error).toBeNull()

      const aRow = await fetchIssuer(a.id!)
      const bRow = await fetchIssuer(b.id!)
      expect(aRow?.is_active).toBe(false)
      expect(bRow?.is_active).toBe(true)
    })

    it('activating already-active issuer raises', async () => {
      const c = await createIssuer(owner, { prefix: 'ACT3' })
      await owner.client
        .schema('admin')
        .rpc('billing_issuer_activate', { p_id: c.id! })
      const { error } = await owner.client
        .schema('admin')
        .rpc('billing_issuer_activate', { p_id: c.id! })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/already active/i)
    })
  })

  describe('retire', () => {
    it('owner can retire; cannot re-activate after', async () => {
      const r = await createIssuer(owner, { prefix: 'RET1' })
      const retire = await owner.client
        .schema('admin')
        .rpc('billing_issuer_retire', {
          p_id: r.id!,
          p_reason: 'retirement test — end of life',
        })
      expect(retire.error).toBeNull()

      const row = await fetchIssuer(r.id!)
      expect(row?.is_active).toBe(false)
      expect(row?.retired_at).not.toBeNull()
      expect(row?.retired_reason).toMatch(/retirement test/)

      const reactivate = await owner.client
        .schema('admin')
        .rpc('billing_issuer_activate', { p_id: r.id! })
      expect(reactivate.error).not.toBeNull()
      expect(reactivate.error?.message).toMatch(/cannot activate a retired issuer/i)
    })

    it('retire requires reason ≥10 chars', async () => {
      const r = await createIssuer(owner, { prefix: 'RET2' })
      const { error } = await owner.client
        .schema('admin')
        .rpc('billing_issuer_retire', { p_id: r.id!, p_reason: 'short' })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/reason required/i)
    })
  })

  describe('hard_delete', () => {
    it('operator denied', async () => {
      const r = await createIssuer(owner, { prefix: 'DEL1' })
      const { error } = await operator.client
        .schema('admin')
        .rpc('billing_issuer_hard_delete', { p_id: r.id! })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/platform_owner role required/i)
    })

    it('owner can hard_delete a fresh issuer', async () => {
      const r = await createIssuer(owner, { prefix: 'DEL2' })
      const { error } = await owner.client
        .schema('admin')
        .rpc('billing_issuer_hard_delete', { p_id: r.id! })
      expect(error).toBeNull()
      // Remove from cleanup list so afterAll doesn't re-attempt.
      const idx = createdIds.indexOf(r.id!)
      if (idx >= 0) createdIds.splice(idx, 1)
      // Verify gone via detail RPC.
      const detail = await owner.client
        .schema('admin')
        .rpc('billing_issuer_detail', { p_id: r.id! })
      expect(detail.error).not.toBeNull()
      expect(detail.error?.message).toMatch(/not found/i)
    })

    it('missing row raises', async () => {
      const { error } = await owner.client
        .schema('admin')
        .rpc('billing_issuer_hard_delete', {
          p_id: '00000000-0000-0000-0000-000000000000',
        })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/not found/i)
    })
  })
})
