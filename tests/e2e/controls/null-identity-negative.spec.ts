import { test, expect } from '../utils/fixtures'

// SACRIFICIAL CONTROL — expected to fail internally.
//
// Paired with: no product code — assertion-layer control.
// Assertion: null is identical to undefined.
// Invariant probed: `expect(v).toBe(x)` distinguishes null from undefined.
// ConsentShield uses nullable Postgres columns for optional state
// (`revoked_at`, `delivered_at`, `confirmed_at`); every negative assertion
// that a row stayed un-mutated relies on this distinction.

test.describe('@control @smoke Sacrificial — null-vs-undefined inversion', () => {
  test('asserts null === undefined — MUST FAIL INTERNALLY', async () => {
    test.fail()
    expect(null).toBe(undefined)
  })
})
