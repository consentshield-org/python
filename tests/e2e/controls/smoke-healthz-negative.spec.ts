import { test, expect } from '../utils/fixtures'

// SACRIFICIAL CONTROL — MUST fail on every run.
//
// Paired with: ../smoke-healthz.spec.ts
// Purpose: assert a patently-false condition so that the Sprint-5.4 inversion
// gate can prove the runner is honest. See controls/README.md.
//
// Expected outcome on every run: this test is reported FAILED.
// If this test ever passes, the suite's pos/neg discipline is broken and
// the CI gate must red-flag the run.

test.describe('@control @smoke Sacrificial control — MUST FAIL', () => {
  test('asserts "ok" equals "not-ok"', async () => {
    expect('ok').toEqual('not-ok')
  })
})
