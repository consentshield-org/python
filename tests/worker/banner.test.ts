import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorker, defaultState, MockState } from './harness'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222'
const BANNER_ID = '33333333-3333-4333-8333-333333333333'

let state: MockState
let mf: Awaited<ReturnType<typeof createWorker>>

async function getBanner(search = `?org=${ORG_ID}&prop=${PROPERTY_ID}`) {
  return mf.fetch(`https://cdn.local/v1/banner.js${search}`, { method: 'GET' })
}

beforeEach(async () => {
  state = defaultState()
  state.properties[PROPERTY_ID] = {
    allowed_origins: ['https://customer.example'],
    event_signing_secret: 'a'.repeat(64),
  }
  state.banners[PROPERTY_ID] = {
    id: BANNER_ID,
    property_id: PROPERTY_ID,
    version: 3,
    headline: 'Cookie consent for ACME',
    body_copy: 'We use cookies. Choose your preferences below.',
    position: 'bottom-bar',
    purposes: [
      { id: 'essential', name: 'Essential', description: 'Required', required: true, default: true },
      { id: 'analytics', name: 'Analytics', description: 'Optional', required: false, default: false },
    ],
    monitoring_enabled: true,
    is_active: true,
  }
  mf = await createWorker({ state })
})

afterEach(async () => {
  if (mf) await mf.dispose()
})

describe('GET /v1/banner.js', () => {
  it('returns the compiled banner script with correct Content-Type and Cache-Control', async () => {
    const res = await getBanner()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/javascript/)
    expect(res.headers.get('Cache-Control')).toContain('max-age=60')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('never ships the event_signing_secret in the compiled output (ADR-0008 invariant)', async () => {
    const res = await getBanner()
    const text = await res.text()
    expect(text).not.toContain('a'.repeat(64))
    expect(text).not.toContain('signing_secret')
    expect(text).not.toMatch(/"secret"\s*:/i)
  })

  it('embeds the expected org / property / banner / version in the config blob', async () => {
    const res = await getBanner()
    const text = await res.text()
    expect(text).toContain(ORG_ID)
    expect(text).toContain(PROPERTY_ID)
    expect(text).toContain(BANNER_ID)
    expect(text).toContain('"version":3')
    expect(text).toContain('Cookie consent for ACME')
  })

  it('returns 404 for an unknown property and 400 when params are missing', async () => {
    const notFound = await getBanner(`?org=${ORG_ID}&prop=99999999-9999-4999-8999-999999999999`)
    expect(notFound.status).toBe(404)

    const missing = await getBanner('')
    expect(missing.status).toBe(400)
  })
})
