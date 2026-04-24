import { test, expect } from '../utils/fixtures'

// SACRIFICIAL CONTROL — expected to fail internally.
//
// Paired with: no product code — assertion-layer control.
// Assertion: an empty array has non-zero length.
// Invariant probed: `expect(arr).toHaveLength(n)` discriminates array sizes.
// Several positives depend on this matcher to confirm row counts (buffer
// rows, audit events, rights-request events) land at the expected cardinality.

test.describe('@control @smoke Sacrificial — toHaveLength inversion', () => {
  test('asserts [] has length 5 — MUST FAIL INTERNALLY', async () => {
    test.fail()
    expect([]).toHaveLength(5)
  })
})
