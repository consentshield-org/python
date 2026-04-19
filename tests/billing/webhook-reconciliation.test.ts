import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminAnonClient,
  getAdminServiceClient,
} from '../admin/helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0050 Sprint 2.3 — public.rpc_razorpay_reconcile_invoice_paid.
//
// Verifies:
//   · Matches by razorpay_invoice_id → flips status → paid, stamps paid_at.
//   · Matches by razorpay_order_id when invoice_id absent.
//   · Already-paid invoice → no mutation, returns matched=true.
//   · Orphan id → matched=false, no error.
//   · Empty matcher → matched=false reason='no matcher'.

let owner: AdminTestUser
let operator: AdminTestUser
let customer: TestOrg
let issuerId: string
let invoiceId: string
let invoiceRow: {
  razorpay_invoice_id: string
  razorpay_order_id: string
}

const service = getAdminServiceClient()
const anon = getAdminAnonClient()

let gstinSeed = Date.now() % 100_000
function nextGstin(): string {
  gstinSeed = (gstinSeed + 1) % 100_000
  return `29AAAAA${String(gstinSeed).padStart(5, '0').slice(-5)}B1Z`
}

async function populateAccountBillingProfile(accountId: string) {
  const { error } = await service
    .from('accounts')
    .update({
      billing_legal_name: 'Reconcile Test Customer',
      billing_gstin: '29BBBBB22222C1Z',
      billing_state_code: '29',
      billing_address: '1 Reconcile Road, Bangalore',
      billing_email: 'reconcile@test.consentshield.in',
      billing_profile_updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
  if (error) throw new Error(error.message)
}

async function createIssueStubInvoice(): Promise<{
  id: string
  razorpay_invoice_id: string
  razorpay_order_id: string
}> {
  // Create draft via RPC.
  const { data: id, error } = await operator.client
    .schema('admin')
    .rpc('billing_issue_invoice', {
      p_account_id: customer.accountId,
      p_period_start: '2026-04-01',
      p_period_end: '2026-04-30',
      p_line_items: [
        {
          description: 'Reconcile test line',
          hsn_sac: '9983',
          quantity: 1,
          rate_paise: 100_000,
          amount_paise: 100_000,
        },
      ],
      p_due_date: null,
    })
  if (error || typeof id !== 'string') throw new Error(`issue failed: ${error?.message}`)

  // Finalize draft → issued (required so reconcile can flip it to paid).
  const { error: finErr } = await operator.client
    .schema('admin')
    .rpc('billing_finalize_invoice_pdf', {
      p_invoice_id: id,
      p_pdf_r2_key: 'test-bucket/invoices/reconcile/test.pdf',
      p_pdf_sha256: 'f'.repeat(64),
    })
  if (finErr) throw new Error(`finalize failed: ${finErr.message}`)

  // Attach Razorpay ids via service role (no application RPC for this in Sprint 2.3;
  // they would normally arrive from an invoice.created event hook not covered here).
  const rzpInvoiceId = `inv_test_${Date.now()}_${Math.floor(Math.random() * 1000)}`
  const rzpOrderId = `order_test_${Date.now()}_${Math.floor(Math.random() * 1000)}`
  const { error: updErr } = await service
    .from('invoices')
    .update({
      razorpay_invoice_id: rzpInvoiceId,
      razorpay_order_id: rzpOrderId,
    })
    .eq('id', id)
  if (updErr) throw new Error(`rzp id attach failed: ${updErr.message}`)

  return { id, razorpay_invoice_id: rzpInvoiceId, razorpay_order_id: rzpOrderId }
}

async function readStatus(id: string): Promise<{ status: string; paid_at: string | null }> {
  const { data, error } = await service
    .from('invoices')
    .select('status,paid_at')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) throw new Error(error?.message ?? 'row missing')
  return data as { status: string; paid_at: string | null }
}

async function resetToIssued(id: string) {
  const { error } = await service
    .from('invoices')
    .update({ status: 'issued', paid_at: null })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

beforeAll(async () => {
  owner = await createAdminTestUser('platform_owner')
  operator = await createAdminTestUser('platform_operator')
  customer = await createTestOrg('recon')

  await populateAccountBillingProfile(customer.accountId)

  // Create + activate an issuer.
  const { data: iid } = await owner.client
    .schema('admin')
    .rpc('billing_issuer_create', {
      p_legal_name: 'Reconcile Test LLP',
      p_gstin: nextGstin(),
      p_pan: 'AAAAA1234B',
      p_registered_state_code: '29',
      p_registered_address: '1 Test St, Bangalore',
      p_invoice_prefix: 'RCN',
      p_fy_start_month: 4,
      p_signatory_name: 'Test Signatory',
      p_signatory_designation: 'Director',
      p_bank_account_masked: '**** 0000',
      p_logo_r2_key: null,
    })
  issuerId = iid as string
  await owner.client.schema('admin').rpc('billing_issuer_activate', { p_id: issuerId })

  const created = await createIssueStubInvoice()
  invoiceId = created.id
  invoiceRow = {
    razorpay_invoice_id: created.razorpay_invoice_id,
    razorpay_order_id: created.razorpay_order_id,
  }
})

afterAll(async () => {
  if (invoiceId) {
    await service.from('invoices').delete().eq('id', invoiceId)
  }
  if (issuerId) {
    try {
      await owner.client
        .schema('admin')
        .rpc('billing_issuer_retire', { p_id: issuerId, p_reason: 'test cleanup' })
      await owner.client
        .schema('admin')
        .rpc('billing_issuer_hard_delete', { p_id: issuerId })
    } catch {
      // best effort
    }
  }
  if (customer) await cleanupTestOrg(customer)
  if (owner) await cleanupAdminTestUser(owner)
  if (operator) await cleanupAdminTestUser(operator)
})

describe('ADR-0050 Sprint 2.3 — rpc_razorpay_reconcile_invoice_paid', () => {
  it('matches by razorpay_invoice_id and flips status → paid', async () => {
    const { data, error } = await anon.rpc('rpc_razorpay_reconcile_invoice_paid', {
      p_razorpay_invoice_id: invoiceRow.razorpay_invoice_id,
      p_razorpay_order_id: null,
      p_paid_at: '2026-05-05T12:00:00Z',
    })
    expect(error).toBeNull()
    const env = data as {
      matched: boolean
      invoice_id: string
      previous_status: string
      new_status: string
      reason: string
    }
    expect(env.matched).toBe(true)
    expect(env.invoice_id).toBe(invoiceId)
    expect(env.previous_status).toBe('issued')
    expect(env.new_status).toBe('paid')
    expect(env.reason).toBe('reconciled')

    const row = await readStatus(invoiceId)
    expect(row.status).toBe('paid')
    expect(row.paid_at).toMatch(/^2026-05-05/)
  })

  it('already-paid invoice is idempotent (matched=true, reason=already paid)', async () => {
    const { data, error } = await anon.rpc('rpc_razorpay_reconcile_invoice_paid', {
      p_razorpay_invoice_id: invoiceRow.razorpay_invoice_id,
      p_razorpay_order_id: null,
      p_paid_at: null,
    })
    expect(error).toBeNull()
    const env = data as { matched: boolean; reason: string; new_status: string }
    expect(env.matched).toBe(true)
    expect(env.reason).toBe('already paid')
    expect(env.new_status).toBe('paid')
  })

  it('falls back to razorpay_order_id when invoice_id absent', async () => {
    await resetToIssued(invoiceId)
    const { data, error } = await anon.rpc('rpc_razorpay_reconcile_invoice_paid', {
      p_razorpay_invoice_id: null,
      p_razorpay_order_id: invoiceRow.razorpay_order_id,
      p_paid_at: null,
    })
    expect(error).toBeNull()
    const env = data as { matched: boolean; invoice_id: string; new_status: string }
    expect(env.matched).toBe(true)
    expect(env.invoice_id).toBe(invoiceId)
    expect(env.new_status).toBe('paid')
  })

  it('orphan id returns matched=false without error', async () => {
    const { data, error } = await anon.rpc('rpc_razorpay_reconcile_invoice_paid', {
      p_razorpay_invoice_id: 'inv_never_existed_xyz',
      p_razorpay_order_id: 'order_never_existed_xyz',
      p_paid_at: null,
    })
    expect(error).toBeNull()
    const env = data as { matched: boolean; reason: string }
    expect(env.matched).toBe(false)
    expect(env.reason).toBe('no matching invoice')
  })

  it('empty matcher returns matched=false reason="no matcher"', async () => {
    const { data, error } = await anon.rpc('rpc_razorpay_reconcile_invoice_paid', {
      p_razorpay_invoice_id: null,
      p_razorpay_order_id: null,
      p_paid_at: null,
    })
    expect(error).toBeNull()
    const env = data as { matched: boolean; reason: string }
    expect(env.matched).toBe(false)
    expect(env.reason).toBe('no matcher')
  })
})
