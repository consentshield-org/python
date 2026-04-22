import { NextRequest } from 'next/server'
import { problemJson } from '@/lib/api/auth'
import {
  readContext,
  respondV1,
  gateScopeOrProblem,
  requireOrgOrProblem,
} from '@/lib/api/v1-helpers'
import { triggerTestDelete } from '@/lib/consent/test-delete'

// ADR-1005 Phase 2 Sprint 2.1 — POST /v1/integrations/{connector_id}/test_delete
//
// Round-trip validation of a customer's deletion-webhook handler.
// Generates a deletion_receipts row with:
//   trigger_type = 'test_delete'
//   request_payload.is_test = true
//   data_principal_identifier = 'cs_test_principal_<uuid>'
// and leaves delivery to the existing dispatch pipeline.
//
// Scope: write:deletion.
// Rate limit: 10 calls per connector per hour (enforced inside the RPC).

const ROUTE = '/api/v1/integrations/{connector_id}/test_delete'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ connector_id: string }> },
) {
  const { context, t0 } = await readContext()

  const scopeGate = gateScopeOrProblem(context, 'write:deletion')
  if (scopeGate) return respondV1(context, ROUTE, 'POST', scopeGate.status, scopeGate.body, t0, true)

  const orgGate = requireOrgOrProblem(context, ROUTE)
  if (orgGate) return respondV1(context, ROUTE, 'POST', orgGate.status, orgGate.body, t0, true)

  const { connector_id: connectorId } = await params
  if (!connectorId || !UUID_PATTERN.test(connectorId)) {
    return respondV1(context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity', 'connector_id must be a UUID'),
      t0, true)
  }

  const result = await triggerTestDelete({
    keyId:       context.key_id,
    orgId:       context.org_id!,
    connectorId,
  })

  if (!result.ok) {
    switch (result.error.kind) {
      case 'api_key_binding':
        return respondV1(context, ROUTE, 'POST', 403,
          problemJson(403, 'Forbidden', 'API key does not authorise access to this organisation'),
          t0, true)
      case 'connector_not_found':
        return respondV1(context, ROUTE, 'POST', 404,
          problemJson(404, 'Not Found', 'connector_id does not belong to your org'),
          t0, true)
      case 'connector_inactive':
        return respondV1(context, ROUTE, 'POST', 422,
          problemJson(422, 'Unprocessable Entity', result.error.detail),
          t0, true)
      case 'rate_limit_exceeded':
        return respondV1(context, ROUTE, 'POST', 429,
          problemJson(429, 'Too Many Requests', '10 test_delete calls per connector per hour'),
          t0, true)
      default:
        return respondV1(context, ROUTE, 'POST', 500,
          problemJson(500, 'Internal Server Error', 'test_delete failed'),
          t0, true)
    }
  }

  return respondV1(context, ROUTE, 'POST', 202, result.data, t0)
}
