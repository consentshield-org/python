// ADR-1010 Phase 2 Sprint 2.1 — cs_worker direct-Postgres role smoke tests.
//
// Skips gracefully when SUPABASE_CS_WORKER_DATABASE_URL is not set (pre-env
// setup; see docs/runbooks/adr-1010-cs-worker-setup.md).
//
// When set, validates that `cs_worker` connected via Supavisor pooler can:
//   - INSERT into consent_events, tracker_observations, worker_errors
//   - SELECT from consent_banners, web_properties (incl. event_signing_secret)
//   - UPDATE web_properties.snippet_last_seen_at only
// and CANNOT:
//   - SELECT api_keys, organisations, accounts (minimum-privilege proof)
//   - UPDATE any web_properties column besides snippet_last_seen_at
//   - DELETE any buffer table row
//
// This test is the direct-Postgres equivalent of the checks the Worker
// today performs via PostgREST + HS256 JWT. Once ADR-1010 Phase 3 lands,
// these same grants back the production Worker surface.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  type TestOrg,
} from '../rls/helpers'

const CS_WORKER_URL = process.env.SUPABASE_CS_WORKER_DATABASE_URL

const describeIf = CS_WORKER_URL ? describe : describe.skip

describeIf('cs_worker direct-Postgres role — ADR-1010 Phase 2', () => {
  let org: TestOrg
  let propertyId: string
  let bannerId: string
  let sql: ReturnType<typeof postgres>

  beforeAll(async () => {
    sql = postgres(CS_WORKER_URL!, {
      prepare:         false,
      max:             2,
      idle_timeout:    5,
      connect_timeout: 10,
      ssl:             'require',
    })

    org = await createTestOrg('csWorker')
    const admin = getServiceClient()

    const { data: prop, error: pErr } = await admin
      .from('web_properties')
      .insert({
        org_id: org.orgId,
        name: 'cs_worker smoke property',
        url: `https://cs-worker-${Date.now()}.test`,
        allowed_origins: [`https://cs-worker-${Date.now()}.test`],
      })
      .select('id').single()
    if (pErr) throw new Error(`seed property: ${pErr.message}`)
    propertyId = prop.id

    const { data: banner, error: bErr } = await admin
      .from('consent_banners')
      .insert({
        org_id: org.orgId,
        property_id: propertyId,
        version: 1,
        is_active: true,
        headline: 'cs_worker test banner',
        body_copy: 'smoke',
        purposes: [],
      })
      .select('id').single()
    if (bErr) throw new Error(`seed banner: ${bErr.message}`)
    bannerId = banner.id
  }, 60_000)

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 })
    if (org) await cleanupTestOrg(org)
  }, 30_000)

  it('runs as cs_worker', async () => {
    const rows = await sql<Array<{ current_user: string }>>`select current_user`
    expect(rows[0].current_user).toBe('cs_worker')
  })

  it('SELECT on web_properties succeeds and includes event_signing_secret', async () => {
    const rows = await sql<Array<{ id: string; event_signing_secret: string | null }>>`
      select id, event_signing_secret from web_properties where id = ${propertyId}::uuid
    `
    expect(rows.length).toBe(1)
    expect(rows[0].id).toBe(propertyId)
  })

  it('SELECT on consent_banners succeeds', async () => {
    const rows = await sql<Array<{ id: string }>>`
      select id from consent_banners where id = ${bannerId}::uuid
    `
    expect(rows.length).toBe(1)
    expect(rows[0].id).toBe(bannerId)
  })

  // INSERTs use no RETURNING — cs_worker has INSERT-only column grants on
  // these buffer tables (mirrors PostgREST's Prefer: return=minimal path
  // used by the production Worker today). Assertion is "INSERT succeeded"
  // via postgres.js .count and verified via the admin client.
  it('INSERT into consent_events succeeds', async () => {
    const fingerprint = `csw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const result = await sql`
      insert into consent_events
        (org_id, property_id, banner_id, banner_version,
         session_fingerprint, event_type, purposes_accepted, purposes_rejected,
         origin_verified)
      values (${org.orgId}::uuid, ${propertyId}::uuid, ${bannerId}::uuid, 1,
              ${fingerprint}, 'consent_given', ${sql.array([])}, ${sql.array([])},
              true)
    `
    expect(result.count).toBe(1)

    const admin = getServiceClient()
    const { data } = await admin
      .from('consent_events').select('id').eq('session_fingerprint', fingerprint).maybeSingle()
    expect(data?.id).toBeTruthy()
  })

  it('INSERT into tracker_observations succeeds', async () => {
    const fingerprint = `csw-obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // consent_state + trackers_detected are jsonb; origin_verified is text on
    // this table (unlike consent_events where it's boolean).
    const result = await sql`
      insert into tracker_observations
        (org_id, property_id, session_fingerprint, page_url_hash,
         trackers_detected, consent_state, origin_verified)
      values (${org.orgId}::uuid, ${propertyId}::uuid, ${fingerprint},
              'abc123', ${JSON.stringify([])}::jsonb,
              ${JSON.stringify({ state: 'granted' })}::jsonb, 'hmac-v1')
    `
    expect(result.count).toBe(1)

    const admin = getServiceClient()
    const { data } = await admin
      .from('tracker_observations').select('id').eq('session_fingerprint', fingerprint).maybeSingle()
    expect(data?.id).toBeTruthy()
  })

  it('INSERT into worker_errors succeeds', async () => {
    const endpointTag = `/v1/events-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const result = await sql`
      insert into worker_errors
        (org_id, property_id, endpoint, status_code, upstream_error)
      values (${org.orgId}::uuid, ${propertyId}::uuid, ${endpointTag},
              500, 'cs_worker smoke')
    `
    expect(result.count).toBe(1)

    const admin = getServiceClient()
    const { data } = await admin
      .from('worker_errors').select('id').eq('endpoint', endpointTag).maybeSingle()
    expect(data?.id).toBeTruthy()
  })

  it('UPDATE on web_properties.snippet_last_seen_at succeeds', async () => {
    const rows = await sql<Array<{ snippet_last_seen_at: string | null }>>`
      update web_properties
         set snippet_last_seen_at = now()
       where id = ${propertyId}::uuid
       returning snippet_last_seen_at
    `
    expect(rows[0].snippet_last_seen_at).toBeTruthy()
  })

  it('UPDATE on a non-granted web_properties column fails with permission denied', async () => {
    let code = ''
    try {
      await sql`
        update web_properties
           set name = 'hijack attempt'
         where id = ${propertyId}::uuid
      `
    } catch (e) {
      code = (e as { code?: string }).code ?? ''
    }
    expect(code).toBe('42501')
  })

  it('SELECT on api_keys fails with permission denied', async () => {
    let code = ''
    try {
      await sql`select id from api_keys limit 1`
    } catch (e) {
      code = (e as { code?: string }).code ?? ''
    }
    expect(code).toBe('42501')
  })

  it('SELECT on organisations fails with permission denied', async () => {
    let code = ''
    try {
      await sql`select id from organisations limit 1`
    } catch (e) {
      code = (e as { code?: string }).code ?? ''
    }
    expect(code).toBe('42501')
  })

  it('DELETE from consent_events fails with permission denied (append-only per Rule 2)', async () => {
    let code = ''
    try {
      await sql`delete from consent_events where session_fingerprint = 'never_matches'`
    } catch (e) {
      code = (e as { code?: string }).code ?? ''
    }
    expect(code).toBe('42501')
  })

})
