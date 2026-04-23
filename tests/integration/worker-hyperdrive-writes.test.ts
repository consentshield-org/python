import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getServiceClient } from '../rls/helpers'

// ADR-1010 Phase 3 Sprint 3.2 — integration test for the Hyperdrive
// write path. Exercises the exact INSERTs the Worker issues in prod,
// against dev Supabase via postgres.js as cs_worker.
//
// cs_worker has INSERT-only column grants on these three tables — no
// SELECT, no RETURNING. Assertions verify the row landed via the
// service-role client (admin).
//
// Skip-on-missing-env when SUPABASE_CS_WORKER_DATABASE_URL is not set.

const CS_WORKER_DSN = process.env.SUPABASE_CS_WORKER_DATABASE_URL
const ipostgres = async () => (await import('postgres')).default

const admin = getServiceClient()

const fixtureSuffix = `hdw-${Date.now()}`
let accountId: string
let orgId: string
let propertyId: string
let bannerId: string

const skipSuite = !CS_WORKER_DSN ? describe.skip : describe

beforeAll(async () => {
  if (!CS_WORKER_DSN) return

  const { data: account } = await admin
    .from('accounts')
    .insert({ name: `HD-writes ${fixtureSuffix}`, plan_code: 'trial_starter', status: 'trial' })
    .select('id')
    .single()
  accountId = (account as { id: string }).id

  const { data: org } = await admin
    .from('organisations')
    .insert({ name: `HD-writes ${fixtureSuffix}`, account_id: accountId })
    .select('id')
    .single()
  orgId = (org as { id: string }).id

  const { data: prop } = await admin
    .from('web_properties')
    .insert({
      org_id: orgId,
      name: 'hd writes fixture',
      url: `https://hdw-${fixtureSuffix}.test`,
      allowed_origins: [`https://hdw-${fixtureSuffix}.test`],
      event_signing_secret: `secret_${fixtureSuffix}`,
    })
    .select('id')
    .single()
  propertyId = (prop as { id: string }).id

  const { data: banner } = await admin
    .from('consent_banners')
    .insert({
      org_id: orgId,
      property_id: propertyId,
      version: 1,
      is_active: true,
      headline: 'hd',
      body_copy: 'hd',
      purposes: [],
    })
    .select('id')
    .single()
  bannerId = (banner as { id: string }).id
})

afterAll(async () => {
  if (!CS_WORKER_DSN) return
  if (orgId) {
    await admin.from('consent_events').delete().eq('org_id', orgId)
    await admin.from('tracker_observations').delete().eq('org_id', orgId)
    await admin.from('worker_errors').delete().eq('org_id', orgId)
    await admin.from('organisations').delete().eq('id', orgId)
  }
  if (accountId) await admin.from('accounts').delete().eq('id', accountId)
})

skipSuite('ADR-1010 P3 S3.2 — cs_worker Hyperdrive write path (postgres.js)', () => {
  it('INSERTs consent_events with jsonb purposes_accepted / purposes_rejected', async () => {
    const postgres = await ipostgres()
    const sql = postgres(CS_WORKER_DSN!, { prepare: false, connect_timeout: 10, idle_timeout: 5 })
    const fingerprint = `fp-${fixtureSuffix}-ce`
    try {
      await sql`
        insert into public.consent_events (
          org_id, property_id, banner_id, banner_version,
          session_fingerprint, event_type,
          purposes_accepted, purposes_rejected,
          ip_truncated, user_agent_hash, origin_verified
        ) values (
          ${orgId}::uuid, ${propertyId}::uuid, ${bannerId}::uuid, 1,
          ${fingerprint}, 'consent_given',
          ${sql.json(['analytics'])},
          ${sql.json(['marketing'])},
          '10.0.0.0', 'uah-test', 'hmac-verified'
        )
      `
    } finally {
      await sql.end({ timeout: 1 })
    }

    const { data } = await admin
      .from('consent_events')
      .select('event_type, purposes_accepted, purposes_rejected, origin_verified')
      .eq('session_fingerprint', fingerprint)
      .single()
    const row = data as {
      event_type: string
      purposes_accepted: string[]
      purposes_rejected: string[]
      origin_verified: string
    } | null
    expect(row).not.toBeNull()
    expect(row!.event_type).toBe('consent_given')
    expect(row!.purposes_accepted).toContain('analytics')
    expect(row!.purposes_rejected).toContain('marketing')
    expect(row!.origin_verified).toBe('hmac-verified')
  })

  it('INSERTs tracker_observations with jsonb consent_state / trackers / violations', async () => {
    const postgres = await ipostgres()
    const sql = postgres(CS_WORKER_DSN!, { prepare: false, connect_timeout: 10, idle_timeout: 5 })
    const fingerprint = `fp-${fixtureSuffix}-to`
    try {
      await sql`
        insert into public.tracker_observations (
          org_id, property_id, session_fingerprint,
          consent_state, trackers_detected, violations,
          page_url_hash, origin_verified
        ) values (
          ${orgId}::uuid, ${propertyId}::uuid, ${fingerprint},
          ${sql.json({ analytics: true, marketing: false })},
          ${sql.json([{ service_slug: 'gtag', category: 'analytics' }])},
          ${sql.json([{ service_slug: 'gtag', reason: 'unconsented' }])},
          'hash_test', 'origin-only'
        )
      `
    } finally {
      await sql.end({ timeout: 1 })
    }

    const { data } = await admin
      .from('tracker_observations')
      .select('consent_state, trackers_detected, violations, origin_verified')
      .eq('session_fingerprint', fingerprint)
      .single()
    const row = data as {
      consent_state: Record<string, boolean>
      trackers_detected: Array<Record<string, string>>
      violations: Array<Record<string, string>>
      origin_verified: string
    } | null
    expect(row).not.toBeNull()
    expect(row!.consent_state.analytics).toBe(true)
    expect(row!.trackers_detected).toHaveLength(1)
    expect(row!.violations).toHaveLength(1)
    expect(row!.origin_verified).toBe('origin-only')
  })

  it('INSERTs worker_errors', async () => {
    const postgres = await ipostgres()
    const sql = postgres(CS_WORKER_DSN!, { prepare: false, connect_timeout: 10, idle_timeout: 5 })
    try {
      await sql`
        insert into public.worker_errors (
          org_id, property_id, endpoint, status_code, upstream_error
        ) values (
          ${orgId}::uuid, ${propertyId}::uuid,
          '/v1/events', 500, 'hd-writes-test-error'
        )
      `
    } finally {
      await sql.end({ timeout: 1 })
    }

    const { data } = await admin
      .from('worker_errors')
      .select('endpoint, status_code, upstream_error')
      .eq('org_id', orgId)
      .eq('upstream_error', 'hd-writes-test-error')
      .single()
    const row = data as {
      endpoint: string
      status_code: number
      upstream_error: string
    } | null
    expect(row).not.toBeNull()
    expect(row!.endpoint).toBe('/v1/events')
    expect(row!.status_code).toBe(500)
  })

  it('rejects RETURNING (cs_worker has INSERT-only column grants)', async () => {
    const postgres = await ipostgres()
    const sql = postgres(CS_WORKER_DSN!, { prepare: false, connect_timeout: 10, idle_timeout: 5 })
    try {
      await expect(
        sql`
          insert into public.consent_events (
            org_id, property_id, banner_id, banner_version,
            session_fingerprint, event_type,
            purposes_accepted, purposes_rejected, origin_verified
          ) values (
            ${orgId}::uuid, ${propertyId}::uuid, ${bannerId}::uuid, 1,
            'returning-test', 'consent_given',
            ${sql.json([])}, ${sql.json([])},
            'hmac-verified'
          )
          returning id
        `,
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await sql.end({ timeout: 1 })
    }
  })
})
