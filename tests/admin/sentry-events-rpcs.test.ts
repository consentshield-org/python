import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminAnonClient,
  getAdminServiceClient,
} from './helpers'

// ADR-0049 Phase 2 Sprint 2.1 — admin.security_sentry_events_list.

const service = getAdminServiceClient()

let supportUser: AdminTestUser
const seededSentryIds: string[] = []

beforeAll(async () => {
  supportUser = await createAdminTestUser('support')
})

afterAll(async () => {
  if (supportUser) await cleanupAdminTestUser(supportUser)
  if (seededSentryIds.length > 0) {
    await service.from('sentry_events').delete().in('sentry_id', seededSentryIds)
  }
})

describe('ADR-0049 Phase 2.1 — admin.security_sentry_events_list', () => {
  it('support can call; returns an array', async () => {
    const { data, error } = await supportUser.client
      .schema('admin')
      .rpc('security_sentry_events_list', { p_window_hours: 24 })
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('returns a seeded row with the right shape', async () => {
    const sid = `test-sentry-${Date.now()}`
    seededSentryIds.push(sid)
    await service.from('sentry_events').insert({
      sentry_id: sid,
      project_slug: 'consentshield-app',
      level: 'error',
      title: 'Vitest synthetic error',
      culprit: 'tests/admin/sentry-events-rpcs.test.ts',
      event_url: 'https://example.sentry.io/issues/1',
      user_count: 1,
      payload: { synthetic: true },
    })

    const { data } = await supportUser.client
      .schema('admin')
      .rpc('security_sentry_events_list', { p_window_hours: 1 })
    const ours = (data as Array<{ sentry_id: string; level: string; title: string }>).find(
      (r) => r.sentry_id === sid,
    )
    expect(ours).toBeDefined()
    expect(ours!.level).toBe('error')
    expect(ours!.title).toBe('Vitest synthetic error')
  })

  it('upsert on sentry_id is idempotent (second insert with same id replaces, not duplicates)', async () => {
    const sid = `test-sentry-dup-${Date.now()}`
    seededSentryIds.push(sid)

    // First insert.
    await service.from('sentry_events').upsert(
      {
        sentry_id: sid,
        project_slug: 'consentshield-app',
        level: 'warning',
        title: 'first',
      },
      { onConflict: 'sentry_id' },
    )
    // Retry with same id, different title — the Sentry retry scenario.
    await service.from('sentry_events').upsert(
      {
        sentry_id: sid,
        project_slug: 'consentshield-app',
        level: 'warning',
        title: 'retry',
      },
      { onConflict: 'sentry_id' },
    )

    const { count } = await service
      .from('sentry_events')
      .select('*', { count: 'exact', head: true })
      .eq('sentry_id', sid)
    expect(count).toBe(1)

    const { data } = await service
      .from('sentry_events')
      .select('title')
      .eq('sentry_id', sid)
      .maybeSingle()
    expect(data?.title).toBe('retry')
  })

  it('rejects unknown level via CHECK constraint', async () => {
    const { error } = await service.from('sentry_events').insert({
      sentry_id: `test-sentry-bad-${Date.now()}`,
      project_slug: 'consentshield-app',
      level: 'catastrophic',
      title: 'should fail',
    })
    expect(error).not.toBeNull()
  })

  it('rejects p_window_hours outside [1, 168]', async () => {
    const { error } = await supportUser.client
      .schema('admin')
      .rpc('security_sentry_events_list', { p_window_hours: 200 })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/p_window_hours must be between/i)
  })

  it('non-admin authenticated user is denied', async () => {
    const anon = getAdminAnonClient()
    const { error } = await anon
      .schema('admin')
      .rpc('security_sentry_events_list', { p_window_hours: 1 })
    expect(error).not.toBeNull()
  })
})
