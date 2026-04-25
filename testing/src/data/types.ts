// ADR-1014 Sprint 5.3 — Published-run schema.
//
// Every entry in src/data/runs.ts is a PublishedRun. CI appends a new
// entry after each run that should appear on testing.consentshield.in.
// The file is the machine-readable truth; the page renders from it.
//
// Adding an entry is a commit to this repo — reviewers can see exactly
// which runs have been published and when, and the PR diff is the
// publication record.

export type Vertical = 'ecommerce' | 'healthcare' | 'bfsi'
export type ReporterBrowser = 'chromium' | 'webkit' | 'firefox'
export type RunStatus = 'green' | 'partial' | 'red'

export interface RunTally {
  total: number
  /** Tests that Playwright reported `status === expectedStatus` (positives that passed + controls that failed internally). */
  expected: number
  /** Tests that Playwright reported `status !== expectedStatus` — the thing CI fails on. */
  unexpected: number
  skipped: number
  flaky: number
}

/**
 * ADR-1014 Phase 4 Sprint 4.4 — per-module Stryker score.
 *
 * One entry per Stryker configuration that ran. The `score` field is the
 * "% Mutation score (covered)" reported by Stryker — i.e. NoCoverage
 * mutants are excluded from the denominator on purpose; the mutate scope
 * is line-ranged in each conf.mjs to match what the unit suite can reach.
 *
 * `survived` and `equivalent` SHOULD sum to (total - killed - timeout):
 *   - survived: actual gaps in the test suite (red flag).
 *   - equivalent: mutants whose behaviour change can't be observed from
 *     outside the function (documented in the ADR Test Results section).
 * If a module published with survived > 0 + equivalent === 0, that's a
 * regression worth investigating — the gate did not catch it but the
 * audit-trail discipline did.
 */
export interface ModuleMutationScore {
  /** Stable id the aggregate driver writes; matches scripts/run-mutation-suite.ts. */
  id: 'worker' | 'delivery' | 'v1' | 'sigv4'
  /** Human-readable label rendered in the run-detail page. */
  label: string
  /** Mutation score 0-100 as a number (one decimal place). */
  score: number
  killed: number
  survived: number
  /** Survived mutants the ADR has classified as equivalent (no observable behaviour change). */
  equivalent: number
  noCoverage: number
  timeout: number
  /** Sprint id that produced this baseline (e.g. '4.1', '4.2', '4.3'). */
  sprint: string
}

export interface PublishedRun {
  /** ULID-shaped, matches the test-harness `E2E_RUN_ID` env var. */
  runId: string
  /** ISO 8601 UTC timestamp the run started. */
  date: string
  /** 12-char short SHA — enough to disambiguate, short enough to read. */
  commitSha: string
  /** Branch the run was against (usually `main`). */
  branch: string
  /**
   * Aggregate Stryker mutation score as a 0-100 number (rounded to two
   * decimal places). Mean across `mutation` modules when present;
   * otherwise null. Kept in addition to the per-module breakdown so the
   * list view stays compact.
   */
  mutationScore: number | null
  /**
   * Per-module Stryker breakdown. null until Sprint 4.4's CI gate
   * publishes the first integrated run; populated after that for any
   * run that ran the aggregate suite. Phase 5 reproduction runs may
   * leave this null (mutation testing isn't part of the partner kit).
   */
  mutation: ModuleMutationScore[] | null
  tally: RunTally
  /** Overall status — derived from tally (green = 0 unexpected; partial = unexpected > 0 AND within known-partial list; red = otherwise). */
  status: RunStatus
  /** Browsers actually exercised in this run. */
  browsers: ReporterBrowser[]
  /** Which verticals' demo sites were exercised (subset of the three). */
  verticals: Vertical[]
  /** ADR sprint IDs this run exercised (e.g. ['1.5', '2.1', '3.3']). Used by sprint filter view. */
  sprints: string[]
  /** ADR phase numbers (1..5) this run exercised. Derived from `sprints` but stored explicitly for stable filter UX. */
  phases: number[]
  /**
   * Public URL of the sealed evidence archive (zip or directory index).
   * null until the partner-evidence archive is uploaded — entry remains visible
   * in the list but "download" is disabled.
   */
  archiveUrl: string | null
  /** SHA-256 root hash of the sealed archive, as emitted by the evidence reporter. */
  archiveSealRoot: string | null
  /**
   * Partner-side runs (reproduced on the auditor's own Supabase) are tagged
   * separately so filter UX can distinguish "our CI reference" from "auditor
   * replay". Both are load-bearing evidence at different points of the trust
   * chain.
   */
  partnerReproduction: boolean
  /**
   * Free-form note — reviewers can explain what a partial / red run was
   * blocked on, what was deferred, etc. Markdown-free; plain text only.
   */
  notes: string | null
}

export function tallyStatus(tally: RunTally): RunStatus {
  if (tally.unexpected === 0 && tally.expected > 0) return 'green'
  if (tally.unexpected > 0 && tally.expected > 0) return 'partial'
  return 'red'
}

export function phasesForSprints(sprints: string[]): number[] {
  const seen = new Set<number>()
  for (const s of sprints) {
    const major = parseInt(s.split('.')[0] ?? '', 10)
    if (Number.isFinite(major)) seen.add(major)
  }
  return [...seen].sort((a, b) => a - b)
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`
}
