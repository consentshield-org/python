# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: —

## User Preferences

- **No AI authorship attribution anywhere.** No commit Co-Authored-By, no "AI-assisted" claims, no tool credits in docs/code/comments. All work is (c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com. References to Claude API/Anthropic API as technology choices are fine — only authorship claims are prohibited.
- **User prefers working files archived in .claude/working/** to keep project root clean.

## Key Learnings

- **Next.js 16 uses `proxy.ts` not `middleware.ts`.** The proxy runs on Node.js runtime (not Edge). Export `proxy` not `middleware`. See docs/architecture/nextjs-16-reference.md.
- **All request APIs must be awaited in Next 16.** `await cookies()`, `await headers()`, `await params`, `await searchParams`. Sync access removed entirely.
- **`next lint` does not exist in Next 16.** Run `eslint src/` directly. The package.json script already accounts for this.
- **Caching is opt-in in Next 16.** Pages are dynamic by default. Use `"use cache"` directive only for static content. Good for ConsentShield's real-time buffer data views.
- **Tailwind v4 is CSS-first.** No `tailwind.config.js`. Uses `@theme` in CSS and `@tailwindcss/postcss`.
- **ESLint 9 flat config.** Uses `eslint.config.mjs`, not `.eslintrc.json`.
- **Every package must be latest with security patches, exact-pinned.** No `^`, no `~`. Check versions before adding any dependency.
- **Supabase hosted: `gen_random_bytes()` lives in `extensions` schema.** Must qualify as `extensions.gen_random_bytes()` in all migrations. Same applies to other pgcrypto functions.
- **Use pooler connection string for psql queries.** Direct DB hostname doesn't resolve from local. Use `postgresql://postgres.xlqiakmkdjycfiioslgs:PASSWORD@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres`.
- **Supabase REST accepts JWTs signed with the project JWT secret for ANY role claim — but the signing secret is being phased out.** Historically the Cloudflare Worker's `SUPABASE_WORKER_KEY` was an HS256 JWT claiming `role: cs_worker`, signed with the project's HS256 shared secret. PostgREST `SET ROLE`s based on the claim. That's why cs_worker ever "worked" with Supabase REST.
- **[2026-04-21] Supabase is rotating HS256 shared-secret → ECC P-256 asymmetric JWT signing.** The dashboard now lists the HS256 key as "Previously used (legacy)". Once revoked, every HS256-signed scoped-role JWT stops working — including SUPABASE_WORKER_KEY. ECC P-256 is Supabase-private (asymmetric), so we can NO LONGER mint new role JWTs from our side.
- **[2026-04-21] For scoped-role access going forward, use direct Postgres via the Supavisor pooler.** Grant the role `LOGIN` + a password; connect via `postgres.js` (app runtime) or `psql` (ops) against `aws-1-<region>.pooler.supabase.com:6543` (transaction mode for apps) or `:5432` (session mode for DDL). ADR-1009 Phase 2 established this pattern for cs_api; it's also the Worker's eventual migration path.
- **[2026-04-21] `sb_secret_*` (new Supabase API key format) is NOT the JWT signing secret.** It's an opaque service-role-equivalent token. You cannot sign JWTs with it. For signing you need the HS256 legacy secret (on its way out) or direct-Postgres access.
- **React 19 purity rule flags `Date.now()` and `new Date()` inline in server components.** Extract to helper functions in `lib/` (e.g., `nowIso()`, `isoSinceHours(n)`). The lint rule only catches inline calls, not those wrapped in named functions. Same applies to `Math.random` and other impure operations.

## Do-Not-Repeat

[2026-04-13] Initially scaffolded with Next.js 14 (from CLAUDE.md) instead of checking the current major version (16). Always verify current versions of all tools before scaffolding. The user corrected this — latest stable with all security patches is the rule.

[2026-04-13] Over-eagerly replaced "Anthropic API" technology references when the user only wanted authorship attribution removed. Technology references (Claude API, Anthropic API) are fine. Only authorship/credit claims (Co-Authored-By, "AI-assisted", "Claude writes") must be removed.

[2026-04-21] **Don't `source .secrets` naively.** Values with a trailing `\` (line-continuation) join with the next line when bash sources the file. Example: `SUPABASE_DATABASE_PASSWORD=jxFENChEAG4cZdjZ\` plus the next line produced a 77-char mangled password instead of the 16-char real one, causing psql auth failures. Parse individual values with `grep "^KEY=" .secrets | sed 's/^KEY=//; s/\\$//'` or load into a variable via `read` with appropriate quoting. Also relevant to other scripts/tools that read .secrets.

[2026-04-21] **Don't assume `sb_secret_*` is the JWT signing secret.** It's an opaque API key, not a signing secret. Using it with HS256 produces a JWT that Supabase won't verify. The JWT signing secret lives in Project Settings → JWT Keys → Legacy HS256 (on new projects it may already be absent; those are direct-Postgres-only for scoped roles).

## Decision Log

[2026-04-13] **Next.js 16 over 14.** CLAUDE.md originally specified Next.js 14 but the current major version is 16. Updated to 16.2.3 (latest stable). React 19.2.5. All packages pinned to latest with security patches as of 2026-04-13.

[2026-04-21] **ADR-1009 Phase 2 scope amendment: direct Postgres via postgres.js, not HS256 JWT signing.** Original plan was to mint a `cs_api` HS256 JWT identical to SUPABASE_WORKER_KEY. Discovered mid-sprint that Supabase is rotating HS256 → ECC P-256 signing keys (legacy key flagged "Previously used" in dashboard). HS256-signed scoped-role JWTs would break when the legacy key is revoked. Switched to direct Postgres connections as LOGIN roles (same pattern cs_delivery / cs_orchestrator already use from Edge Functions). Future-proof against the rotation; also the Worker's eventual migration path.
