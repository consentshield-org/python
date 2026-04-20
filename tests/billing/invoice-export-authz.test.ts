import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from '../admin/helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0050 Sprint 3.1 — admin.billing_invoice_export_manifest +
// admin.billing_invoice_export_audit + admin.billing_invoice_search.
//
// Scope rule: platform_operator → current-active issuer only (any other
// issuer id raises); platform_owner → unconstrained. Both tables + audit
// log gated via require_admin('platform_operator'), so support + read_only
// denied.

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

async function populateBilling(accountId: string) {
  const { error } = await service
    .from('accounts')
    .update({
      billing_legal_name: 'Export Test Customer',
      billing_gstin: null,
      billing_state_code: '29',
      billing_address: '1 Export Rd, Bangalore',
      billing_email: 'export@test.consentshield.in',
      billing_profile_updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
  if (error) throw new Error(error.message)
}

async function createIssuer(prefix: string): Promise<string> {
  const { data } = await owner.client
    .schema('admin')
    .rpc('billing_issuer_create', {
      p_legal_name: `Export LLP ${prefix}`,
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

async function issueAndFinalize(
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
          description: 'Export authz test',
          hsn_sac: '9983',
          quantity: 1,
          rate_paise: 100_000,
          amount_paise: 100_000,
        },
      ],
      p_due_date: null,
    })
  if (error) throw new Error(error.message)
  const id = data as string
  // Finalize so the manifest + search include it (both filter out drafts).
  const fin = await operator.client
    .schema('admin')
    .rpc('billing_finalize_invoice_pdf', {
      p_invoice_id: id,
      p_pdf_r2_key: `test-bucket/invoices/authz/${id}.pdf`,
      p_pdf_sha256: 'b'.repeat(64),
    })
  if (fin.error) throw new Error(`finalize failed: ${fin.error.message}`)
  return id
}

beforeAll(async () => {
  owner = await createAdminTestUser('platform_owner')
  operator = await createAdminTestUser('platform_operator')
  support = await createAdminTestUser('support')
  customer = await createTestOrg('expauth')
  await populateBilling(customer.accountId)

  retiredIssuerId = await createIssuer('EXR')
  await owner.client
    .schema('admin')
    .rpc('billing_issuer_activate', { p_id: retiredIssuerId })
  retiredInvoiceId = await issueAndFinalize('2026-04-01', '2026-04-30')

  await owner.client
    .schema('admin')
    .rpc('billing_issuer_retire', {
      p_id: retiredIssuerId,
      p_reason: 'rolling for export authz',
    })
  activeIssuerId = await createIssuer('EXA')
  await owner.client
    .schema('admin')
    .rpc('billing_issuer_activate', { p_id: activeIssuerId })
  activeInvoiceId = await issueAndFinalize('2026-05-01', '2026-05-31')
})

afterAll(async () => {
  const ids = [activeInvoiceId, retiredInvoiceId].filter(Boolean)
  if (ids.length > 0) await service.from('invoices').delete().in('id', ids)
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

describe('ADR-0050 Sprint 3.1 — billing_invoice_export_manifest', () => {
  it('operator with NULL issuer → active-issuer invoices only', async () => {
    const { data, error } = await operator.client
      .schema('admin')
      .rpc('billing_invoice_export_manifest', {
        p_issuer_id: null,
        p_fy_year: null,
        p_account_id: null,
      })
    expect(error).toBeNull()
    const env = data as {
      rows: Array<{ id: string; issuer_is_active: boolean }>
      summary: { count: number }
      scope: { issuer_id: string | null }
    }
    const ids = env.rows.map((r) => r.id)
    expect(ids).toContain(activeInvoiceId)
    expect(ids).not.toContain(retiredInvoiceId)
    env.rows.forEach((r) => expect(r.issuer_is_active).toBe(true))
  })

  it('operator passing retired-issuer id raises', async () => {
    const { error } = await operator.client
      .schema('admin')
      .rpc('billing_invoice_export_manifest', {
        p_issuer_id: retiredIssuerId,
        p_fy_year: null,
        p_account_id: null,
      })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/currently-active issuer/i)
  })

  it('owner unconstrained: NULL issuer → all; retired issuer → that issuer', async () => {
    const allRes = await owner.client
      .schema('admin')
      .rpc('billing_invoice_export_manifest', {
        p_issuer_id: null,
        p_fy_year: null,
        p_account_id: null,
      })
    expect(allRes.error).toBeNull()
    const all = allRes.data as {
      rows: Array<{ id: string }>
      scope: { all_issuers: boolean }
    }
    const allIds = all.rows.map((r) => r.id)
    expect(allIds).toContain(activeInvoiceId)
    expect(allIds).toContain(retiredInvoiceId)
    expect(all.scope.all_issuers).toBe(true)

    const retRes = await owner.client
      .schema('admin')
      .rpc('billing_invoice_export_manifest', {
        p_issuer_id: retiredIssuerId,
        p_fy_year: null,
        p_account_id: null,
      })
    expect(retRes.error).toBeNull()
    const ret = retRes.data as { rows: Array<{ id: string }> }
    expect(ret.rows.map((r) => r.id)).toEqual([retiredInvoiceId])
  })

  it('account_id filter works', async () => {
    const { data } = await owner.client
      .schema('admin')
      .rpc('billing_invoice_export_manifest', {
        p_issuer_id: null,
        p_fy_year: null,
        p_account_id: customer.accountId,
      })
    const env = data as { rows: Array<{ id: string }> }
    expect(env.rows.length).toBeGreaterThanOrEqual(2)
  })

  it('support + read_only denied', async () => {
    const { error } = await support.client
      .schema('admin')
      .rpc('billing_invoice_export_manifest', {
        p_issuer_id: null,
        p_fy_year: null,
        p_account_id: null,
      })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/require|forbidden|permission|denied/i)
  })
})

describe('ADR-0050 Sprint 3.1 — billing_invoice_export_audit', () => {
  it('records the audit row; rejects bad sha256 length', async () => {
    const okRes = await owner.client
      .schema('admin')
      .rpc('billing_invoice_export_audit', {
        p_issuer_id: activeIssuerId,
        p_fy_year: '2026-27',
        p_account_id: customer.accountId,
        p_row_count: 1,
        p_zip_sha256: 'c'.repeat(64),
      })
    expect(okRes.error).toBeNull()

    const badRes = await owner.client
      .schema('admin')
      .rpc('billing_invoice_export_audit', {
        p_issuer_id: activeIssuerId,
        p_fy_year: null,
        p_account_id: null,
        p_row_count: 1,
        p_zip_sha256: 'short',
      })
    expect(badRes.error).not.toBeNull()
    expect(badRes.error?.message).toMatch(/sha256/i)
  })

  it('support denied', async () => {
    const { error } = await support.client
      .schema('admin')
      .rpc('billing_invoice_export_audit', {
        p_issuer_id: activeIssuerId,
        p_fy_year: null,
        p_account_id: null,
        p_row_count: 1,
        p_zip_sha256: 'd'.repeat(64),
      })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/require|forbidden|permission|denied/i)
  })
})

describe('ADR-0050 Sprint 3.1 — billing_invoice_search', () => {
  it('operator sees only active-issuer invoices', async () => {
    const { data, error } = await operator.client
      .schema('admin')
      .rpc('billing_invoice_search', {
        p_q: null,
        p_account_id: customer.accountId,
        p_date_from: null,
        p_date_to: null,
        p_limit: 50,
        p_offset: 0,
      })
    expect(error).toBeNull()
    const env = data as {
      rows: Array<{ id: string; issuer_is_active: boolean }>
      total: number
    }
    const ids = env.rows.map((r) => r.id)
    expect(ids).toContain(activeInvoiceId)
    expect(ids).not.toContain(retiredInvoiceId)
    env.rows.forEach((r) => expect(r.issuer_is_active).toBe(true))
  })

  it('owner sees retired-issuer invoices too', async () => {
    const { data } = await owner.client
      .schema('admin')
      .rpc('billing_invoice_search', {
        p_q: null,
        p_account_id: customer.accountId,
        p_date_from: null,
        p_date_to: null,
        p_limit: 50,
        p_offset: 0,
      })
    const env = data as { rows: Array<{ id: string }> }
    const ids = env.rows.map((r) => r.id)
    expect(ids).toContain(activeInvoiceId)
    expect(ids).toContain(retiredInvoiceId)
  })

  it('q prefix filter works', async () => {
    const { data } = await owner.client
      .schema('admin')
      .rpc('billing_invoice_search', {
        p_q: 'EXA/',
        p_account_id: null,
        p_date_from: null,
        p_date_to: null,
        p_limit: 50,
        p_offset: 0,
      })
    const env = data as { rows: Array<{ id: string; invoice_number: string }> }
    env.rows.forEach((r) => expect(r.invoice_number.startsWith('EXA/')).toBe(true))
  })

  it('paging honours limit + offset', async () => {
    const first = await owner.client
      .schema('admin')
      .rpc('billing_invoice_search', {
        p_q: null,
        p_account_id: customer.accountId,
        p_date_from: null,
        p_date_to: null,
        p_limit: 1,
        p_offset: 0,
      })
    const second = await owner.client
      .schema('admin')
      .rpc('billing_invoice_search', {
        p_q: null,
        p_account_id: customer.accountId,
        p_date_from: null,
        p_date_to: null,
        p_limit: 1,
        p_offset: 1,
      })
    const a = (first.data as { rows: Array<{ id: string }> }).rows
    const b = (second.data as { rows: Array<{ id: string }> }).rows
    expect(a.length).toBe(1)
    expect(b.length).toBe(1)
    expect(a[0].id).not.toBe(b[0].id)
  })

  it('support denied', async () => {
    const { error } = await support.client
      .schema('admin')
      .rpc('billing_invoice_search', {
        p_q: null,
        p_account_id: null,
        p_date_from: null,
        p_date_to: null,
        p_limit: 10,
        p_offset: 0,
      })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/require|forbidden|permission|denied/i)
  })
})
