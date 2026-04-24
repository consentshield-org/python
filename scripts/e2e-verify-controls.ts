/**
 * ADR-1014 Sprint 5.4 — Sacrificial-control CI gate.
 *
 * Spawns Playwright against `tests/e2e/controls/`, parses the JSON report,
 * and confirms every test tagged `@control` was internally-failed (per
 * `test.fail()` inversion — the control asserts a patently-false proposition;
 * Playwright reports status="failed" + expectedStatus="failed" + ok=true).
 *
 * Exit codes:
 *   0 — every discovered control behaved as a sacrificial control must.
 *   1 — at least one control reported unexpected status (its internal
 *       assertion actually held, i.e., the harness's discipline is broken
 *       somewhere — treat as SEV-1 and page the maintainer).
 *   2 — IO / usage / schema error (Playwright config missing, results.json
 *       malformed, controls directory empty when a count is expected).
 *
 * Usage:
 *   bunx tsx scripts/e2e-verify-controls.ts
 *   bunx tsx scripts/e2e-verify-controls.ts --min-controls=8
 *   bunx tsx scripts/e2e-verify-controls.ts --help
 *
 * Designed to run either as a standalone CI step or as the last step of
 * `bun run test:e2e:full`. The script is self-contained and has no non-core
 * deps (Node + tsx only).
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const E2E_DIR = resolve(REPO_ROOT, 'tests/e2e')
const RESULTS_PATH = resolve(E2E_DIR, 'test-results/results.json')

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  printHelp()
  process.exit(0)
}

const MIN_CONTROLS = parseMinControls(argv)

interface PlaywrightSuite {
  title?: string
  file?: string
  suites?: PlaywrightSuite[]
  specs?: PlaywrightSpec[]
}
interface PlaywrightSpec {
  title: string
  file?: string
  ok?: boolean
  tags?: string[]
  tests?: PlaywrightTest[]
}
interface PlaywrightTest {
  expectedStatus?: string
  results?: Array<{ status?: string }>
}
interface PlaywrightReport {
  stats?: { expected?: number; unexpected?: number; skipped?: number; flaky?: number }
  suites?: PlaywrightSuite[]
}

function parseMinControls(args: string[]): number {
  const flag = args.find((a) => a.startsWith('--min-controls='))
  if (!flag) return 8 // default: match the 8 controls shipped in ADR-1014 Sprint 5.4
  const n = parseInt(flag.slice('--min-controls='.length), 10)
  if (!Number.isFinite(n) || n < 1) {
    console.error(`Bad --min-controls value: ${flag}`)
    process.exit(2)
  }
  return n
}

function runControls(): { exitCode: number } {
  console.log(`▸ Running sacrificial controls under ${E2E_DIR}/controls/ …`)
  // No `--reporter=json` override: the playwright.config.ts's json reporter
  // already writes to test-results/results.json, and overriding the reporter
  // at the CLI suppresses the file writer.
  const result = spawnSync('bunx', ['playwright', 'test', 'controls/', '--project=chromium'], {
    cwd: E2E_DIR,
    stdio: 'inherit'
  })
  return { exitCode: result.status ?? 2 }
}

function parseReport(jsonPath: string): PlaywrightReport {
  let raw: string
  try {
    raw = readFileSync(jsonPath, 'utf8')
  } catch (err) {
    console.error(`Cannot read ${jsonPath}: ${(err as Error).message}`)
    process.exit(2)
  }
  try {
    return JSON.parse(raw) as PlaywrightReport
  } catch (err) {
    console.error(`Malformed JSON at ${jsonPath}: ${(err as Error).message}`)
    process.exit(2)
  }
}

interface ControlResult {
  title: string
  file: string
  expectedStatus: string
  actualStatus: string
  ok: boolean
  tags: string[]
}

function walkSpecs(node: PlaywrightSuite, file: string | undefined, acc: ControlResult[]): void {
  const fileHere = node.file ?? file
  for (const spec of node.specs ?? []) {
    const tags = spec.tags ?? []
    if (!tags.includes('control')) continue
    for (const t of spec.tests ?? []) {
      acc.push({
        title: spec.title,
        file: spec.file ?? fileHere ?? '<unknown>',
        expectedStatus: t.expectedStatus ?? '<missing>',
        actualStatus: t.results?.[0]?.status ?? '<no-run>',
        ok: spec.ok ?? false,
        tags
      })
    }
  }
  for (const sub of node.suites ?? []) {
    walkSpecs(sub, fileHere, acc)
  }
}

function collectControls(report: PlaywrightReport): ControlResult[] {
  const out: ControlResult[] = []
  for (const root of report.suites ?? []) {
    walkSpecs(root, undefined, out)
  }
  return out
}

function formatControl(c: ControlResult): string {
  return `  - ${c.file.replace(/^.*\/controls\//, 'controls/')} :: ${c.title}\n    expected=${c.expectedStatus} actual=${c.actualStatus} ok=${c.ok}`
}

function main(): void {
  const { exitCode: playwrightExit } = runControls()
  const exitCode = playwrightExit

  const report = parseReport(RESULTS_PATH)
  const controls = collectControls(report)

  console.log()
  console.log(`▸ Discovered ${controls.length} control test${controls.length === 1 ? '' : 's'} (min required: ${MIN_CONTROLS}).`)

  if (controls.length < MIN_CONTROLS) {
    console.error()
    console.error(`✗ Expected at least ${MIN_CONTROLS} controls, found ${controls.length}. Sprint 5.4 ships 8; none should be removed without a new ADR.`)
    process.exit(2)
  }

  const rogue: ControlResult[] = []
  const missingExpectation: ControlResult[] = []

  for (const c of controls) {
    if (c.expectedStatus !== 'failed') {
      missingExpectation.push(c)
    }
    if (c.expectedStatus === 'failed' && c.actualStatus !== 'failed') {
      rogue.push(c)
    }
  }

  if (missingExpectation.length > 0) {
    console.error()
    console.error(`✗ ${missingExpectation.length} control(s) lack the test.fail() inversion (expectedStatus !== 'failed'):`)
    for (const c of missingExpectation) console.error(formatControl(c))
    console.error()
    console.error('  Every sacrificial control MUST wrap its assertion with test.fail(). See controls/README.md.')
    process.exit(1)
  }

  if (rogue.length > 0) {
    console.error()
    console.error(`✗ ${rogue.length} rogue control(s) — assertion that was supposed to fail actually held:`)
    for (const c of rogue) console.error(formatControl(c))
    console.error()
    console.error('  This is SEV-1. The suite\'s pos/neg discipline is not discriminating.')
    console.error('  Page the maintainer before trusting any other test result in this run.')
    process.exit(1)
  }

  if (exitCode !== 0) {
    console.error()
    console.error(`✗ Playwright exited with status ${exitCode} despite every control passing the inversion check.`)
    console.error('  Something broke outside the control matrix. Inspect the Playwright output above.')
    process.exit(1)
  }

  console.log()
  console.log(`✓ All ${controls.length} sacrificial controls behaved as expected — inversion discipline intact.`)
  console.log(`  expectedStatus='failed' + actualStatus='failed' + ok=true on every control.`)
  process.exit(0)
}

function printHelp(): void {
  console.log(
    [
      'e2e-verify-controls.ts — ADR-1014 Sprint 5.4',
      '',
      'Runs the sacrificial-control subset of the E2E suite and verifies every',
      'control inverts correctly via test.fail(). Use as a CI gate — a rogue',
      'control means the suite has lost its pos/neg discipline.',
      '',
      'Usage:',
      '  bunx tsx scripts/e2e-verify-controls.ts',
      '  bunx tsx scripts/e2e-verify-controls.ts --min-controls=8',
      '  bunx tsx scripts/e2e-verify-controls.ts --help',
      '',
      'Exit codes:',
      '  0 — all controls behaved as expected.',
      '  1 — at least one control misbehaved (SEV-1). Page the maintainer.',
      '  2 — IO / usage / schema error (missing results, bad flag).',
      '',
      'Wire into CI after `bun run test:e2e` or as a dedicated job step.'
    ].join('\n')
  )
}

main()
