# Changelog — Infrastructure

Vercel, Cloudflare, Supabase config changes.

## [Sprint 1.1] — 2026-04-16

**ADR:** ADR-0026 — Monorepo Restructure (Bun Workspace — `app/` + `admin/` + `packages/*`)
**Sprint:** Phase 1, Sprint 1.1 — Workspace bootstrap + customer app moved to `app/`

### Added
- `tsconfig.base.json` at repo root — shared compiler options for all workspace members.
- `worker/package.json` — zero runtime deps, `@cloudflare/workers-types` as devDep (Worker is now a workspace member).
- `app/package.json` — `@consentshield/app`, customer deps (Next 16.2.3, React 19.2.5, Sentry 10.48.0, Supabase SSR 0.10.2, Upstash Redis, JSZip, input-otp) + devDeps (eslint-config-next, tailwind, esbuild, miniflare, vitest).
- Root `vitest.config.ts` dedicated to the RLS test suite (`include: ['tests/rls/**/*.test.ts']`).
- Root `bun run test:rls` script — cross-app RLS isolation runner.
- `app/.env.local` — copy of root `.env.local` so the app workspace's vitest picks up dev env from its own CWD. Both paths gitignored.

### Changed
- Repo root `package.json` is now a Bun workspace root (`"workspaces": ["app", "worker"]`); customer app dependencies moved into `app/package.json`. Admin + `packages/*` will be added as workspace members in their respective sprints (Bun rejects workspace entries that point at non-existent directories).
- `src/` → `app/src/` (git mv, history preserved).
- `tests/{buffer,rights,worker,workflows,fixtures}/` → `app/tests/` (git mv).
- `tests/rls/` stays at repo root (cross-app RLS isolation suite).
- `next.config.ts`, `next-env.d.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `sentry.client.config.ts`, `sentry.server.config.ts`, `vitest.config.ts`, `tsconfig.json` → `app/`.
- `app/tsconfig.json` extends `../tsconfig.base.json`; keeps `tests/worker` in `exclude` so Next build's type check doesn't stumble on the Miniflare harness.
- `app/tests/worker/harness.ts` — `WORKER_ENTRY` relative path rewritten to `../../../worker/src/index.ts` (one extra level after the move).
- `app/tests/buffer/lifecycle.test.ts` — RLS helpers import path rewritten to `../../../tests/rls/helpers` (reaches the root-level RLS utilities).
- `CLAUDE.md` — tree diagram rewritten for monorepo layout; build/test commands rewritten for Bun workspace (`cd app && bun run build`, `bun run test:rls`).
- `docs/architecture/consentshield-definitive-architecture.md` — Document Purpose section's `src/app/` reference updated to `app/src/app/`.
- `docs/design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md` — normative reminder's `src/app/` references updated to `app/src/app/`.
- `docs/design/screen designs and ux/consentshield-screens.html` — header comment's `src/app/` reference updated to `app/src/app/`.
- `.gitignore` — added `app/.env.local`, `admin/.env.local`, `app/.next/`, `admin/.next/`.

### Tested
- [x] `bun install` from repo root — 1152 packages installed, workspace `bun.lock` updated — PASS
- [x] `cd app && bun run lint` — zero warnings — PASS
- [x] `cd app && bun run build` — Next.js 16.2.3 Turbopack, all 38 routes compiled — PASS
- [x] `cd app && bun run test` — 7 test files, 42/42 tests pass — PASS
- [x] `bun run test:rls` from root — 2 test files (isolation + url-path), 44/44 tests pass — PASS
- [x] Combined count: 86/86 matches Phase 2 close baseline — PASS

### Deferred to subsequent sprints
- `admin` workspace member + admin app scaffold — Sprint 3.1
- `packages/*` workspace entries — Sprint 2.1
- Vercel project root-directory change + `consentshield-admin` project creation + Cloudflare Access + CI isolation guards — Sprint 4.1 (point of no return)
- Cleaner shared test-utility extraction (today: `app/tests/buffer/lifecycle.test.ts` imports `../../../tests/rls/helpers`) — deferred; not a correctness issue, just a path hop

## [Sprint 2.1] — 2026-04-16

**ADR:** ADR-0026 — Monorepo Restructure
**Sprint:** Phase 2, Sprint 2.1 — Extract 3 shared packages (one commit per package)

### Added
- `packages/compliance/` — `@consentshield/compliance`, deterministic compliance logic (`computeComplianceScore`, `daysBetween`, `daysUntilEnforcement`, `isoSinceHours`, `nowIso`, `composePrivacyNotice` + their types). Commit `4b48545`.
- `packages/encryption/` — `@consentshield/encryption`, per-org key derivation helpers (`encryptForOrg`, `decryptForOrg`). `@supabase/supabase-js` declared as peerDependency (takes `SupabaseClient` as a parameter). Commit `4eb34d3`.
- `packages/shared-types/` — `@consentshield/shared-types`, stub package for schema-derived types shared by both apps. Populated by subsequent ADRs (0020 DEPA, 0027 admin). Commit `fec7a0a`.

### Changed
- Root `package.json` workspaces → `["app", "worker", "packages/*"]` (added on the compliance commit).
- `app/package.json` — added `@consentshield/compliance`, `@consentshield/encryption`, `@consentshield/shared-types` as `workspace:*` dependencies.
- `git mv` `app/src/lib/compliance/{score,privacy-notice}.ts` → `packages/compliance/src/`. Empty `app/src/lib/compliance/` directory removed.
- `git mv` `app/src/lib/encryption/crypto.ts` → `packages/encryption/src/`. Empty `app/src/lib/encryption/` directory removed.
- 7 call sites in `app/src/` rewired from relative `@/lib/{compliance,encryption}` paths to `@consentshield/{compliance,encryption}` package imports.

### Tested (after each of the 3 commits)
- [x] `cd app && bun run lint` — zero warnings — PASS
- [x] `cd app && bun run build` — all 38 routes compiled — PASS
- [x] `cd app && bun run test` — 7 files, 42/42 tests pass — PASS
- [x] `bun run test:rls` (root) — 2 files, 44/44 tests pass — PASS
- [x] Combined: 86/86 (matches Sprint 1.1 baseline)
- [x] `grep -rn "from '@/lib/encryption\|from '@/lib/compliance" app/src/` → 0 hits — PASS
