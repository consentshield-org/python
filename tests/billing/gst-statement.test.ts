import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from '../admin/helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0050 Sprint 3.1 — admin.billing_gst_statement.
//
// Synthetic setup: two issuers (one retired, one active), two accounts
// (one intra-state KA, one inter-state MH), three invoices total.
// Verifies:
//   · operator caller with current-active issuer succeeds; summary totals
//     match the two active-issuer invoices.
//   · operator caller passing retired issuer id raises.
//   · operator caller with NULL issuer resolves to active.
//   · owner caller with NULL issuer returns all three invoices.
//   · owner caller with retired issuer id succeeds.
//   · support tier denied.

let owner: AdminTestUser
let operator: AdminTestUser
let support: AdminTestUser
let customerKa: TestOrg
let customerMh: TestOrg
let retiredIssuerId: string
let activeIssuerId: string
let retiredInvoiceId: string
let activeInvoiceKaId: string
let activeInvoiceMhId: string

const service = getAdminServiceClient()

let gstinSeed = Date.now() % 100_000
function nextGstin(): string {
  gstinSeed = (gstinSeed + 1) % 100_000
  return `29AAAAA${String(gstinSeed).padStart(5, '0').slice(-5)}B1Z`
}

async function setAccountBillingProfile(
  accountId: string,
  legalName: string,
  stateCode: string,
) {
  const { error } = await service
    .from('accounts')
    .update({
      billing_legal_name: legalName,
      billing_gstin: null,
      billing_state_code: stateCode,
      billing_address: `Address for ${legalName}`,
      billing_email: `${legalName.replace(/[^A-Za-z0-9]/g, '').toLowerCase()}@test.consentshield.in`,
      billing_profile_updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
  if (error) throw new Error(error.message)
}

async function createIssuer(prefix: string): Promise<string> {
  const { data } = await owner.client
    .schema('admin')
    .rpc('billing_issuer_create', {
      p_legal_name: `GST Statement LLP ${prefix}`,
      p_gstin: nextGstin(),
      p_pan: 'AAAAA1234B',
      p_registered_state_code: '29',
      p_registered_address: '1 Test St, Bangalore',
      p_invoice_prefix: prefix,
      p_fy_start_month: 4,
      p_signatory_name: 'Test Signatory',
      p_signatory_designation: 'Director',
      p_bank_account_masked: '**** 0000',
      p_logo_r2_key: null,
    })
  return data as string
}

async function issueInvoice(
  customer: TestOrg,
  periodStart: string,
  periodEnd: string,
  amountPaise: number,
): Promise<string> {
  const { data, error } = await operator.client
    .schema('admin')
    .rpc('billing_issue_invoice', {
      p_account_id: customer.accountId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_line_items: [
        {
          description: 'GST statement test line',
          hsn_sac: '9983',
          quantity: 1,
          rate_paise: amountPaise,
          amount_paise: amountPaise,
        },
      ],
      p_due_date: null,
    })
  if (error) throw new Error(error.message)
  return data as string
}

async function finalizeInvoice(invoiceId: string) {
  await operator.client
    .schema('admin')
    .rpc('billing_finalize_invoice_pdf', {
      p_invoice_id: invoiceId,
      p_pdf_r2_key: `test-bucket/invoices/gst/${invoiceId}.pdf`,
      p_pdf_sha256: 'a'.repeat(64),
    })
}

beforeAll(async () => {
  owner = await createAdminTestUser('platform_owner')
  operator = await createAdminTestUser('platform_operator')
  support = await createAdminTestUser('support')
  customerKa = await createTestOrg('gstka')
  customerMh = await createTestOrg('gstmh')
  await setAccountBillingProfile(customerKa.accountId, 'GST KA Customer', '29')
  await setAccountBillingProfile(customerMh.accountId, 'GST MH Customer', '27')

  // Issuer A — will be retired after issuing one invoice.
  retiredIssuerId = await createIssuer('GRET')
  await owner.client
    .schema('admin')
    .rpc('billing_issuer_activate', { p_id: retiredIssuerId })
  retiredInvoiceId = await issueInvoice(
    customerKa,
    '2026-04-01',
    '2026-04-30',
    100_000,
  )
  await finalizeInvoice(retiredInvoiceId)

  // Retire and roll to Issuer B.
  await owner.client
    .schema('admin')
    .rpc('billing_issuer_retire', {
      p_id: retiredIssuerId,
      p_reason: 'rolling for gst statement test',
    })
  activeIssuerId = await createIssuer('GACT')
  await owner.client
    .schema('admin')
    .rpc('billing_issuer_activate', { p_id: activeIssuerId })

  activeInvoiceKaId = await issueInvoice(
    customerKa,
    '2026-05-01',
    '2026-05-31',
    200_000,
  )
  await finalizeInvoice(activeInvoiceKaId)

  activeInvoiceMhId = await issueInvoice(
    customerMh,
    '2026-05-01',
    '2026-05-31',
    500_000,
  )
  await finalizeInvoice(activeInvoiceMhId)
})

afterAll(async () => {
  const ids = [retiredInvoiceId, activeInvoiceKaId, activeInvoiceMhId].filter(Boolean)
  if (ids.length > 0) {
    await service.from('invoices').delete().in('id', ids)
  }
  try {
    if (activeIssuerId) {
      await owner.client
        .schema('admin')
        .rpc('billing_issuer_retire', { p_id: activeIssuerId, p_reason: 'test cleanup' })
      await owner.client
        .schema('admin')
        .rpc('billing_issuer_hard_delete', { p_id: activeIssuerId })
    }
    if (retiredIssuerId) {
      await owner.client
        .schema('admin')
        .rpc('billing_issuer_hard_delete', { p_id: retiredIssuerId })
    }
  } catch {
    // best effort
  }
  if (customerKa) await cleanupTestOrg(customerKa)
  if (customerMh) await cleanupTestOrg(customerMh)
  if (owner) await cleanupAdminTestUser(owner)
  if (operator) await cleanupAdminTestUser(operator)
  if (support) await cleanupAdminTestUser(support)
})

describe('ADR-0050 Sprint 3.1 — admin.billing_gst_statement', () => {
  it('operator + NULL issuer resolves to active; returns two rows with correct totals', async () => {
    const { data, error } = await operator.client
      .schema('admin')
      .rpc('billing_gst_statement', {
        p_issuer_id: null,
        p_fy_start: '2026-04-01',
        p_fy_end: '2027-03-31',
      })
    expect(error).toBeNull()
    const env = data as {
      rows: Array<{ invoice_number: string; total_paise: number | string }>
      summary: {
        count: number
        subtotal_paise: number | string
        cgst_paise: number | string
        sgst_paise: number | string
        igst_paise: number | string
        total_paise: number | string
      }
      scope: { caller_role: string; all_issuers: boolean }
    }
    expect(env.rows.length).toBe(2)
    expect(env.summary.count).toBe(2)
    // KA invoice: 200_000 subtotal, intra-state → CGST 18_000 + SGST 18_000, total 236_000
    // MH invoice: 500_000 subtotal, inter-state → IGST 90_000, total 590_000
    expect(Number(env.summary.subtotal_paise)).toBe(700_000)
    expect(Number(env.summary.cgst_paise)).toBe(18_000)
    expect(Number(env.summary.sgst_paise)).toBe(18_000)
    expect(Number(env.summary.igst_paise)).toBe(90_000)
    expect(Number(env.summary.total_paise)).toBe(826_000)
    expect(env.scope.caller_role).toBe('platform_operator')
    expect(env.scope.all_issuers).toBe(false)
  })

  it('operator + active issuer id succeeds (same result)', async () => {
    const { data, error } = await operator.client
      .schema('admin')
      .rpc('billing_gst_statement', {
        p_issuer_id: activeIssuerId,
        p_fy_start: '2026-04-01',
        p_fy_end: '2027-03-31',
      })
    expect(error).toBeNull()
    const env = data as { summary: { count: number } }
    expect(env.summary.count).toBe(2)
  })

  it('operator + retired issuer id raises with scope error', async () => {
    const { error } = await operator.client
      .schema('admin')
      .rpc('billing_gst_statement', {
        p_issuer_id: retiredIssuerId,
        p_fy_start: '2026-04-01',
        p_fy_end: '2027-03-31',
      })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/currently-active issuer/i)
  })

  it('owner + NULL issuer returns all three invoices across both issuers', async () => {
    const { data, error } = await owner.client
      .schema('admin')
      .rpc('billing_gst_statement', {
        p_issuer_id: null,
        p_fy_start: '2026-04-01',
        p_fy_end: '2027-03-31',
      })
    expect(error).toBeNull()
    const env = data as {
      rows: Array<{ invoice_number: string }>
      summary: { count: number; total_paise: number | string }
      scope: { all_issuers: boolean }
    }
    expect(env.rows.length).toBe(3)
    expect(env.summary.count).toBe(3)
    expect(env.scope.all_issuers).toBe(true)
  })

  it('owner + retired issuer id succeeds and returns only that issuer\'s invoices', async () => {
    const { data, error } = await owner.client
      .schema('admin')
      .rpc('billing_gst_statement', {
        p_issuer_id: retiredIssuerId,
        p_fy_start: '2026-04-01',
        p_fy_end: '2027-03-31',
      })
    expect(error).toBeNull()
    const env = data as { rows: Array<unknown>; summary: { count: number } }
    expect(env.rows.length).toBe(1)
    expect(env.summary.count).toBe(1)
  })

  it('support tier denied', async () => {
    const { error } = await support.client
      .schema('admin')
      .rpc('billing_gst_statement', {
        p_issuer_id: null,
        p_fy_start: '2026-04-01',
        p_fy_end: '2027-03-31',
      })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/require|forbidden|permission|denied/i)
  })

  it('invalid FY range raises', async () => {
    const { error } = await owner.client
      .schema('admin')
      .rpc('billing_gst_statement', {
        p_issuer_id: null,
        p_fy_start: '2027-03-31',
        p_fy_end: '2026-04-01',
      })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/fy_end/i)
  })
})
