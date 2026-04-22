// ADR-1005 Phase 2 Sprint 2.1 — test_delete helper over the cs_api pool.
//
// Wraps rpc_test_delete_trigger. The surface is fenced at the DB by
// assert_api_key_binding(p_key_id, p_org_id); rate-limited 10 calls
// per connector per hour inside the RPC.

import { csApi } from '../api/cs-api-client'

export interface TestDeleteEnvelope {
  receipt_id:                string
  data_principal_identifier: string
  reason:                    'test'
  connector_id:              string
  connector_type:            string
  status:                    string
  note:                      string
}

export type TestDeleteError =
  | { kind: 'api_key_binding';    detail: string }
  | { kind: 'connector_not_found' }
  | { kind: 'connector_inactive'; detail: string }
  | { kind: 'rate_limit_exceeded' }
  | { kind: 'unknown';            detail: string }

function classify(err: { code?: string; message?: string }): TestDeleteError {
  const code = err.code ?? ''
  const msg  = err.message ?? ''

  if (
    code === '42501' ||
    msg.includes('api_key_') ||
    msg.includes('org_id_missing') ||
    msg.includes('org_not_found')
  ) {
    return { kind: 'api_key_binding', detail: msg }
  }
  if (msg.includes('connector_not_found')) return { kind: 'connector_not_found' }
  if (msg.includes('connector_inactive'))  return { kind: 'connector_inactive', detail: msg }
  if (msg.includes('rate_limit_exceeded')) return { kind: 'rate_limit_exceeded' }
  return { kind: 'unknown', detail: msg }
}

export async function triggerTestDelete(input: {
  keyId:       string
  orgId:       string
  connectorId: string
}): Promise<
  | { ok: true;  data: TestDeleteEnvelope }
  | { ok: false; error: TestDeleteError }
> {
  try {
    const sql = csApi()
    const rows = await sql<Array<{ result: TestDeleteEnvelope }>>`
      select rpc_test_delete_trigger(
        ${input.keyId}::uuid,
        ${input.orgId}::uuid,
        ${input.connectorId}::uuid
      ) as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    return { ok: false, error: classify(e as { code?: string; message?: string }) }
  }
}
