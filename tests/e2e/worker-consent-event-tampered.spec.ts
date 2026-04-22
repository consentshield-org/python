import { test, expect } from './utils/fixtures'
import { signConsentEvent, tamperSignature } from './utils/hmac'
import { countConsentEventsSince } from './utils/supabase-admin'

// Paired negative for worker-consent-event.spec.ts. See specs/worker-consent-event.md
// sections 5 + 6. Deterministically flips one hex character of the HMAC; the
// Worker's timing-safe compare must reject, and no row must be written.

test.describe('@pipeline @worker Tampered signature — paired negative', () => {
  test('POST /v1/events with flipped HMAC byte → 403 + zero rows written', async ({
    ecommerce,
    tracedRequest
  }, testInfo) => {
    const workerUrl = process.env.WORKER_URL
    if (!workerUrl) {
      test.skip(true, 'WORKER_URL env not set.')
      return
    }

    // Use a DIFFERENT fixture property from the positive test. Playwright
    // may run pos + neg in parallel; sharing property[0] would let the
    // positive's legitimate row leak into the negative's count-since-cutoff
    // query under any clock skew between Node and Postgres.
    const property = ecommerce.properties[1]
    const cutoffIso = new Date().toISOString()

    const good = signConsentEvent(
      {
        org_id: ecommerce.orgId,
        property_id: property.id,
        banner_id: property.bannerId,
        banner_version: 1,
        event_type: 'consent_given',
        purposes_accepted: ['essential']
      },
      property.signingSecret
    )
    const tampered = tamperSignature(good)

    // Sanity: our own mutation must differ from the original signature.
    // If it didn't, the test would be a false positive (same payload sent).
    expect(tampered.signature).not.toBe(good.signature)

    const response = await tracedRequest.post(`${workerUrl}/v1/events`, {
      headers: { 'Content-Type': 'application/json' },
      data: tampered,
      failOnStatusCode: false
    })

    const status = response.status()
    const bodyText = await response.text()

    await testInfo.attach('negative-response.json', {
      body: JSON.stringify(
        { status, headers: response.headers(), bodyPreview: bodyText.slice(0, 200) },
        null,
        2
      ),
      contentType: 'application/json'
    })

    expect(status, `expected 403, got ${status}: ${bodyText}`).toBe(403)
    expect(bodyText).toContain('Invalid signature')

    // Observable-state proof: no row written for this property since cutoff.
    // Give the Worker 1s to not-write anything (paradoxical but: buffer writes
    // in the positive complete within 500ms, so 1s is plenty to catch a regression
    // where the Worker writes BEFORE validating).
    await new Promise((r) => setTimeout(r, 1_000))

    const count = await countConsentEventsSince(property.id, cutoffIso)
    expect(count, 'tampered event must not produce a buffer row').toBe(0)
  })
})
