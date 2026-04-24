import { test, expect } from '../utils/fixtures'

// SACRIFICIAL CONTROL — expected to fail internally.
//
// Paired with: no product code — assertion-layer control.
// Assertion: two distinct single-key objects report deep-equal.
// Invariant probed: `expect(o).toEqual(x)` correctly descends into nested
// keys. Several positives rely on deep-equal for JSON response-body assertions
// (RFC 7807 problem+json shape, webhook-callback response_payload, fixture
// banner purposes arrays, audit_log metadata JSONB blobs).

test.describe('@control @smoke Sacrificial — toEqual object-deep-equal inversion', () => {
  test('asserts { a: 1 } deep-equals { a: 2 } — MUST FAIL INTERNALLY', async () => {
    test.fail()
    expect({ a: 1 }).toEqual({ a: 2 })
  })
})
