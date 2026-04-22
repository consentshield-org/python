# Changelog — Infrastructure

Vercel, Cloudflare, Supabase config changes.

## [ADR-1014 Sprint 1.2 — e2e bootstrap + reset scripts + fixtures] — 2026-04-22

**ADR:** ADR-1014 — E2E test harness + vertical demo sites
**Sprint:** Phase 1, Sprint 1.2 — Supabase test-project bootstrap

### Added
- `scripts/e2e-bootstrap.ts` — seeds 3 vertical fixtures (ecommerce / healthcare / bfsi). Each fixture = auth.user + account + account_membership + organisation + org_membership + 3 web_properties + 1 `cs_test_*` API key with SHA-256 hash. Idempotent (reuses fixtures matched by account name `e2e-fixture-<vertical>`); `--force` flag supported for full rebuild. Writes a gitignored `.env.e2e` at repo root with all ids, plaintext keys, fixture user emails/passwords, app surface URLs.
- `scripts/e2e-reset.ts` — clears 14 tables in FK order (expiry_queue → revocations → artefact_index → artefacts → consent_events → tracker_observations + independent buffers); deletes non-fixture E2E-tagged auth.users (matched on `user_metadata.e2e_run === true`). Fixture accounts/orgs preserved.
- `tests/e2e/utils/fixtures.ts` — extended with `ecommerce`, `healthcare`, `bfsi` Playwright fixtures. Each reads `.env.e2e` on first access and returns `{ accountId, orgId, userId, userEmail, userPassword, propertyIds[], propertyUrls[], apiKey, apiKeyId }`. Tests that don't use a vertical never trigger its env lookup.

### Changed
- Root `.gitignore` — added `.env.e2e` + `.env.partner` alongside existing `.env*.local` entries.

### Scope amendment
- Original ADR Sprint 1.2 deliverable listed "seeds the scoped roles (cs_worker / cs_delivery / cs_orchestrator / cs_api / cs_admin) and reads each role's password back". That rotation is destructive against any existing dev Supabase project (invalidates app/admin/marketing `.env.local`). Moved to Sprint 5.1 (partner bootstrap) where it only runs against a fresh partner project. Sprint 1.2 scope is fixture seeding + `.env.e2e` emission — what the harness actually needs to start running. ADR body updated.

### Tested
- [x] Fresh bootstrap — 7.6s wall-clock (target: < 10 min). 3 accounts / 3 orgs / 9 web_properties / 3 api_keys created.
- [x] Idempotent re-run — 4.4s. Every fixture reused (no duplicates in DB).
- [x] Reset — 3.9s wall-clock (target: < 20 s). 14 tables cleared without FK errors.
- [x] `bunx playwright test --list` loads `.env.e2e` (45 env keys injected) + still discovers 8 tests.
- [x] `bunx tsc --noEmit` clean on scripts + tests/e2e.

### Gotcha
- Initial run used plan codes `trial_growth` / `trial_starter` mixed — only `trial_starter` exists in `public.plans`. Valid codes are `trial_starter`, `starter`, `growth`, `pro`, `enterprise`. All verticals now use `trial_starter`; real billing plans are out of scope for E2E fixtures.
- First reset attempt failed on `consent_events` due to `consent_artefacts.consent_event_id_fkey`. Fixed by deleting artefact-family tables first (documented in CLEAR_TABLES ordering comment).

## [ADR-1014 Sprint 1.1 — e2e harness scaffold] — 2026-04-22

**ADR:** ADR-1014 — E2E test harness + vertical demo sites (partner-evidence grade)
**Sprint:** Phase 1, Sprint 1.1 — Workspace scaffold

### Added
- `tests/e2e/` — new Bun workspace (`@consentshield/e2e`). Added to root `package.json` `workspaces` array.
- `tests/e2e/package.json` — exact-pinned `@playwright/test@1.52.0`, `dotenv@17.4.2`, `typescript@5.9.3`, `@types/node@20.19.39`. Scripts: `test`, `test:smoke`, `test:full`, `test:partner`, `test:controls`, `report`, `install:browsers`.
- `tests/e2e/tsconfig.json` — extends `tsconfig.base.json`.
- `tests/e2e/playwright.config.ts` — chromium + webkit projects default; firefox project gated behind `PLAYWRIGHT_NIGHTLY=1`. HTML + JSON + list reporters. Trace retain-on-failure. Nightly adds one retry + video. PR runs 0 retries (flakes must be diagnosed, not masked).
- `tests/e2e/utils/env.ts` — env loader (`.env.e2e` local / `.env.partner` when `PLAYWRIGHT_PARTNER=1`), required-keys guard, ESM-safe path resolution via `fileURLToPath(import.meta.url)`.
- `tests/e2e/utils/trace-id.ts` — ULID-shaped per-test trace id using `crypto.randomBytes`. Threads through Worker logs → buffer rows → R2 manifests → evidence archive (wire-up lands in Sprints 1.3 + 1.4).
- `tests/e2e/utils/fixtures.ts` — extended Playwright `test` with `env`, `traceId`, `tracedRequest` fixtures. Attaches `trace-id.txt` to each test so the id is in the archive even on pass.
- `tests/e2e/specs/README.md` — normative test-spec template. 8 sections: title / intent / setup / invariants / proofs / pair-with-negative / fake-positive defence / evidence outputs. Every `*.spec.ts` must have a sibling `specs/<slug>.md` (1:1 mapping enforced in review).
- `tests/e2e/specs/smoke-healthz.md` — spec doc for the first smoke test.
- `tests/e2e/smoke-healthz.spec.ts` — `@smoke`-tagged probe of `APP_URL` / `ADMIN_URL` / `MARKETING_URL` `/healthz` (falls back to `/`). Asserts status < 500 + non-empty body + trace id attachment.
- `tests/e2e/controls/README.md` + `tests/e2e/controls/smoke-healthz-negative.spec.ts` — preview of the Sprint 5.4 sacrificial-control pattern. Control asserts `'ok' === 'not-ok'` — MUST fail red on every run.
- `tests/e2e/README.md` — workspace orientation + discipline rules (spec 1:1, paired negatives, observable-state-only, trace-id threading, controls-must-fail).
- `tests/e2e/.gitignore` — `test-results/`, `playwright-report/`, `blob-report/`, `.tsbuild/`, `.env.e2e`, `.env.partner`.
- Root `package.json` — added scripts `test:e2e`, `test:e2e:smoke`, `test:e2e:full`, `test:e2e:partner`, `test:e2e:report` (all delegate to the workspace).

### Tested
- [x] `bun install` — workspace picked up, 12 packages resolved; `bun.lock` updated.
- [x] `bunx tsc --noEmit` in `tests/e2e/` — clean.
- [x] `bunx playwright test --list` — 8 tests discovered (3 surfaces × 2 browsers + 1 control × 2 browsers). Config loads; fixtures resolve.

### Outcome
Foundation is in place. Sprint 1.2 (Supabase test-project bootstrap + fixture factory) can start. `bun run test:e2e:smoke` against running local servers is deferred to Sprint 1.2 — the harness needs `.env.e2e` seeded and the 3 servers up.

## [ADR-1009 Sprint 2.4] — 2026-04-21

**ADR:** ADR-1009 — v1 API role hardening
**Sprint:** Phase 2 Sprint 2.4 — env purge

### Removed
- `app/.env.local` — `SUPABASE_SERVICE_ROLE_KEY=sb_secret_*` line (was line 4). The customer-app runtime stopped reading it in Sprint 2.3; removing it from env means any accidental re-introduction hits `UnconfiguredError` / undefined at call time instead of silently falling back to service-role powers.
- `app/.env.local.bak` — sed backup created during the purge, deleted (would have contained the removed plaintext secret; already in .gitignore but extra caution).

### Unchanged
- Root `.env.local` — `SUPABASE_SERVICE_ROLE_KEY` retained. Used by `tests/rls/helpers.ts` admin ops (seedApiKey, createTestOrg) which run outside the customer-app runtime.
- Vercel customer-app project — already had no service-role entry (ADR-0009 purged it previously). Verified with `vercel env ls`.

### Outcome
**Phase 2 CLOSED.** The v1 API surface runs entirely as `cs_api` via direct Postgres (Supavisor pooler, transaction mode). `SUPABASE_SERVICE_ROLE_KEY` has zero reachability from the customer-app runtime — revoked at the DB layer AND absent from every customer-app env (local + Vercel).

## [ADR-1009 Sprint 2.1] — 2026-04-21

**ADR:** ADR-1009 — v1 API role hardening
**Sprint:** Phase 2 Sprint 2.1 — cs_api role activation (env + secrets)

### Changed

- **Supabase Postgres role:** `cs_api` rotated from `NOLOGIN` → `LOGIN` with a strong password (migration 20260801000006 set a placeholder; rotated out-of-band via psql with an `openssl rand -base64 32`-derived value).
- **`.secrets`:** added `CS_API_PASSWORD` (raw) and `SUPABASE_CS_API_DATABASE_URL` (Supavisor transaction-mode pooler connection string).
- **`app/.env.local` + repo-root `.env.local`:** `SUPABASE_CS_API_DATABASE_URL` added so local dev + vitest pick up the cs_api pool connection.
- **Vercel (`consentshield` project):** `SUPABASE_CS_API_DATABASE_URL` set for both production and preview environments via `vercel env add`.

### Discovery (2026-04-21)

Supabase is rotating project JWT signing keys from HS256 (shared secret) to ECC P-256 (asymmetric). The legacy HS256 secret is flagged "Previously used" in the dashboard. This changes the scoped-role activation pattern permanently:

- HS256-signed role JWTs (like `SUPABASE_WORKER_KEY`) are living off the legacy key's verification tail; they will stop working when it's revoked.
- ECC P-256 is asymmetric — we cannot mint new role JWTs from our side.
- **Going forward:** scoped roles activate via direct Postgres (LOGIN + password + Supavisor pooler), NOT via HS256-signed JWTs on Supabase REST. ADR-1009 Phase 2 establishes this pattern for cs_api; the Cloudflare Worker will need the same migration eventually.
- `sb_secret_*` (new API-key format) is an opaque service-role token, **not** the JWT signing secret.

Captured in `.wolf/cerebrum.md` (Key Learnings + Decision Log) and the `reference_supabase_platform_gotchas` memory for cross-session durability.

### `.secrets` parsing gotcha

`SUPABASE_DATABASE_PASSWORD=jxFENChEAG4cZdjZ\` in the file — the trailing `\` is line-continuation when bash sources. Naive `source .secrets` produces a 77-char mangled password and psql auth fails. Parse individual values with `grep "^KEY=" .secrets | sed 's/^KEY=//; s/\\$//'`. Captured in cerebrum Do-Not-Repeat.

## [Sprint 4.1 — ADR-0026, afternoon] — 2026-04-17

**ADR:** ADR-0026 — Monorepo Restructure
**Sprint:** Phase 4, Sprint 4.1 — soft-privacy + Ignored Build Step scripts

### Added (soft-privacy layer — pre-launch URL containment)
- `app/src/app/robots.ts` + `admin/src/app/robots.ts` — robots.txt routes that disallow `User-Agent: *` plus 30 named search and AI crawlers (Googlebot, Google-Extended, GPTBot, ChatGPT-User, anthropic-ai, ClaudeBot, PerplexityBot, CCBot, Bytespider, Amazonbot, Applebot-Extended, Meta-ExternalAgent, etc.).
- `<meta name="robots">` in both apps' root layout: `noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai`.
- `X-Robots-Tag` HTTP header on every response, via `async headers()` in both `app/next.config.ts` and `admin/next.config.ts`. Covers API routes and non-HTML bodies.
- Smoke-verified with `curl`: header present on `/` and `/robots.txt`; full disallow list served on `/robots.txt`.

### Added (Ignored Build Step)
- `app/scripts/vercel-should-build.sh` — exit 0 skips the build; checks `git diff` for changes in `app/**`, `packages/**`, `worker/**`, `supabase/**`, root `package.json`, `bun.lock`, `tsconfig.base.json`.
- `admin/scripts/vercel-should-build.sh` — same pattern; admin builds on `admin/**`, `packages/**`, `supabase/**`, root `package.json`, `bun.lock`, `tsconfig.base.json`. NOT on `app/**` or `worker/**`.
- Both scripts mode `0755`.

### Deferred (owner dashboard steps)
- Wire `bash app/scripts/vercel-should-build.sh` into `consentshield` Vercel project's Settings → Git → Ignored Build Step.
- Wire `bash admin/scripts/vercel-should-build.sh` into `consentshield-admin` Vercel project likewise.
- Add `admin.consentshield.in` domain to `consentshield-admin` Vercel project + Cloudflare CNAME.
- Cloudflare Access gate on `admin.consentshield.in`.
- Create Sentry project `consentshield-admin` + set `SENTRY_DSN_ADMIN` env (script once DSN is known).

## [Sprint 4.1 — ADR-0026] — 2026-04-17

**ADR:** ADR-0026 — Monorepo Restructure
**Sprint:** Phase 4, Sprint 4.1 — Vercel split + CI isolation guards (code piece)

### Added
- `scripts/check-no-admin-imports-in-app.ts` — walks `app/src/`, resolves each import path, fails if any lands inside `admin/` or names an `@consentshield/admin-*` scoped package. Proper path resolution so `app/(operator)/` inside admin's Next.js route groups does not false-positive.
- `scripts/check-no-customer-imports-in-admin.ts` — same pattern, inverse direction.
- `scripts/check-env-isolation.ts` — detects the deploying Vercel project via `VERCEL_PROJECT_NAME` (fallback: CWD). Customer project must not carry any `ADMIN_*` var; admin project must not carry customer-only secrets (`MASTER_ENCRYPTION_KEY`, `DELETION_CALLBACK_SECRET`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `TURNSTILE_SECRET_KEY`). Secret values are never logged — only names.
- `.github/workflows/monorepo-isolation.yml` — GitHub Actions workflow running both import guards on every PR to `main` and every push to `main`. Ubuntu + Bun; no deps beyond Node built-ins.

### Changed
- `app/package.json` + `admin/package.json` — added `prebuild` script `bun ../scripts/check-env-isolation.ts` so the env isolation check runs inside each Vercel build step automatically. Bun executes the TS script natively; no `tsx` dependency required in the build image.

### Tested
- [x] Clean scan of `app/src/` — OK, 69 files, exit 0
- [x] Clean scan of `admin/src/` — OK, 31 files, exit 0
- [x] Injected violation (`app/src/__violation-test.ts` importing from `admin/src/proxy`) — FAIL detected, exit 1
- [x] `VERCEL_PROJECT_NAME=consentshield ADMIN_FAKE_KEY=x` — FAIL, ADMIN_FAKE_KEY flagged, exit 1
- [x] `VERCEL_PROJECT_NAME=consentshield` clean — OK, exit 0
- [x] `cd app && bun run prebuild` — OK, env isolation intact for customer project

### Deferred to owner (infra, Vercel dashboard + Cloudflare + Sentry)
- New Vercel project `consentshield-admin`, Root Directory = `admin/`, domain `admin.consentshield.in`
- Cloudflare Access on `admin.consentshield.in` (GitHub-OAuth restricted)
- Separate Sentry project + `SENTRY_DSN_ADMIN`
- Vercel "Ignored Build Step" on both projects (skip cross-app churn)
- First-PR smoke that the workflow runs green on CI

## [Sprint 4.1] — 2026-04-17

**ADR:** ADR-0027 — Admin Platform Schema
**Sprint:** Phase 4, Sprint 4.1 — Bootstrap admin user

### Added
- `scripts/bootstrap-admin.ts` — one-shot Bun script (not a migration) that promotes an existing `auth.users` row to the initial platform_operator admin. Idempotent; refuses a second run. Distinct exit codes per failure class: 2 for flag/env, 3 for idempotency, 4 for missing auth user, 1 for unexpected DB errors.

### Executed
- Rehearsal with `bootstrap-test@consentshield.in` — all 3 invariants verified (auth claims, admin_users row, re-entry refusal). Cleanup via `auth.admin.deleteUser` cascaded the admin_users row via ON DELETE CASCADE.
- Real bootstrap of `a.d.sudhindra@gmail.com` (auth id `c073b464-34f7-4c55-9398-61dc965e94ff`) with display name `Sudhindra Anegondhi`. Post-run join query confirms `is_admin=true`, `admin_role='platform_operator'`, `bootstrap_admin=true`, `status='active'`.

### Changed
- `docs/admin/architecture/consentshield-admin-platform.md` §10 — extended with full bootstrap procedure (sign up → run script → sign in → verify → register second hardware key). Exit-code table included so any future operator running the script knows what each failure class means.

### Next operator actions (NOT part of this sprint)
- Register a second hardware key via Supabase Auth before flipping `ADMIN_HARDWARE_KEY_ENFORCED=true` (Rule 21 — AAL2 enforcement requires backup key).
- Set CF_* Supabase secrets so the `admin-sync-config-to-kv` cron (Sprint 3.2) writes to Cloudflare KV instead of returning dry_run.

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

## [Sprint 3.1] — 2026-04-16

**ADR:** ADR-0026 — Monorepo Restructure
**Sprint:** Phase 3, Sprint 3.1 — Admin app skeleton + stub auth gate

### Added
- `admin/` — new Next.js 16 workspace member (`@consentshield/admin`). Mirrors `app/`'s layout (`src/app/`, `src/lib/`, `tests/`, per-app Supabase clients, per-app Sentry config) per the "share narrowly, not broadly" principle.
- `admin/src/proxy.ts` — host check (`admin.consentshield.in` / Vercel preview / localhost) + Supabase session validation + `app_metadata.is_admin` check + AAL2 hardware-key check with stub-mode bypass (`ADMIN_HARDWARE_KEY_ENFORCED=false` for local dev). Implements Rules 21 + 24 of the admin platform.
- `admin/src/lib/supabase/{server,browser}.ts` — admin's own Supabase SSR clients. Separate from the customer app's.
- `admin/src/app/(auth)/login/page.tsx` — stub login page with instructions for bootstrapping an admin via Supabase SQL editor. Real flow (Supabase Auth + WebAuthn hardware-key enrolment) lands in ADR-0028.
- `admin/src/app/(operator)/layout.tsx` — red admin-mode strip (Rule 25 visual cue) + red-bordered sidebar with 11 nav stubs keyed to ADR-0028..0036. Matches `docs/admin/design/consentshield-admin-screens.html`.
- `admin/src/app/(operator)/page.tsx` — placeholder Operations Dashboard. Reads the current user from Supabase, renders their display name, and shows the admin Rules 21–25 summary. Real panel ships in ADR-0028.
- `admin/sentry.{client,server}.config.ts` — separate Sentry project DSN (`SENTRY_DSN_ADMIN`); identical `beforeSend` scrubbing to the customer app.
- `admin/eslint.config.mjs`, `admin/vitest.config.ts`, `admin/tsconfig.json` (extends `../tsconfig.base.json`), `admin/next.config.ts`, `admin/postcss.config.mjs` (from `create-next-app`).
- `admin/tests/smoke.test.ts` — trivial smoke test proving the admin workspace's test runner is wired up. Real tests ship with ADR-0028+.

### Changed
- Root `package.json` workspaces → `["app", "admin", "worker", "packages/*"]` (added `admin`).
- Dev port convention: `app` on 3000, `admin` on 3001 (configured via `"dev": "next dev --port 3001"` in `admin/package.json`). Lets both apps run side-by-side during local dev.

### Tested
- [x] `cd admin && bun run lint` — zero warnings — PASS
- [x] `cd admin && bun run build` — Next.js 16.2.3 Turbopack, 2 routes (`/`, `/login`) compiled — PASS
- [x] `cd admin && bun run test` — 1 file, 1/1 tests pass — PASS
- [x] `cd app && bun run build` — baseline unchanged (all 38 routes) — PASS
- [x] `cd app && bun run test` — baseline unchanged (42/42) — PASS
- [x] `bun run test:rls` — baseline unchanged (44/44) — PASS
- [x] Combined total: 87 (86 baseline + 1 admin smoke)

### Deferred
- `bunx shadcn@latest init` inside `admin/` — skeleton uses raw Tailwind; first ADR-0028 sprint that needs a shadcn primitive will run it.
- `admin/next.config.ts` Sentry wrapping — out of scope for the skeleton.
- Real login + hardware-key enrolment UI — ADR-0028.
- Env vars on Vercel (`ADMIN_SUPABASE_DB_URL`, `ADMIN_HARDWARE_KEY_ENFORCED=true`, `SENTRY_DSN_ADMIN`, etc.) — Sprint 4.1.
