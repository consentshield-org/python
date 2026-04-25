#!/usr/bin/env bunx tsx
/* eslint-disable no-console */
//
// ADR-1014 Phase 4 Sprint 4.4 — Aggregate Stryker driver + threshold gate.
//
// Runs the three Phase-4 Stryker configurations sequentially and emits a
// single machine-readable summary so the CI gate can:
//   1. Fail the build if any module is below its `break` threshold (80%).
//   2. Publish per-module scores into the testing.consentshield.in catalogue
//      (testing/src/data/runs.ts) without anyone having to read three
//      separate HTML reports.
//
// Configurations:
//   · worker/stryker.conf.mjs        — Worker security-critical surfaces
//   · app/stryker.delivery.conf.mjs  — delivery pipeline pure surfaces
//   · app/stryker.v1.conf.mjs        — v1 API pure helpers
//
// Output:
//   · reports/mutation/summary.json  — { generatedAt, modules: [...], thresholdGate }
//   · stdout                          — human-readable table + final verdict
//   · exit code                       — 0 if all modules pass; 1 if any fails
//
// Usage:
//   bunx tsx scripts/run-mutation-suite.ts            # full suite
//   bunx tsx scripts/run-mutation-suite.ts --module worker
//   bunx tsx scripts/run-mutation-suite.ts --skip-runs --report-only
//                  ↑ parses the existing mutation.json files; skips Stryker

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type ModuleId = 'worker' | 'delivery' | 'v1' | 'sigv4'

interface ModuleConfig {
  id: ModuleId
  label: string
  workspace: string
  bunScript: string
  reportJson: string
  breakThreshold: number
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const MODULES: ModuleConfig[] = [
  {
    id: 'worker',
    label: 'Worker (hmac + validateOrigin)',
    workspace: 'worker',
    bunScript: 'test:mutation',
    reportJson: 'worker/reports/mutation/mutation.json',
    breakThreshold: 80,
  },
  {
    id: 'delivery',
    label: 'Delivery pipeline (canonical-json + object-key + endpoint)',
    workspace: 'app',
    bunScript: 'test:mutation:delivery',
    reportJson: 'app/reports/mutation/delivery/mutation.json',
    breakThreshold: 80,
  },
  {
    id: 'v1',
    label: 'v1 API pure helpers (auth + v1-helpers + rate-limits)',
    workspace: 'app',
    bunScript: 'test:mutation:v1',
    reportJson: 'app/reports/mutation/v1/mutation.json',
    breakThreshold: 80,
  },
  {
    id: 'sigv4',
    label: 'sigv4 signer (Phase-4 follow-up)',
    workspace: 'app',
    bunScript: 'test:mutation:sigv4',
    reportJson: 'app/reports/mutation/sigv4/mutation.json',
    // Carve-out: ~32-mutant equivalent floor enumerated in
    // app/stryker.sigv4.conf.mjs and ADR-1014 §Phase-4 follow-up.
    // The "covered" score (~83%) is the more meaningful metric;
    // the lowered total threshold accounts for the equivalent floor
    // without violating Rule 13 via // Stryker disable comments.
    breakThreshold: 75,
  },
]

interface FileScore {
  path: string
  killed: number
  survived: number
  noCoverage: number
  timeout: number
  errors: number
  total: number
  scorePct: number
}

interface ModuleScore {
  id: ModuleId
  label: string
  totalKilled: number
  totalSurvived: number
  totalNoCoverage: number
  totalTimeout: number
  totalErrors: number
  scorePct: number
  files: FileScore[]
  passedThreshold: boolean
  breakThreshold: number
}

function parseStrykerJson(absPath: string, breakThreshold: number, mod: ModuleConfig): ModuleScore {
  const raw = JSON.parse(readFileSync(absPath, 'utf8')) as {
    files: Record<
      string,
      {
        mutants: Array<{
          status: string
        }>
      }
    >
  }

  const files: FileScore[] = []
  let totalKilled = 0
  let totalSurvived = 0
  let totalNoCoverage = 0
  let totalTimeout = 0
  let totalErrors = 0

  for (const [path, file] of Object.entries(raw.files)) {
    let killed = 0
    let survived = 0
    let noCoverage = 0
    let timeout = 0
    let errors = 0
    for (const m of file.mutants) {
      switch (m.status) {
        case 'Killed':
          killed += 1
          break
        case 'Survived':
          survived += 1
          break
        case 'NoCoverage':
          noCoverage += 1
          break
        case 'Timeout':
          timeout += 1
          break
        case 'CompileError':
        case 'RuntimeError':
          errors += 1
          break
      }
    }
    const validForScore = killed + survived + noCoverage + timeout
    const scorePct = validForScore === 0 ? 0 : ((killed + timeout) / validForScore) * 100
    files.push({
      path,
      killed,
      survived,
      noCoverage,
      timeout,
      errors,
      total: validForScore,
      scorePct: Math.round(scorePct * 100) / 100,
    })
    totalKilled += killed
    totalSurvived += survived
    totalNoCoverage += noCoverage
    totalTimeout += timeout
    totalErrors += errors
  }

  const validForScore = totalKilled + totalSurvived + totalNoCoverage + totalTimeout
  const scorePct = validForScore === 0
    ? 0
    : Math.round(((totalKilled + totalTimeout) / validForScore) * 10000) / 100

  return {
    id: mod.id,
    label: mod.label,
    totalKilled,
    totalSurvived,
    totalNoCoverage,
    totalTimeout,
    totalErrors,
    scorePct,
    files,
    passedThreshold: scorePct >= breakThreshold,
    breakThreshold,
  }
}

function runStryker(mod: ModuleConfig): { exitCode: number } {
  console.log(`\n━━━ ${mod.label} ━━━`)
  console.log(`    workspace: ${mod.workspace}/   script: ${mod.bunScript}\n`)
  const result = spawnSync('bun', ['run', mod.bunScript], {
    cwd: join(REPO_ROOT, mod.workspace),
    stdio: 'inherit',
    env: process.env,
  })
  return { exitCode: result.status ?? 1 }
}

function pad(s: string, n: number, right = false): string {
  if (s.length >= n) return s
  return right ? ' '.repeat(n - s.length) + s : s + ' '.repeat(n - s.length)
}

function renderTable(modules: ModuleScore[]): string {
  const headers = ['module', 'score%', 'killed', 'survived', 'noCov', 'timeout', 'errors', 'gate']
  const widths = [42, 7, 7, 9, 6, 8, 7, 6]
  const rows: string[][] = [
    headers,
    ...modules.map((m) => [
      m.label,
      m.scorePct.toFixed(2),
      String(m.totalKilled),
      String(m.totalSurvived),
      String(m.totalNoCoverage),
      String(m.totalTimeout),
      String(m.totalErrors),
      m.passedThreshold ? `≥${m.breakThreshold}` : `<${m.breakThreshold}`,
    ]),
  ]
  return rows
    .map((r, i) => {
      const line = r.map((cell, idx) => pad(cell, widths[idx]!, idx > 0)).join(' | ')
      return i === 0 ? `${line}\n${'-'.repeat(line.length)}` : line
    })
    .join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  const moduleArgIdx = args.indexOf('--module')
  const onlyModule = moduleArgIdx >= 0 ? args[moduleArgIdx + 1] : undefined
  const skipRuns = args.includes('--skip-runs') || args.includes('--report-only')
  const targets = onlyModule
    ? MODULES.filter((m) => m.id === onlyModule)
    : MODULES

  if (targets.length === 0) {
    console.error(`No matching modules. Pick from: ${MODULES.map((m) => m.id).join(', ')}`)
    process.exit(2)
  }

  if (!skipRuns) {
    console.log(`Running Stryker for ${targets.length} module(s) sequentially...`)
    for (const mod of targets) {
      const { exitCode } = runStryker(mod)
      // Stryker exits non-zero when its OWN break threshold is breached. We
      // still need to parse the JSON to surface per-module scores; treat
      // any non-fatal exit as "ran but possibly failed gate". A truly
      // catastrophic exit (no JSON written) is caught below.
      if (exitCode !== 0 && exitCode !== 1) {
        console.error(`Stryker for module=${mod.id} exited with code ${exitCode} — aborting suite`)
        process.exit(exitCode)
      }
    }
  } else {
    console.log('--skip-runs supplied: parsing existing mutation.json reports without running Stryker')
  }

  // Parse + aggregate.
  const scores: ModuleScore[] = []
  for (const mod of targets) {
    const abs = join(REPO_ROOT, mod.reportJson)
    if (!existsSync(abs)) {
      console.error(`Missing mutation.json for module=${mod.id} at ${abs}`)
      process.exit(2)
    }
    scores.push(parseStrykerJson(abs, mod.breakThreshold, mod))
  }

  // Render summary.
  console.log('\n━━━ Aggregate mutation summary ━━━\n')
  console.log(renderTable(scores))

  const failed = scores.filter((s) => !s.passedThreshold)
  if (failed.length > 0) {
    console.log(
      `\n❌ ${failed.length} module(s) under their break threshold: ` +
        `${failed.map((f) => `${f.id} (${f.scorePct}% < ${f.breakThreshold}%)`).join(', ')}`,
    )
  } else {
    console.log('\n✅ All modules passed their break threshold.')
  }

  // Persist machine-readable summary.
  const summaryDir = join(REPO_ROOT, 'reports', 'mutation')
  if (!existsSync(summaryDir)) mkdirSync(summaryDir, { recursive: true })
  const summary = {
    generatedAt: new Date().toISOString(),
    modules: scores,
    thresholdGate: {
      passed: failed.length === 0,
      failedModules: failed.map((f) => f.id),
    },
  }
  const summaryPath = join(summaryDir, 'summary.json')
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n')
  console.log(`\nWrote ${summaryPath} (${dirname(summaryPath)} created if missing).\n`)

  process.exit(failed.length === 0 ? 0 : 1)
}

void main()
