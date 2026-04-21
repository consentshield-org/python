#!/usr/bin/env bun
// ADR-1009 Phase 2 — mint an HS256 JWT for a scoped Postgres role so Supabase
// REST can SET ROLE into it. Reuses the Supabase project JWT secret (same
// secret that signs anon/service_role keys). Supports rotation of cs_worker /
// cs_delivery / cs_orchestrator / cs_api without adding a new npm dep.
//
// Usage:
//   SUPABASE_JWT_SECRET=<secret> bun run scripts/mint-role-jwt.ts cs_api
//
//   - Prints the signed JWT to stdout.
//   - Prints a usage hint to stderr (so `>> .env.local` captures only the JWT).
//   - Exits 1 on unknown roles or missing secret.
//
// Implementation note: Rule 15 — HS256 JWT signing is ~30 lines of
// node:crypto; no new package added.

import { createHmac } from 'node:crypto'

const SCOPED_ROLES = [
  'cs_worker',       // Cloudflare Worker
  'cs_delivery',     // deliver-consent-events Edge Function
  'cs_orchestrator', // other Edge Functions
  'cs_admin',        // admin app
  'cs_api',          // /api/v1/* handlers (ADR-1009)
]

function die(msg: string, code = 1): never {
  process.stderr.write(`mint-role-jwt: ${msg}\n`)
  process.exit(code)
}

const role = process.argv[2]
if (!role) {
  die(
    `missing role argument.\n` +
      `usage: SUPABASE_JWT_SECRET=<secret> bun run scripts/mint-role-jwt.ts <role>\n` +
      `roles: ${SCOPED_ROLES.join(' | ')}`,
  )
}
if (!SCOPED_ROLES.includes(role)) {
  die(`unknown role "${role}". allowed: ${SCOPED_ROLES.join(', ')}`)
}

const secret = process.env.SUPABASE_JWT_SECRET
if (!secret) {
  die(
    `SUPABASE_JWT_SECRET not set in env. Grab it from the Supabase dashboard:\n` +
      `  Project → Settings → API → JWT Settings → JWT Secret.\n` +
      `Invocation: SUPABASE_JWT_SECRET=<secret> bun run scripts/mint-role-jwt.ts ${role}`,
  )
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const header = { alg: 'HS256', typ: 'JWT' }
const payload = {
  role,
  iss: 'supabase',
  iat: Math.floor(Date.now() / 1000),
  // No exp — service-role JWTs for scoped roles are long-lived; rotate by
  // minting a new one, updating env, and invalidating the old (if needed)
  // via a JWT secret rotation on the Supabase project.
}

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
const signature = createHmac('sha256', secret).update(signingInput).digest()
const jwt = `${signingInput}.${b64url(signature)}`

process.stderr.write(
  `minted JWT for role "${role}"\n` +
    `payload: ${JSON.stringify(payload)}\n\n` +
    `paste into app/.env.local as SUPABASE_CS_API_KEY (or the matching *_KEY var),\n` +
    `and mirror into Vercel:\n` +
    `  vercel env add SUPABASE_CS_API_KEY preview\n` +
    `  vercel env add SUPABASE_CS_API_KEY production\n\n`,
)
process.stdout.write(jwt + '\n')
