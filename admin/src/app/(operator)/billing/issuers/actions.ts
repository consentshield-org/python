'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0050 Sprint 2.1 chunk 2 — Issuer entity server actions.
//
// All writes require platform_owner; the RPC is the authoritative gate
// (returns "platform_owner role required" when denied), so these actions
// forward the RPC error verbatim.

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

interface CreateIssuerInput {
  legalName: string
  gstin: string
  pan: string
  registeredStateCode: string
  registeredAddress: string
  invoicePrefix: string
  fyStartMonth: number
  signatoryName: string
  signatoryDesignation: string | null
  bankAccountMasked: string | null
  logoR2Key: string | null
}

export async function createIssuerAction(
  input: CreateIssuerInput,
): Promise<ActionResult<{ issuerId: string }>> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .schema('admin')
    .rpc('billing_issuer_create', {
      p_legal_name: input.legalName.trim(),
      p_gstin: input.gstin.trim(),
      p_pan: input.pan.trim(),
      p_registered_state_code: input.registeredStateCode.trim(),
      p_registered_address: input.registeredAddress.trim(),
      p_invoice_prefix: input.invoicePrefix.trim(),
      p_fy_start_month: input.fyStartMonth,
      p_signatory_name: input.signatoryName.trim(),
      p_signatory_designation:
        input.signatoryDesignation?.trim() || null,
      p_bank_account_masked: input.bankAccountMasked?.trim() || null,
      p_logo_r2_key: input.logoR2Key?.trim() || null,
    })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/billing/issuers')
  return { ok: true, data: { issuerId: data as string } }
}

export interface UpdateIssuerPatch {
  registeredAddress?: string
  logoR2Key?: string | null
  signatoryName?: string
  signatoryDesignation?: string | null
  bankAccountMasked?: string | null
}

export async function updateIssuerAction(
  issuerId: string,
  patch: UpdateIssuerPatch,
): Promise<ActionResult> {
  const pPatch: Record<string, unknown> = {}
  if (patch.registeredAddress !== undefined)
    pPatch.registered_address = patch.registeredAddress
  if (patch.logoR2Key !== undefined) pPatch.logo_r2_key = patch.logoR2Key
  if (patch.signatoryName !== undefined)
    pPatch.signatory_name = patch.signatoryName
  if (patch.signatoryDesignation !== undefined)
    pPatch.signatory_designation = patch.signatoryDesignation
  if (patch.bankAccountMasked !== undefined)
    pPatch.bank_account_masked = patch.bankAccountMasked

  if (Object.keys(pPatch).length === 0) {
    return { ok: false, error: 'No changes to apply.' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('billing_issuer_update', {
    p_id: issuerId,
    p_patch: pPatch,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/billing/issuers')
  revalidatePath(`/billing/issuers/${issuerId}`)
  return { ok: true }
}

export async function activateIssuerAction(
  issuerId: string,
): Promise<ActionResult> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('billing_issuer_activate', { p_id: issuerId })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/billing/issuers')
  revalidatePath(`/billing/issuers/${issuerId}`)
  return { ok: true }
}

export async function retireIssuerAction(
  issuerId: string,
  reason: string,
): Promise<ActionResult> {
  if (reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }
  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('billing_issuer_retire', { p_id: issuerId, p_reason: reason.trim() })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/billing/issuers')
  revalidatePath(`/billing/issuers/${issuerId}`)
  return { ok: true }
}

export async function hardDeleteIssuerAction(
  issuerId: string,
): Promise<ActionResult> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('billing_issuer_hard_delete', { p_id: issuerId })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/billing/issuers')
  redirect('/billing/issuers')
}
