// ADR-1012 Sprint 1.2 — /v1/purposes and /v1/properties helpers over the cs_api pool.

import { csApi } from './cs-api-client'

// ── /v1/purposes ─────────────────────────────────────────────────────────────

export interface PurposeItem {
  id:                    string
  purpose_code:          string
  display_name:          string
  description:           string | null
  data_scope:            string[]
  default_expiry_days:   number
  auto_delete_on_expiry: boolean
  is_required:           boolean
  framework:             string
  is_active:             boolean
  created_at:            string
  updated_at:            string
}

export interface PurposeListEnvelope {
  items: PurposeItem[]
}

export type PurposeListError =
  | { kind: 'api_key_binding'; detail: string }
  | { kind: 'unknown'; detail: string }

function classifyKeyBinding(err: { code?: string; message?: string }): boolean {
  const msg = err.message ?? ''
  return (
    err.code === '42501' ||
    msg.includes('api_key_') ||
    msg.includes('org_id_missing') ||
    msg.includes('org_not_found')
  )
}

export async function listPurposes(params: {
  keyId: string
  orgId: string
}): Promise<{ ok: true; data: PurposeListEnvelope } | { ok: false; error: PurposeListError }> {
  try {
    const sql = csApi()
    const rows = await sql<Array<{ result: PurposeListEnvelope }>>`
      select rpc_purpose_list(${params.keyId}::uuid, ${params.orgId}::uuid) as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    const msg = err.message ?? ''
    if (classifyKeyBinding(err)) return { ok: false, error: { kind: 'api_key_binding', detail: msg } }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }
}

// ── /v1/properties ───────────────────────────────────────────────────────────

export interface PropertyItem {
  id:                   string
  name:                 string
  url:                  string
  allowed_origins:      string[]
  snippet_verified_at:  string | null
  snippet_last_seen_at: string | null
  created_at:           string
  updated_at:           string
}

export interface PropertyListEnvelope {
  items: PropertyItem[]
}

export type PropertyListError =
  | { kind: 'api_key_binding'; detail: string }
  | { kind: 'unknown'; detail: string }

export async function listProperties(params: {
  keyId: string
  orgId: string
}): Promise<{ ok: true; data: PropertyListEnvelope } | { ok: false; error: PropertyListError }> {
  try {
    const sql = csApi()
    const rows = await sql<Array<{ result: PropertyListEnvelope }>>`
      select rpc_property_list(${params.keyId}::uuid, ${params.orgId}::uuid) as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    const msg = err.message ?? ''
    if (classifyKeyBinding(err)) return { ok: false, error: { kind: 'api_key_binding', detail: msg } }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }
}
