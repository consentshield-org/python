import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from '../admin/helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0050 Sprint 2.2 — admin.billing_issue_invoice +
// admin.billing_finalize_invoice_pdf + admin.billing_stamp_invoice_email.
//
// Tests the RPC path only. PDF render / R2 upload / Resend dispatch are
// exercised by the Route Handler and its manual-verification step; here
// we assert DB behaviour: FY sequence allocation, GST split, draft→issued
// flip, scope rules, precondition errors.

let owner: AdminTestUser
let operator: AdminTestUser
let support: AdminTestUser
let customer: TestOrg
let issuerId: string

const createdInvoices: string[] = []

// Unique GSTIN per run so parallel runs don't collide.
let gstinSeed = Date.now() % 100_000
function nextGstin(): string {
  gstinSeed = (gstinSeed + 1) % 100_000
  return `29AAAAA${String(gstinSeed).padStart(5, '0').slice(-5)}B1Z`
}

async function createActiveIssuer(): Promise<string> {
  const { data: id, error: createErr } = await owner.client
    .schema('admin')
    .rpc('billing_issuer_create', {
      p_legal_name: 'ConsentShield Test LLP',
      p_gstin: nextGstin(),
      p_pan: 'AAAAA1234B',
      p_registered_state_code: '29',
      p_registered_address: '123 Test Street, Bangalore, Karnataka',
      p_invoice_prefix: 'CSTEST',
      p_fy_start_month: 4,
      p_signatory_name: 'Test Signatory',
      p_signatory_designation: 'Director',
      p_bank_account_masked: 'XXXX1234',
      p_logo_r2_key: null,
    })
  if (createErr || typeof id !== 'string') {
    throw new Error(`issuer create failed: ${createErr?.message}`)
  }
  const { error: activateErr } = await owner.client
    .schema('admin')
    .rpc('billing_issuer_activate', { p_id: id })
  if (activateErr) throw new Error(`issuer activate failed: ${activateErr.message}`)
  return id
}

async function populateAccountBillingProfile(accountId: string) {
  const service = getAdminServiceClient()
  const { error } = await service
    .from('accounts')
    .update({
      billing_legal_name: 'Test Customer Pvt Ltd',
      billing_gstin: '29BBBBB22222C1Z', // same state as issuer (29 = KA) → CGST+SGST
      billing_state_code: '29',
      billing_address: '456 Customer Road, Bangalore, Karnataka',
      billing_email: 'billing@test.consentshield.in',
      billing_profile_updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
  if (error) throw new Error(`account update failed: ${error.message}`)
}

beforeAll(async () => {
  owner = await createAdminTestUser('platform_owner')
  operator = await createAdminTestUser('platform_operator')
  support = await createAdminTestUser('support')
  customer = await createTestOrg('invissue')
  issuerId = await createActiveIssuer()
  await populateAccountBillingProfile(customer.accountId)
})

afterAll(async () => {
  const service = getAdminServiceClient()
  if (createdInvoices.length > 0) {
    await service.from('invoices').delete().in('id', createdInvoices)
  }
  if (issuerId) {
    try {
      await owner.client
        .schema('admin')
        .rpc('billing_issuer_retire', {
          p_id: issuerId,
          p_reason: 'test cleanup',
        })
      await owner.client
        .schema('admin')
        .rpc('billing_issuer_hard_delete', { p_id: issuerId })
    } catch {
      // tolerate cleanup errors
    }
  }
  if (customer) await cleanupTestOrg(customer)
  if (owner) await cleanupAdminTestUser(owner)
  if (operator) await cleanupAdminTestUser(operator)
  if (support) await cleanupAdminTestUser(support)
})

const LINE_ITEMS_SMALL = [
  {
    description: 'ConsentShield Growth — monthly fee',
    hsn_sac: '9983',
    quantity: 1,
    rate_paise: 100_000,
    amount_paise: 100_000,
  },
]

async function issue(
  caller: AdminTestUser,
  opts: {
    periodStart?: string
    periodEnd?: string
    dueDate?: string | null
    lineItems?: unknown
  } = {},
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await caller.client
    .schema('admin')
    .rpc('billing_issue_invoice', {
      p_account_id: customer.accountId,
      p_period_start: opts.periodStart ?? '2026-04-01',
      p_period_end: opts.periodEnd ?? '2026-04-30',
      p_line_items: opts.lineItems ?? LINE_ITEMS_SMALL,
      p_due_date: opts.dueDate ?? null,
    })
  if (error) return { id: null, error: error.message }
  if (typeof data === 'string') {
    createdInvoices.push(data)
    return { id: data, error: null }
  }
  return { id: null, error: 'RPC returned no id' }
}

async function readEnvelope(invoiceId: string) {
  const { data, error } = await operator.client
    .schema('admin')
    .rpc('billing_invoice_pdf_envelope', { p_invoice_id: invoiceId })
  if (error) throw new Error(error.message)
  return data as {
    invoice: Record<string, unknown>
    issuer: Record<string, unknown>
    account: Record<string, unknown>
  }
}

describe('ADR-0050 Sprint 2.2 — admin.billing_issue_invoice', () => {
  it('operator issues first invoice for FY → CGST+SGST split, fy_sequence=1, status=draft', async () => {
    const { id, error } = await issue(operator)
    expect(error).toBeNull()
    expect(id).toBeTruthy()
    const env = await readEnvelope(id!)
    expect(env.invoice.fy_year).toBe('2026-27')
    expect(env.invoice.fy_sequence).toBe(1)
    expect(env.invoice.status).toBe('draft')
    expect(env.invoice.invoice_number).toBe('CSTEST/2026-27/0001')
    expect(Number(env.invoice.subtotal_paise)).toBe(100_000)
    expect(Number(env.invoice.cgst_paise)).toBe(9_000)
    expect(Number(env.invoice.sgst_paise)).toBe(9_000)
    expect(Number(env.invoice.igst_paise)).toBe(0)
    expect(Number(env.invoice.total_paise)).toBe(118_000)
  })

  it('next invoice same FY gets fy_sequence=2', async () => {
    const { id, error } = await issue(operator, {
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
    })
    expect(error).toBeNull()
    const env = await readEnvelope(id!)
    expect(env.invoice.fy_sequence).toBe(2)
    expect(env.invoice.invoice_number).toBe('CSTEST/2026-27/0002')
  })

  it('period straddling FY boundary raises', async () => {
    const { error } = await issue(operator, {
      periodStart: '2026-03-15',
      periodEnd: '2026-04-15',
    })
    expect(error).not.toBeNull()
    expect(error).toMatch(/FY boundary/i)
  })

  it('support role denied', async () => {
    const { error } = await issue(support)
    expect(error).not.toBeNull()
    expect(error).toMatch(/require|forbidden|permission|denied/i)
  })

  it('line_items must be non-empty array', async () => {
    const { error: emptyErr } = await issue(operator, { lineItems: [] })
    expect(emptyErr).not.toBeNull()
    expect(emptyErr).toMatch(/line_items/i)

    const { error: notArrayErr } = await issue(operator, { lineItems: {} })
    expect(notArrayErr).not.toBeNull()
    expect(notArrayErr).toMatch(/line_items/i)
  })

  it('line_item missing amount_paise raises', async () => {
    const { error } = await issue(operator, {
      lineItems: [
        { description: 'missing amount', hsn_sac: '9983', quantity: 1, rate_paise: 100 },
      ],
    })
    expect(error).not.toBeNull()
    expect(error).toMatch(/amount_paise/i)
  })

  it('missing account billing_* fields raises', async () => {
    const service = getAdminServiceClient()
    await service
      .from('accounts')
      .update({ billing_email: null })
      .eq('id', customer.accountId)

    const { error } = await issue(operator)
    expect(error).not.toBeNull()
    expect(error).toMatch(/billing_email/i)

    // restore for remaining tests
    await populateAccountBillingProfile(customer.accountId)
  })

  it('no active issuer raises', async () => {
    // retire issuer
    await owner.client
      .schema('admin')
      .rpc('billing_issuer_retire', {
        p_id: issuerId,
        p_reason: 'test — no-active-issuer scenario',
      })

    const { error } = await issue(operator)
    expect(error).not.toBeNull()
    expect(error).toMatch(/active issuer/i)

    // restore for remaining tests
    const newId = await createActiveIssuer()
    // update issuerId so afterAll cleans the right one
    try {
      await owner.client
        .schema('admin')
        .rpc('billing_issuer_hard_delete', { p_id: issuerId })
    } catch {
      // may still have invoices referencing it — hard_delete then restricted;
      // afterAll handles best-effort cleanup
    }
    issuerId = newId
  })
})

describe('ADR-0050 Sprint 2.2 — finalize + stamp email', () => {
  let invoiceId: string

  beforeAll(async () => {
    const { id, error } = await issue(operator, {
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
    })
    if (error || !id) throw new Error(`setup issue failed: ${error}`)
    invoiceId = id
  })

  it('finalize flips draft → issued, stamps pdf fields', async () => {
    const fakeSha256 = 'a'.repeat(64)
    const { error } = await operator.client
      .schema('admin')
      .rpc('billing_finalize_invoice_pdf', {
        p_invoice_id: invoiceId,
        p_pdf_r2_key: 'invoices-bucket/invoices/test/2026-27/CSTEST_2026-27_0003.pdf',
        p_pdf_sha256: fakeSha256,
      })
    expect(error).toBeNull()
    const env = await readEnvelope(invoiceId)
    expect(env.invoice.status).toBe('issued')
  })

  it('finalize on non-draft raises', async () => {
    const { error } = await operator.client
      .schema('admin')
      .rpc('billing_finalize_invoice_pdf', {
        p_invoice_id: invoiceId,
        p_pdf_r2_key: 'invoices-bucket/x',
        p_pdf_sha256: 'b'.repeat(64),
      })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/only drafts/i)
  })

  it('stamp_email stamps message id on issued invoice', async () => {
    const msgId = 'resend-msg-test-12345'
    const { error } = await operator.client
      .schema('admin')
      .rpc('billing_stamp_invoice_email', {
        p_invoice_id: invoiceId,
        p_email_message_id: msgId,
      })
    expect(error).toBeNull()
  })

  it('stamp_email on draft raises', async () => {
    const { id } = await issue(operator, {
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
    })
    const { error } = await operator.client
      .schema('admin')
      .rpc('billing_stamp_invoice_email', {
        p_invoice_id: id!,
        p_email_message_id: 'resend-msg-draft',
      })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/draft/i)
  })

  it('support cannot finalize', async () => {
    const { id } = await issue(operator, {
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
    })
    const { error } = await support.client
      .schema('admin')
      .rpc('billing_finalize_invoice_pdf', {
        p_invoice_id: id!,
        p_pdf_r2_key: 'invoices-bucket/x',
        p_pdf_sha256: 'c'.repeat(64),
      })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/require|forbidden|permission|denied/i)
  })

  it('pdf_sha256 must be 64 hex characters', async () => {
    const { id } = await issue(operator, {
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    })
    const { error } = await operator.client
      .schema('admin')
      .rpc('billing_finalize_invoice_pdf', {
        p_invoice_id: id!,
        p_pdf_r2_key: 'invoices-bucket/x',
        p_pdf_sha256: 'too-short',
      })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/sha256/i)
  })
})
