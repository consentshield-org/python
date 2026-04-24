# ⚠️ Next-session assignment — read before picking your next ADR

**User greenlit a v2 Whitepaper track split on 2026-04-24 (Terminal B session).** Full detail at `~/.claude/projects/-Users-sudhindra-projects-aiSpirit-consent-sheild/memory/project_v2_whitepaper_split.md` (also referenced from `.wolf/cerebrum.md` Decision Log).

**Terminal A (you) own these three ADRs, in this proposed order:**
1. **ADR-1003** — Processor posture (storage_mode enforcement + BYOS + Zero-Storage + Healthcare seed + sandbox). 5 phases / 8 sprints. Natural extension of the ADR-1025 storage auto-provisioning and ADR-1041 Vercel Sandbox work you've already shipped.
2. **ADR-1007** — Connector ecosystem expansion (CleverTap, Razorpay, WebEngage/MoEngage, Intercom/Freshdesk, Shopify/WooCommerce, Segment + WordPress + Shopify plugins). 3 phases / 9 sprints. Extends your ADR-0039 (OAuth) + ADR-0018 (pre-built connectors) work.
3. **ADR-1008** — Scale + audit polish + SOC 2 + React Native + HMAC rotation. 3 phases / 10 sprints. Load tests + verify SLO exercise the pipeline you built.

**Do not start ADR-1006 or ADR-1015** — Terminal B owns those (client libraries + `/docs/*` developer docs) and is actively shipping. If you find you've touched them, unwind and ping the user.

**Coordination tripwires (from this session):**
- Migrations: collision at `supabase db push` → renumber YOUR file, not the other terminal's (precedent from 2026-04-24 at migrations 43 + 47).
- `docs/changelogs/CHANGELOG-schema.md` + `CHANGELOG-api.md` are shared. Prepend at top. If `Edit` fails because the file moved, re-read head and retry.
- `docs/ADRs/ADR-index.md`: edit only your own ADR rows.
- Terminal B is currently active on ADR-1015 as of 2026-04-24 afternoon (`marketing/src/app/docs/*` + `packages/cs-sdk-*` + `tests/integration/v1-api/`).

---

# Session Handoff — 2026-04-24 (Terminal A — ADR-1025 start-to-finish)

**Long session. ADR-1025 (customer storage auto-provisioning) is now FULLY CLOSED.** Every sprint in every phase is `[x]`, with 12 commits on `main`, 5 Supabase migrations applied to dev, 8 Vault secrets seeded, 5 pg_cron schedules active, and 115 storage-related unit tests green.

Terminal B worked concurrently on ADR-1010 Phase 4 + the abandoned-then-replaced ADR-1026 Hyperdrive experiment. Their commits interleaved cleanly via `git commit <paths>` pathspec discipline — zero cross-contamination across all 12 Terminal-A commits.

**Next-session intent:** start **ADR-1019 `deliver-consent-events`** (proposed; 4 phases / 7 sprints, all `[ ]`). It's the piece that writes compliance records into the R2 buckets that ADR-1025 just finished building. User decided to skip ADR-1014 Phase 4 for now (Stryker mutation testing; Sprint 4.2 is blocked on ADR-1019 existing anyway).

**Main commits this session (newest first, Terminal A only):**

| Commit | What |
|---|---|
| `b091045` | ADR-1025 close-out — customer usage display on dashboard storage-panel (progress bar + ceiling + snapshot date) + provision-org.ts + migrate-org.ts consolidated to use shared `org-crypto.ts` helper |
| `fffbe08` | Sprint 4.2 — monthly storage usage snapshots + admin chargeback panel + plan_ceiling_bytes per tier + `admin.storage_usage_snapshots_query` RPC |
| `0519ea8` | Sprint 4.1 — nightly verify + rotation RPC + retention cleanup (3 orchestrators, 3 routes, 2 crons, admin rotate RPC, shared `org-crypto.ts` helper introduced) |
| `8709d04` | Sprint 3.2 — storage migration orchestrator (forward_only + copy_existing modes) + customer migrate route + status polling + expanded BYOK form + admin migrate RPC + resumable chunk chain |
| `9677ceb` | Tiny follow-up: storage-panel "Manage storage" link → `/dashboard/settings/storage` (target now exists post-Sprint 3.1) |
| `5b87e8a` | Sprint 3.1 — BYOK credential validation route + `/dashboard/settings/storage` page + byok-form client |
| `186adc3` | Architecture docs + CHANGELOG-infra sync for Phase 2 completion |
| `93f116d` | Sprint 2.2 — wizard Step-7 soft banner + dashboard storage-panel widget |
| `613de21` | Wolf cerebrum learnings: bypassrls ≠ grants; CF R2 user-level token minting |
| `3d6142c` | Sprint 2.1 — provisioning orchestrator + data_inventory AFTER INSERT trigger + admin RPC + cs_orchestrator grants on export_configurations |
| `4a847d3` | Sprint 1.2 AMENDMENT — /user/tokens (not /r2/tokens) + two-token architecture (cfat_ bucket CRUD, cfut_ token mint) discovered via live E2E |
| `cee3886` | Sprint 1.1 — CF account token + STORAGE_NAME_SALT + env rename CF_* → CLOUDFLARE_ACCOUNT_* |

---

## Full ADR-1025 sprint ledger (final state)

| Phase | Sprint | Status |
|---|---|---|
| Phase 1 Foundation | 1.1 CF token + env wiring | ✅ |
| | 1.2 Provisioning primitives (+amendment) | ✅ |
| | 1.3 Verify probe + failure capture | ✅ (shipped earlier) |
| Phase 2 Managed provisioning | 2.1 Orchestrator + trigger + admin RPC | ✅ |
| | 2.2 Wizard banner + dashboard panel | ✅ |
| Phase 3 BYOK | 3.1 Validate route + settings UI | ✅ |
| | 3.2 Migration orchestrator + UI | ✅ |
| Phase 4 Observability | 4.1 Verify + rotation + retention cleanup | ✅ |
| | 4.2 Cost monitoring + chargeback | ✅ |

Plus close-out pass (b091045) handling the two in-scope deferred items.

---

## Major architectural decisions made this session

1. **All scheduled storage work runs as Next.js API routes, not Supabase Edge Functions.** The original ADR specified Deno Edge Functions but every sprint (2.1, 3.1, 3.2, 4.1, 4.2) was amended to use Next.js routes. Reason: `cf-provision.ts` / `verify.ts` / `sigv4.ts` / `migrate-org.ts` are Node-native; porting to Deno means dual maintenance with no shared-package infrastructure. Precedent: ADR-1017's probe orchestrator made the same move. Auth path (`csOrchestrator()` direct-Postgres as `cs_orchestrator`) is identical to the Deno path.

2. **Two-token Cloudflare architecture, forced by platform constraint.** CF R2 bucket-scoped tokens can ONLY be minted via `POST /user/tokens` (user-level), and that endpoint strictly rejects account-level tokens with `9109 Valid user-level authentication not found` regardless of scopes. Bucket CRUD (`/accounts/{id}/r2/buckets`) strictly rejects user-level tokens. Resolution:
   - `CLOUDFLARE_ACCOUNT_API_TOKEN` (prefix `cfat_`) — account-level, scope `Account → R2 Storage → Edit`. Used for bucket create/delete/list.
   - `CLOUDFLARE_API_TOKEN` (prefix `cfut_`) — user-level, scopes `User → API Tokens → Edit` + `Workers R2 Storage → Edit`. Used for token mint/revoke via `/user/tokens`. Shared with the existing wrangler-deploy + KV-invalidation uses.
   - `cf-provision.ts` → `cfFetch` has an `auth: 'account' | 'user'` parameter per-call.

3. **CF R2 S3 credentials are DERIVED from the token response, not returned directly.** Per CF docs: `access_key_id = response.result.id`, `secret_access_key = sha256hex(response.result.value)` (hex, not base64). Raw `value` is discarded after hashing. This was a Sprint 1.2 amendment discovery — the original code assumed a hypothetical `/accounts/{id}/r2/tokens` endpoint that returned `{credentials: {accessKeyId, secretAccessKey}}` directly; that endpoint doesn't exist.

4. **Customer-storage provisioning driven by `data_inventory` AFTER INSERT trigger on the FIRST row per org.** The trigger fires `net.http_post` to the Next.js route via `public.dispatch_provision_storage` + Vault-backed URL + bearer. Subsequent rows no-op (exclusion via `export_configurations.unique(org_id)` AND the first-row count check). Safety-net cron every 5 min catches any dispatch that failed during a Vault-unconfigured window.

5. **BYOK migration uses chunked execution with near-zero dead time.** Each chunk invocation of `/api/internal/migrate-storage` processes up to 200 objects or 240s (whichever hits first), commits `last_copied_key` every 20 objects for crash-resume, and if more work remains fires `public.dispatch_migrate_storage(migration_id)` via `csOrchestrator()` to self-schedule the next chunk. Cron safety-net every 1 min re-kicks migrations whose `last_activity_at` fell behind by > 2 min. Atomic pointer swap when `ListObjectsV2` returns empty/untruncated.

6. **Per-org HMAC encryption key shared across all storage orchestrators.** `app/src/lib/storage/org-crypto.ts` exposes `deriveOrgKey` / `decryptCredentials` / `encryptCredentials` / `normaliseBytea`. All 5 call sites (provision-org, migrate-org, nightly-verify, rotate-org, retention-cleanup + fetch-usage indirectly) use it after the close-out consolidation. Matches `@consentshield/encryption.deriveOrgKey` byte-for-byte so ciphertext round-trips through `decryptForOrg` on the read path.

7. **`bypassrls` is NOT a substitute for table grants.** cs_orchestrator has bypassrls (sees rows across RLS policies), but SQL-level privilege checks are separate. The Sprint 2.1 live E2E uncovered "permission denied for table export_configurations" despite bypassrls. Fix: migration 20260804000037 added explicit `grant select, insert, update on export_configurations to cs_orchestrator`. Audit stance going forward: join `information_schema.role_table_grants` against cs_orchestrator to assert least-privilege. Cerebrum entry added.

8. **Single Vault URL convention + shared bearer across all storage routes.** One bearer (`cs_provision_storage_secret`) gates five routes (provision, migrate, verify, rotate, retention-cleanup, usage-snapshot). Each route has its own URL secret. This keeps trust boundary uniform while isolating route dispatch.

9. **Forward-only migration preserves the old CS-managed bucket for 30 days.** `storage_migrations.retention_until` tracks the deadline. Phase 4 Sprint 4.1's retention-cleanup cron empties + deletes the bucket after the window. Audit-export downloads keep working during the retention period.

10. **Storage hygiene crons operate independently of ADR-1025 Phase 4.** `storage-nightly-verify` (02:00 IST) + `storage-retention-cleanup` (03:00 IST) + `storage-usage-snapshot-monthly` (1st of month 04:30 IST) + `provision-storage-retry` + `storage-migration-retry` all run on cron without any operator intervention. Over-ceiling orgs surface on `/admin/storage-usage` for manual chargeback (Razorpay line-item automation deferred to ADR-0050).

---

## Files shipped this session (by area)

### Migrations (5 total)
- `supabase/migrations/20260804000036_provision_storage_dispatch.sql` — dispatch fn + data_inventory trigger + cron + admin.provision_customer_storage RPC
- `supabase/migrations/20260804000037_cs_orchestrator_grants_export_configurations.sql` — grants
- `supabase/migrations/20260804000038_storage_migrations_and_dispatch.sql` — migration table + dispatch + trigger + cron + admin.storage_migrate RPC
- `supabase/migrations/20260804000039_storage_verify_rotate_retention.sql` — tracking columns + 3 dispatch fns + 2 crons + admin.storage_rotate_credentials RPC
- `supabase/migrations/20260804000040_storage_usage_snapshots.sql` — plans.storage_bytes_limit + storage_usage_snapshots table + dispatch + cron + admin.storage_usage_snapshots_query RPC

### Orchestrators + shared helpers (`app/src/lib/storage/`)
- `cf-provision.ts` — amended (Sprint 1.2): /user/tokens endpoint + two-token auth + sha256hex secret derivation
- `provision-org.ts` — Sprint 2.1 orchestrator (now using org-crypto)
- `migrate-org.ts` — Sprint 3.2 chunked migration (forward_only + copy_existing, now using org-crypto)
- `org-crypto.ts` — Sprint 4.1 shared helper (deriveOrgKey / decryptCredentials / encryptCredentials / normaliseBytea)
- `nightly-verify.ts` — Sprint 4.1 batch verification
- `rotate-org.ts` — Sprint 4.1 cs_managed_r2 token rotation
- `retention-cleanup.ts` — Sprint 4.1 post-migration bucket reclamation
- `fetch-usage.ts` — Sprint 4.2 CF R2 /usage API integration

### Routes (10 new)
- `/api/internal/provision-storage` — Sprint 2.1 (bearer-authed)
- `/api/internal/migrate-storage` — Sprint 3.2 (chunk worker)
- `/api/internal/storage-verify` — Sprint 4.1 (nightly)
- `/api/internal/storage-rotate` — Sprint 4.1 (admin-triggered)
- `/api/internal/storage-retention-cleanup` — Sprint 4.1 (daily)
- `/api/internal/storage-usage-snapshot` — Sprint 4.2 (monthly)
- `/api/orgs/[orgId]/storage/byok-validate` — Sprint 3.1 (customer)
- `/api/orgs/[orgId]/storage/byok-migrate` — Sprint 3.2 (customer)
- `/api/orgs/[orgId]/storage/migrations/[migrationId]` — Sprint 3.2 (customer status polling)
- (extended) `/api/orgs/[orgId]/onboarding/status` — Sprint 2.2 added `storage_verified` field

### UI
- `app/src/app/(dashboard)/dashboard/_components/storage-panel.tsx` — Sprint 2.2 + close-out usage display
- `app/src/app/(dashboard)/dashboard/settings/storage/page.tsx` — Sprint 3.1
- `app/src/app/(dashboard)/dashboard/settings/storage/_components/byok-form.tsx` — Sprint 3.1 + Sprint 3.2 5-stage machine
- `app/src/app/(public)/onboarding/_components/step-7-first-consent.tsx` — Sprint 2.2 soft banner
- `admin/src/app/(operator)/storage-usage/page.tsx` — Sprint 4.2 chargeback panel

### Tests (27 new, 115 total in tests/storage/)
- `app/tests/storage/provision-org.test.ts` (9 tests)
- `app/tests/storage/byok-validate-route.test.ts` (18 tests)
- `app/tests/storage/byok-migrate-route.test.ts` (17 tests)
- `app/tests/storage/migrate-org.test.ts` (10 tests)
- `app/tests/storage/nightly-verify.test.ts` (6 tests)
- `app/tests/storage/rotate-org.test.ts` (6 tests)
- `app/tests/storage/retention-cleanup.test.ts` (6 tests)
- `app/tests/storage/fetch-usage.test.ts` (7 tests)
- (preserved from prior session) `cf-provision.test.ts` + `verify.test.ts`

### Scripts
- `scripts/verify-adr-1025-sprint-11.ts` — live E2E harness for Sprint 1.1/1.2 (22.65s all-green)
- `scripts/verify-adr-1025-sprint-21.ts` — live E2E harness for Sprint 2.1 (13.38s all-green)

### Docs
- `docs/ADRs/ADR-1025-customer-storage-auto-provisioning.md` — every sprint `[x]`, every amendment documented
- `docs/architecture/consentshield-definitive-architecture.md` — §5 cs_orchestrator grant ledger updated
- `docs/architecture/consentshield-complete-schema-design.md` — §5.1 grant stanzas added
- `docs/changelogs/CHANGELOG-api.md` — 5 new entries
- `docs/changelogs/CHANGELOG-schema.md` — 4 new entries
- `docs/changelogs/CHANGELOG-dashboard.md` — 2 new entries
- `docs/changelogs/CHANGELOG-infra.md` — 1 entry covering operator work (Vercel env, CF domain, Vault seeds, cron catalogue)

---

## Operational state (post-session)

### Vault secrets seeded (8 total for ADR-1025)
| Name | Purpose |
|---|---|
| `cs_provision_storage_url` | Next.js route URL for provisioning |
| `cs_provision_storage_secret` | **Bearer shared across ALL 7 storage routes** |
| `cs_migrate_storage_url` | Next.js migration route |
| `cs_storage_verify_url` | Nightly verify |
| `cs_storage_rotate_url` | Credential rotation |
| `cs_storage_retention_url` | Retention cleanup |
| `cs_storage_usage_url` | Monthly usage snapshot |

### pg_cron schedules active (5 for ADR-1025)
| Name | Schedule | Purpose |
|---|---|---|
| `provision-storage-retry` | `*/5 * * * *` | Sprint 2.1 safety-net |
| `storage-migration-retry` | `* * * * *` | Sprint 3.2 chunk chain |
| `storage-nightly-verify` | `30 20 * * *` (02:00 IST) | Sprint 4.1 |
| `storage-retention-cleanup` | `30 21 * * *` (03:00 IST) | Sprint 4.1 |
| `storage-usage-snapshot-monthly` | `0 23 1 * *` (04:30 IST 2nd) | Sprint 4.2 |

### Vercel env (customer-app project `consentshield`, production)
Added this session: `STORAGE_PROVISION_SECRET`, `CLOUDFLARE_ACCOUNT_API_TOKEN`, `STORAGE_NAME_SALT`, `SUPABASE_CS_ORCHESTRATOR_DATABASE_URL`.

### Cloudflare
- Custom domain `app.consentshield.in` → customer-app Vercel project `consentshield` (`prj_XJKuuTJPRyPaikEEui1gSNgsUyQq`), under scope `sanegondhis-projects`. DNS + Vercel alias both live.
- CLI: operator upgraded from 37.4.1 → 52.x.x during the session via `pnpm add -g vercel@latest` after cleaning stray npm install.
- Two distinct CF API tokens now in use (cfat_ for bucket CRUD, cfut_ for token mint — see architectural decisions §2 above).

### Live E2E evidence
- `bunx tsx scripts/verify-adr-1025-sprint-11.ts` — 7 steps, 22.65s, real CF + real DB, all green.
- `bunx tsx scripts/verify-adr-1025-sprint-21.ts` — 4 steps, 13.38s, real CF + real DB, all green.
- **Trigger-flow production verification**: inserted a test `data_inventory` row against the deployed app (https://app.consentshield.in). Trigger fired → net.http_post → route provisioned bucket + encrypted credential + UPSERTed `export_configurations` in ~30s. All end-to-end without operator intervention.

---

## Handoff items to other ADRs (deliberate scope-out, not deferrals)

1. **Class A/B CF ops cost tracking** → future ADR-1027 "Platform cost observability" (tentative number). Needs CF's GraphQL analytics API (different auth, different rate limits). Storage dominates ≥ 95% of ConsentShield's bill anyway.

2. **Razorpay line-item generation for overages** → integrates into ADR-0050 billing rewrite once it has a line-items path. Operators use `/admin/storage-usage` + manual Razorpay invoice for first-customer overages.

3. **ADR-1019 (`deliver-consent-events`)** — the main next-up. It's what writes to the R2 buckets we just built. See "Exact next step" below.

4. **ADR-1014 Phase 4 (Stryker mutation testing)** — deferred AFTER ADR-1019 because Sprint 4.2 of ADR-1014 specifically targets `supabase/functions/deliver-consent-events/` which doesn't exist until ADR-1019 ships. User explicitly chose this order.

---

## Exact next step for tomorrow — start ADR-1019

The proposed ADR at `docs/ADRs/ADR-1019-deliver-consent-events-edge-function.md` sketches 4 phases / 7 sprints. All `[ ]`. Expected first move:

### Step 1 — Read the ADR proposal (5 min)
```
cat docs/ADRs/ADR-1019-deliver-consent-events-edge-function.md
```

### Step 2 — Apply the Sprint 2.1/3.1/3.2/4.1/4.2 amendment (5 min)
Same revision every sprint required: the proposed design is a Supabase Edge Function (Deno); amend to a Next.js API route (Node) for the same reasons (cf-provision/sigv4 are Node-native, no shared-package infra, single runtime to maintain). Write the amendment inline in Sprint 1.1 before touching any code. Pattern language is already canonical — past sprints use "Design amendment (YYYY-MM-DD): moved the orchestrator from a Supabase Edge Function (Deno) to a Next.js API route (Node). Reason: ... same rationale as ADR-1025 Sprints 2.1 + 3.1 + 3.2 + 4.1 + 4.2."

### Step 3 — Phase 1 first sprint (approx 3-4 hours)
Probably:
- New route `/api/internal/deliver-consent-events/route.ts` — bearer-authed POST, reuses `STORAGE_PROVISION_SECRET`
- New orchestrator `app/src/lib/delivery/deliver-events.ts` — polls `delivery_buffer` rows, reads `export_configurations.write_credential_enc` via `decryptCredentials` from **`@/lib/storage/org-crypto`** (the shared helper we just landed), writes to R2 via `sigv4.putObject`, marks `delivered_at` then deletes the buffer row (Rule 1 — buffer tables are temporary).
- Migration for a dispatch function + Vault seed + cron (every 30s? 1min? — scope decision per the ADR)
- Unit tests
- Live E2E against real CF (Sprint 3 commits worth of practice with this pattern)

### Step 4 — Resume ADR-1014 Phase 4 afterwards
Once `supabase/functions/deliver-consent-events/` has code (or its Next.js route equivalent does), run Stryker across Worker + delivery orchestrator + v1 RPCs. 4 sprints, ~1-2 days.

### Key context for ADR-1019 from this session

- **Use `org-crypto.ts` for decryption.** `decryptCredentials(pg, encrypted, derivedKey)` from `@/lib/storage/org-crypto`. No inline copies — that was the whole point of the close-out consolidation.
- **Use `sigv4.ts` `putObject` for the R2 write.** It's the exact same primitive used in Sprint 1.3's verification probe and Sprint 3.2's copy-existing chunk. Path: `app/src/lib/storage/sigv4.ts`.
- **`export_configurations.write_credential_enc` already has the decryptable target credentials** after ADR-1025 Sprint 2.1 provisions an org. Read it, decrypt with the org's derived key, call `putObject`.
- **`delivery_buffer` schema** lives in migration `20260413000003_operational_tables.sql` (check there for column names). `cs_delivery` was the original role designated for this work; now that we're running it as cs_orchestrator in a Next.js route, make sure the Postgres grants are in place (cs_delivery already has some; cs_orchestrator may need additive grants — check).

---

## Gotchas + constraints discovered this session

1. **cwd drift matters during long sessions.** `bunx supabase db push` only works from the **repo root** (where `supabase/config.toml` + `supabase/migrations/` live). `bun run lint` / `bun run build` only work from `app/` (or `admin/`). When you see "No test files found" or "Remote migration versions not found", check `pwd` before doing anything else.

2. **Vercel CLI + pnpm shadowing.** Operator had Vercel CLI 37.4.1 from pnpm global install shadowing newer npm installs. Fix: `pnpm add -g vercel@latest` (update the pnpm one) rather than `npm i -g vercel@latest` (which landed elsewhere in PATH). Now on 52.x.x.

3. **Vercel project Root Directory setting conflicts with `.vercel/project.json` location.** Customer-app `app/.vercel/project.json` exists. If Vercel dashboard's "Root Directory" is also set to `app`, running `vercel --prod` from `app/` resolves to `app/app/` and fails. Fix: clear the dashboard Root Directory setting to `.`.

4. **Three separate Vercel projects, three separate logins.** Customer app (scope `sanegondhis-projects/consentshield`), admin, marketing/website — each has its own project link + env vars + scope. The customer-app project is `prj_XJKuuTJPRyPaikEEui1gSNgsUyQq`.

5. **`vercel env add <KEY> preview` requires `--value` flag** in the new CLI (3-arg form with env= doesn't prompt correctly in non-TTY mode). Use `vercel env add KEY preview --value "$VALUE" --yes`. Production + development accept piped stdin.

6. **`admin.require_admin('support')` pattern.** Every admin RPC starts with this. cs_admin role is gated; non-admins get thrown exceptions.

7. **`storage_migrations.storage_migrations_active_unique` exclusion constraint.** Surfaces as 409 via Postgres error text `conflicting key value violates exclusion constraint`. Customer-facing migrate route catches this and returns `migration_already_active`.

8. **CF token propagation is always ~5 seconds.** After `createBucketScopedToken` returns, the token isn't usable at the R2 edge yet. Every orchestrator sleeps 5s before probing. Revocation has a similar delay (5-10s) — covered by polling in the Sprint 1.1 verification script + accepted as a non-issue in production flows where cutover barriers handle it.

9. **`net._http_response` auto-cleans after processing.** When you insert a data_inventory row and check `net.http_request_queue` a few seconds later, the queue is empty — this is expected. The proof of dispatch is the downstream side-effect (`export_configurations` row exists).

10. **Vault seed via pooler.** `db.<ref>.supabase.co:5432` doesn't DNS-resolve from local. Use the Supavisor pooler URL with postgres user: `postgresql://postgres.<ref>:<SUPABASE_DATABASE_PASSWORD>@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres`.

11. **`vi.stubEnv` + `vi.resetModules()` interaction in tests.** `vi.resetModules()` doesn't reset env stubs (the `vi.unstubAllEnvs()` in afterEach does). Fine, but means `beforeEach` must set env AFTER `resetModules` if both are used.

12. **Commit discipline — shared tree, zero cross-contamination.** Always `git commit <path1> <path2> ... -m "..."` pathspec form, NEVER `git add -A` with unrelated dirty files. When creating new files (untracked), first `git add <specific path>` then commit. Zero cross-contamination with Terminal B across all 12 commits this session.

13. **ADR numbering collision risk.** Terminal B has been reserving ADR numbers (1020/1021/1022/1023/1024 for multilingual; drafted 1026 for Hyperdrive that was abandoned). Check `docs/plans/adr-*.md` + existing ADR file names before picking a number. ADR-1027 is the proposed next slot (for platform cost observability, from the Sprint 4.2 handoff).

---

## Files expected dirty at session start (not this session's work)

```
 M .claude/session-handoff-terminal-a.md  ← THIS FILE gets overwritten next session
 M .wolf/anatomy.md
 M .wolf/buglog.json
 M .wolf/hooks/_session.json
 M .wolf/memory.md
```

Plus untracked items from Terminal B's in-flight work (ADR-1020, ADR-1021 draft files, etc.). None of these were touched by Terminal A; git status shows them to flag "don't accidentally include in your commits."

---

## Session close-out summary

- **ADR-1025 done.** 12 commits `cee3886 → b091045`. All 9 sprints + close-out shipped.
- **ADR-1019 is next**, blocked only on reading the proposed ADR and applying the Next.js-route amendment. ~3-4 hours for first sprint.
- **ADR-1014 Phase 4** waits for ADR-1019.
- **Cerebrum learnings recorded** by hooks (bypassrls ≠ grants; CF R2 token mint architecture).
- **No open bugs logged against ADR-1025.** Latest buglog entries were the Sprint 1.2 amendment discoveries (bug-699, bug-700 — both resolved by the amendment commit).
