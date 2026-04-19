import { describe, expect, it } from 'vitest'

import { getAdminServiceClient } from '../admin/helpers'

// ADR-0050 Sprint 2.2 — public.billing_compute_gst.
//
// Tests run against a service-role client because the function is an
// IMMUTABLE SQL primitive with EXECUTE granted to cs_admin, cs_orchestrator,
// and authenticated — the specific caller doesn't matter for behavioural
// assertions. SQL is the system of record for money arithmetic: any future
// change to splitting or rounding shows up here first.

async function compute(
  issuer: string,
  customer: string | null,
  subtotal: number,
  rateBps = 1800,
): Promise<{ cgst: number; sgst: number; igst: number; total: number }> {
  const service = getAdminServiceClient()
  const { data, error } = await service.rpc('billing_compute_gst', {
    p_issuer_state: issuer,
    p_customer_state: customer,
    p_subtotal_paise: subtotal,
    p_rate_bps: rateBps,
  })
  if (error) throw new Error(error.message)
  const row = (data as Array<{
    cgst_paise: number | string
    sgst_paise: number | string
    igst_paise: number | string
    total_gst_paise: number | string
  }>)[0]
  return {
    cgst: Number(row.cgst_paise),
    sgst: Number(row.sgst_paise),
    igst: Number(row.igst_paise),
    total: Number(row.total_gst_paise),
  }
}

describe('ADR-0050 Sprint 2.2 — public.billing_compute_gst', () => {
  it('intra-state → CGST + SGST split 50/50 at 18%', async () => {
    const r = await compute('KA', 'KA', 100_000)
    expect(r.cgst).toBe(9_000)
    expect(r.sgst).toBe(9_000)
    expect(r.igst).toBe(0)
    expect(r.total).toBe(18_000)
    expect(r.cgst + r.sgst).toBe(r.total)
  })

  it('inter-state → full amount on IGST', async () => {
    const r = await compute('KA', 'MH', 100_000)
    expect(r.cgst).toBe(0)
    expect(r.sgst).toBe(0)
    expect(r.igst).toBe(18_000)
    expect(r.total).toBe(18_000)
  })

  it('customer with null state → IGST (registration-agnostic cross-border)', async () => {
    const r = await compute('KA', null, 100_000)
    expect(r.cgst).toBe(0)
    expect(r.sgst).toBe(0)
    expect(r.igst).toBe(18_000)
  })

  it('case-insensitive state match treats KA / ka as intra-state', async () => {
    const r = await compute('KA', 'ka', 100_000)
    expect(r.cgst).toBe(9_000)
    expect(r.sgst).toBe(9_000)
    expect(r.igst).toBe(0)
  })

  it('odd-paise subtotal: remainder lands on SGST so the sum is exact', async () => {
    // 333 × 1800 / 10000 = 59.94 → 59 total GST. 59/2 = 29 CGST; 59-29 = 30 SGST.
    const r = await compute('KA', 'KA', 333)
    expect(r.cgst).toBe(29)
    expect(r.sgst).toBe(30)
    expect(r.igst).toBe(0)
    expect(r.cgst + r.sgst).toBe(r.total)
  })

  it('zero subtotal → zero taxes across the board', async () => {
    const r = await compute('KA', 'KA', 0)
    expect(r.cgst).toBe(0)
    expect(r.sgst).toBe(0)
    expect(r.igst).toBe(0)
    expect(r.total).toBe(0)
  })

  it('custom rate_bps honoured (5% intra-state)', async () => {
    // 100_000 × 500 / 10000 = 5000 total GST; split 2500 / 2500 intra-state.
    const r = await compute('KA', 'KA', 100_000, 500)
    expect(r.cgst).toBe(2_500)
    expect(r.sgst).toBe(2_500)
    expect(r.total).toBe(5_000)
  })

  it('negative subtotal raises', async () => {
    const service = getAdminServiceClient()
    const { error } = await service.rpc('billing_compute_gst', {
      p_issuer_state: 'KA',
      p_customer_state: 'KA',
      p_subtotal_paise: -1,
      p_rate_bps: 1800,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/subtotal/i)
  })

  it('rate_bps > 10000 raises', async () => {
    const service = getAdminServiceClient()
    const { error } = await service.rpc('billing_compute_gst', {
      p_issuer_state: 'KA',
      p_customer_state: 'KA',
      p_subtotal_paise: 100_000,
      p_rate_bps: 10001,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/rate_bps/i)
  })

  it('missing issuer_state raises', async () => {
    const service = getAdminServiceClient()
    const { error } = await service.rpc('billing_compute_gst', {
      p_issuer_state: '',
      p_customer_state: 'KA',
      p_subtotal_paise: 100_000,
      p_rate_bps: 1800,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/issuer_state/i)
  })
})
