import { test, expect } from '../utils/fixtures'

// SACRIFICIAL CONTROL — expected to fail internally; Playwright reports PASSED
// via `test.fail()` inversion. If this ever reports FAILED, the harness's
// assertion-equality semantics have regressed and the CI gate
// (scripts/e2e-verify-controls.ts) MUST page the maintainer.
//
// Paired with: ../smoke-healthz.spec.ts (positive — live /healthz probe)
// Assertion: two distinct string literals are reported equal.
// Invariant probed: Playwright's `expect().toEqual()` discriminates string
// values. If the assertion layer starts collapsing distinct strings, every
// evidence-graded positive in the suite becomes suspect.

test.describe('@control @smoke Sacrificial — toEqual string-equality inversion', () => {
  test('asserts "ok" equals "not-ok" — MUST FAIL INTERNALLY', async () => {
    test.fail()
    expect('ok').toEqual('not-ok')
  })
})
