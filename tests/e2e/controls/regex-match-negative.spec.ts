import { test, expect } from '../utils/fixtures'

// SACRIFICIAL CONTROL — expected to fail internally.
//
// Paired with: no product code — assertion-layer control.
// Assertion: a string matches a regex anchored on a different character class.
// Invariant probed: `expect(s).toMatch(re)` correctly discriminates regex
// semantics including anchors. Several positives rely on anchored-regex
// matchers for trace IDs (ULID-shape) and key prefixes (`cs_live_` /
// `cs_test_`); any silent permissiveness would hide malformed IDs.

test.describe('@control @smoke Sacrificial — toMatch inversion', () => {
  test('asserts "abc" matches /^xyz$/ — MUST FAIL INTERNALLY', async () => {
    test.fail()
    expect('abc').toMatch(/^xyz$/)
  })
})
