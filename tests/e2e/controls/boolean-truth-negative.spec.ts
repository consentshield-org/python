import { test, expect } from '../utils/fixtures'

// SACRIFICIAL CONTROL — expected to fail internally.
//
// Paired with: no product code — assertion-layer control.
// Assertion: false is strictly equal to true.
// Invariant probed: boolean-truth discrimination. Load-bearing for every
// `email_verified=true` / `is_active=false` / `revoked_at IS NULL` assertion
// the suite makes against consent_events, rights_request rows, api_keys, and
// deletion_receipts. Silent boolean collapse would be catastrophic.

test.describe('@control @smoke Sacrificial — boolean inversion', () => {
  test('asserts false === true — MUST FAIL INTERNALLY', async () => {
    test.fail()
    expect(false).toBe(true)
  })
})
