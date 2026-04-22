import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// Single source of truth for which env file drives the run.
//   Primary:  .env.e2e        (gitignored) or .env.partner (PLAYWRIGHT_PARTNER=1)
//   Fallback: root .env.local (for SUPABASE_SERVICE_ROLE_KEY used by admin
//             client in observable-state assertions; dotenv.config does
//             NOT overwrite keys already set, so .env.e2e wins).
//   CI:       ambient GitHub Actions env (no file)
export function loadE2eEnv(): void {
  const isPartner = process.env.PLAYWRIGHT_PARTNER === '1'
  const filename = isPartner ? '.env.partner' : '.env.e2e'

  const tryLoad = (fname: string): boolean => {
    const candidates = [
      resolve(process.cwd(), fname),
      resolve(HERE, '..', fname),
      resolve(HERE, '..', '..', '..', fname)
    ]
    for (const path of candidates) {
      if (existsSync(path)) {
        config({ path })
        return true
      }
    }
    return false
  }

  // Primary env first so its values win.
  tryLoad(filename)
  // Fallback for admin-client-only keys not emitted into .env.e2e.
  tryLoad('.env.local')
}

export interface E2eEnv {
  APP_URL: string
  ADMIN_URL: string
  MARKETING_URL: string
  WORKER_URL: string
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  // Scoped-role credentials (populated by e2e-bootstrap.ts in Sprint 1.2).
  CS_API_DATABASE_URL?: string
  CS_ORCHESTRATOR_DATABASE_URL?: string
  CS_ADMIN_DATABASE_URL?: string
  // Test-fixture Bearer keys (seeded by Sprint 1.2).
  TEST_API_KEY_ECOM?: string
  TEST_API_KEY_HEALTH?: string
  TEST_API_KEY_BFSI?: string
  // Evidence archive (Sprint 1.4).
  EVIDENCE_R2_BUCKET?: string
  EVIDENCE_R2_ACCESS_KEY?: string
  EVIDENCE_R2_SECRET?: string
}

const REQUIRED_KEYS: Array<keyof E2eEnv> = [
  'APP_URL',
  'ADMIN_URL',
  'MARKETING_URL',
  'WORKER_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY'
]

export function readEnv(): E2eEnv {
  const missing: string[] = []
  const out: Partial<E2eEnv> = {}
  for (const key of REQUIRED_KEYS) {
    const value = process.env[key]
    if (!value) {
      missing.push(key)
    } else {
      (out as Record<string, string>)[key] = value
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `E2E env missing required keys: ${missing.join(', ')}. ` +
        `See tests/e2e/README.md for setup (or run scripts/e2e-bootstrap.ts — Sprint 1.2).`
    )
  }
  // Optional keys passed through unchanged.
  for (const key of [
    'CS_API_DATABASE_URL',
    'CS_ORCHESTRATOR_DATABASE_URL',
    'CS_ADMIN_DATABASE_URL',
    'TEST_API_KEY_ECOM',
    'TEST_API_KEY_HEALTH',
    'TEST_API_KEY_BFSI',
    'EVIDENCE_R2_BUCKET',
    'EVIDENCE_R2_ACCESS_KEY',
    'EVIDENCE_R2_SECRET'
  ] as const) {
    const value = process.env[key]
    if (value) (out as Record<string, string>)[key] = value
  }
  return out as E2eEnv
}
