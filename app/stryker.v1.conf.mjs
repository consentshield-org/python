// ADR-1014 Phase 4 Sprint 4.3 — Stryker mutation testing for the v1 API
// pure surfaces.
//
// Mutate scope (pure helpers — every function reaches a deterministic
// verdict from a Node-runner subprocess):
//   - src/lib/api/auth.ts        (verifyBearerToken pre-SQL branches +
//                                  problemJson)
//   - src/lib/api/v1-helpers.ts  (gateScopeOrProblem + requireOrgOrProblem)
//   - src/lib/api/rate-limits.ts (TIER_LIMITS table + limitsForTier
//                                  fallback chain)
//
// Out of scope for Sprint 4.3:
//
//   - The SECURITY DEFINER RPCs themselves (assert_api_key_binding,
//     idempotency-key handling, per-row fencing). These live in
//     PL/pgSQL inside Postgres, not in TypeScript — Stryker can't
//     mutate them directly. The Phase 3 E2E suites + RLS tests
//     exercise the full RPC contract; the Sprint 4.4 CI gate will
//     surface cumulative kill-set across all of Phase 4.
//
//   - app/src/lib/api/{cs-api-client,cs-orchestrator-client,cs-delivery-
//     client,context,log-request,audit,plans,rights,score,security,
//     introspection,discovery}.ts — these are I/O wrappers (postgres.js
//     pools, Sentry, logging) or thin route handlers. Mutation testing
//     them at the unit layer mostly produces fixture-shape mutants;
//     they belong to integration-test territory.
//
//   - readContext + respondV1 in v1-helpers.ts — both reach into
//     next/headers + NextResponse and need a Next.js request context to
//     behave. Tested via the Phase 3 E2E suites against the live route
//     handlers, not in this baseline.
//
//   - The v1 route handlers themselves (app/src/app/api/v1/**/route.ts)
//     — same Next.js-runtime constraint plus heavy postgres dependence.

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.stryker.v1.json',
  plugins: [
    '@stryker-mutator/vitest-runner',
    '@stryker-mutator/typescript-checker',
  ],
  mutate: [
    // verifyBearerToken pre-SQL branches (header presence + Bearer regex)
    // + problemJson RFC 7807 builder. Lines 34-45 cover the synchronous
    // header/regex branches; 96-109 cover problemJson. The SQL-bound
    // tail of verifyBearerToken (47-77) and the private getKeyStatus
    // helper (82-93) need a postgres mock to be testable at the unit
    // layer — deferred to integration / E2E coverage.
    'src/lib/api/auth.ts:34-45',
    'src/lib/api/auth.ts:96-109',
    // gateScopeOrProblem (41-52) + requireOrgOrProblem (54-65). The
    // upper half of the file (readContext + respondV1) reaches into
    // next/headers + NextResponse and needs a Next.js request context;
    // those branches are exercised by Phase 3 E2E suites against the
    // live route handlers.
    'src/lib/api/v1-helpers.ts:41-65',
    'src/lib/api/rate-limits.ts',
  ],
  reporters: ['html', 'json', 'progress', 'clear-text'],
  htmlReporter: {
    fileName: 'reports/mutation/v1/index.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/v1/mutation.json',
  },
  thresholds: {
    high: 90,
    low: 80,
    break: 80,
  },
  coverageAnalysis: 'perTest',
  timeoutMS: 60_000,
  concurrency: 4,
  cleanTempDir: true,
  tempDirName: '.stryker-tmp-v1',
  ignorePatterns: [
    'node_modules',
    'reports',
    '.stryker-tmp',
    '.stryker-tmp-delivery',
    '.stryker-tmp-v1',
    '.next',
    'dist',
    'public',
    '*.log',
  ],
}
