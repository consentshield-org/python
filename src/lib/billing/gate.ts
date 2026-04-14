import { createClient } from '@supabase/supabase-js'
import { PLANS, type PlanId } from './plans'

type Resource = 'web_properties' | 'deletion_connectors'

/**
 * Check if the org is allowed to create one more of `resource`.
 * Returns { allowed: true } or { allowed: false, limit, current } when blocked.
 */
export async function checkPlanLimit(
  orgId: string,
  resource: Resource,
): Promise<{ allowed: true } | { allowed: false; limit: number; current: number; plan: string }> {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: org } = await admin
    .from('organisations')
    .select('plan')
    .eq('id', orgId)
    .single()

  const planId = (org?.plan ?? 'trial') as PlanId
  const plan = PLANS[planId] ?? PLANS.trial
  const limit = plan.limits[resource]

  if (limit === null) return { allowed: true } // unlimited

  const tableMap: Record<Resource, string> = {
    web_properties: 'web_properties',
    deletion_connectors: 'integration_connectors',
  }

  const { count } = await admin
    .from(tableMap[resource])
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)

  const current = count ?? 0
  if (current >= limit) {
    return { allowed: false, limit, current, plan: planId }
  }

  return { allowed: true }
}
