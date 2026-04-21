import { problemJson } from '@/lib/api/auth'
import { readContext, respondV1 } from '@/lib/api/v1-helpers'
import { listPlans } from '@/lib/api/plans'

// ADR-1012 Sprint 1.3 — GET /v1/plans
//
// Public tier table. Any valid Bearer can call (no scope gate; same pattern
// as /v1/_ping and /v1/keys/self). Use case: SDK setup wizards, checkout
// flows, per-tier feature lists.
//
// 200 — PlanListEnvelope
// 401/410/429 — middleware
// 500 — unexpected DB error

const ROUTE = '/api/v1/plans'

export async function GET() {
  const { context, t0 } = await readContext()

  const result = await listPlans()
  if (!result.ok) {
    return respondV1(context, ROUTE, 'GET', 500,
      problemJson(500, 'Internal Server Error', 'Plan listing failed'), t0, true)
  }

  return respondV1(context, ROUTE, 'GET', 200, result.data, t0)
}
