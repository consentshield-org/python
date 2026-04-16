# ADR-0026: Monorepo Restructure (Bun Workspace — `app/` + `admin/` + `packages/*`)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** In Progress
**Date proposed:** 2026-04-16
**Date completed:** —

---

## Context

The 2026-04-16 admin platform design pass (`docs/admin/architecture/consentshield-admin-platform.md`) established that the operator-facing admin platform is a **separate Next.js application** deployed to a separate Vercel project on `admin.consentshield.in`. The two apps share most of the Supabase project, the Cloudflare Worker, and a meaningful slice of TypeScript code (shared types, Supabase client utilities, encryption helpers, compliance score calculation, shadcn-style UI primitives).

Today the repository is a single Next.js app rooted at the repo root. There is no place for `admin/` to live without either copy-pasting the shared layer (drift risk) or coupling admin to customer code (blast-radius risk — admin Rule 25 explicitly requires deploys to be independent).

The monorepo restructure is a prerequisite for every admin platform ADR (0027 onwards). It does **not** depend on, and does not block, the DEPA roadmap (ADR-0019+) — DEPA work continues against `app/` after this ADR ships, with file paths gaining an `app/src/` prefix instead of `src/`. If both streams are active, this ADR ships first because the merge surface is smaller before DEPA migrations land in `app/src/app/`.

The full step-by-step migration plan with target directory layout, workspace tooling rationale, Vercel project configuration, and CI isolation guards lives in [`docs/admin/architecture/consentshield-admin-monorepo-migration.md`](../admin/architecture/consentshield-admin-monorepo-migration.md). This ADR ports that plan into the project's ADR/sprint/test discipline.

## Decision

Convert the repository into a **Bun workspace monorepo** with the following workspace members:

| Member | Role |
|---|---|
| `app/` | Customer-facing Next.js application (moved from repo root) |
| `admin/` | Operator-facing Next.js application (new — stub only in this ADR) |
| `worker/` | Cloudflare Worker (unchanged location) |
| `packages/shared-types` | TypeScript types derived from the Postgres schema (one canonical source) |
| `packages/compliance` | Deterministic compliance logic (DPDP score, DEPA score, privacy-notice composition) |
| `packages/encryption` | Per-org key derivation helpers (shared if both apps need per-org customer encryption) |

**Share narrowly, not broadly.** Only three packages are shared. Specifically NOT shared (each app keeps its own copy):

| Concern | Why each app has its own | Where it lives |
|---|---|---|
| Supabase server client | Customer uses `authenticated`/`anon` JWT + security-definer RPCs against `public.*`. Admin uses `cs_admin` connection + AAL2 + audit-logging RPC pattern against `admin.*`. Sharing risks leaking admin-specific logic into customer-reachable code (security boundary blur). | `app/src/lib/supabase/server.ts` and `admin/src/lib/supabase/server.ts` |
| Supabase browser client | Admin browser client checks `is_admin + AAL2` before every call; customer browser client doesn't. | `app/src/lib/supabase/browser.ts` and `admin/src/lib/supabase/browser.ts` |
| UI components | Shadcn philosophy is copy-paste-into-your-codebase, not consume-as-library. Admin app has different visual density, red admin-mode chrome, and different layout shell. Shared "primitives" become a coordination point that slows both apps. Both apps run `bunx shadcn@latest add` independently against the same Tailwind tokens — they look similar by convention, not by code sharing. | `app/src/components/` and `admin/src/components/` |

Shared infrastructure (`supabase/`, `docs/`, `tests/`, `scripts/`, `test-sites/`, `.wolf/`, `.claude/`, `session-context/`) stays at the repo root and is consumed by both apps without duplication.

Two Vercel projects:

| Vercel project | Root directory | Production domain | Notes |
|---|---|---|---|
| `consentshield` (existing) | `app/` | `consentshield.in`, `app.consentshield.in` | Re-rooted from `.` to `app/` in Phase 4 |
| `consentshield-admin` (new) | `admin/` | `admin.consentshield.in` | Behind Cloudflare Access (defence-in-depth) |

Each Vercel project's "Ignored Build Step" gates deploys to changes within its own directory + `packages/**` + `worker/**` + root `package.json`/`bun.lock`. Customer-only changes do not trigger admin deploys; admin-only changes do not trigger customer deploys. CI guards (Phase 4) prevent cross-app imports and env-var leakage.

The migration is reversible until Phase 4 (Vercel project split). Up to that point every phase ends in a clean build + green tests on the existing single-app codebase, just at new paths.

## Consequences

- **The customer app's path prefix changes** from `src/` to `app/src/`. All `docs/architecture/*` references to file paths gain an `app/` prefix. The customer-side ALIGNMENT doc's W1–W14 panel anchors remain valid (panels are HTML in `docs/design/`, unaffected by code restructure).
- **A narrow slice of code moves from `src/lib/` to `packages/*`.** Three packages: `shared-types`, `compliance`, and `encryption`. Imports for those change from relative paths (`@/lib/compliance/score`) to package names (`@consentshield/compliance`). Affects ~10–15 files in the customer app. Supabase clients and UI components stay in `app/src/lib/supabase/` and `app/src/components/` respectively (each app keeps its own copy — see Decision §).
- **Both apps deploy independently** with separate build cadences, separate Sentry projects, and separate env-var sets. An admin-only outage cannot page customer on-call. A customer-only outage cannot lock the operator out of admin tools.
- **The repository root becomes a workspace root** (no app code). Top-level `package.json` defines workspaces and orchestrates `bun --filter app run dev` etc.
- **DEPA roadmap (ADR-0019+) gets a slight rebase tax** on file paths (one rename per file). The amended customer architecture's references to `src/app/` become `app/src/app/`. Done in a single sweep at the end of Phase 1.
- **No database changes** in this ADR. The admin schema (`cs_admin` role, `admin.*` tables, audit-log RPC pattern) is scope for ADR-0027.
- **No new functionality.** A user navigating to either app sees the same things they would today (customer app) or a stub "Hello, admin" page (admin app). Real admin functionality is ADR-0028 onwards.

---

## Implementation Plan

### Phase 1: Workspace bootstrap + customer app moved to `app/`

**Goal:** Repo becomes a Bun workspace root. The existing customer app lives under `app/` and continues to build, lint, test, and deploy exactly as before — just at new paths. No new functionality, no admin code yet.

#### Sprint 1.1: Workspace bootstrap + customer app split

**Estimated effort:** 1.5 hours (workspace setup + git mv + Vercel root reconfig + verification)

**Deliverables:**
- [ ] Create `tsconfig.base.json` at repo root with the shared compiler options currently in `tsconfig.json`.
- [ ] Replace root `package.json` with the workspace root version: `"workspaces": ["app", "admin", "packages/*", "worker"]`, no app dependencies, only root devDependencies (prettier, typescript, @types/node).
- [ ] `git mv` customer app files into `app/`:
  - `src/` → `app/src/`
  - `tests/{worker,buffer,rights,workflows}/` → `app/tests/` (keep `tests/rls/` at repo root for cross-app RLS isolation work)
  - `next.config.ts`, `next-env.d.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `sentry.client.config.ts`, `sentry.server.config.ts`, `vitest.config.ts`, `tsconfig.json` → `app/`
- [ ] Move customer-app dependencies from root `package.json` into `app/package.json` (Next, React, Sentry, Supabase, Upstash, JSZip, input-otp + dev deps).
- [ ] Update `app/tsconfig.json` to extend `../tsconfig.base.json`.
- [ ] Update `app/eslint.config.mjs` paths.
- [ ] Update `app/vitest.config.ts` paths.
- [ ] Run `bun install` from repo root; confirm `bun.lock` updates for workspace mode.
- [ ] Reconfigure existing Vercel project `consentshield`: change Root Directory from `.` to `app`. Test with a preview deploy from a feature branch FIRST before merging.
- [ ] Sweep customer-side architecture docs for `src/app/` references and update to `app/src/app/`. Files: `docs/architecture/consentshield-definitive-architecture.md`, `docs/architecture/consentshield-complete-schema-design.md` (where it references frontend paths), `docs/design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md` panel anchors.
- [ ] Update `.gitignore` for new path layout (move `node_modules`, `.next`, `tsconfig.tsbuildinfo` ignores under `app/`; root-level `node_modules/` still applies to workspace root).

**Testing plan:**
- [ ] `bun install` from repo root completes without errors. Workspace `bun.lock` updates.
- [ ] `bun --filter app run lint` exits with zero warnings.
- [ ] `bun --filter app run build` completes successfully — all 38 routes compile.
- [ ] `bun --filter app run test` — all current tests pass (baseline 86/86 from Phase 2 close).
- [ ] Vercel preview deploy from migration branch builds and renders the dashboard at the expected paths.
- [ ] `cd tests/rls && bun test` — RLS isolation tests pass at the new repo-root location (39/39 baseline).

**Status:** `[x] complete` — 2026-04-16

**Execution notes (2026-04-16):**
- Worker got its own `worker/package.json` (zero runtime deps, `@cloudflare/workers-types` as devDep) so the workspace pattern can include it as a member.
- Workspace list in root `package.json` is currently `["app", "worker"]` — `admin` and `packages/*` get added back in Sprints 3.1 and 2.1 respectively, because Bun refuses a workspace entry that points at a non-existent directory.
- `tsconfig.base.json` created at repo root; `app/tsconfig.json` extends it and keeps `tests/worker` in `exclude` so the Next.js build's type check doesn't stumble on the Miniflare harness (which references Cloudflare-typed `Request` that's not type-compatible with the Next.js global `RequestInit`).
- `tests/worker/harness.ts` relative path to the Worker entrypoint was rewritten from `../../worker/src/index.ts` to `../../../worker/src/index.ts` (one extra level because the tests now live at `app/tests/worker/` instead of `tests/worker/`).
- `app/tests/buffer/lifecycle.test.ts` import of the RLS helpers was rewritten from `../rls/helpers` to `../../../tests/rls/helpers` — `tests/rls/` stays at repo root per the deliverables; a cleaner extraction to a shared test-utility package is deferred.
- Root `vitest.config.ts` now runs the RLS suite only (`include: ['tests/rls/**/*.test.ts']`); `app/vitest.config.ts` unchanged (its `tests/**` glob picks up `app/tests/**` from the app CWD).
- Root `package.json` exposes `bun run test:rls` as the cross-app RLS runner.
- `.env.local` was copied to `app/.env.local` so the app workspace's vitest picks it up from its own CWD. Both files are now in `.gitignore`.
- `CLAUDE.md` tree diagram rewritten to show the `app/` + `admin/` + `packages/` layout; build/test commands rewritten for Bun workspace (`cd app && bun run build`, `bun run test:rls`).

**Commands that work today:**
- `bun install` from repo root — installs deps for all workspaces
- `cd app && bun run dev` — customer app on port 3000
- `cd app && bun run build` — Next.js production build
- `cd app && bun run lint` — zero warnings
- `cd app && bun run test` — app/ vitest (worker harness, buffer, rights, workflows)
- `bun run test:rls` — root-level RLS vitest run

### Phase 2: Extract shared packages

**Goal:** Three narrow packages of code that both apps will benefit from sharing. The customer app consumes them via `workspace:*` references. Supabase clients, UI components, and app-specific lib code stay in `app/src/lib/` (and later in `admin/src/lib/`) — each app has its own copy by design (see Decision §).

#### Sprint 2.1: Extract 3 shared packages

**Estimated effort:** 1.5 hours (one commit per package; revert-friendly)

**Deliverables (one commit per item):**

- [ ] **`packages/shared-types`** — extract from `app/src/types/`. Target: types that derive from the Postgres schema and will be referenced by both apps (consent event, artefact, billing plan, org, purpose definition, deletion receipt). App-specific UI prop types and React component prop types stay in `app/src/types/`.
  - `packages/shared-types/package.json` (name: `@consentshield/shared-types`, main: `./src/index.ts`)
  - `packages/shared-types/tsconfig.json` extends `../../tsconfig.base.json`
  - Update `app/package.json` to depend on `"@consentshield/shared-types": "workspace:*"`
  - Replace `from '@/types/...'` imports in `app/src/` with `from '@consentshield/shared-types'` for the moved types only

- [ ] **`packages/compliance`** — extract from `app/src/lib/compliance/{score,privacy-notice}.ts`. Deterministic functions over data (DPDP score calc, DEPA score calc once ADR-0025 lands, privacy-notice composition). Both apps need to render the same scores; sharing the calculation guarantees they agree. Add `app` as consumer.

- [ ] **`packages/encryption`** — extract from `app/src/lib/encryption/crypto.ts`. Per-org key derivation helper. Add `app` as consumer. **Flag for review when ADR-0027 lands:** if admin-specific encryption needs (e.g., wrapping admin secrets) emerge, split into `packages/encryption-shared` (per-org customer encryption) + `admin/src/lib/encryption/admin-secrets.ts` (admin-specific). For v1 this single shared package is sufficient.

**What does NOT get a package** (each app keeps its own copy in its own `src/lib/` or `src/components/`):

- Supabase server client (`app/src/lib/supabase/server.ts` stays; admin gets `admin/src/lib/supabase/server.ts` in Phase 3)
- Supabase browser client (`app/src/lib/supabase/browser.ts` stays; admin gets its own in Phase 3)
- UI components (`app/src/components/` stays; admin gets its own `admin/src/components/` in Phase 3 — both apps independently run `bunx shadcn@latest add <component>` against shared Tailwind tokens)
- App-specific lib code (`app/src/lib/{billing,rights}/` stays in `app/`; the admin equivalents will live in `admin/src/lib/`)

**Testing plan (per package extraction):**
- [ ] After each commit: `bun install` succeeds; `bun --filter app run lint` zero warnings; `bun --filter app run build` succeeds; `bun --filter app run test` all pass (86/86).
- [ ] After all 3 commits: `grep -rn "from '@/lib/encryption\\|from '@/lib/compliance" app/src/` returns zero hits for the moved files (only app-specific lib paths remain).
- [ ] After all 3 commits: shared types are imported from `@consentshield/shared-types` in `app/src/`; app-specific types continue to live at `from '@/types/...'` and are unchanged.

**Status:** `[x] complete` — 2026-04-16

**Execution notes (2026-04-16):**
- Three commits, one per package — revert-friendly.
- `packages/compliance` — moved `score.ts` + `privacy-notice.ts` verbatim; `src/index.ts` re-exports the full surface (`computeComplianceScore`, `daysBetween`, `daysUntilEnforcement`, `isoSinceHours`, `nowIso`, `composePrivacyNotice` + their types). 5 app/src call sites rewired.
- `packages/encryption` — moved `crypto.ts` verbatim. `@supabase/supabase-js` is declared as a `peerDependency` (not a direct dep) because `crypto.ts` takes `SupabaseClient` as a parameter and doesn't instantiate its own client; pinning here would risk version drift with the host app. 2 app/src call sites rewired.
- `packages/shared-types` — shipped as a stub (`app/src/types/` was empty at extraction time). `src/index.ts` is an `export {}` with a comment describing which ADRs will populate it (0020 DEPA, 0027 admin). Added to `app/package.json` so the dependency edge exists before any type is moved in.
- Root `package.json` workspace list expanded to `["app", "worker", "packages/*"]` at the compliance commit (the first time a `packages/*` entry was non-empty).

### Phase 3: Admin app skeleton

**Goal:** `admin/` exists as a Next.js app that serves a "Hello, admin" page behind the proxy gate. No real admin functionality, no Supabase Auth wiring beyond a stub login, no admin RPCs (those need ADR-0027). The deliverable is a runnable Next.js app at the right path with the right project metadata.

#### Sprint 3.1: Admin app scaffold + stub auth gate

**Estimated effort:** 2 hours

**Deliverables:**
- [ ] `cd admin && bunx create-next-app@latest . --typescript --tailwind --app --no-import-alias --no-src-dir`, then reorganise generated output into `admin/src/` to match the layout expected by `consentshield-admin-platform.md` §2.1.
- [ ] `admin/package.json` — exact-pinned to the same Next/React/Supabase versions used by `app/package.json`. Add `workspace:*` deps on `@consentshield/shared-types` only. The admin skeleton does not yet need `compliance` or `encryption` (those land in admin via ADR-0028+).
- [ ] `admin/src/lib/supabase/{server,browser}.ts` — admin's own Supabase clients. The server client uses cs_admin connection (env: `ADMIN_SUPABASE_DB_URL`); the browser client checks `is_admin + AAL2` claims before any call. Each app owns its own Supabase wiring per the Decision §.
- [ ] `admin/src/components/` — admin's own UI components. Run `bunx shadcn@latest init` inside `admin/` to set up the per-app shadcn config; add only the components the skeleton needs (button, card; more in ADR-0028+). Do NOT import from `app/src/components/` — the CI guard in Phase 4 will fail any such import.
- [ ] `admin/proxy.ts` — host check (`admin.consentshield.in` or Vercel preview pattern), Supabase session check, `is_admin` claim check, AAL2 check. Public routes (`/login`, `/api/auth/*`) bypass. **Stub mode:** if env `ADMIN_HARDWARE_KEY_ENFORCED=false`, the AAL2 check is skipped (this is for local dev only — Phase 4 enforces it in production).
- [ ] `admin/src/app/(auth)/login/page.tsx` — minimal Supabase Auth login form (email + password + WebAuthn prompt). No real second-factor flow yet (deferred to ADR-0028).
- [ ] `admin/src/app/(operator)/page.tsx` — placeholder "Operations Dashboard" rendering: the current admin user's display name and a notice "Skeleton — real panels ship in ADR-0028 onwards. See `docs/admin/design/consentshield-admin-screens.html` for the spec."
- [ ] `admin/src/app/(operator)/layout.tsx` — top-of-page red admin-mode strip + sidebar matching the wireframe shell (nav items as anchor links to `#`, no real routing yet).
- [ ] `admin/sentry.client.config.ts`, `admin/sentry.server.config.ts` — point at separate Sentry project DSN env var (`SENTRY_DSN_ADMIN`).
- [ ] `admin/eslint.config.mjs`, `admin/postcss.config.mjs`, `admin/tsconfig.json` (extends `../tsconfig.base.json`), `admin/next.config.ts`, `admin/vitest.config.ts`.
- [ ] `admin/tests/` directory with one smoke test: `bun --filter admin run test` exits 0.

**Testing plan:**
- [ ] `bun --filter admin run dev` starts Next.js on `localhost:3001` (different port from `app`'s 3000).
- [ ] Visiting `localhost:3001/` redirects to `/login` (proxy rejects unauthenticated request).
- [ ] After signing in (with a manually-set `is_admin=true` row in `auth.users.raw_app_meta_data` via Supabase SQL editor), `localhost:3001/` renders the placeholder Operations Dashboard with the user's display name.
- [ ] `bun --filter admin run lint` zero warnings.
- [ ] `bun --filter admin run build` succeeds.
- [ ] `bun --filter admin run test` smoke test passes.
- [ ] `bun --filter app run dev` still works in parallel (port 3000); both apps run side-by-side without conflict.

**Status:** `[ ] planned`

### Phase 4: Vercel project split + CI isolation guards

**Goal:** Admin lives in a separate Vercel project on its own domain. Both apps deploy independently. CI prevents cross-app imports and env-var leakage. **This phase is the point of no return — after this, rolling back is multi-step.**

#### Sprint 4.1: Vercel split + CI guards

**Estimated effort:** 1.5 hours

**Deliverables:**
- [ ] Create new Vercel project `consentshield-admin` linked to the same GitHub repo. Set Root Directory to `admin`.
- [ ] Configure env vars per `consentshield-admin-platform.md` §11 (admin-specific: `ADMIN_SUPABASE_DB_URL`, `ADMIN_SUPABASE_DB_PASSWORD`, `ADMIN_HARDWARE_KEY_ENFORCED=true`, `ADMIN_IMPERSONATION_*`, `RESEND_ADMIN_SENDER`, `SENTRY_DSN_ADMIN`, `CLOUDFLARE_ACCESS_AUD`, `CLOUDFLARE_ACCESS_TEAM`). Run `vercel env pull` after to seed `admin/.env.local`.
- [ ] Add domain `admin.consentshield.in` to the new Vercel project. DNS via Cloudflare (CNAME to `cname.vercel-dns.com`).
- [ ] Configure Cloudflare Access (free tier) in front of `admin.consentshield.in`: GitHub-OAuth-restricted to Sudhindra's account.
- [ ] Configure Vercel "Ignored Build Step" on **both** projects:
  - `consentshield`: skip if no changes outside `admin/**`, `docs/**`, `session-context/**`, `.wolf/**`, `.claude/**`. (Customer app rebuilds on `app/**`, `packages/**`, `worker/**`, `supabase/**`, `tests/**`, root `package.json`, `bun.lock`.)
  - `consentshield-admin`: skip if no changes outside `app/**`, `docs/**`, `session-context/**`, `.wolf/**`, `.claude/**`. (Admin app rebuilds on `admin/**`, `packages/**`, `worker/**`, `supabase/**`, root `package.json`, `bun.lock`.)
- [ ] Create separate Sentry project `consentshield-admin` under the existing org; populate `SENTRY_DSN_ADMIN`.
- [ ] `scripts/check-env-isolation.ts` — pre-deploy script that lists env vars for the deploying project and fails if customer project carries any `ADMIN_*` var or admin project carries any customer-only secret. Wired into the Vercel build via `package.json` script.
- [ ] `scripts/check-no-admin-imports-in-app.ts` — greps `app/src/` for any import from `admin/` or `packages/admin-*`. Fails if found.
- [ ] `scripts/check-no-customer-imports-in-admin.ts` — greps `admin/src/` for any import from `app/`. Fails if found.
- [ ] GitHub Actions workflow `monorepo-isolation.yml` — runs all three scripts on every PR. Required check.

**Testing plan:**
- [ ] Push to a feature branch with **only** an `admin/**` change. Verify only `consentshield-admin` builds; customer project shows "Skipped" in Vercel.
- [ ] Push to a feature branch with **only** an `app/**` change. Verify only `consentshield` builds; admin project shows "Skipped".
- [ ] Push to a feature branch with **only** a `docs/**` change. Verify NEITHER project builds.
- [ ] Push to a feature branch with a `packages/**` change. Verify BOTH projects build.
- [ ] Push to a feature branch that adds `import { foo } from '@consentshield/admin-rpc'` to a file in `app/src/`. Verify `monorepo-isolation.yml` fails the PR with the cross-import message.
- [ ] Manually add an `ADMIN_HARDWARE_KEY_ENFORCED` env var to the customer Vercel project via the UI. Verify the next deploy fails at `check-env-isolation.ts`. Remove the env var.
- [ ] Visit `https://admin.consentshield.in` in a browser. Cloudflare Access challenge appears first; after authentication, Supabase Auth login appears; after sign-in with a `is_admin=true` user via WebAuthn, the placeholder Operations Dashboard renders.
- [ ] Visit `https://consentshield-admin-xxx.vercel.app` (preview URL). Cloudflare Access NOT in front (preview domains aren't gated by free CF Access); Supabase Auth + AAL2 alone gates access.
- [ ] Visit `https://consentshield.in` and `https://app.consentshield.in`. Customer app still works as before. Cloudflare Access NOT in front.

**Status:** `[ ] planned`

---

## Architecture Changes

This ADR does not change any architecture document content — the architecture documents are unchanged in their conclusions. Only path prefixes referenced by those docs (e.g., `src/app/`) gain an `app/` prefix when they refer to file locations. Specifically:

- `docs/architecture/consentshield-definitive-architecture.md` — file path references in §6, §10, §13 gain `app/` prefix where they cite `src/app/` or `src/lib/`.
- `docs/architecture/consentshield-complete-schema-design.md` — only the migration paths in §10 are affected (none — migrations stay at `supabase/migrations/`).
- `docs/admin/architecture/consentshield-admin-platform.md` — already authored against the post-monorepo layout; no change needed.
- `docs/admin/architecture/consentshield-admin-monorepo-migration.md` — this is the source plan for the ADR; cross-reference each phase here against the same phase in the migration doc.
- `CLAUDE.md` — UI specification reference section already mentions the monorepo (added 2026-04-16). No further change.

The path-prefix sweep happens inside Sprint 1.1 deliverables (last bullet) so the architecture docs ship in sync with the restructure.

---

## Test Results

_To be filled per sprint as the work executes._

### Sprint 1.1 — 2026-04-16 (Completed)

```
bun install                      → 1152 packages installed
cd app && bun run lint           → $ eslint src/ ; exit 0 (zero warnings)
cd app && bun run build          → Next.js 16.2.3 — all 38 routes compiled
cd app && bun run test           → 7 files, 42/42 tests pass
bun run test:rls                 → 2 files, 44/44 tests pass
Total: 42 + 44 = 86/86 (matches Phase 2 close baseline)
```

### Sprint 2.1 — 2026-04-16 (Completed)

```
# Split into 3 commits (one per package):
# - 4b48545 feat(ADR-0026): sprint 2.1a — extract packages/compliance
# - 4eb34d3 feat(ADR-0026): sprint 2.1b — extract packages/encryption
# - fec7a0a feat(ADR-0026): sprint 2.1c — extract packages/shared-types (stub)

After each commit:
  cd app && bun run lint     → 0 warnings
  cd app && bun run build    → all routes compiled
  cd app && bun run test     → 7 files, 42/42 pass
  bun run test:rls           → 2 files, 44/44 pass
  Combined: 86/86 (matches Sprint 1.1 baseline)

Verification:
  grep -rn "from '@/lib/encryption\|from '@/lib/compliance" app/src/ → 0 hits
  ls app/src/lib/           → no compliance/ or encryption/ subdirectories
  bun pm ls                 → 5 workspace members (app, worker, compliance,
                              encryption, shared-types)
```

### Sprint 3.1 — TBD

### Sprint 4.1 — TBD

---

## Risks and Mitigations

- **Vercel root-directory change for the customer project (Sprint 1.1) is observable** — the existing `consentshield` project must rebuild from a new path. Mitigation: test from a feature-branch preview deploy first; the production deploy is one-click after preview verification. Rollback is one-click (change Root Directory back to `.`).
- **Cross-app imports could sneak in during Phase 3** before Phase 4 wires the CI guard. Mitigation: keep Sprint 3.1 deliverables tight (no logic that would tempt cross-imports); land Phase 4 within days of Phase 3.
- **Cloudflare Access misconfiguration could lock Sudhindra out of the admin app.** Mitigation: configure Access AFTER Supabase Auth + AAL2 are working without it; verify via preview URL (not gated by Access in free tier) before adding the production gate; keep an escape hatch via direct Vercel function logs and the Supabase SQL editor.
- **Admin Sentry project must not receive customer-app errors** (would pollute admin error budget). Mitigation: Sentry DSN is a separate env var; the `beforeSend` hook is identical to the customer app's; misconfiguration would show up immediately in Sentry's project view.
- **Bun workspace tooling is less mature than npm/pnpm at very large scale.** Mitigation: this monorepo is small (2 apps + 6 small packages); Bun workspaces are sufficient. If scale demands at Series-A, a future ADR can introduce Turborepo for shared task caching.

---

## Out of Scope (Explicitly)

- **Real admin functionality.** This ADR ships a stub admin app. Real panels (Operations Dashboard, Organisations, Sectoral Templates, etc.) are scope for ADR-0028+.
- **Admin database schema** (`cs_admin` role, `admin.*` tables, audit log, impersonation). Scope for ADR-0027.
- **Admin user bootstrap** (creating Sudhindra's `admin.admin_users` row + setting `is_admin=true` in `auth.users.raw_app_meta_data`). Scope for ADR-0027.
- **Hardware key enrolment flow.** Stub mode (`ADMIN_HARDWARE_KEY_ENFORCED=false`) is acceptable for local dev throughout this ADR. Production AAL2 enforcement turns on in Phase 4 (env var set on production Vercel project), but the actual enrolment UI ships in ADR-0028.
- **Worker changes.** The Cloudflare Worker stays where it is; no monorepo work touches it.
- **Test infra split decisions beyond `tests/rls/` staying at the root.** Other cross-app integration tests (admin RLS, audit-log invariants) are added by ADR-0027.

---

## Changelog References

- `CHANGELOG-infra.md` — each sprint adds an entry referencing the phase

---

## Approval Gates

- **Before Sprint 1.1:** confirm a window of ~8 hours of focused work is available (the four sprints are sequential, not parallelisable across two operators).
- **Before Sprint 4.1:** confirm Cloudflare Access is configured and tested via preview URL; confirm the second hardware key (backup) is registered on the operator's Supabase Auth user; confirm a break-glass procedure exists for hardware-key loss (direct DB update by service role + re-enrolment).
- **Before marking Completed:** all four sprints' Status set to `[x] complete`, all test results recorded, both apps deploying independently, both isolation guards green on a test PR.

---

*ADR-0026 — Monorepo Restructure. The next ADR after this is ADR-0027 (Admin Schema + cs_admin role + audit log + impersonation tables) which depends on this restructure being complete.*
