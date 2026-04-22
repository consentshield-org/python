import { test, expect } from './utils/fixtures'

// See specs/smoke-healthz.md for the normative spec.
//
// Tag: @smoke — runs on every invocation including PR subset.

test.describe('@smoke All three surfaces serve /healthz (or /)', () => {
  for (const surface of ['APP_URL', 'ADMIN_URL', 'MARKETING_URL'] as const) {
    test(`${surface}: responds < 500 with non-empty body`, async ({ env, tracedRequest, traceId }, testInfo) => {
      const base = env[surface]
      // Try /healthz first; fall back to / if the app doesn't expose it yet.
      const healthz = await tracedRequest.get(`${base}/healthz`, {
        ignoreHTTPSErrors: false,
        failOnStatusCode: false
      })

      let response = healthz
      if (healthz.status() === 404) {
        response = await tracedRequest.get(base, {
          ignoreHTTPSErrors: false,
          failOnStatusCode: false
        })
      }

      const status = response.status()
      const bodyText = await response.text()

      // Proof 1-3: status is not a 5xx.
      expect(status, `${surface} returned ${status}`).toBeLessThan(500)
      // Proof 4: body is non-empty.
      expect(bodyText.length, `${surface} body empty`).toBeGreaterThan(0)

      // Proof 5: the trace id attachment exists AFTER the test body ran.
      await testInfo.attach(`${surface}-response.json`, {
        body: JSON.stringify(
          {
            surface,
            url: response.url(),
            status,
            headers: response.headers(),
            bodyPreview: bodyText.slice(0, 200)
          },
          null,
          2
        ),
        contentType: 'application/json'
      })

      // The trace id was attached by the fixture; verify it is non-empty.
      expect(traceId).toMatch(/^e2e-\w+_[0-9A-HJKMNP-TV-Z]+$/)
    })
  }
})
