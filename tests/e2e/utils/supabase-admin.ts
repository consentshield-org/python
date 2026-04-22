import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Service-role client for observable-state assertions — reads from buffer
// tables and verifies rows produced by the pipeline. Tests NEVER write
// through this client except to compensate for a test-harness bug.
//
// Rule 5 applies: this is test code, not running customer-app code. It
// lives in tests/e2e/ and is excluded from the scripts/check-no-service-role-*
// grep gate by path.

let cached: SupabaseClient | null = null

export function getAdminClient(): SupabaseClient {
  if (cached) return cached
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'tests/e2e/utils/supabase-admin: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required. ' +
        'Pass them via .env.e2e or ambient env.'
    )
  }
  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  return cached
}

/** Convenience: count rows in consent_events for a property since a cutoff. */
export async function countConsentEventsSince(
  propertyId: string,
  sinceIso: string
): Promise<number> {
  const client = getAdminClient()
  const { count, error } = await client
    .from('consent_events')
    .select('id', { count: 'exact', head: true })
    .eq('property_id', propertyId)
    .gte('created_at', sinceIso)
  if (error) throw new Error(`countConsentEventsSince: ${error.message}`)
  return count ?? 0
}

/** Convenience: fetch the most recent consent_events row for a property. */
export async function latestConsentEvent(
  propertyId: string,
  sinceIso: string
): Promise<{
  id: string
  org_id: string
  property_id: string
  banner_id: string
  event_type: string
  origin_verified: string
  created_at: string
} | null> {
  const client = getAdminClient()
  const { data, error } = await client
    .from('consent_events')
    .select('id, org_id, property_id, banner_id, event_type, origin_verified, created_at')
    .eq('property_id', propertyId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`latestConsentEvent: ${error.message}`)
  return data
}
