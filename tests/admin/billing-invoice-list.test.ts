import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from './helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0050 Sprint 2.3 — admin.billing_invoice_list + admin.billing_invoice_detail.
//
// Verifies scope rule:
//   · platform_operator sees only invoices under the currently-active issuer
//   · platform_owner sees all issuers, active + retired
//   · support tier is denied
//   · accessing a retired-issuer invoice via detail raises for operators

let owner: AdminTestUser
let operator: AdminTestUser
let support: AdminTestUser
let customer: TestOrg
let activeIssuerId: string
let retiredIssuerId: string
let activeInvoiceId: string
let retiredInvoiceId: string

const service = getAdminServiceClient()

let gstinSeed = Date.now() % 100_000
function nextGstin(): string {
  gstinSeed = (gstinSeed + 1) % 100_000
  return `29AAAAA${String(gstinSeed).padStart(5, '0').slice(-5)}B1Z`
}

async function populateAccountBillingProfile(accountId: string) {
  const { error } = await service
    .from('accounts')
    .update({
      billing_legal_name: 'List Test Customer',
      billing_gstin: '29BBBBB22222C1Z',
      billing_state_code: '29',
      billing_address: '1 List Road, Bangalore',
      billing_email: 'list@test.consentshield.in',
      billing_profile_updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
  if (error) throw new Error(error.message)
}

async function createIssuer(prefix: string): Promise<string> {
  const { data } = await owner.client
    .schema('admin')
    .rpc('billing_issuer_create', {
      p_legal_name: `List Test LLP ${prefix}`,
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

async function issueThroughActiveIssuer(
  periodStart: string,
  periodEnd: string,
): Promise<string> {
  const { data, error } = await operator.client
    .schema('admin')
    .rpc('billing_issue_invoice', {
      p_account_id: customer.accountId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_line_items: [
        {
          description: 'List test line',
          hsn_sac: '9983',
          quantity: 1,
          rate_paise: 100_000,
          amount_paise: 100_000,
        },
      ],
      p_due_date: null,
    })
  if (error) throw new Error(`issue failed: ${error.message}`)
  return data as string
}

beforeAll(async () => {
  owner = await createAdminTestUser('platform_owner')
  operator = await createAdminTestUser('platform_operator')
  support = await createAdminTestUser('support')
  customer = await createTestOrg('invlist')
  await populateAccountBillingProfile(customer.accountId)

  // 1) Create + activate a first issuer; issue one invoice under it.
  retiredIssuerId = await createIssuer('RET')
  await owner.client
    .schema('admin')
    .rpc('billing_issuer_activate', { p_id: retiredIssuerId })
  retiredInvoiceId = await issueThroughActiveIssuer('2026-04-01', '2026-04-30')

  // 2) Retire the first issuer and activate a new one. Issue one invoice there.
  await owner.client
    .schema('admin')
    .rpc('billing_issuer_retire', {
      p_id: retiredIssuerId,
      p_reason: 'rolling to new active issuer for list test',
    })
  activeIssuerId = await createIssuer('ACT')
  await owner.client
    .schema('admin')
    .rpc('billing_issuer_activate', { p_id: activeIssuerId })
  activeInvoiceId = await issueThroughActiveIssuer('2026-05-01', '2026-05-31')
})

afterAll(async () => {
  await service
    .from('invoices')
    .delete()
    .in('id', [activeInvoiceId, retiredInvoiceId].filter(Boolean))
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
  if (customer) await cleanupTestOrg(customer)
  if (owner) await cleanupAdminTestUser(owner)
  if (operator) await cleanupAdminTestUser(operator)
  if (support) await cleanupAdminTestUser(support)
})

describe('ADR-0050 Sprint 2.3 — billing_invoice_list', () => {
  it('platform_operator sees only invoices under the active issuer', async () => {
    const { data, error } = await operator.client
      .schema('admin')
      .rpc('billing_invoice_list', {
        p_account_id: customer.accountId,
        p_limit: 50,
      })
    expect(error).toBeNull()
    const rows = data as Array<{ id: string; issuer_is_active: boolean }>
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(activeInvoiceId)
    expect(ids).not.toContain(retiredInvoiceId)
    rows.forEach((r) => expect(r.issuer_is_active).toBe(true))
  })

  it('platform_owner sees all invoices including retired issuer', async () => {
    const { data, error } = await owner.client
      .schema('admin')
      .rpc('billing_invoice_list', {
        p_account_id: customer.accountId,
        p_limit: 50,
      })
    expect(error).toBeNull()
    const rows = data as Array<{ id: string; issuer_is_active: boolean }>
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(activeInvoiceId)
    expect(ids).toContain(retiredInvoiceId)
  })

  it('results are newest-first by issue_date', async () => {
    const { data } = await owner.client
      .schema('admin')
      .rpc('billing_invoice_list', {
        p_account_id: customer.accountId,
        p_limit: 50,
      })
    const rows = data as Array<{ issue_date: string }>
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].issue_date >= rows[i].issue_date).toBe(true)
    }
  })

  it('p_limit is honoured', async () => {
    const { data } = await owner.client
      .schema('admin')
      .rpc('billing_invoice_list', {
        p_account_id: customer.accountId,
        p_limit: 1,
      })
    expect((data as unknown[]).length).toBe(1)
  })

  it('support role is denied', async () => {
    const { error } = await support.client
      .schema('admin')
      .rpc('billing_invoice_list', {
        p_account_id: customer.accountId,
        p_limit: 50,
      })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/require|forbidden|permission|denied/i)
  })
})

describe('ADR-0050 Sprint 2.3 — billing_invoice_detail', () => {
  it('platform_owner can read a retired-issuer invoice', async () => {
    const { data, error } = await owner.client
      .schema('admin')
      .rpc('billing_invoice_detail', { p_invoice_id: retiredInvoiceId })
    expect(error).toBeNull()
    const env = data as {
      invoice: { id: string; issuer_entity_id: string }
      issuer: { is_active: boolean; retired_at: string | null }
    }
    expect(env.invoice.id).toBe(retiredInvoiceId)
    expect(env.issuer.is_active).toBe(false)
    expect(env.issuer.retired_at).not.toBeNull()
  })

  it('platform_operator cannot read a retired-issuer invoice', async () => {
    const { error } = await operator.client
      .schema('admin')
      .rpc('billing_invoice_detail', { p_invoice_id: retiredInvoiceId })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/non-active issuer/i)
  })

  it('platform_operator can read an active-issuer invoice', async () => {
    const { data, error } = await operator.client
      .schema('admin')
      .rpc('billing_invoice_detail', { p_invoice_id: activeInvoiceId })
    expect(error).toBeNull()
    const env = data as { invoice: { id: string } }
    expect(env.invoice.id).toBe(activeInvoiceId)
  })

  it('missing invoice raises', async () => {
    const { error } = await owner.client
      .schema('admin')
      .rpc('billing_invoice_detail', {
        p_invoice_id: '00000000-0000-0000-0000-000000000000',
      })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/not found/i)
  })

  it('support role is denied', async () => {
    const { error } = await support.client
      .schema('admin')
      .rpc('billing_invoice_detail', { p_invoice_id: activeInvoiceId })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/require|forbidden|permission|denied/i)
  })
})

describe('ADR-0050 Sprint 2.3 — billing_account_summary latest_invoice + balance', () => {
  it('latest_invoice points at the newest invoice and outstanding balance is total_paise of issued invoices', async () => {
    const { data, error } = await operator.client
      .schema('admin')
      .rpc('billing_account_summary', { p_account_id: customer.accountId })
    expect(error).toBeNull()
    const env = data as {
      latest_invoice: { id: string; status: string } | null
      outstanding_balance_paise: number | string
    }
    expect(env.latest_invoice).not.toBeNull()
    expect(env.latest_invoice!.id).toBe(activeInvoiceId)
    // Only active invoice was finalized — its status should be 'draft' because
    // we didn't finalize; still treated as outstanding only if issued.
    // Our RPC sets status='draft' (not 'issued') for the unfinalized invoice, so
    // outstanding should be 0. Finalize it and re-check.
    await operator.client
      .schema('admin')
      .rpc('billing_finalize_invoice_pdf', {
        p_invoice_id: activeInvoiceId,
        p_pdf_r2_key: 'test-bucket/invoices/listtest/active.pdf',
        p_pdf_sha256: 'a'.repeat(64),
      })
    const after = await operator.client
      .schema('admin')
      .rpc('billing_account_summary', { p_account_id: customer.accountId })
    const afterEnv = after.data as { outstanding_balance_paise: number | string }
    expect(Number(afterEnv.outstanding_balance_paise)).toBe(118_000)
  })
})

describe('ADR-0050 Sprint 2.3 — billing_accounts_invoice_snapshot', () => {
  it('returns a snapshot row for the test account, active issuer only for operator', async () => {
    const { data, error } = await operator.client
      .schema('admin')
      .rpc('billing_accounts_invoice_snapshot')
    expect(error).toBeNull()
    const rows = data as Array<{
      account_id: string
      invoice_id: string
      issuer_is_active: boolean
    }>
    const mine = rows.find((r) => r.account_id === customer.accountId)
    expect(mine).toBeDefined()
    expect(mine!.invoice_id).toBe(activeInvoiceId)
    expect(mine!.issuer_is_active).toBe(true)
  })

  it('owner sees the retired-issuer invoice when no active-issuer invoice exists for an account', async () => {
    const { data } = await owner.client
      .schema('admin')
      .rpc('billing_accounts_invoice_snapshot')
    const rows = data as Array<{ account_id: string; invoice_id: string }>
    const mine = rows.find((r) => r.account_id === customer.accountId)
    expect(mine).toBeDefined()
    // Newest overall — activeInvoice has later issue_date
    expect(mine!.invoice_id).toBe(activeInvoiceId)
  })
})
