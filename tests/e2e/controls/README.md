# Sacrificial controls (ADR-1014 Sprint 5.4)

Files in this folder are **intentionally broken tests that MUST fail internally**. Each one is wrapped with Playwright's `test.fail()` inversion — when the false assertion correctly fails, Playwright reports the test as `passed` overall. If any control's assertion somehow holds, the test is reported as `failed` overall and the CI gate triggers SEV-1.

Eight controls ship in this folder, each targeting a DISTINCT assertion matcher:

| File | Matcher probed |
|---|---|
| `smoke-healthz-negative.spec.ts` | `toEqual` (string) |
| `arithmetic-negative.spec.ts` | `toBe` (integer) |
| `string-contains-negative.spec.ts` | `toContain` (substring) |
| `array-length-negative.spec.ts` | `toHaveLength` (cardinality) |
| `null-identity-negative.spec.ts` | `toBe` (null vs undefined) |
| `regex-match-negative.spec.ts` | `toMatch` (anchored regex) |
| `boolean-truth-negative.spec.ts` | `toBe` (boolean) |
| `deep-equal-negative.spec.ts` | `toEqual` (deep object) |

Rules:

- Every control is a plain `*.spec.ts` file tagged `@control @smoke`.
- Every control asserts a patently-false condition wrapped with `test.fail()`.
- Every control targets a DISTINCT matcher. Two controls probing the same matcher add no discriminatory value.
- Controls do NOT touch product code paths and do NOT require fixture setup.
- Do not "fix" a control by softening its assertion. The false assertion IS the control. If the assertion is no longer false, the test framework has regressed — bisect Playwright / TypeScript / Node before anything else.
- If a new matcher class becomes load-bearing for positive assertions (e.g. `toBeCloseTo` for floating-point tolerance), add a control in the same sprint.

**CI gate:** `bun run test:e2e:controls` (at repo root) = `bunx tsx scripts/e2e-verify-controls.ts`. Walks `test-results/results.json`, confirms each `@control`-tagged spec has `expectedStatus === 'failed'` AND run-time `status === 'failed'`. Exits 1 with the rogue control's file + mismatch on any anomaly. See `/docs/test-verification/controls` on the marketing site for the partner-facing runbook.
