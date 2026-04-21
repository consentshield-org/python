#!/usr/bin/env bunx tsx
// ADR-1009 Phase 3 Sprint 3.1 — grep gate for Rule 5 violation in app/src/.
//
// Scans app/src/ for references to SUPABASE_SERVICE_ROLE_KEY and
// SUPABASE_SECRET_KEY. Either would be a regression — the v1 API path runs
// entirely as cs_api via direct Postgres (ADR-1009 Phase 2). The only
// place SUPABASE_SERVICE_ROLE_KEY is legitimately used is in test harness
// code at the repo root (tests/rls/helpers.ts, admin ops) and in migrations,
// neither of which is in app/src/.
//
// Wired into app/package.json as `prelint` so `bun run lint` catches any
// reintroduction before CI even sees it.
//
// Exit codes:
//   0 — no violations
//   1 — one or more forbidden references found (prints file:line)
//
// Usage:
//   bun ../scripts/check-no-service-role-in-customer-app.ts
//   (from app/ workspace — resolves ./src relative to CWD)

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const FORBIDDEN = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY']

// Skip: this script itself contains the forbidden strings as data.
const SELF_PATH = import.meta.path

const ROOT = resolve(process.cwd(), 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
      walk(full, out)
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

try {
  statSync(ROOT)
} catch {
  console.error(`check-no-service-role: ${ROOT} not found. Run from app/ workspace.`)
  process.exit(1)
}

const files = walk(ROOT)
const violations: Array<{ file: string; line: number; match: string; text: string }> = []

for (const file of files) {
  if (file === SELF_PATH) continue
  const src = readFileSync(file, 'utf8').split('\n')
  for (let i = 0; i < src.length; i++) {
    const line = src[i]
    for (const needle of FORBIDDEN) {
      if (line.includes(needle)) {
        violations.push({ file, line: i + 1, match: needle, text: line.trim() })
      }
    }
  }
}

if (violations.length === 0) {
  console.log(`check-no-service-role: ${files.length} files scanned, 0 violations.`)
  process.exit(0)
}

console.error(
  `check-no-service-role: ${violations.length} Rule 5 violation(s) in ${ROOT}:\n`,
)
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  [${v.match}]  ${v.text}`)
}
console.error(
  `\nADR-1009 Phase 2 eliminated service-role from the customer-app runtime. The v1\n` +
    `path must connect as cs_api via the postgres.js pool (see app/src/lib/api/cs-api-client.ts).\n` +
    `If you genuinely need service-role access for a non-v1 surface, raise it in an ADR first.`,
)
process.exit(1)
