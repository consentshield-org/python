import { test, expect } from '../utils/fixtures'

// SACRIFICIAL CONTROL — expected to fail internally.
//
// Paired with: no product code — assertion-layer control.
// Assertion: substring-containment check reports a non-contained substring.
// Invariant probed: `expect(s).toContain(sub)` discriminates presence vs
// absence. Several positives depend on this matcher to confirm observable
// state (response-body substrings, audit-log event_type presence, HTML text
// in rendered pages).

test.describe('@control @smoke Sacrificial — toContain inversion', () => {
  test('asserts "hello" contains "xyz" — MUST FAIL INTERNALLY', async () => {
    test.fail()
    expect('hello').toContain('xyz')
  })
})
