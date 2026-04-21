// ADR-1012 Sprint 1.3 — /v1/plans helper over the cs_api pool.

import { csApi } from './cs-api-client'

export interface PlanItem {
  plan_code:                  string
  display_name:               string
  max_organisations:          number
  max_web_properties_per_org: number
  base_price_inr:             number | null
  trial_days:                 number
  api_rate_limit_per_hour:    number
  api_burst:                  number
}

export interface PlanListEnvelope {
  items: PlanItem[]
}

export type PlanListError = { kind: 'unknown'; detail: string }

export async function listPlans(): Promise<
  { ok: true; data: PlanListEnvelope } | { ok: false; error: PlanListError }
> {
  try {
    const sql = csApi()
    const rows = await sql<Array<{ result: PlanListEnvelope }>>`
      select rpc_plans_list() as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    const err = e as { message?: string }
    return { ok: false, error: { kind: 'unknown', detail: err.message ?? '' } }
  }
}
