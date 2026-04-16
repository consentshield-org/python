import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorker, defaultState, signHmac, MockState } from './harness'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222'
const BANNER_ID = '33333333-3333-4333-8333-333333333333'
const SECRET = 'a'.repeat(64)

let state: MockState
let mf: Awaited<ReturnType<typeof createWorker>>

async function postEvent(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return mf.fetch('https://cdn.local/v1/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(async () => {
  state = defaultState()
  state.properties[PROPERTY_ID] = {
    allowed_origins: ['https://customer.example'],
    event_signing_secret: SECRET,
  }
  mf = await createWorker({ state })
})

afterEach(async () => {
  if (mf) await mf.dispose()
})

describe('POST /v1/events — HMAC path', () => {
  it('accepts a valid HMAC signature + timestamp', async () => {
    const ts = Date.now().toString()
    const sig = await signHmac(`${ORG_ID}${PROPERTY_ID}${ts}`, SECRET)
    const res = await postEvent({
      org_id: ORG_ID,
      property_id: PROPERTY_ID,
      banner_id: BANNER_ID,
      banner_version: 1,
      event_type: 'consent_given',
      signature: sig,
      timestamp: ts,
    })
    expect(res.status).toBe(202)
    const insert = state.writes.find((w) => w.url.includes('/consent_events'))
    expect(insert).toBeTruthy()
    expect((insert?.body as { origin_verified: string }).origin_verified).toBe('hmac-verified')
  })

  it('rejects a signature computed with the wrong secret', async () => {
    const ts = Date.now().toString()
    const sig = await signHmac(`${ORG_ID}${PROPERTY_ID}${ts}`, 'WRONG_SECRET'.repeat(5))
    const res = await postEvent({
      org_id: ORG_ID,
      property_id: PROPERTY_ID,
      banner_id: BANNER_ID,
      banner_version: 1,
      event_type: 'consent_given',
      signature: sig,
      timestamp: ts,
    })
    expect(res.status).toBe(403)
    expect(state.writes.some((w) => w.url.includes('/consent_events'))).toBe(false)
  })

  it('rejects a timestamp outside the ±5 minute window', async () => {
    const ts = (Date.now() - 10 * 60 * 1000).toString()
    const sig = await signHmac(`${ORG_ID}${PROPERTY_ID}${ts}`, SECRET)
    const res = await postEvent({
      org_id: ORG_ID,
      property_id: PROPERTY_ID,
      banner_id: BANNER_ID,
      banner_version: 1,
      event_type: 'consent_given',
      signature: sig,
      timestamp: ts,
    })
    expect(res.status).toBe(403)
  })

  it('accepts a signature made with the previous secret during rotation grace', async () => {
    const oldSecret = 'b'.repeat(64)
    await mf.kvPut(`signing_secret_prev:${PROPERTY_ID}`, oldSecret)
    const ts = Date.now().toString()
    const sig = await signHmac(`${ORG_ID}${PROPERTY_ID}${ts}`, oldSecret)
    const res = await postEvent({
      org_id: ORG_ID,
      property_id: PROPERTY_ID,
      banner_id: BANNER_ID,
      banner_version: 1,
      event_type: 'consent_given',
      signature: sig,
      timestamp: ts,
    })
    expect(res.status).toBe(202)
    const insert = state.writes.find((w) => w.url.includes('/consent_events'))
    expect((insert?.body as { origin_verified: string }).origin_verified).toBe('hmac-verified')
  })
})

describe('POST /v1/events — origin path', () => {
  it('accepts a browser POST from an allowed origin and records origin_verified=origin-only', async () => {
    const res = await postEvent(
      {
        org_id: ORG_ID,
        property_id: PROPERTY_ID,
        banner_id: BANNER_ID,
        banner_version: 1,
        event_type: 'consent_given',
      },
      { Origin: 'https://customer.example' },
    )
    expect(res.status).toBe(202)
    const insert = state.writes.find((w) => w.url.includes('/consent_events'))
    expect((insert?.body as { origin_verified: string }).origin_verified).toBe('origin-only')
  })

  it('rejects a browser POST from a different origin', async () => {
    const res = await postEvent(
      {
        org_id: ORG_ID,
        property_id: PROPERTY_ID,
        banner_id: BANNER_ID,
        banner_version: 1,
        event_type: 'consent_given',
      },
      { Origin: 'https://attacker.example' },
    )
    expect(res.status).toBe(403)
    expect(state.writes.some((w) => w.url.includes('/consent_events'))).toBe(false)
  })

  it('rejects a browser POST when allowed_origins is empty', async () => {
    state.properties[PROPERTY_ID].allowed_origins = []
    const res = await postEvent(
      {
        org_id: ORG_ID,
        property_id: PROPERTY_ID,
        banner_id: BANNER_ID,
        banner_version: 1,
        event_type: 'consent_given',
      },
      { Origin: 'https://customer.example' },
    )
    expect(res.status).toBe(403)
  })

  it('rejects an unsigned POST with no Origin header at all', async () => {
    const res = await postEvent({
      org_id: ORG_ID,
      property_id: PROPERTY_ID,
      banner_id: BANNER_ID,
      banner_version: 1,
      event_type: 'consent_given',
    })
    expect(res.status).toBe(403)
  })
})

describe('POST /v1/events — property resolution', () => {
  it('returns 404 for an unknown property_id', async () => {
    const res = await postEvent(
      {
        org_id: ORG_ID,
        property_id: '99999999-9999-4999-8999-999999999999',
        banner_id: BANNER_ID,
        banner_version: 1,
        event_type: 'consent_given',
      },
      { Origin: 'https://customer.example' },
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await postEvent({ org_id: ORG_ID })
    expect(res.status).toBe(400)
  })
})
