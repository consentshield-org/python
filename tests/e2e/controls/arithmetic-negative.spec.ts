import { test, expect } from '../utils/fixtures'

// SACRIFICIAL CONTROL — expected to fail internally; Playwright reports PASSED
// via `test.fail()` inversion. If this ever reports FAILED, the harness's
// numeric-equality semantics have regressed and every timing / count assertion
// in the suite becomes suspect.
//
// Paired with: no product code — this is an assertion-layer control.
// Assertion: integer addition produces a wrong sum.
// Invariant probed: `expect(n).toBe(m)` discriminates distinct integers.

test.describe('@control @smoke Sacrificial — toBe integer-equality inversion', () => {
  test('asserts 1 + 1 === 3 — MUST FAIL INTERNALLY', async () => {
    test.fail()
    expect(1 + 1).toBe(3)
  })
})
