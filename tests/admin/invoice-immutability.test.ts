import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from './helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0050 Sprint 2.1 chunk 3 — public.invoices immutability.
//
// Covers:
//   · Service-role UPDATE to an immutable column raises (trigger fires).
//   · Service-role UPDATE to an allow-list column succeeds.
//   · DELETE permissions are revoked from cs_admin / cs_orchestrator /
//     authenticated (service_role bypasses in Supabase; we verify via
//     an admin JWT call through PostgREST).

const service = getAdminServiceClient()

let owner: AdminTestUser
let testOrg: TestOrg
let issuerId: string
let invoiceId: string

function nextGstin(): string {
  const n = Math.floor(Date.now() / 1000) % 99_999
  const s = String(n).padStart(5, '0').slice(-5)
  return `29AAAAA${s}B1Z`
}

beforeAll(async () => {
  owner = await createAdminTestUser('platform_owner')
  testOrg = await createTestOrg('invimmut')

  // Create an issuer via the RPC (the only supported path).
  const issuerRes = await owner.client
    .schema('admin')
    .rpc('billing_issuer_create', {
      p_legal_name: 'Test Issuer for Immutability',
      p_gstin: nextGstin(),
      p_pan: 'AAAAA1234B',
      p_registered_state_code: '29',
      p_registered_address: '1 Test St, Bangalore, Karnataka',
      p_invoice_prefix: 'IMM',
      p_fy_start_month: 4,
      p_signatory_name: 'Test Signatory',
      p_signatory_designation: 'Director',
      p_bank_account_masked: '**** 0000',
      p_logo_r2_key: null,
    })
  if (issuerRes.error) throw new Error(`issuer create failed: ${issuerRes.error.message}`)
  issuerId = issuerRes.data as string

  // Insert a draft invoice directly via service-role. The issuance RPC
  // lands in Sprint 2.2; for this chunk we just need a row to test
  // immutability semantics on.
  const ins = await service
    .schema('public')
    .from('invoices')
    .insert({
      issuer_entity_id: issuerId,
      account_id: testOrg.accountId,
      invoice_number: `IMM/TEST/${Date.now()}`,
      fy_year: '2026-27',
      fy_sequence: 1,
      period_start: '2026-04-01',
      period_end: '2026-04-30',
      due_date: '2026-05-07',
      line_items: [{ description: 'Test', hsn_sac: '9983', quantity: 1, unit_price_paise: 100_000, amount_paise: 100_000 }],
      subtotal_paise: 100_000,
      cgst_paise: 9_000,
      sgst_paise: 9_000,
      igst_paise: 0,
      total_paise: 118_000,
      status: 'draft',
    })
    .select('id')
    .single()
  if (ins.error) throw new Error(`invoice insert failed: ${ins.error.message}`)
  invoiceId = ins.data!.id as string
})

afterAll(async () => {
  // Direct delete of the invoice for cleanup (service-role bypasses the
  // role-grant REVOKE we verified below). Then retire the issuer via
  // hard_delete since no invoices reference it anymore.
  if (invoiceId) {
    await service.schema('public').from('invoices').delete().eq('id', invoiceId)
  }
  if (issuerId) {
    try {
      await owner.client
        .schema('admin')
        .rpc('billing_issuer_hard_delete', { p_id: issuerId })
    } catch {
      // ignore
    }
  }
  if (testOrg) await cleanupTestOrg(testOrg)
  if (owner) await cleanupAdminTestUser(owner)
})

describe('ADR-0050 Sprint 2.1 chunk 3 — public.invoices immutability', () => {
  describe('UPDATE — immutable columns raise', () => {
    it('changing total_paise raises', async () => {
      const { error } = await service
        .schema('public')
        .from('invoices')
        .update({ total_paise: 999_999 })
        .eq('id', invoiceId)
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/immutable column .?total_paise/i)
    })

    it('changing line_items raises', async () => {
      const { error } = await service
        .schema('public')
        .from('invoices')
        .update({ line_items: [{ description: 'Mutated' }] })
        .eq('id', invoiceId)
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/immutable column .?line_items/i)
    })

    it('changing invoice_number raises', async () => {
      const { error } = await service
        .schema('public')
        .from('invoices')
        .update({ invoice_number: 'NEW/NUM/1' })
        .eq('id', invoiceId)
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/immutable column .?invoice_number/i)
    })

    it('changing fy_sequence raises', async () => {
      const { error } = await service
        .schema('public')
        .from('invoices')
        .update({ fy_sequence: 42 })
        .eq('id', invoiceId)
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/immutable column .?fy_sequence/i)
    })

    it('changing issuer_entity_id raises', async () => {
      // Create a second issuer to attempt re-assigning.
      const second = await owner.client
        .schema('admin')
        .rpc('billing_issuer_create', {
          p_legal_name: 'Second Issuer',
          p_gstin: nextGstin(),
          p_pan: 'AAAAA2345B',
          p_registered_state_code: '29',
          p_registered_address: '2 Test St',
          p_invoice_prefix: 'IM2',
          p_fy_start_month: 4,
          p_signatory_name: 'Second Signatory',
          p_signatory_designation: null,
          p_bank_account_masked: null,
          p_logo_r2_key: null,
        })
      expect(second.error).toBeNull()
      const secondId = second.data as string

      const { error } = await service
        .schema('public')
        .from('invoices')
        .update({ issuer_entity_id: secondId })
        .eq('id', invoiceId)
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/immutable column .?issuer_entity_id/i)

      // Cleanup second issuer.
      await owner.client
        .schema('admin')
        .rpc('billing_issuer_hard_delete', { p_id: secondId })
    })
  })

  describe('UPDATE — allow-list columns succeed', () => {
    it('status can transition draft → issued', async () => {
      const { error } = await service
        .schema('public')
        .from('invoices')
        .update({ status: 'issued', issued_at: new Date().toISOString() })
        .eq('id', invoiceId)
      expect(error).toBeNull()
    })

    it('paid_at + status can be updated to paid', async () => {
      const { error } = await service
        .schema('public')
        .from('invoices')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', invoiceId)
      expect(error).toBeNull()
    })

    it('razorpay_invoice_id can be recorded', async () => {
      const { error } = await service
        .schema('public')
        .from('invoices')
        .update({ razorpay_invoice_id: `inv_test_${Date.now()}` })
        .eq('id', invoiceId)
      expect(error).toBeNull()
    })

    it('notes can be updated', async () => {
      const { error } = await service
        .schema('public')
        .from('invoices')
        .update({ notes: 'added by test' })
        .eq('id', invoiceId)
      expect(error).toBeNull()
    })
  })

  describe('DELETE — revoked for authenticated role', () => {
    it('admin JWT DELETE raises permission error', async () => {
      const { error } = await owner.client
        .schema('public')
        .from('invoices')
        .delete()
        .eq('id', invoiceId)
      // authenticated role has no DELETE grant → permission denied.
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/permission|policy/i)
    })
  })
})
