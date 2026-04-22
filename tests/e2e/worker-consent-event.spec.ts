import { test, expect } from './utils/fixtures'
import { signConsentEvent } from './utils/hmac'
import {
  countConsentEventsSince,
  latestConsentEvent
} from './utils/supabase-admin'

// See specs/worker-consent-event.md for the normative spec.
// Paired negative: worker-consent-event-tampered.spec.ts.

test.describe('@pipeline @worker Signed consent event reaches the buffer', () => {
  test('POST /v1/events with valid HMAC → 202 + row in consent_events', async ({
    ecommerce,
    tracedRequest
  }, testInfo) => {
    const workerUrl = process.env.WORKER_URL
    if (!workerUrl) {
      test.skip(true, 'WORKER_URL env not set. Run `cd worker && bun run dev` or set WORKER_URL to a deployed URL.')
      return
    }

    const property = ecommerce.properties[0]
    expect(property, 'ecommerce fixture missing properties — re-run e2e-bootstrap').toBeTruthy()

    const cutoffIso = new Date().toISOString()

    const envelope = signConsentEvent(
      {
        org_id: ecommerce.orgId,
        property_id: property.id,
        banner_id: property.bannerId,
        banner_version: 1,
        event_type: 'consent_given',
        purposes_accepted: ['essential', 'analytics'],
        purposes_rejected: ['marketing']
      },
      property.signingSecret
    )

    const response = await tracedRequest.post(`${workerUrl}/v1/events`, {
      headers: { 'Content-Type': 'application/json' },
      data: envelope,
      failOnStatusCode: false
    })

    const status = response.status()
    const bodyText = await response.text()

    await testInfo.attach('positive-response.json', {
      body: JSON.stringify(
        { status, headers: response.headers(), bodyPreview: bodyText.slice(0, 200) },
        null,
        2
      ),
      contentType: 'application/json'
    })

    // Proof 1: status 202.
    expect(status, `Worker returned ${status}: ${bodyText}`).toBe(202)

    // Proof 2 + 3: observable DB state. Poll up to 5s for the row to appear.
    let observed: Awaited<ReturnType<typeof latestConsentEvent>> = null
    for (let i = 0; i < 10; i++) {
      observed = await latestConsentEvent(property.id, cutoffIso)
      if (observed) break
      await new Promise((r) => setTimeout(r, 500))
    }

    expect(observed, 'No consent_events row observed within 5s').not.toBeNull()
    expect(observed!.org_id).toBe(ecommerce.orgId)
    expect(observed!.property_id).toBe(property.id)
    expect(observed!.banner_id).toBe(property.bannerId)
    expect(observed!.event_type).toBe('consent_given')
    expect(observed!.origin_verified).toBe('hmac-verified')

    await testInfo.attach('observed-row.json', {
      body: JSON.stringify(observed, null, 2),
      contentType: 'application/json'
    })

    const count = await countConsentEventsSince(property.id, cutoffIso)
    expect(count, 'expected exactly 1 row since cutoff').toBe(1)
  })
})
