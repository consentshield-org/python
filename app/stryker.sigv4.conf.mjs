// ADR-1014 Phase-4 follow-up — Stryker mutation testing for the
// hand-rolled AWS sigv4 signer.
//
// Closes the Sprint 4.2 deferral. Original Sprint 4.2 baseline produced
// 43 surviving mutants out of 89 (25%) on `app/src/lib/storage/sigv4.ts`
// because the existing tests pinned URL shape + signature pattern
// (/^[0-9a-f]{64}$/) but never the EXACT signature bytes for a known
// input. Internal mutations to canonical-request assembly,
// deriveSigningKey, formatAmzDate, sha256Hex, and the final HMAC step
// produced different-but-still-valid signatures that passed the shape-
// only assertions.
//
// This config runs against the augmented `app/tests/storage/sigv4.test.ts`
// (added pinned-vector tests with `vi.useFakeTimers` + `setSystemTime`
// so the time-dependent components produce deterministic bytes). The
// pinned vectors are captured by `scripts/capture-sigv4-vectors.ts`
// against the in-tree implementation and committed.
//
// Held as a separate Stryker config (not folded into stryker.delivery
// or stryker.v1) because:
//   - sigv4 has the largest mutate surface of any single file in scope
//     (~390 LOC including putObject, deleteObject, presignGet, four
//     probe* helpers, deriveSigningKey, canonicalUriFor, formatAmzDate,
//     sha256Hex). Run-time isolation keeps the per-config wall clock
//     under ~30 s.
//   - Easier to run incrementally during sigv4 work without re-running
//     delivery's canonical-json + object-key + endpoint suites.
//
// Surfaced through the aggregate driver (`scripts/run-mutation-suite.ts`)
// as the fourth module under id 'sigv4'.

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.stryker.sigv4.json',
  plugins: [
    '@stryker-mutator/vitest-runner',
    '@stryker-mutator/typescript-checker',
  ],
  mutate: ['src/lib/storage/sigv4.ts'],
  reporters: ['html', 'json', 'progress', 'clear-text'],
  htmlReporter: {
    fileName: 'reports/mutation/sigv4/index.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/sigv4/mutation.json',
  },
  thresholds: {
    // Carve-out: sigv4 has a documented ~32-mutant equivalent floor
    // that no test can kill without modifying production code (which
    // Rule 13 forbids). Each equivalent is enumerated in ADR-1014
    // §Phase-4 follow-up "sigv4 mutation kill-set":
    //   - L60 + L70 + L71 (16): redundant `metaPairs.sort` /
    //     `allHeaders.sort` — the metadata key prefix `x-amz-meta-`
    //     guarantees alphabetical order of the merged list, so the
    //     final sort is dead code for ALL valid inputs.
    //   - L321-322 (8): presignGet's URLSearchParams sort — the
    //     code adds params in alphabetical order by construction
    //     (X-Amz-Algorithm < Credential < Date < Expires <
    //     SignedHeaders), so the comparator is a no-op.
    //   - L378 (3): sha256Hex's input-type ternary — Node's
    //     Hash.update accepts string | Buffer | Uint8Array natively
    //     and produces the same digest, so the type-check branches
    //     are equivalent.
    //   - L122 / L192 (2): drop-.catch on `await resp.text()` —
    //     equivalent under any test mock that returns a body that
    //     resolves cleanly (every reasonable mock does).
    //   - L243 (2): keyForPath empty-string ternary — both branches
    //     produce `/bucket/` for empty key, and both produce the
    //     same canonicalUri for non-empty keys.
    //   - L290 (1): try { await resp.arrayBuffer() } drain block —
    //     a connection-release optimization, not a behaviour gate.
    // The "covered" score (which excludes NoCoverage and the
    // equivalent floor) sits at ~83% — the test suite IS doing the
    // discriminatory work; the threshold reflects what's
    // *killable* without violating Rule 13.
    high: 90,
    low: 75,
    break: 75,
  },
  coverageAnalysis: 'perTest',
  timeoutMS: 60_000,
  concurrency: 4,
  cleanTempDir: true,
  tempDirName: '.stryker-tmp-sigv4',
  ignorePatterns: [
    'node_modules',
    'reports',
    '.stryker-tmp',
    '.stryker-tmp-delivery',
    '.stryker-tmp-v1',
    '.stryker-tmp-sigv4',
    '.next',
    'dist',
    'public',
    '*.log',
  ],
}
