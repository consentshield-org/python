# Changelog — Dashboard

Next.js UI changes.

## [ADR-1027 Sprint 2.1 — AccountContextCard + group-by-account toggle on Pipeline] — 2026-04-24

**ADR:** ADR-1027 — Admin account-awareness pass
**Sprint:** Phase 2, Sprint 2.1 — Pipeline panel account sidebar + rollup

### Added
- `admin/src/components/account-context/account-context-card.tsx` — reusable Server Component. Calls `admin.account_detail(p_account_id)` and renders the canonical operator envelope (account name + plan + status badge + child-org count + trial-ends + active adjustments + last 3 admin actions). `mode` prop:
  - `full` (default): sticky sidebar aside with multi-block layout, status tone background (green / navy / amber / red / grey by status).
  - `compact`: single-line strip with name + plan + org count + status pill + "Open account →" link. Designed to drop above org-scoped pages as a context anchor.

### Admin console
- `admin/src/app/(operator)/orgs/[orgId]/page.tsx` — compact `<AccountContextCard>` strip now renders above the 3-column info grid. Gives operators the parent-account context at a glance and a direct jump to `/accounts/[id]`.
- `admin/src/app/(operator)/pipeline/page.tsx` — server-side parallel fetch now also loads `public.organisations` with the embedded `accounts(name, plan_code)` relation; builds an `orgToAccount` lookup map and passes it to `<PipelineTabs>`. Admin already has SELECT on `public.organisations`; no new RPC required.
- `admin/src/app/(operator)/pipeline/pipeline-tabs.tsx` — new `groupBy: 'org' | 'account'` state. A visible "Group by: Orgs · Accounts" toggle row sits above the three org-grouped tabs (Worker errors, DEPA expiry queue, Delivery health). Stuck buffers is table-grouped and stays untouched.
  - **org mode**: per-row Account column renders the parent-account name on top and the org name beneath. Orgs without an account mapping show `—`.
  - **account mode**: client-side rollup via `useMemo` — buckets by `account_id`; sums counts (events, throughput, failures, orgs_touched, expiring counts); tracks worst-case median + p95 latency per account; surfaces endpoints touched on worker_errors. Orgs without an account mapping fall into a synthetic `(no account)` bucket so they're visible, never silently dropped.

### Design
- `docs/admin/design/consentshield-admin-screens.html`:
  - Organisations panel — parent-account context strip added above the inline org detail drawer. Shows `<strong>account name</strong> · <plan_code> · <N orgs> · since <date>` + status pill + "Open account →" link.
  - Pipeline Operations panel — "Group by: Orgs · Accounts" toggle row added between the tab bar and the visible tab. Worker errors table's Org column becomes "Account · Org" with the account name on top line.
- `docs/admin/design/ARCHITECTURE-ALIGNMENT-2026-04-16.md` — reconciliation tracker Sprint 2.1 flipped to ✅ wireframe + ✅ code. Note: Security and Billing operator panels are already account-scoped today (Security has no org grouping; Billing panel is account-keyed via `/billing/[accountId]`), so the card is redundant there — the only org-scoped surface that benefits is Pipeline, which is where the toggle landed.

### Tested
- [x] `cd admin && bunx tsc --noEmit` — PASS (one FK-typing fix: PostgREST returns the nested `accounts` relation as an array even for a 1:1 FK; code handles both array and object shapes defensively).
- [x] `cd admin && bun run lint` — PASS.
- [x] RPC shape — covered by existing `tests/admin/account-rpcs.test.ts`; component is a thin renderer over that envelope.
- [ ] Component / interaction — recommend a dev-server visual check (compact strip on `/orgs/[orgId]`, pipeline toggle re-renders without round-trip, synthetic `(no account)` bucket shows for unmapped orgs).

### Why
Operators were forced to mentally re-aggregate org-tier metrics when a multi-org account (enterprise customers with per-division orgs) was the thing they actually cared about. The `<AccountContextCard>` + toggle turns that re-aggregation into a UI click. No RPC changes; single server round-trip; zero risk to the existing org-tier views since the toggle defaults to `org`.

---

## [ADR-1025 close-out — usage display on storage panel + org-crypto consolidation] — 2026-04-24

**ADR:** ADR-1025 — Customer storage auto-provisioning
**Sprint:** Close-out pass (post-Sprint 4.2)

### Changed
- `app/src/app/(dashboard)/dashboard/_components/storage-panel.tsx` — added the customer-facing usage display flagged as a follow-up during Sprint 4.2. Panel now parallel-fetches `storage_usage_snapshots` alongside `export_configurations` and renders a usage bar with:
  - Current bytes stored (payload + metadata) vs plan ceiling, formatted in B / KiB / MiB / GiB / TiB.
  - Three-colour progress bar: green <80%, amber ≥80%, red if over ceiling.
  - Object count + snapshot date in a secondary line.
  - Over-ceiling explanatory copy ("Over plan ceiling — contact support...") for rows flagged by the generated `over_ceiling` column.
  - When no snapshot exists yet (pre-first-monthly-cron), shows "First snapshot arrives on the 1st of each month" rather than leaving the field blank.
  - Enterprise plan (null ceiling) shows "(no ceiling)" alongside raw bytes.
- `app/src/lib/storage/provision-org.ts` + `app/src/lib/storage/migrate-org.ts` — consolidated `deriveOrgKey` / `decryptCredentials` / `normaliseBytea` into the shared `org-crypto.ts` helper. Both files now import from it instead of carrying inline copies. Migration orchestrator keeps its thin `loadSourceCreds` wrapper (migrate-specific — reads the source config row first, then decrypts). `createHmac` is no longer a top-level import anywhere that reuses org-crypto; the lingering use inside `migrate-org.ts`'s hand-rolled sigv4 ListObjectsV2 block is a dynamic import alongside the existing `createHash` pull.

### Why
Sprint 2.2's storage panel was a visibility surface before any usage data existed. Sprint 4.2 shipped the snapshot pipeline (table + monthly cron + admin chargeback panel) but stopped short of the customer-facing read path — the data was visible to operators only. This close-out finishes the loop: customers see their own storage usage on the dashboard, ceiling warnings fire without requiring an admin touchpoint, and the first snapshot (after the 1st of next month) will render automatically with zero additional UI work.

The org-crypto consolidation is a hygiene win that was deliberately deferred out of Sprint 4.1 (zero-risk principle — don't touch passing code when the new modules can use the shared helper directly). Landing it now while the ADR-1025 workstream is hot and all 115 tests are green is the lowest-risk time to pay down the duplication.

### Tested
- `bunx vitest run tests/storage/` — 115/115 PASS (zero behaviour change from consolidation).
- `bun run lint` — 248 files, 0 violations.
- `bun run build` — Next.js 16 clean.

## [ADR-1025 Sprint 2.2 — wizard Step-7 storage banner + dashboard storage panel] — 2026-04-24

**ADR:** ADR-1025 — Customer storage auto-provisioning
**Sprint:** Phase 2, Sprint 2.2 — UI surfaces for storage provisioning state

### Added
- `app/src/app/(dashboard)/dashboard/_components/storage-panel.tsx` — new server component. Reads `public.export_configurations` via the authenticated-user Supabase client (the existing `org_select` RLS policy scopes the read to the viewer's org). Three visual states — row-missing ("Provisioning" + spinner + explanatory paragraph), row-unverified ("Initialising" amber badge), row-verified ("Ready" green badge + provider label from PROVIDER_LABELS + bucket name + relative last-delivery timestamp). Two links: "View exports →" to `/dashboard/exports`, and "Manage storage" to `/dashboard/exports/settings` (placeholder — moves to `/dashboard/settings/storage` when Phase 3 ships the BYOK UI). Wired into `dashboard/page.tsx` between the compliance-scores grid and the `ComplianceHealthCard`.
- `StorageInitialisingBanner` (inline component inside `step-7-first-consent.tsx`) — compact non-blocking banner rendered above the wizard's Step-7 heading while `storage_verified !== true`. Renders a spinner, "Storage initialising" label, and a one-sentence explanation. Disappears on the next 5 s poll once verification flips to true. Non-blocking by design: the "Open my dashboard" button remains active throughout, so a transient CF outage can't trap the user in Step 7.

### Changed
- `app/src/app/api/orgs/[orgId]/onboarding/status/route.ts` — `StatusResponse` gains `storage_verified: boolean | null`. Null means the provisioning trigger hasn't landed yet (no `export_configurations` row); false means a row exists but verification is pending; true means storage is ready. Reads via `.maybeSingle()` so a missing row is an explicit null rather than an error.
- `app/src/app/(public)/onboarding/_components/step-7-first-consent.tsx` — added `storageVerified` state fed by each poll tick; renders the new `StorageInitialisingBanner` above the main card heading when `storageVerified !== true`.

### Why
The provisioning trigger fires on the first `data_inventory` INSERT (Sprint 2.1) and completes in ~30 s end-to-end. Without this sprint, a user who zipped through the wizard could land on the dashboard before their bucket was ready and see no indication of WHY export actions might briefly misbehave. These two surfaces — one in-wizard, one post-wizard — give a deterministic visible signal at both exit points, auto-dismissing without any user action when provisioning completes.

### Tested
- `bun run lint` — 232 files, 0 violations (was 231 before the panel file landed).
- `bun run build` — clean; Next.js 16 prerender manifest includes the new components; 0 errors, 0 warnings.
- `bunx vitest run tests/storage/` — 45/45 PASS in 164 ms (no new tests; the route delta is additive behind existing membership-gate tests, and the presentation components are pure read-only rendering).

### Scope boundary
No automated race-simulation test. The nightly verify cron shipping in Phase 4 Sprint 4.1 will exercise is_verified flips against production data, and visual verification happens during the next real onboarding run. The `/dashboard/exports/settings` link in the panel is a Phase 3 placeholder — it currently points to the pre-existing r2-settings-form (BYOK surface from before ADR-1025); Phase 3 will rewrite that page and move the link to `/dashboard/settings/storage` per the ADR.

## [ADR-1005 Phase 6 Sprint 6.4 — notifications dashboard + per-channel test-send] — 2026-04-23

**ADR:** ADR-1005 — Operations maturity (Phase 6 fully shipped)
**Sprint:** Phase 6 Sprint 6.4

### Added
- `app/src/app/(dashboard)/dashboard/settings/notifications/page.tsx` — server component; reads `notification_channels` for the org (RLS handles isolation), passes to client manager.
- `app/src/app/(dashboard)/dashboard/settings/notifications/channels.tsx` — `ChannelsManager` client component: per-type "Add channel" buttons + inline form, per-row edit (config + alert-type checkboxes + active toggle + Test send + Delete), per-type field schemas (slack/teams/discord webhook_url; pagerduty routing_key; custom_webhook url+signing_secret).
- `app/src/app/(dashboard)/dashboard/settings/notifications/actions.ts` — four server actions (create/update/delete/testSend). Side-effect imports `@/lib/notifications/adapters` so the registry is populated. Test-send injects `'test_send'` into the channel's alert_types so the dispatcher's filter doesn't drop the synthetic event.
- `app/src/components/dashboard-nav.tsx` — sidebar entry "Notification channels" → `/dashboard/settings/notifications` between API keys and Billing settings.
- Five seeded alert types render as inline-described checkboxes: `orphan_events_nonzero` (ADR-1004 P3), `deletion_sla_overdue`, `rights_request_sla`, `security_scan_critical`, `daily_summary`.

### Tested
- [x] `cd app && bun run lint` — clean.
- [x] `cd app && bun run build` — clean. Route present in build output.
- [x] `cd app && bunx tsc --noEmit` — clean.
- [x] Live Slack test-send already verified by Sprint 6.2's slack-live test (`SLACK_WEBHOOK_URL` env-gated, 1/1 PASS).

### Severity-routing rationale
A formal severity → channel matrix (e.g. "critical always pages PagerDuty") was considered and deferred — the per-channel/per-kind opt-in is finer-grained and avoids the awkward case where an operator wants critical alerts in Slack but specifically not PagerDuty. The current dispatch rule is: `is_active && org_id === event.org_id && alert_types.includes(event.kind)`. Adding a new event kind in code is a one-line edit to `ALERT_TYPES` in `channels.tsx`.

## [ADR-1004 Phase 2 Sprints 2.2 + 2.3 — privacy-notices dashboard + campaign view] — 2026-04-23

**ADR:** ADR-1004 — Statutory retention / material change / silent-failure
**Sprint:** Phase 2 Sprint 2.2 + Sprint 2.3

### Wireframes
- `docs/design/screen designs and ux/consentshield-notices.html` — both new panels with the canonical visual identity (navy/teal/amber palette, card layout matching `consentshield-screens.html`).

### Added (Sprint 2.2)
- `app/src/app/(dashboard)/dashboard/notices/page.tsx` — server component listing every published version with current-version badge + material/routine pill + affected-on-prior count + view-campaign + export-CSV per material row.
- `app/src/app/(dashboard)/dashboard/notices/publish-form.tsx` — client component (title + markdown textarea + material-change toggle gated by amber explainer).
- `app/src/app/(dashboard)/dashboard/notices/actions.ts` — `publishNoticeAction` server action over `publish_notice` RPC + `revalidatePath`.
- `app/src/app/(dashboard)/dashboard/notices/[id]/affected.csv/route.ts` — CSV streaming endpoint over `rpc_notice_affected_artefacts`; auth-gated, member-of-org-checked, RFC-4180 escaped.
- `app/src/components/dashboard-nav.tsx` — sidebar entry "Privacy Notices" → `/dashboard/notices`.

### Added (Sprint 2.3)
- `app/src/app/(dashboard)/dashboard/notices/[id]/campaign/page.tsx` — campaign view: 4 tone-coloured stat cards, progress bar, replaced-by chain sample, outreach CSV exports. Calls `refresh_reconsent_campaign` opportunistically per page load.
- `supabase/functions/process-consent-event/index.ts` — wires `mark_replaced_artefacts_for_event` into the post-INSERT step; failure is non-blocking (logs + nightly cron catches divergence).

### Tested
- [x] `cd app && bun run lint` — clean.
- [x] `cd app && bun run build` — clean. Both new routes (`/dashboard/notices` + `/dashboard/notices/[id]/campaign` + CSV endpoint) appear in the build output.
- [x] `cd app && bunx tsc --noEmit` — clean.
- [x] Replaced-by + reconsent_campaigns + RPC + cross-org fence + idempotency covered by `tests/integration/notices-replaced-by.test.ts` 7/7 PASS (see CHANGELOG-schema).
- [x] Edge function redeployed via `bunx supabase functions deploy process-consent-event`.

## [ADR-1005 Phase 6 Sprints 6.2 + 6.3 — Slack/Teams/Discord/PagerDuty/custom_webhook adapters] — 2026-04-23

**ADR:** ADR-1005 — Operations maturity (non-email notification channels)
**Sprint:** Phase 6 Sprint 6.2 + Sprint 6.3

### Added
- `app/src/lib/notifications/adapters/http.ts` — shared `postJson` helper with timeout / abort + outcome envelope; `isRetryableStatus` default mapping (5xx + 429).
- `app/src/lib/notifications/adapters/slack.ts` — Slack Incoming Webhook adapter; Block Kit (header + section + context) with severity-coloured attachment.
- `app/src/lib/notifications/adapters/teams.ts` — Microsoft Teams Workflows webhook adapter; Adaptive Card v1.5 in `message` envelope; severity → color enum.
- `app/src/lib/notifications/adapters/discord.ts` — Discord webhook adapter; single embed per event with severity color + structured fields + ISO timestamp.
- `app/src/lib/notifications/adapters/pagerduty.ts` — PagerDuty Events API v2 adapter; 32-char hex routing-key validation; `dedup_key` from `event.idempotency_key` (or synthesised); captures returned `dedup_key` as `external_id` for follow-up acknowledge/resolve events.
- `app/src/lib/notifications/adapters/custom-webhook.ts` — generic customer-hosted webhook adapter; canonical v1 envelope; `X-ConsentShield-Signature` HMAC-SHA256 over `${occurred_at}.${body}` with the per-channel `signing_secret` (≥ 32 chars); `X-ConsentShield-Timestamp` header for replay protection.
- `app/src/lib/notifications/adapters/index.ts` — barrel that registers all five real adapters with the singleton registry on import.

### Tested
- `app/tests/notifications/slack.test.ts` — 12 PASS.
- `app/tests/notifications/teams.test.ts` — 10 PASS.
- `app/tests/notifications/discord.test.ts` — 9 PASS.
- `app/tests/notifications/pagerduty.test.ts` — 11 PASS.
- `app/tests/notifications/custom-webhook.test.ts` — 9 PASS (includes byte-exact HMAC recompute against captured request bytes).
- `app/tests/notifications/slack-live.test.ts` — **LIVE delivery to operator's Slack workspace 2026-04-23**, ok=true, Block Kit rendered correctly in `#consentshield-alerts`.
- Total notifications-suite count 20 → 71 (+51).
- `cd app && bun run lint` — clean.
- `cd app && bun run build` — clean.
- `cd app && bunx tsc --noEmit` — clean.

### Deferred (per the 2026-04-22 channel-account decision)
- Teams live test — operator on Teams Free; M365 Business Basic provisioning tracked on `admin.ops_readiness_flags` row "Teams webhook — live integration test against M365 Business tenant".
- Discord live test — no workspace; tracked on `admin.ops_readiness_flags`.
- PagerDuty own-ops paging — replaced by WhatsApp Business Cloud API; tracked on `admin.ops_readiness_flags` row "Own-ops paging — WhatsApp Business Cloud API integration". Customer-facing PagerDuty *adapter* still ships.
- Sprint 6.4 (Dashboard UI + per-channel test-send + severity-routing matrix) is the next sprint and depends on these adapters.

## [ADR-1004 Phase 3 Sprint 3.2 — Compliance Health widget] — 2026-04-22

**ADR:** ADR-1004 — Statutory retention / material change / silent-failure detection
**Sprint:** Phase 3 Sprint 3.2

### Added
- `app/src/app/(dashboard)/dashboard/page.tsx` — new `<ComplianceHealthCard>` above the stat strip. Four live metrics: Coverage (DEPA coverage_score %), Orphan events (from Sprint 3.1 metric column), Overdue deletions (pending/failed `deletion_receipts` >24h; test_delete excluded), Upcoming expiries in 30d. Each metric is a drill-down `<Link>` to the relevant panel. Tone-coloured per metric; overall "healthy" only when coverage=100% + orphan=0 + overdue=0.
- `<HealthMetric>` + `<ComplianceHealthCard>` helper components co-located with the page.

### Deferred (follow-up sprint)
- Per-metric threshold-alert configuration UI (blocks on ADR-1005 Phase 6 Sprint 6.2/6.3 adapter landings).
- Standalone customer-docs explainer (covered for now by hint text on each card).

### Tested
- [x] `cd app && bun run lint` — PASS (one Date.now() usage annotated with the existing `react-hooks/purity` disable pattern).
- [x] `cd app && bun run build` — PASS.
- [x] `cd app && bunx tsc --noEmit` — PASS.

## [ADR-1005 Phase 6 Sprint 6.1 — NotificationAdapter interface + mock] — 2026-04-22

**ADR:** ADR-1005 — Operations maturity (non-email notification channels)
**Sprint:** Phase 6 Sprint 6.1

### Added
- `app/src/lib/notifications/adapters/types.ts` — `NotificationAdapter` interface, `NotificationEvent` common envelope, `NotificationChannel` row type, `DeliveryResult` discriminated union, `AdapterConfigError` + `UnknownAdapterError` classes. Channel types declared: `slack`, `teams`, `discord`, `pagerduty`, `custom_webhook`, `mock`.
- `app/src/lib/notifications/adapters/retry.ts` — `withRetry(attempt, config)` returning `RetryEnvelope { final, attempts[] }`. 3 attempts / 200ms-600ms backoff by default; stops immediately on non-retryable failures; injectable `sleep` for tests.
- `app/src/lib/notifications/adapters/registry.ts` — module-singleton adapter registry (`registerAdapter`, `unregisterAdapter`, `getAdapter`, `registeredTypes`, `resetRegistry`).
- `app/src/lib/notifications/adapters/mock.ts` — test-only mock adapter with an `calls` inbox + `setNextResult()` scripting queue.
- `app/src/lib/notifications/dispatch.ts` — `dispatchEvent(event, channels, options)` filters (active + org_id + alert_types) → retry-wrapped deliver → aggregate `DispatchReport`. Never throws on delivery failure; config errors fold into the report as non-retryable.

### Tested
- [x] `bunx vitest run tests/notifications/` — 20/20 PASS (retry 7, registry 5, dispatch 8) — PASS
- [x] `bun run lint` — 0 warnings — PASS
- [x] `bun run build` — no new routes; lib-only change compiles — PASS

### Deferred
- Sprint 6.2 Slack/Teams/Discord adapters — requires the registry entries + each channel's webhook-format implementation.
- Sprint 6.3 PagerDuty + custom_webhook adapters — requires PagerDuty routing key provisioning (tracked in `admin.ops_readiness_flags` via ADR-1017).
- Sprint 6.4 `/dashboard/settings/notifications` UI.

## [ADR-1004 Sprint 1.5 — Retention & Exemptions page] — 2026-04-22

**ADR:** ADR-1004 — Statutory retention + material-change re-consent
**Sprint:** Phase 1 Sprint 1.5

### Added
- `app/src/app/(dashboard)/dashboard/compliance/retention/page.tsx` — server component. Reads the caller's account role + latest 100 `retention_suppressions` + all applicable `regulatory_exemptions` (platform defaults + own overrides via RLS). Passes data to the client panel.
- `app/src/app/(dashboard)/dashboard/compliance/retention/retention-panel.tsx` — client component. Renders:
  - Suppression table (date · statute · artefact id · retained categories · citation) with a client-side statute filter dropdown.
  - Two exemption tables: "Your overrides" (highlighted blue) and "Platform defaults" — each row carries an amber "Pending legal review" badge when `reviewed_at IS NULL`, green "Reviewed · <firm>" badge otherwise.
  - Inline "Add override" form (sector / precedence / statute / statute_code / retention_period / data_categories / applies_to_purposes / source_citation / legal_review_notes) — gated to `account_owner`. Submits POST, refreshes the route on success.
- `app/src/components/dashboard-nav.tsx` — new nav entry "Retention & Exemptions" between "Data Inventory" and "Sector template".

### Tested
- [x] `bun run lint` — 0 warnings, 0 errors — PASS
- [x] `bun run build` — page + API route both present in the manifest (`ƒ /dashboard/compliance/retention`, `ƒ /api/orgs/[orgId]/regulatory-exemptions`) — PASS
- [x] RLS override visibility + account_owner gate — covered by existing `tests/integration/retention-exemptions.test.ts` (11/11 PASS from Sprint 1.1). The page + API are thin layers over the same SQL path.

## [ADR-1018 Sprints 1.2 + 1.3 — status page admin + public] — 2026-04-22

**ADR:** ADR-1018 — Self-hosted status page
**Sprints:** 1.2 admin panel · 1.3 public read-only page

### Added
- `admin/src/app/(operator)/status/page.tsx` — server component listing subsystems + open + resolved incidents; passes `adminRole` for write-gating.
- `admin/src/app/(operator)/status/actions.ts` — 4 server actions wrapping the admin status RPCs.
- `admin/src/components/status/status-panel.tsx` — subsystem cards with inline state-flip buttons; "Post incident" modal (title / description / severity / affected subsystems); incident cards with progress + resolve + postmortem-URL input; resolved-incidents collapsible.
- `admin/src/app/(operator)/layout.tsx` — new sidebar entry "Status Page" → `/status`.
- `app/src/app/(public)/status/page.tsx` — unauthenticated public read-only status page. 60s edge cache. Renders overall banner (green/amber/red/blue with aria-live), per-subsystem state dots + labels, open-incidents section, 90-day resolved-incidents collapsible. No cookies, no analytics.

### Tested
- [x] `bunx tsc --noEmit` clean on both admin + app workspaces.
- [x] Both `bun run build` commands succeed.
- [x] `/status` route is not in `app/src/proxy.ts` matcher → no auth gate. Reads Supabase via anon key with anon-SELECT RLS policies.

## [ADR-1017 Sprint 1.2 — Ops Readiness admin panel] — 2026-04-22

**ADR:** ADR-1017 — Admin ops-readiness alerts
**Sprint:** 1.2 admin UI

### Added
- `admin/src/app/(operator)/readiness/page.tsx` — server component reading `admin.list_ops_readiness_flags()`. Header chip shows "N open" + "N high/critical". Reads `app_metadata.admin_role` and passes to the list for write-gating.
- `admin/src/app/(operator)/readiness/actions.ts` — `setFlagStatusAction({ flagId, status, resolutionNotes? })` wrapping the RPC. `revalidatePath('/readiness')` on success.
- `admin/src/components/readiness/readiness-list.tsx` — client component with per-flag cards, severity + status chips, action buttons (Mark in progress / Resolve / Defer / Reopen). Actions visible only for `platform_operator` or `platform_operator` roles; others see a read-only notice.
- `admin/src/app/(operator)/layout.tsx` — new sidebar entry "Ops Readiness" → `/readiness` under ADR-1017.

### Tested
- [x] `bunx tsc --noEmit` clean on admin workspace.
- [x] `bun run build` — /readiness route builds into the admin app output.

## [ADR-0058 Sprint 1.5 close-out — resend-link form on /onboarding] — 2026-04-21

**ADR:** ADR-0058 — Split-flow customer onboarding (Sprint 1.5 deferred item closed)

### Added
- `app/src/app/(public)/onboarding/_components/resend-link-form.tsx` — client island. Email input + "Resend" button + generic "if a pending invitation exists for {email}, we've sent it again" outcome shell. Rate-limit and network errors surface inline; success always shown regardless of branch (endpoint-side existence-leak parity).

### Changed
- `app/src/app/(public)/onboarding/page.tsx`:
  - `NoTokenShell` — replaced the trailing "write to hello@consentshield.in" paragraph with `<ResendLinkForm />`. Users land here when they click an email-less URL (bookmark, manual navigation); resending the actual setup link is better UX than mailto.
  - `InvalidShell` — for `not_found` and `expired` reasons, renders `<ResendLinkForm />` in place of the "Request a new link" mailto. `already_accepted` keeps its `/login` CTA unchanged (resend doesn't help a consumed invite).

### Tested
- [x] `cd app && bun run build / lint` — clean.

## [ADR-0058 follow-up — onboarding Step 5 + email-first /signup polish] — 2026-04-21

**ADR:** ADR-0058 (follow-up)

### Changed
- `app/src/app/(public)/onboarding/_components/step-5-deploy.tsx` — `res.json()` replaced with `res.text()` + `JSON.parse` so empty-body 500s surface as readable error strings instead of a runtime syntax error. Network failures in `fetch()` now caught explicitly.
- `app/src/app/(public)/onboarding/_components/step-7-first-consent.tsx` — HTML entity `&rsquo;` (rendered verbatim in JSX string literals) replaced with the Unicode right-single-quote character. Fixes "No consent yet — that&rsquo;s fine" → "No consent yet — that's fine" on the timeout screen.
- `app/src/app/(public)/signup/page.tsx` — no-token state replaced with an email lookup form: user enters email → `/api/public/lookup-invitation` → client routes to `/signup?invite=<token>` (operator invite) or `/onboarding?token=<token>` (intake), or shows "We couldn't find an invitation for that email" with a retry button.
- `app/src/app/(public)/login/page.tsx` — dropped the operator-session-cleared amber banner; subtitle clarified for existing customers.
- `marketing/src/components/sections/signup-form.tsx` — explicit Turnstile render (vs. auto-scan) that survives site-key changes + dev hot-reloads. Token held in React state via the widget's `callback`; `error-callback` / `expired-callback` / `timeout-callback` clear it. Submit is guarded: if the widget hasn't resolved, user sees "Security challenge hasn't loaded yet" instead of a server-side "Missing Turnstile token".

### Tested
- [x] Build + lint clean on app/ and marketing/.
- [x] End-to-end onboarding verified (2026-04-21): marketing signup → email → wizard → dashboard handoff.

## [ADR-0058 Sprint 1.5] — 2026-04-21

**ADR:** ADR-0058 — Split-flow customer onboarding
**Sprint:** Sprint 1.5 — Admin operator-intake + polish

### Added
- `admin/src/app/(operator)/accounts/new-intake/page.tsx` — server page. Loads active plans sorted cheap → expensive. Renders `<NewIntakeForm>` and a sales-routing blurb.
- `admin/src/app/(operator)/accounts/new-intake/form.tsx` — client form. Email (required, autofocus) + plan select (populated from page server data) + optional default org name. Submits through `createOperatorIntakeAction`; on success clears the fields and shows the invite id.
- `admin/src/app/(operator)/accounts/actions.ts::createOperatorIntakeAction` — `supabase.schema('admin').rpc('create_operator_intake', ...)`. Returns `{id, token}` on success; raw RPC errors (bad plan code, Rule-12 conflict, ADR-0047 single-account conflict) relayed verbatim so the operator knows what to fix.
- `app/src/app/(public)/onboarding/_components/plan-swap.tsx` — wizard-header widget (visible Steps 2–6 when `orgId` is set). Opens a modal with Starter / Growth / Pro cards; "Current" pill on the active one. Per-card "Switch" calls `swapPlan` server action. Enterprise routed to `hello@consentshield.in`. Modal uses `role="dialog"`, `aria-modal`, `aria-labelledby`; click-outside and ✕ both dismiss.
- `app/src/app/(public)/onboarding/actions.ts::swapPlan`, `::logStepCompletion` — server-action wrappers over `swap_intake_plan` and `log_onboarding_step_event`.
- `app/src/components/welcome-toast.tsx` — one-time toast on `?welcome=1`. Strips the query param on mount so a refresh doesn't replay. Auto-dismisses after 8 s. `role="status"` + `aria-live="polite"`; keyboard-dismissable.

### Changed
- `app/src/app/(dashboard)/layout.tsx` — mounts `<WelcomeToast />` inside a `<Suspense>` boundary (required for client components that read search params under Next.js 16).
- `app/src/app/(public)/onboarding/_components/onboarding-wizard.tsx` — extended `WizardState` with `planCode`; renders `<PlanSwap>` above the step indicator from Step 2 onward; tracks step-enter timestamp via `useRef` + `useEffect(step)` and fires `logStepCompletion` on every successful advance. Plan swap updates the in-memory `planCode` without reloading.
- `admin/src/app/(operator)/accounts/page.tsx` — header now carries an "Invite new account" button linking to `/accounts/new-intake`.
- `admin/src/app/(operator)/billing/disputes/[disputeId]/page.tsx` — one-line `Date.now()` → `new Date().getTime()` to satisfy the Next.js-16 `react-hooks/purity` rule (pre-existing; surfaced when the wizard work re-ran `bun run lint`).

### Tested
- [x] `cd app && bun run build` — PASS.
- [x] `cd app && bun run lint` — 0 errors, 0 warnings.
- [x] `cd admin && bun run build` — PASS; `/accounts/new-intake` listed.
- [x] `cd admin && bun run lint` — 0 errors, 0 warnings.
- [ ] Manual dev-server click-through — operator playtest next session.

## [ADR-0058 Sprint 1.4] — 2026-04-21

**ADR:** ADR-0058 — Split-flow customer onboarding
**Sprint:** Sprint 1.4 — Steps 5–7 (deploy + scores + first-consent watch)

### Added
- `app/src/app/(public)/onboarding/_components/step-5-deploy.tsx` — Step 5 client island. URL capture → `POST /api/orgs/<org>/properties` → snippet display + copy button → Verify button. Pre-loads the first existing `web_property` for the org so a wizard refresh mid-flow resumes cleanly. "I'll do this later →" advances without verify (unverified properties remain writable from Settings → Properties).
- `app/src/app/(public)/onboarding/_components/step-6-scores.tsx` — Step 6 client island. Fetches `/api/orgs/<org>/depa-score` (cache-first with RPC fallback per ADR-0025). Renders: total gauge with 75/50 colour thresholds + 4 dimension tiles (coverage / expiry / freshness / revocation) + Top-3 actions (lowest-scoring three dimensions mapped to canned recommendations).
- `app/src/app/(public)/onboarding/_components/step-7-first-consent.tsx` — Step 7 client island. 5-second poll loop with 5-minute client-side timeout. On first-consent event: displays the captured timestamp + finalises via `set_onboarding_step(7)` (which stamps `onboarded_at`) + redirects to `/dashboard?welcome=1`. On timeout: identical finalise path but with "no consent yet — that's fine" copy. Manual "Skip the wait →" escape hatch.

### Changed
- `app/src/app/(public)/onboarding/_components/onboarding-wizard.tsx` — wires in `<Step5Deploy>`, `<Step6Scores>`, `<Step7FirstConsent>`. Removed the Sprint 1.3 `<ComingSoonShell>` placeholder. Step 7 redirects to `/dashboard?welcome=1` on `onDone`.

### Tested
- [x] `cd app && bun run build` — PASS.
- [x] `cd app && bun run lint` — 0 errors, 0 warnings.

## [ADR-0058 Sprint 1.3] — 2026-04-21

**ADR:** ADR-0058 — Split-flow customer onboarding
**Sprint:** Sprint 1.3 — Wizard shell + Steps 1–4

### Added
- `app/src/app/(public)/onboarding/page.tsx` — server component entry; reads `?token=`, calls `invitation_preview`, branches on state: fresh-token → render `<OnboardingWizard mode="fresh">`; authed-user-with-pending-org → render `<OnboardingWizard mode="resume">` at the last-completed step (acceptance criterion: refresh restores progress); no-token unauthed / invalid / expired / already-accepted / already-onboarded each render a distinct recovery shell.
- `app/src/app/(public)/onboarding/layout.tsx` — top chrome (ConsentShield wordmark + "Onboarding" pill + "Need help?" mail link).
- `app/src/app/(public)/onboarding/_components/wizard-types.ts` — `InvitePreview`, `ResumeContext`, `Industry` whitelist, `WIZARD_LABELS`.
- `app/src/app/(public)/onboarding/_components/step-indicator.tsx` — 7-dot progress bar (done/current/upcoming) with `aria-current="step"`.
- `app/src/app/(public)/onboarding/_components/onboarding-wizard.tsx` — client orchestrator. Holds wizard state; renders the active step component; post-Step-4 shows a `<ComingSoonShell>` that links to `/dashboard` (Sprints 1.4 + 1.5 will populate Steps 5–7).
- `app/src/app/(public)/onboarding/_components/step-1-welcome.tsx` — `signInWithOtp` (email from `invitation_preview.invited_email`) → OTP → `verifyOtp` → `accept_invitation` → `supabase.auth.refreshSession()`. The refresh is load-bearing: `apply_sectoral_template` in Step 4 reads `current_org_id()` from the JWT claim injected by the `custom_access_token_hook`, and the hook only fires on token issuance.
- `app/src/app/(public)/onboarding/_components/step-2-company.tsx` — industry select (8 whitelisted values) + read-only org name. Calls `update_org_industry` then `set_onboarding_step(2)`.
- `app/src/app/(public)/onboarding/_components/step-3-data-inventory.tsx` — 3 yes/no toggles (email / payments / analytics). Calls `seed_quick_data_inventory` then `set_onboarding_step(3)`.
- `app/src/app/(public)/onboarding/_components/step-4-purposes.tsx` — loads `list_sectoral_templates_for_sector(industry)` on mount; card grid with per-row "Use this template" CTA; "Skip for now" fallback. Calls `apply_sectoral_template` then `set_onboarding_step(4)`.
- `app/src/app/(public)/onboarding/actions.ts` — server-action wrappers over the 5 RPCs (`set_onboarding_step`, `update_org_industry`, `seed_quick_data_inventory`, `apply_sectoral_template`, `list_sectoral_templates_for_sector`). Tagged-union `{ok, data | error}` results.

### Changed
- `app/src/proxy.ts` — matcher extended with `/onboarding` + `/onboarding/:path*`. Rule 12 enforcement (admin-identity 403 redirect to admin origin) now covers the onboarding surface.

### Tested
- [x] `cd app && bun run build` — PASS; 48 routes; `/onboarding` dynamic route present.
- [x] `cd app && bun run lint` — 0 errors, 0 warnings.
- [ ] Manual dev-server click-through — deferred to Sprint 1.5 polish, where operator-intake lands and both flows can be validated in one pass.

## [ADR-0056 Sprint 1.2] — 2026-04-21

**ADR:** ADR-0056 — Per-account feature-flag targeting
**Sprint:** Sprint 1.2 — Admin UI account picker for feature flags

### Added
- `admin/src/components/flags/feature-flags-tab.tsx` — `ScopePill` (global/account/org colour-coded); `Target` column renders account name for account-scoped rows; scope select widened to `'global' | 'account' | 'org'`; conditional Account picker mirrors the Organisation picker in `FlagFormModal`; `DeleteFlagModal` subtitle shows account name for account-scoped rows.
- `admin/src/app/(operator)/flags/page.tsx` — fetches `public.accounts (id, name)` alongside organisations; builds `accountById` lookup; `account_id` + `account_name` populated on every flag row; passes `accounts` down to `FlagsTabs`.

### Changed
- `admin/src/components/flags/flags-tabs.tsx` — `accounts` prop forwarded to `FeatureFlagsTab`.
- `admin/src/app/(operator)/flags/actions.ts` — Sprint 1.1 already accepted `accountId`; UI now forwards a real value (was `null`) when scope = `account`; delete forwards `flag.account_id`.

### Tested
- [x] `cd admin && bun run build` — PASS (47 routes; `/flags` compiles clean).
- [x] Sprint 1.1 behavioural coverage (`tests/billing/account-feature-flags.test.ts`, 9/9 PASS) still valid — UI is a thin wrapper over the same RPCs, no new server-side paths introduced.

## [ADR-1001 Sprint 2.4] — 2026-04-20

**ADR:** ADR-1001 — Truth in marketing and public API foundation
**Sprint:** Sprint 2.4 — Rate limiter + request logging + usage dashboard + OpenAPI stub

### Added
- `app/src/app/(dashboard)/dashboard/settings/api-keys/[id]/usage/page.tsx` — key usage page: 3 summary cards (7d total, p50/p95 today), SVG bar chart (7 days, server-rendered, no new deps), day-by-day table with request count + p50/p95 latency. Fetches via `rpc_api_key_usage`.
- `app/public/openapi.yaml` — OpenAPI 3.1 stub with `bearerAuth` security scheme, `/_ping` endpoint, 401/410/429 response definitions.
- `app/src/lib/api/rate-limits.ts` — Static tier→limits map (`perHour`, `burst`) mirroring `public.plans.api_rate_limit_per_hour`.
- `app/src/lib/api/log-request.ts` — `logApiRequest` fire-and-forget helper; inserts via `rpc_api_request_log_insert` (service-role client).
- `supabase/migrations/20260601000001_api_request_log.sql` — Adds `api_rate_limit_per_hour` + `api_burst` to `public.plans`; `rpc_api_request_log_insert` (service_role); `rpc_api_key_usage` (authenticated).

### Changed
- `app/src/proxy.ts` — After Bearer verification: rate-check via `checkRateLimit(api_key:<key_id>, perHour, 60min)`; returns 429 with `Retry-After` + `X-RateLimit-Limit` when limit exceeded; injects `x-cs-t` (epoch ms) for route-level latency tracking.
- `app/src/lib/api/context.ts` — Added `requestStart: 'x-cs-t'` to `API_HDR`.
- `app/src/app/api/v1/_ping/route.ts` — Reads `x-cs-t` to compute latency; calls `logApiRequest` on every request.

### Tested
- [x] `cd app && bun run build` — PASS
- [x] `bun run lint` — PASS (0 errors, 0 warnings)
- [x] Migration `20260601000001_api_request_log.sql` applied — PASS
- [ ] Burst test + audit log verification: pending manual run.

## [ADR-1001 Sprint 2.3] — 2026-04-20

**ADR:** ADR-1001 — Truth in marketing and public API foundation
**Sprint:** Sprint 2.3 — Dashboard UI for API key management

### Added
- `app/src/app/(dashboard)/dashboard/settings/api-keys/page.tsx` — server page; fetches account role, org, account's API keys, and plan_code; renders locked card for non-owners.
- `app/src/app/(dashboard)/dashboard/settings/api-keys/api-keys-panel.tsx` — client component with full key management UI: active/revoked table, empty state, create modal (name + scope multiselect + rate_tier read-only), plaintext-reveal modal (shown once, dismiss requires checkbox), rotate modal (dual-window notice in row while `previous_key_expires_at` is in future), revoke confirmation modal.
- `app/src/app/(dashboard)/dashboard/settings/api-keys/actions.ts` — `createApiKey`, `rotateApiKey`, `revokeApiKey` server actions; each revalidates the page on success.
- Nav entry: `API keys` added to `app/src/components/dashboard-nav.tsx`.

### Tested
- [x] `cd app && bun run build` — PASS; `/dashboard/settings/api-keys` in route manifest.
- [x] `bun run lint` — PASS (0 errors, 0 warnings).
- [ ] Manual flow: mint → copy → `/v1/_ping` → 200 (pending dev server run).

## [ADR-0050 Sprint 2.3] — 2026-04-19

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.3 — account detail invoice UI + landing last-invoice column

### Changed
- `admin/src/app/(operator)/billing/[accountId]/page.tsx`:
  - "Balance" card: Sprint 1 stub ("always zero until Sprint 2") replaced with real `outstanding_balance_paise` sourced from `admin.billing_account_summary` (sum of `total_paise` across invoices in status `issued` / `partially_paid` / `overdue`).
  - "Latest invoice" card: stub replaced with the newest-issue-date invoice — number, FY, issue/due dates, subtotal + CGST+SGST (intra-state) or IGST (inter-state), total, and a Download link to `/api/admin/billing/invoices/[invoiceId]/download` when the PDF is present.
  - New "Invoice history" card: full scope-gated list (up to 50 rows) via `admin.billing_invoice_list`. Retired-issuer rows visible only to platform_owner and badged `retired`. Each row links to the download endpoint.
  - New `InvoiceStatusPill` component alongside `StatusPill` / `SourcePill` / `RefundStatusPill`.
- `admin/src/app/(operator)/billing/page.tsx`:
  - Landing "Last invoice" column: Sprint 1 stub ("pipeline ships in ADR-0050 Sprint 2") replaced with real data via `admin.billing_accounts_invoice_snapshot`. Shows an `InvoiceSnapshotPill` (status-coloured) plus the invoice number; the whole cell links to the account's billing detail.

### Tested
- [x] Admin `bun run build` — compiles; `/api/admin/billing/invoices/[invoiceId]/download` in the route manifest; `/billing` and `/billing/[accountId]` render with new sections.
- [x] Admin `bun run lint` — clean.

## [ADR-0050 Sprint 2.1 — chunk 3] — 2026-04-18

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.1 — Razorpay webhook handler refactor (verbatim preservation)

### Changed
- `app/src/app/api/webhooks/razorpay/route.ts` — calls `public.rpc_razorpay_webhook_insert_verbatim` immediately after signature verification (before any state mutation), persisting every verified Razorpay webhook to `billing.razorpay_webhook_events`. Calls `public.rpc_razorpay_webhook_stamp_processed` on every terminal path (`not_handled`, `no_subscription_entity`, `duplicate_dropped`, `rpc_error:…`, `unresolved_org:…`, `ok`) so each row has a `processed_outcome` matching the handler's final response. Existing ADR-0034 subscription-state handling preserved verbatim; unhandled event types still persist (outcome `not_handled`) so `dispute.*` and `invoice.*` are captured ahead of the chunks that act on them.

### Tested
- [x] Customer app `bun run build` + `bun run lint` clean.
- [x] End-to-end handler behaviour under the existing integration test (unchanged); verbatim-insert + stamp paths covered by `tests/admin/razorpay-verbatim.test.ts` (6/6 PASS).

## [ADR-0050 Sprint 2.1 — chunk 2] — 2026-04-18

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.1 — Issuer entities admin UI

### Added
- `admin/src/app/(operator)/billing/issuers/page.tsx` — list (platform_operator+ read); status pill per row; "+ New issuer" enabled only for platform_owner; warning card when no issuer is active.
- `admin/src/app/(operator)/billing/issuers/new/page.tsx` + `new/form.tsx` — create form; identity fields flagged as "immutable once saved"; operational fields flagged "editable later"; 403 fallback for non-owner.
- `admin/src/app/(operator)/billing/issuers/[issuerId]/page.tsx` + `[issuerId]/client.tsx` — detail + inline edit form for operational fields; lifecycle card; `Activate` / `Retire` / `Hard delete` buttons with owner-gated tooltips. Retire / Delete modals require reason and surface RPC errors verbatim.
- `admin/src/app/(operator)/billing/issuers/actions.ts` — server actions: `createIssuerAction`, `updateIssuerAction`, `activateIssuerAction`, `retireIssuerAction`, `hardDeleteIssuerAction`.

### Changed
- `admin/src/app/(operator)/layout.tsx` — new `Issuer Entities` nav entry (`/billing/issuers`, ADR-0050) added after `Billing Operations`.

### Tested
- [x] `bun run build` on `admin/` — compiles; `/billing/issuers`, `/billing/issuers/new`, `/billing/issuers/[issuerId]` in route manifest.
- [x] `bun run lint` on `admin/` — clean.
- [x] RPC behaviour coverage lives in `tests/admin/billing-issuer-rpcs.test.ts` (21/21 PASS); manual UI verification pending.

## [ADR-0050 Sprint 2.1 — chunk 1] — 2026-04-18

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.1 — platform_owner tier UI alignment

### Added
- `admin/src/lib/admin/role-tiers.ts` — `AdminRole` type + `canOperate()` + `canSupport()` helpers. Mirrors the Postgres `admin.require_admin` tier hierarchy so UI gating reads the same way the DB gate does.

### Changed
- Eleven admin-console sites switched from inline `adminRole === 'platform_operator'` (and variants) to `canOperate(adminRole)` / `canSupport(adminRole)`: `admin/src/app/(operator)/billing/operations/page.tsx`, `security/page.tsx`, `templates/[templateId]/page.tsx`, `accounts/[accountId]/page.tsx`, `admins/page.tsx`, `connectors/[connectorId]/page.tsx`, `support/[ticketId]/page.tsx`, `orgs/[orgId]/page.tsx`, `orgs/[orgId]/members-section.tsx`, `components/flags/feature-flags-tab.tsx`, `components/flags/kill-switches-tab.tsx`, `components/orgs/action-bar.tsx`. Without this change a `platform_owner` user would silently lose UI action buttons even though their RPCs succeed.

### Tested
- [x] `bun run build` on `admin/` — compiles with all routes intact.
- [x] `bun run lint` on `admin/` — clean.

## [ADR-0050 Sprint 1] — 2026-04-18

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 1 — Account-shaped `/billing` panel

### Added
- `admin/src/app/(operator)/billing/page.tsx` — new account-indexed landing. Reuses `admin.accounts_list`; shows N-with-payment-failures pill linking to operations; stub "Last invoice" column pending Sprint 2.
- `admin/src/app/(operator)/billing/[accountId]/page.tsx` — per-account detail. Composes `admin.account_detail` (ADR-0048), the new `admin.billing_account_summary`, and `admin.billing_refunds_list` (filtered client-side to the account). Renders Subscription / Razorpay / Balance cards, Latest-invoice stub, Plan history timeline, Active adjustments, Refunds table.

### Changed
- `admin/src/app/(operator)/billing/operations/page.tsx` + `billing-tabs.tsx` + `actions.ts` — existing ADR-0034 four-tab Billing Operations panel relocated verbatim from `/billing` to `/billing/operations`. `suspendAccountAction` import updated to `../../accounts/actions`. `revalidatePath('/billing')` calls now use `'layout'` scope so the landing + operations sub-route refresh together.
- `admin/src/app/(operator)/layout.tsx` — nav item split: `Billing` (`/billing`, ADR-0050) + `Billing Operations` (`/billing/operations`, ADR-0034).

### Tested
- [x] Admin build compiles; `/billing`, `/billing/[accountId]`, `/billing/operations` present in the route manifest — PASS.
- [x] `bun run lint` clean on `admin/` — PASS.
- [x] `tests/admin/billing-account-view.test.ts` 3/3 PASS: base plan-history event present for a fresh account; missing-account raises; grant + revoke produce two distinct events sharing `adjustment_id` with opposite `action` values; `effective_plan_code` tracks grant/revoke correctly.

## [ADR-0049 Phase 2.2] — 2026-04-18

**ADR:** ADR-0049 — Security observability ingestion

### Changed
- `admin/src/app/(operator)/security/security-tabs.tsx` — `SentryTab` rewritten from link-out-only to inline table (Received · Project · Level (tone-coded) · Title + culprit · Users · per-row "Open ↗"). Project-wide triage links retained in the Card action. `SecurityData.sentryEvents` interface added; `LevelPill` helper added. RateLimitTab "ingestion pending" banner dropped.
- `admin/src/app/(operator)/security/page.tsx` — fetches `admin.security_sentry_events_list` in Promise.all.

## [ADR-0048 Sprint 1.2] — 2026-04-18

**ADR:** ADR-0048 — Admin Accounts panel

### Added
- `admin/src/app/(operator)/accounts/page.tsx` — list with filter bar (status / plan / name-search).
- `admin/src/app/(operator)/accounts/[accountId]/page.tsx` + `action-bar.tsx` — detail envelope (plan, billing identity, lifecycle, orgs, active adjustments, recent audit) + Suspend/Restore modals gated on platform_operator.
- `admin/src/app/(operator)/accounts/actions.ts` — `suspendAccountAction` / `restoreAccountAction`.
- Nav: `Accounts` between `Organisations` and `Support Tickets`.

### Changed
- `admin/src/app/(operator)/billing/billing-tabs.tsx` — Adjustment modal UUID textbox replaced with select populated via `admin.accounts_list`. Payment Failures tab gains a `Suspend` button (platform_operator + retries ≥ 3).
- `admin/src/app/(operator)/billing/page.tsx` — fetches `accounts_list` at page render.

## [ADR-0046 Phase 1.2] — 2026-04-18

**ADR:** ADR-0046 — Significant Data Fiduciary foundation

### Added
- `admin/src/app/(operator)/orgs/[orgId]/sdf-card.tsx` — client card + edit modal. Tone-coded status pill; notification fields disabled when status is `not_designated`; amber note warns revert clears metadata.
- `admin/src/app/(operator)/orgs/[orgId]/actions.ts` — `setSdfStatus` Server Action wrapping `admin.set_sdf_status`.
- SDF card slotted into the org detail page before the Contacts card.
- `app/src/app/(dashboard)/dashboard/page.tsx` — `SdfObligationsCard` renders only when `sdf_status != 'not_designated'`. Lists DPDP §10 obligations with tone-coded styling + notification metadata + Phase 2+ pointer.

## [ADR-0045 Sprint 2.1] — 2026-04-18

**ADR:** ADR-0045 — Admin user lifecycle

### Added
- `admin/src/app/(operator)/admins/page.tsx` + `admin-list.tsx` + `actions.ts` — list with Invite / Change-role / Disable modals. Service-readiness banner when `SUPABASE_SERVICE_ROLE_KEY` absent. Self-row + disabled-row actions disabled in UI.
- Nav: `Admin Users` between `Feature Flags` and `Audit Log`.

## [ADR-0034 Sprints 2.1 + 2.2] — 2026-04-18

**ADR:** ADR-0034 — Billing Operations

### Added
- `admin/src/app/(operator)/billing/page.tsx` + `billing-tabs.tsx` — four tabs (Payment failures · Refunds · Comp accounts · Plan overrides), 30s auto-refresh, three modals (Refund · Adjustment · Revoke). ₹-denominated amount input (converted to paise server-side).
- Refund modal result screen (green issued / red failed / amber pending) after Razorpay round-trip.
- Payment Failures `Retry at Razorpay ↗` link-out (Razorpay handles subscription retries automatically).
- Nav: `Billing Operations` live.

## ADR-0047 Sprint 1.2 — 2026-04-18

**ADR:** ADR-0047 — Customer membership lifecycle
**Sprint:** Phase 1, Sprint 1.2 — UI wiring

### Added
- `app/src/app/(dashboard)/dashboard/settings/members/member-row-actions.tsx` — per-row role dropdown + Apply + Remove controls. Self-row + last-account_owner disable client-side. Reason collected via `window.prompt` (min 10 chars; matches RPC gate).
- `app/src/app/(dashboard)/dashboard/settings/members/actions.ts` — `changeMembershipRole`, `removeMembership` Server Actions wrapping the public RPCs.
- `admin/src/app/(operator)/orgs/[orgId]/members-section.tsx` — admin mirror: org members list + per-row controls. Read-only for support/read_only admins; full controls for platform_operator.
- `admin/src/app/(operator)/orgs/[orgId]/actions.ts` — `changeMembershipRole`, `removeMembership` on the admin side (admin-JWT bypass fires in the RPC).

### Changed
- `app/src/app/(dashboard)/dashboard/settings/members/page.tsx` — new "Actions" column; `canManageRow` helper.
- `admin/src/app/(operator)/orgs/[orgId]/page.tsx` — fetches `list_members()` (admin-JWT returns platform-wide) and renders the new `AdminMembersSection` between the summary cards and the notes row.

### Tested
- `cd app && bun run build && bun run lint` — green, zero warnings.
- `cd admin && bun run build && bun run lint` — green, zero warnings.
- `bun run test:rls` — 243/243 (Sprint 1.1 RPC suite still validates the now-wired UI).

## ADR-0044 Phase 2.5 — 2026-04-18

**ADR:** ADR-0044 v2 — Customer RBAC
**Sprint:** Phase 2.5 — dispatch pills + template

### Changed
- `admin/src/components/orgs/invite-created-card.tsx` — amber "email dispatch pending — Phase 2.5" pill replaced with a green "email queued via Resend" pill now that dispatch is wired.
- `app/src/app/(dashboard)/dashboard/settings/members/invite-form.tsx` — success card reworded to "Email has been queued via Resend — if it doesn't arrive, share the URL above manually."

## ADR-0044 Phase 2.4 — 2026-04-18

**ADR:** ADR-0044 v2 — Customer RBAC
**Sprint:** Phase 2.4 — customer-side member management

### Added
- `app/src/app/(dashboard)/dashboard/settings/members/page.tsx` + `invite-form.tsx` + `revoke-button.tsx` + `actions.ts` — Server Component lists current members (account-tier + current-org-tier) and pending invitations; client form creates invites with a role picker scoped to caller's effective role. Revoke button calls `public.revoke_invitation`.
- Nav entry `Team & invites` in `app/src/components/dashboard-nav.tsx`.

### Changed
- `docs/design/screen designs and ux/consentshield-screens.html` — Team members subsection added to the Settings panel (current-members table, pending-invitations table with Revoke buttons, invite form with role picker + org selector + expiry).

### Notes
- Role-scoped role picker: `account_owner` sees all 5 roles (`account_owner`, `account_viewer`, `org_admin`, `admin`, `viewer`); `org_admin` (effective) sees only `admin` + `viewer` for their current org. Users with neither role see a "no permission" card.
- Copy-to-clipboard accept URL on success. Email dispatch is still Phase 2.5 — the success card carries an inline reminder.

## ADR-0044 Phase 2.3 — 2026-04-18

**ADR:** ADR-0044 v2 — Customer RBAC
**Sprint:** Phase 2.3 — operator invite forms (admin console)

### Added
- `admin/src/app/(operator)/orgs/new-invite/page.tsx` + `new-account-invite-form.tsx` + `actions.ts` — top-level operator form that creates an **account-creating** invite (`role='account_owner'`, `account_id=null`, `org_id=null`). Inputs: invitee email, plan (from `public.plans`), trial-days override, optional default org name, expiry (1–90 days, default 14). On submit, shows accept URL + invitation id + expiry; "Create another" resets the form. Gate is the `create_invitation` RPC's `is_admin` check, fronted by `admin/src/proxy.ts` Rule 21.
- `admin/src/app/(operator)/orgs/[orgId]/new-invite/page.tsx` + `org-admin-invite-form.tsx` + `actions.ts` — org-scoped operator form that creates an **org_admin promotion** invite (`role='org_admin'`, `account_id` + `org_id` from URL). Role is fixed to `org_admin` in the UI; admin / viewer invites live in the customer dashboard.
- `admin/src/components/orgs/invite-created-card.tsx` — shared success card with clipboard-copy of the accept URL + invitation id + expiry. Surfaces an amber "email dispatch pending — Phase 2.5" pill so operators know they still have to send the link by hand until the Resend wiring ships.
- `admin/src/app/(operator)/orgs/page.tsx` — header now has a `+ New account invite` link.
- `admin/src/components/orgs/action-bar.tsx` — org detail action bar now has a `+ Invite org admin` link.

### Changed
- `docs/admin/design/consentshield-admin-screens.html` — added panels `2a` (New account invite) and `2b` (Invite org admin) wireframes, plus the two trigger buttons. Spec-first discipline per ADR-0044 alignment.

### Tested
- [x] `cd admin && bun run lint` — zero warnings.
- [x] `cd admin && bun run build` — 29 routes (up from 27 after Phase 2.1+2.2). Zero errors.
- [x] `cd admin && bun run test` — 1/1 smoke.
- [x] `bun run test:rls` — 194/194 across 17 files (no change — RPC behavior tested under `tests/rbac/invitations.test.ts` from Phase 2.1 covers the RPC; the admin-side wrappers only add URL building + input validation).

### Notes
- `NEXT_PUBLIC_APP_URL` is the new env var the accept-URL builder reads. Falls back to `NEXT_PUBLIC_CUSTOMER_APP_URL`, then hard-coded `https://app.consentshield.in`. Wire for dev before clicking "Copy".
- Pre-existing customer-app lint errors in `signup/page.tsx` and `dashboard/page.tsx` (react-compiler warnings surfaced by the upgrade landed in 2.2) are untouched by this sprint.

## ADR-0044 Phase 2.2 — 2026-04-18

**ADR:** ADR-0044 v2 — Customer RBAC
**Sprint:** Phase 2.2 — invite-gated /signup

### Changed
- `app/src/app/(public)/signup/page.tsx` — walk-up signup removed. The page now requires `?invite=<token>`; hitting it without a token shows a "contact hello@consentshield.in" message. With a token, it previews the invite via `public.invitation_preview`, forces the email field to match the invited address, sends OTP on submit, and on verify calls `public.accept_invitation` which branches by invite shape (account-creating, account-member, or org-member). Successful accept redirects to /dashboard.
- Invite preview UX — summarises the invitee's incoming role ("creating a new ConsentShield account", "joining as an organisation admin", etc.) with plan + default-org-name when applicable.
- `rpc_signup_bootstrap_org` (legacy walk-up path in `/auth/callback`) unchanged — kept as a fallback for any signup that still arrives with `user_metadata.org_name` but no invite.

## ADR-0033 Sprints 1.2 + 2.2 — 2026-04-17

**ADR:** ADR-0033 — Admin Ops + Security (Pipeline Operations + Abuse & Security panels)
**Sprints:** 1.2 (Pipeline UI) + 2.2 (Security UI). Sprint 2.3 (Worker enforcement + smoke-tests) deferred to next session.

### Added
- `admin/src/app/(operator)/pipeline/page.tsx` + `pipeline-tabs.tsx` — 4-tab panel (Worker errors · Stuck buffers · DEPA expiry queue · Delivery health) consuming the 4 admin.pipeline_* RPCs. Server component fetches all 4 in parallel; client component re-fetches every 30s via `router.refresh()`. Empty states explain zero-row cases (e.g. HMAC/origin failures don't yet log to worker_errors).
- `admin/src/app/(operator)/security/page.tsx` + `security-tabs.tsx` + `actions.ts` — 5-tab panel (Rate-limit triggers · HMAC failures · Origin failures · Sentry escalations · Blocked IPs). Block-IP and Unblock-IP Server Actions wrap `admin.security_block_ip` / `admin.security_unblock_ip`. Sentry tab is link-out only to consentshield-app / consentshield-admin Sentry projects. Rate-limit tab carries an inline amber banner explaining that ingestion is pending (V2-S2). The Blocked-IP footer is explicit that Worker enforcement ships in Sprint 2.3.

### Changed
- `admin/src/app/(operator)/layout.tsx` — `Pipeline Operations` + `Abuse & Security` nav items live (soon pills gone; adr pointer updated to `ADR-0033` for both, reflecting the fold-in of ADR-0035).

### Tested
- [x] `cd admin && bun run build` — 27 routes (up from 25 after ADR-0031). Zero errors / zero warnings.
- [x] `cd admin && bun run lint` — zero warnings.
- [x] `bun run test:rls` — 170/170 across 15 files (up from 160/160 after Phase 1's RPC test file).

## ADR-0031 — 2026-04-17

**ADR:** ADR-0031 — Connector Catalogue + Tracker Signature Catalogue (admin panels)
**Sprints:** 1.1 + 1.2 (connectors list / detail / editor / deprecate) · 2.1 + 2.2 (signatures list / detail / editor / import pack)

### Added
- `admin/src/app/(operator)/connectors/page.tsx` + `[connectorId]/page.tsx` + `new/page.tsx` + `[connectorId]/edit/page.tsx` — list (filterable by status + vendor) + detail (metadata, webhook endpoint template, required-credentials schema) + create/edit form + Deprecate modal with replacement picker + cutover deadline.
- `admin/src/components/connectors/{filter-bar,connector-form,detail-actions}.tsx` — shared UI primitives. JSON schema textarea is parse-validated server-side before calling `admin.add_connector` / `admin.update_connector` / `admin.deprecate_connector`.
- `admin/src/app/(operator)/signatures/page.tsx` + `[signatureId]/page.tsx` + `new/page.tsx` + `[signatureId]/edit/page.tsx` + `import/page.tsx` — list with category pill filter + critical-severity pill + status select + detail with pattern preview + create/edit form (regex pattern compile-checked) + bulk import pack form.
- `admin/src/components/signatures/{filter-bar,signature-form,detail-actions,import-form}.tsx`.
- `admin/src/app/(operator)/connectors/actions.ts` + `signatures/actions.ts` — Server Actions wrapping the seven ADR-0027 RPCs (`add_connector`, `update_connector`, `deprecate_connector`, `add_tracker_signature`, `update_tracker_signature`, `deprecate_tracker_signature`, `import_tracker_signature_pack`). All enforce reason ≥ 10 chars client-side in addition to the RPC's check.

### Changed
- `admin/src/app/(operator)/layout.tsx` — `Connector Catalogue` and `Tracker Signatures` nav items now live; the "soon" pills are gone for ADR-0031.

### Tested
- [x] `cd admin && bun run build` — 25 routes compile (up from 15).
- [x] `cd admin && bun run lint` — zero warnings.
- [x] `cd admin && bun run test` — 1/1 smoke.
- [x] `bun run test:rls` — 160/160, no regression.

## ADR-0039 — 2026-04-17

**ADR:** ADR-0039 — Connector OAuth (Mailchimp + HubSpot)

### Changed
- `app/src/app/(dashboard)/dashboard/integrations/page.tsx` — new "Connect via OAuth" card with "Connect Mailchimp" and "Connect HubSpot" buttons pointing at `/api/integrations/oauth/<provider>/connect`. New `OAuthBanner` surfaces success / error after the callback redirect (`?oauth_connected=<provider>` or `?oauth_error=<code>`).
- API-key connector form is preserved as the fallback for providers without OAuth configured or operators who prefer keys.

## ADR-0041 Sprint 1.4 — 2026-04-17

**ADR:** ADR-0041 — Probes v2 via Vercel Sandbox
**Sprint:** 1.4 — probe CRUD UI

### Added
- `app/src/app/(dashboard)/dashboard/probes/page.tsx` + `probes-list.tsx` + `actions.ts` — probe list, create/edit drawer, pause/resume/delete per-row actions, last-run status pill. Create form takes property, schedule, and a comma-separated consent_state. Help card documents the consent_state format and how v2 probes differ from v1 static-HTML.
- `app/src/components/dashboard-nav.tsx` — new nav item "Consent Probes" slotted after "Enforcement".

## ADR-0040 — 2026-04-17

**ADR:** ADR-0040 — Audit R2 Upload Pipeline
**Sprints:** 1.2 server actions · 1.3 storage settings UI

### Added
- `app/src/app/(dashboard)/dashboard/exports/actions.ts` — `saveR2Config`, `verifyR2Config`, `deleteR2Config`. `saveR2Config` encrypts credentials via `encryptForOrg` and upserts `export_configurations`. `verifyR2Config` decrypts, sigv4-PUTs a tiny verification marker to the bucket, flips `is_verified` on success. Admin/owner gated on the server side.
- `app/src/app/(dashboard)/dashboard/exports/settings/page.tsx` + `r2-settings-form.tsx` — server page + client form. Shows current config (bucket / path prefix / region / verified status / last export), exposes Save + Verify + Delete actions. Endpoint-reference block documents the Cloudflare R2 URL shape.

### Changed
- `app/src/app/(dashboard)/dashboard/exports/page.tsx` — headline restructured as a two-column flex with a "Storage settings" link. New "Delivery target" section surfaces whether exports upload to R2 (verified / unverified) or fall back to direct download. History table renders `r2_bucket/r2_object_key` for R2-delivered manifests.
- `app/src/app/(dashboard)/dashboard/exports/export-button.tsx` — response handling branches on Content-Type. For `application/json` (R2 delivery), opens the presigned URL in a new tab. For binary ZIP, preserves the existing blob download flow.

### Tested
- [x] `cd app && bunx vitest run tests/storage/sigv4.test.ts` — 7/7 PASS.
- [x] `cd app && bun run build` — zero errors / zero warnings; `/dashboard/exports/settings` in the route manifest.

## ADR-0037 — 2026-04-17

**ADR:** ADR-0037 — DEPA Completion
**Sprints:** 1.2 rights per-requestor binding · 1.3 CSV button

### Changed
- `app/src/app/(dashboard)/dashboard/rights/[id]/page.tsx` — erasure requests now render a "Matched N artefacts" green block above the informational impact preview when `rights_requests.session_fingerprint` matches active artefacts. Each matched row shows purpose, data_scope chips, expires_at, and the connector fan-out per artefact. Impact-preview fallback caveat text now reflects fingerprint availability (`no fingerprint` / `no match` / `fallback + primary`).
- `app/src/app/(dashboard)/dashboard/artefacts/page.tsx` — topbar gains "Export CSV" anchor that constructs a CSV URL preserving the current filter params (`?status`, `?framework`, `?purpose`, `?expiring=30`). Headline layout restructured to `flex items-start justify-between`.

### Tested
- [x] `cd app && bun run build` — success, zero errors / zero warnings. `/api/orgs/[orgId]/artefacts.csv` in the route manifest.

## ADR-0024 — 2026-04-17

**ADR:** ADR-0024 — DEPA Customer UI Rollup
**Sprints:** 1.1 Purpose Definitions catalogue · 1.2 Connector mappings · 1.3 Consent Artefacts + dashboard tile · 1.4 Rights Centre + settings + RLS test

### Added
- `app/src/app/(dashboard)/dashboard/purposes/page.tsx` — server route fetching `purpose_definitions`, `purpose_connector_mappings`, `integration_connectors`, and the org's `settings.sectoral_template`. Header shows the active sector template badge.
- `app/src/app/(dashboard)/dashboard/purposes/purposes-view.tsx` — client tab switcher: Catalogue + Connector mappings. Catalogue tab renders the 7-column table with inline Create form and per-row inline edit/archive. Connector mappings tab renders the purpose × connector × data_categories table with inline Create form (purpose picker, connector picker, comma-separated data_categories) and per-row Remove. Admin-only mutations per `organisation_members.role`.
- `app/src/app/(dashboard)/dashboard/purposes/actions.ts` — server actions: `createPurpose`, `updatePurpose`, `togglePurposeActive`, `createMapping`, `deleteMapping`. All use the authenticated supabase client; RLS enforces the org boundary. `createMapping` additionally enforces `data_categories ⊆ purpose.data_scope` server-side.
- `app/src/app/(dashboard)/dashboard/artefacts/page.tsx` — Consent Artefacts list. 4 KPI cards (active / expiring<30d / revoked 7d / replaced 7d). Filter component. Paginated table (50 rows). Link to detail.
- `app/src/app/(dashboard)/dashboard/artefacts/filters.tsx` — client filter-chip component (status × framework × purpose × expiring<30d). Updates `?status=…&framework=…&purpose=…&expiring=30&page=N` via router.push.
- `app/src/app/(dashboard)/dashboard/artefacts/[artefactId]/page.tsx` — detail with two info columns (Artefact / Context) and the 4-link chain-of-custody timeline (Event → Artefact → Revocations → Deletion receipts).
- `app/src/components/dashboard-nav.tsx` — +2 items: "Purpose Definitions" and "Consent Artefacts" slotted between Banners and Enforcement.

### Changed
- `app/src/app/(dashboard)/dashboard/page.tsx` — Stat row expands to 5 columns. New "Consent Artefacts" tile links to `/dashboard/artefacts` with active count + "X expiring 30d · Y revoked 7d" sub-label.
- `app/src/app/(dashboard)/dashboard/rights/[id]/page.tsx` — erasure requests gain an "Artefact-scoped impact preview" section showing org's active purposes + mapped connectors + aggregate fan-out count. Purposes without connector mappings render highlighted. Informational — per-requestor binding deferred to V2-D2.

### Tested
- [x] `cd app && bun run build` — success, zero errors / zero warnings. 3 new server-rendered routes in the manifest.
- [x] `bunx tsc --noEmit` — clean.
- [x] `bun run test:rls` — 14 files, **159/159** — PASS (154 baseline + 5 new in `depa-purpose-crud.test.ts`).

## ADR-0025 Sprint 1.2 — 2026-04-17

**ADR:** ADR-0025 — DEPA Score Dimension
**Sprint:** 1.2 — dashboard DEPA gauge

### Changed
- `app/src/app/(dashboard)/dashboard/page.tsx` — "Compliance Score" card restructured to "Compliance Scores" as a 2-column grid:
  - **Left column (DPDP):** existing `ScoreGauge` with the 6 component `ScoreRow`s (unchanged scoring, unchanged values).
  - **Right column (DEPA):** new `ScoreGauge` fed from `depa_compliance_metrics` (cache) or `compute_depa_score` RPC (fallback), converted to 0–100% via `total / 20 * 100`. Level thresholds: `>=15 green · >=10 amber · <10 red`. Below the gauge, four `ScoreRow`s render the sub-scores ("Coverage · Expiry · Freshness · Revocation", each out of 5). Caption shows `Refreshed <date>` or `Computed on demand · nightly refresh pending` for orgs whose nightly refresh hasn't landed yet.
- Gauge labels ("DPDP" / "DEPA") rendered beneath each gauge.

### Tested
- [x] `cd app && bun run build` — success, zero errors / zero warnings.
- [x] `bunx tsc --noEmit` — clean.

## ADR-0030 Sprint 3.1 — 2026-04-17

**ADR:** ADR-0030 — Sectoral Templates
**Sprint:** 3.1 — Customer-side template picker

### Added
- `app/src/app/(dashboard)/dashboard/template/page.tsx` — customer template picker. Reads caller org industry, calls `public.list_sectoral_templates_for_sector`, renders active template (if any) + available templates with Apply buttons.
- `app/src/app/(dashboard)/dashboard/template/actions.ts` — `applyTemplate(code)` Server Action wrapping `public.apply_sectoral_template`.
- `app/src/components/templates/template-picker.tsx` — client grid of template cards with Apply action.

### Changed
- `app/src/components/dashboard-nav.tsx` — "Sector template" nav item added between Data Inventory and Rights Requests.

### Tested
- [x] `cd app && bun run lint` — zero warnings.
- [x] `cd app && bun run build` — customer routes compile (+ /dashboard/template).
- [x] `bun run test:rls` (root, serial) — 147/147 (+3 new apply-template assertions; Terminal B's ADR-0023 contributed +5).

## ADR-0032 post-review follow-up — 2026-04-17

**ADR:** ADR-0032 — Support Tickets
**Context:** close Sprint 2.1 review deviations.

### Added
- `admin/src/components/support/reply-form.tsx` — Internal-Note toggle. When checked: amber background + "Save internal note" button; submits with `isInternal: true`; does not auto-transition ticket status.
- `admin/src/app/(operator)/support/actions.ts` — `sendMessage(ticketId, body, { isInternal })`. Passes `p_is_internal` through to the RPC.
- `admin/src/app/(operator)/support/[ticketId]/page.tsx` — thread renders internal notes with an amber stripe + 🔒 label; customer-side view filters them out (via `list_support_ticket_messages`).

### Changed
- `admin/src/components/flags/kill-switches-tab.tsx` — copy in the footer + Engage modal softened to note that Worker/Edge propagation requires `CF_*` Supabase secrets to be set (until then kill-switch state lives only in the DB row).

### Out of Scope (formalised)
- Open-ticket count badge in customer nav — the list page already shows counts; nav badge would add a coupling without meaningful UX payoff.

## ADR-0030 Sprint 2.1 — 2026-04-17

**ADR:** ADR-0030 — Sectoral Templates
**Sprint:** 2.1 — Draft editor + publish/deprecate actions

### Added
- `admin/src/app/(operator)/templates/actions.ts` — Server Actions: `createDraft`, `updateDraft`, `publishTemplate`, `deprecateTemplate`, `goToCloneForm`.
- `admin/src/app/(operator)/templates/new/page.tsx` — "+ New draft" form; accepts `?from=<templateId>` for Clone-as-new-version.
- `admin/src/app/(operator)/templates/[templateId]/edit/page.tsx` — draft editor (refuses non-draft).
- `admin/src/components/templates/template-form.tsx` — shared form for new + edit; purpose-definitions editor with add/remove/edit rows; data-scope category chip editor.
- `admin/src/components/templates/detail-actions.tsx` — status-aware action bar on the detail page (Edit + Publish on drafts; Clone + Deprecate on published; read-only notice on deprecated).

### Changed
- `admin/src/app/(operator)/templates/page.tsx` — "+ New draft" button in the header.
- `admin/src/app/(operator)/templates/[templateId]/page.tsx` — Actions card at the bottom. Resolves caller admin_role to gate publish/deprecate.

### Tested
- [x] `cd admin && bun run lint` — zero warnings
- [x] `cd admin && bun run build` — 15 routes compile (+ /templates/new + /templates/[templateId]/edit)
- [x] `cd admin && bun run test` — 1/1 smoke
- [x] `bun run test:rls` (root, serial) — 135/135 (no regression at this point)

## ADR-0032 Sprint 2.1 — 2026-04-17

**ADR:** ADR-0032 — Support Tickets
**Sprint:** 2.1 — Customer-side Contact Support + ticket inbox + reply

### Added (schema)
- Migration `20260421000001_customer_support_access.sql` — three SECURITY DEFINER helpers in `public`: `list_org_support_tickets()`, `list_support_ticket_messages(id)`, `add_customer_support_message(id, body)`. Each scoped via `public.current_org_id()`. Customer reply auto-transitions status to `awaiting_operator`.

### Added (customer app)
- `app/src/app/(dashboard)/dashboard/support/page.tsx` — customer inbox.
- `app/src/app/(dashboard)/dashboard/support/[ticketId]/page.tsx` — detail + thread + reply.
- `app/src/app/(dashboard)/dashboard/support/new/page.tsx` — Contact Support form.
- `app/src/app/(dashboard)/dashboard/support/actions.ts` — `createTicket`, `replyToTicket` Server Actions.
- `app/src/components/support/new-ticket-form.tsx` + `app/src/components/support/customer-reply-form.tsx`.
- `app/src/components/dashboard-nav.tsx` — Support nav item.

### Added (tests)
- `tests/rls/support-tickets.test.ts` — 3 assertions for cross-tenant isolation on all three new RPCs.

### Tested
- [x] `cd app && bun run lint` — zero warnings
- [x] `cd app && bun run build` — customer routes compile (+ /dashboard/support, /dashboard/support/[ticketId], /dashboard/support/new)
- [x] `cd app && bun run test` — 42/42
- [x] `cd admin && bun run test` — 1/1 smoke
- [x] `bun run test:rls` (root, serial) — 138/138 (+3 new support-isolation tests)

## ADR-0032 Sprint 1.1 — 2026-04-17

**ADR:** ADR-0032 — Support Tickets
**Sprint:** 1.1 — /support admin panel (list + detail + reply + controls)

### Added
- `admin/src/app/(operator)/support/page.tsx` — list with 4 metric tiles (Open / Resolved last 7 days / Urgent open / Median first response — V2 placeholder). Client-side sort by priority (urgent first) → open-statuses-first → recent. 200-row cap.
- `admin/src/app/(operator)/support/[ticketId]/page.tsx` — detail + thread with three author kinds (admin right-aligned + teal, customer left-aligned + zinc, system centred + grey).
- `admin/src/app/(operator)/support/actions.ts` — four Server Actions: `sendMessage`, `changeStatus`, `changePriority`, `assignTicket`. All wrap existing RPCs. Status / priority / assign require reason ≥ 10 chars (schema enforces).
- `admin/src/components/support/reply-form.tsx` — client reply form; transitions status to awaiting_customer automatically via the RPC.
- `admin/src/components/support/ticket-controls.tsx` — three control cards + three modal forms reusing the shared `ModalShell / ReasonField / FormFooter`.

### Changed
- `admin/src/app/(operator)/layout.tsx` — "Support Tickets" nav item is live (href=/support).

### Deferred (to Sprint 2.1)
- Customer-side Contact Support form.
- Customer-side ticket list + detail (new RLS policy or public view).

### ADR deviations noted
- No `is_internal_note` column in the schema — wireframe "Internal note" toggle deferred until a schema amendment introduces it.
- ADR Sprint 1.1 had planned "status change requires no reason for support role (routine work)"; the schema's `update_support_ticket` RPC always requires reason ≥ 10 chars, so the action respects that.

### Tested
- [x] `cd admin && bun run lint` — zero warnings
- [x] `cd admin && bun run build` — 13 routes compile (+ /support + /support/[ticketId])
- [x] `cd admin && bun run test` — 1/1 smoke
- [x] `bun run test:rls` (root, serial) — 135/135

## ADR-0030 Sprint 1.1 — 2026-04-17

**ADR:** ADR-0030 — Sectoral Templates
**Sprint:** 1.1 — /templates list + read-only detail

### Added
- `admin/src/app/(operator)/templates/page.tsx` — list with status + sector filters and pill counts. Fetches `admin.sectoral_templates` ordered by sector / template_code / version desc. Row click → detail.
- `admin/src/app/(operator)/templates/[templateId]/page.tsx` — read-only detail. Description + notes + three info tiles (Created / Published / Deprecated — with admin display names resolved from `admin.admin_users`, successor link if deprecated) + purpose-definitions table.
- `admin/src/components/templates/filter-bar.tsx` — Client Component with status + sector selects; Clear-filters link.

### Changed
- `admin/src/app/(operator)/layout.tsx` — "Sectoral Templates" nav item is live (href=/templates).

### Deferred (to Sprint 2.1)
- Create draft / Edit / Publish / Deprecate action bar + modals.
- Used-by count on detail page (no orgs configure a template through the UI yet).

### Tested
- [x] `cd admin && bun run lint` — zero warnings
- [x] `cd admin && bun run build` — 11 routes compile (+ /templates + /templates/[templateId])
- [x] `cd admin && bun run test` — 1/1 smoke
- [x] `bun run test:rls` (root, serial) — 135/135

## ADR-0036 — 2026-04-17

**ADR:** ADR-0036 — Feature Flags & Kill Switches (admin panel)
**Sprint:** 1.1 — Single-sprint ADR, Completed 2026-04-17

### Added
- `admin/src/app/(operator)/flags/page.tsx` — Server Component. Parallel fetch of `admin.feature_flags` + `admin.kill_switches` + `admin.admin_users` (for set_by display) + `public.organisations` (for org-scope flag display / selector). `?tab=kill-switches` deep link honoured.
- `admin/src/app/(operator)/flags/actions.ts` — three Server Actions: `setFeatureFlag` (upsert; boolean/string/number value types), `deleteFeatureFlag`, `toggleKillSwitch`. All wrap the existing ADR-0027 Sprint 3.1 RPCs.
- `admin/src/components/flags/flags-tabs.tsx` — Client tab shell.
- `admin/src/components/flags/feature-flags-tab.tsx` — flags table + Create/Edit/Delete modals. Value-type toggle (boolean/string/number) switches the value input. Edit disables key/scope/org (audit hygiene — changes happen as delete + create).
- `admin/src/components/flags/kill-switches-tab.tsx` — four cards matching the wireframe. Engage button requires typing the exact switch_key to arm submit; Disengage only needs reason ≥ 10 chars.
- `admin/src/components/common/modal-form.tsx` — hoisted `ModalShell`, `Field`, `ReasonField`, `FormFooter` out of `orgs/action-bar.tsx` for reuse.

### Changed
- `admin/src/app/(operator)/layout.tsx` — "Feature Flags & Kill Switches" nav item is now live (`href=/flags`).
- `admin/src/components/ops-dashboard/kill-switches-card.tsx` — "Manage in Feature Flags & Kill Switches" footer link is live, deep-links to `/flags?tab=kill-switches`.
- `admin/src/components/orgs/action-bar.tsx` — now imports `ModalShell`, `Field`, `ReasonField`, `FormFooter` from `../common/modal-form` instead of declaring them inline.

### Tested
- [x] `cd admin && bun run lint` — zero warnings
- [x] `cd admin && bun run build` — 9 routes compile (+ /flags vs prior 8)
- [x] `cd admin && bun run test` — 1/1 smoke
- [x] `bun run test:rls` (root, serial) — 135/135 (no regression)

## ADR-0029 — 2026-04-17

**ADR:** ADR-0029 — Admin Organisations (list + detail + actions + impersonation + customer-side cross-refs)
**Sprints:** 1.1 + 2.1 + 3.1 + 4.1 (all shipped 2026-04-17)

### Added (Admin app)

**Sprint 1.1 — list + detail (read-only):**
- `admin/src/app/(operator)/orgs/page.tsx` — Server Component with plan + status + name/email search filters, 50-per-page pagination.
- `admin/src/app/(operator)/orgs/[orgId]/page.tsx` — parallel fetch of org + members + web_properties + integrations + notes + impersonation sessions; 5 cards (Billing / Configuration / Contacts / Operator notes / Support sessions).
- `admin/src/components/orgs/filter-bar.tsx` — client filter bar.
- Layout nav: Organisations goes live (href=/orgs).

**Sprint 2.1 — actions:**
- `admin/src/app/(operator)/orgs/[orgId]/actions.ts` — four Server Actions wrapping `admin.{add_org_note, extend_trial, suspend_org, restore_org}`. Reason ≥ 10 chars validated client + server.
- `admin/src/components/orgs/action-bar.tsx` — four modal forms with shared ModalShell + ReasonField + FormFooter. Suspend/Restore disabled for non-platform_operator roles.

**Sprint 3.1 — impersonation:**
- `admin/src/components/impersonation/start-drawer.tsx` — Client drawer (reason code + detail textarea with ≥10 char counter + duration select).
- `admin/src/app/(operator)/orgs/[orgId]/impersonation-actions.ts` — Server Actions: startImpersonation / endImpersonation / forceEndImpersonation.
- `admin/src/components/impersonation/active-session-banner.tsx` (Server) + `active-session-banner-client.tsx` (Client, split to satisfy react-hooks/purity) — always-visible red banner while a session is active; amber band on expiry.
- `admin/src/lib/impersonation/cookie.ts` — httpOnly cookie helper.

### Added (Customer app, Sprint 4.1)

- `app/src/app/(dashboard)/dashboard/support-sessions/page.tsx` — customer-side Support sessions tab. Reads `public.org_support_sessions` view; table of sessions ordered newest-first.
- `app/src/components/suspended-banner.tsx` — Server Component in dashboard layout. Shows red banner with Contact support mailto when the org's status='suspended'.
- `app/src/components/dashboard-nav.tsx` — new "Support sessions" nav item.

### Tested
- [x] `cd admin && bun run build` — all routes compile (/, /login, /audit-log[/export], /orgs[/[orgId]], /api/auth/signout)
- [x] `cd admin && bun run lint` — 0 warnings
- [x] `cd app && bun run build + test + lint` — 42/42, 0 warnings, builds clean
- [x] `bun run test:rls` — 135/135 (admin SELECT-all policies don't break customer isolation; customer JWTs don't have is_admin=true)

### Deferred (execution note, not a blocker)
- Binding subsequent mutation audit rows to the active impersonation_session_id via a BEFORE INSERT trigger + per-request `set_config('app.impersonation_session_id', ...)`. PostgREST's transaction-pooled connections make session-local settings hard to propagate; the fix needs either an extra RPC arg on all 30 Sprint 3.1 RPCs or a wrapper dispatch layer. Start/end sessions are audited; intermediate actions are audited individually; forensic linkage is nice-to-have, not Rule 22/23 required.
- Updating the customer-side HTML wireframes with W13 + W14 panels. Implementation shipped; the wireframe HTML is a sizable file and the visual spec is accurately captured by the implemented components. Flagged in the customer alignment doc with a ⚠️ marker.

## ADR-0028 — 2026-04-17

**ADR:** ADR-0028 — Admin App Foundation (real OTP auth + Operations Dashboard + Audit Log viewer)
**Sprints:** 1.1 + 2.1 + 3.1 (all shipped 2026-04-17)

### Added (Admin app)

**Sprint 1.1 — auth:**
- `admin/src/components/otp-boxes.tsx` — per-app OTP boxes (share-narrowly memory). Red admin accent on active slot + caret.
- `admin/src/app/(auth)/login/page.tsx` — rewritten as a two-stage OTP email flow (email → code). No signup link (admin bootstrap is not self-serve). Red accent; preserves the `?reason=mfa_required` banner for AAL2-failure paths.
- `admin/src/app/api/auth/signout/route.ts` — POST-only signout; redirects to `/login`.
- `admin/src/app/(operator)/layout.tsx` — session chip (display_name + admin_role + AAL2 verified), sign-out button in sidebar footer, Operations Dashboard + Audit Log nav links go live (8 remaining panels still point at `#`).
- `admin/package.json` — `input-otp@1.4.2` added exact-pinned.

**Sprint 2.1 — Operations Dashboard:**
- `admin/src/app/(operator)/page.tsx` — Server Component; reads `admin.platform_metrics_daily` (latest row), `admin.kill_switches`, `public.admin_cron_snapshot()`, latest 10 `admin.admin_audit_log` rows. 6 metric tiles + cron status card + kill switch summary + recent activity card.
- `admin/src/components/ops-dashboard/*` — `MetricTile`, `KillSwitchesCard`, `CronStatusCard`, `RecentActivityCard`, `RefreshButton` (client; calls the Server Action).
- `admin/src/app/(operator)/actions.ts` — `refreshPlatformMetrics()` Server Action calls `admin.refresh_platform_metrics(current_date)` + `revalidatePath('/')`.

**Sprint 3.1 — Audit Log:**
- `admin/src/app/(operator)/audit-log/page.tsx` — Server Component; URL-param filters (admin, action, org, from, to, page); 50-per-page pagination via `.range()`.
- `admin/src/components/audit-log/filter-bar.tsx` — Client Component filter bar (admin select populated from `admin.admin_users`, action select from fixed KNOWN_ACTIONS list, org text input, from/to date inputs).
- `admin/src/components/audit-log/audit-table.tsx` — row list; click opens detail drawer.
- `admin/src/components/audit-log/detail-drawer.tsx` — right-side drawer; pretty-printed old_value / new_value JSON + request_ip / request_ua / api_route; Esc + click-outside close.
- `admin/src/app/(operator)/audit-log/export/route.ts` — CSV export endpoint; re-applies the filter predicate, caps at 10k rows, calls `admin.audit_bulk_export()` BEFORE streaming so the export is audit-logged even if the client aborts.

### Deviations from ADR-0028 plan
- **`cron.job_run_details` schema.** ADR Sprint 2.1 RPC initially joined on `jobname` but the Supabase-managed `cron.job_run_details` table has `jobid` instead. Migration was fixed to `jobid` join. Documented as an execution note in the ADR.

### Tested
- [x] `cd admin && bun run build` — 6 routes compile (/, /login, /audit-log, /audit-log/export, /api/auth/signout, /_not-found)
- [x] `cd admin && bun run lint` — 0 warnings
- [x] `cd admin && bun run test` — 1/1 smoke (unchanged)
- [x] `cd app && bun run test` — 42/42 (no regression)
- [x] `bun run test:rls` — 8 files, 135/135 (no regression)

Combined: 42 (app) + 135 (rls/admin/depa) + 1 (admin smoke) = **178/178**.

### Manual smokes (post-merge)
- Real signin end-to-end with Sudhindra's bootstrap account
- Operations Dashboard renders live metrics / kill switches / cron status / recent audit
- Audit Log filter + detail drawer + CSV export

## ADR-0018 Sprint 1.1 — 2026-04-16

### Changed
- `src/app/(dashboard)/dashboard/integrations/integrations-table.tsx`:
  the "New Connector" form now surfaces a Type selector
  (Generic webhook / Mailchimp / HubSpot) with per-type conditional
  fields. Button label moved from "Add Webhook Connector" to
  "Add Connector".

## ADR-0017 Sprint 1.1 — 2026-04-16

### Added
- New page `src/app/(dashboard)/dashboard/exports/page.tsx` — lists
  past export manifests (pointer-only; no ZIP bytes stored) with an
  **Export ZIP** button that triggers `POST /api/orgs/[orgId]/audit-export`,
  downloads the archive in-browser, and reloads the manifest list.
- Companion client component `export-button.tsx` handles the
  fetch-to-blob-to-anchor download flow.

## ADR-0016 Sprint 1 — 2026-04-16

### Changed
- `src/app/(dashboard)/dashboard/enforcement/page.tsx`: new
  **Consent Probes** section listing every active probe with its
  schedule, last-run timestamp, and status (clean / N violations /
  failed). Reads `consent_probes` + `consent_probe_runs`; joins the
  latest run per probe. No CRUD UI in v1 — probes are seeded via
  SQL until a dedicated micro-ADR adds the form.

## ADR-0015 Sprint 1.1 — 2026-04-16

**ADR:** ADR-0015 — Security Posture Scanner
**Sprint:** Phase 1, Sprint 1.1

### Changed
- `src/app/(dashboard)/dashboard/enforcement/page.tsx`: new
  **Security Posture** section. Queries `security_scans` alongside
  the existing tracker-observations queries; for every property
  shows the highest-severity finding from its most-recent scan with
  a colour-coded badge (critical / high / medium / low / info /
  unscanned). Lists total findings and the worst `signal_key` per
  property.

### Tested
- [x] `bun run build` + `bun run lint` + `bun run test` — clean.

## ADR-0013 Sprint 1.2 — 2026-04-15

### Changed
- `src/app/(public)/signup/page.tsx` — passwordless OTP flow. Two stages:
  (1) email + orgName + industry → `supabase.auth.signInWithOtp` with
  `shouldCreateUser: true` and `options.data`; (2) 6-digit code →
  `supabase.auth.verifyOtp({type: 'email'})` → `/auth/callback`.
- `src/app/(public)/login/page.tsx` — same two-stage OTP pattern
  (`shouldCreateUser: false`). Passwords removed from UI.

### Rationale
- Phishing / forwarding resistance, device continuity, no URL leakage, no
  email-scanner premature consumption. Full reasoning in ADR-0013.
- Consistent with ADR-0004 (rights-request OTP).

### Operator action
- In Supabase Dashboard → Authentication → Email Templates → Magic Link,
  replace the `{{ .ConfirmationURL }}` block with a prominent
  `{{ .Token }}` display so the email delivers the code only (no link
  fallback that scanners can prefetch).

## ADR-0013 Sprint 1.1 — 2026-04-15

### Changed
- `src/app/(public)/signup/page.tsx`:
  - Attaches `{ org_name, industry }` to `options.data` on
    `supabase.auth.signUp` so it survives the email-confirmation gap.
  - Sets `options.emailRedirectTo` to
    `<origin>/auth/callback` so Supabase sends the verification link
    back to our single handler.
  - New "Check your email" pending state shown when `signUp` returns no
    session (Supabase's "Confirm email" flag is ON). Otherwise navigates
    straight to `/auth/callback`.

### Tested
- [x] `bun run lint` / `build` / `test` — all green.
- Manual smoke test on live Vercel deploy after next push.

## [ADR-0050 Sprint 3.1] — 2026-04-20

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Phase 3, Sprint 3.1

### Added
- `admin/src/app/(operator)/billing/gst-statement/` — GST statement page + server action; issuer selector (locked to current-active for operators, free-form incl. retired for owner); FY range selector; summary card (totals by tax head + invoice count); CSV download with UTF-8 BOM.
- `admin/src/app/(operator)/billing/export/` — Invoice export page + server action; filter form (FY / account / issuer); streams ZIP of PDFs + `index.csv`; audit-logs caller role + filter params + row count + ZIP SHA-256.
- `admin/src/app/(operator)/billing/search/` — Invoice search page; scope-aware (operator: current-active issuer; owner: all issuers); search by invoice_number / account / razorpay_payment_id / date range; paged; links to invoice detail.

### Changed
- `admin/src/app/(operator)/layout.tsx` — added sidebar nav entries for GST Statement, Export, and Search under the Billing section.

### Tested
- [x] `cd admin && bun run build` — PASS (all 3 new routes compile cleanly)
- [x] `cd admin && bun run lint` — PASS (zero warnings)

## [ADR-0050 Sprint 3.2] — 2026-04-20

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Phase 3, Sprint 3.2

### Added
- `admin/src/app/(operator)/billing/disputes/page.tsx` — Dispute list with status/deadline filter. Red row highlight when deadline < 48h. Shows dispute ID, account, amount, reason, phase, status, deadline.
- `admin/src/app/(operator)/billing/disputes/[disputeId]/page.tsx` — Dispute detail: dispute info, red deadline banner, webhook timeline, plan history, action section.
- `admin/src/app/(operator)/billing/disputes/[disputeId]/dispute-actions.tsx` — Client component: Assemble Evidence Bundle button (streams presigned download URL) + state transition form (under_review/won/lost/closed with required reason).

### Changed
- `admin/src/app/(operator)/layout.tsx` — Added "Disputes" nav entry under Billing section.
- `admin/src/lib/billing/r2-disputes.ts` — R2 upload helper for evidence ZIPs (`disputes/{id}/evidence-{iso}.zip`).
- `admin/src/lib/billing/build-evidence-bundle.ts` — Pure ZIP assembly (dispute.json, account.json, invoices/*, webhook-events.ndjson, plan-history.json); testable without runtime.

### Tested
- [x] `cd admin && bun run build` — PASS (disputes + [disputeId] routes compile clean)

## [ADR-0054 Sprint 1.1] — 2026-04-20

**ADR:** ADR-0054 — Customer-facing billing portal
**Sprint:** Phase 1, Sprint 1.1

### Added
- `app/src/app/(dashboard)/dashboard/settings/billing/page.tsx` — Settings → Billing page. Role-gated (account_owner / account_viewer only); org-level roles see a "Not available for your role" state, not a leak. Current plan card (deep-link to /dashboard/billing for plan change), read-only billing profile, invoice history table with Download links.

### Changed
- `app/src/components/dashboard-nav.tsx` — Added "Billing settings" nav item under the settings sub-group.

## [ADR-0054 Sprint 1.2] — 2026-04-20

**ADR:** ADR-0054 — Customer-facing billing portal
**Sprint:** Phase 1, Sprint 1.2

### Added
- `app/src/app/(dashboard)/dashboard/settings/billing/profile-form.tsx` — client component for inline edit. View mode shows the profile read-only with an "Edit" button (visible only to account_owner). Edit mode shows form inputs + client-side pre-validation + Save/Cancel. State list dropdown covers major Indian states.
- `app/src/app/(dashboard)/dashboard/settings/billing/actions.ts` — server action wrapping the `update_account_billing_profile` RPC; surfaces validation errors verbatim.

### Changed
- `app/src/app/(dashboard)/dashboard/settings/billing/page.tsx` — static profile block replaced with the client `BillingProfileForm` component. Page remains a server component.

## [ADR-0046 Phase 2 Sprint 2.2] — 2026-04-20

**ADR:** ADR-0046 — Significant Data Fiduciary foundation
**Sprint:** Phase 2, Sprint 2.2 (DPIA customer UI)

### Added
- `docs/design/screen designs and ux/consentshield-screens.html` — new DPIA panel wireframe + nav entry (SDF badge) between Audit & Reports and Onboarding Flow.
- `app/src/app/(dashboard)/dashboard/dpia/page.tsx` — list page with KPI strip, status/risk filter chips, review-due highlighting (<30d), SDF context banner.
- `app/src/app/(dashboard)/dashboard/dpia/actions.ts` — server actions wrapping the 3 DPIA RPCs.
- `app/src/app/(dashboard)/dashboard/dpia/new/` — create form (page + client form component) with Save-as-draft / Save-and-publish buttons.
- `app/src/app/(dashboard)/dashboard/dpia/[dpiaId]/` — detail page with publish / supersede actions (role-gated via `effective_org_role`).

### Changed
- `app/src/components/dashboard-nav.tsx` — "DPIA Records" nav item added after Rights Requests.

## [ADR-0046 Phase 3] — 2026-04-20

**ADR:** ADR-0046 — Significant Data Fiduciary foundation
**Sprint:** Phase 3 — Auditor engagements customer UI

### Added
- Wireframe: `consentshield-screens.html` — `<div id="panel-auditors">` + nav entry (SDF badge) after DPIA Records.
- `app/src/app/(dashboard)/dashboard/auditors/page.tsx` — list w/ KPI strip (active / completed / terminated), status filter chips.
- `app/src/app/(dashboard)/dashboard/auditors/new/` — create form (page + client form with 6-category picker).
- `app/src/app/(dashboard)/dashboard/auditors/[engagementId]/` — detail page + action panel with 3 modes (complete / terminate with reason / update scope+notes+attestation). Role-gated via effective_org_role.
- `app/src/app/(dashboard)/dashboard/auditors/actions.ts` — server actions wrapping the 4 RPCs.

### Changed
- `app/src/components/dashboard-nav.tsx` — "Auditor Engagements" nav entry after DPIA Records.

## [ADR-0029 follow-up — support sessions UX] — 2026-04-20

**ADR:** ADR-0029 — Admin organisations (customer follow-up)

### Changed
- `app/src/app/(dashboard)/dashboard/support-sessions/page.tsx` — rewritten to call the new `list_org_support_sessions` RPC. Adds operator display name (replaces raw UUID), duration column ("12 min"), status filter chips, KPI strip (total / active-now / completed), action-count hint per session, and a footer note explaining full action logs are available via support request.

## [ADR-0057 Sprint 1.1] — 2026-04-20

**ADR:** ADR-0057 — Customer-facing sectoral template switcher

### Added
- `app/src/app/(dashboard)/dashboard/settings/account/page.tsx` — org details + industry editor + applied sector template read-only chip.
- `app/src/app/(dashboard)/dashboard/settings/account/industry-editor.tsx` — client component with view / edit / save / cancel flow; post-save hint deep-links to /dashboard/template.
- `app/src/app/(dashboard)/dashboard/settings/account/actions.ts` — server action wrapping the RPC.

### Changed
- `app/src/components/dashboard-nav.tsx` — "Account settings" nav entry before Team & invites.

## [ADR-0048 follow-up — suspension banner clarification] — 2026-04-20

**ADR:** ADR-0048 — Admin accounts panel (customer-side follow-up)

### Changed
- `app/src/components/suspended-banner.tsx` — now checks both `organisations.status` and parent `accounts.status` (account suspension is the more common driver and cascades to orgs). Copy expanded to list explicitly what is paused (banner delivery, new DPIA/auditor engagement entries) vs. what still works (data viewing, billing updates so customer can pay out of suspension, team management).

## [ADR-0051 Sprint 1.1] — 2026-04-20

**ADR:** ADR-0051 — Billing evidence ledger

### Changed
- `admin/src/lib/billing/build-evidence-bundle.ts` — accepts optional `ledger: LedgerEvent[]`; emits `evidence-ledger.ndjson` in the dispute ZIP; returns `ledgerEventCount`.
- `admin/src/app/(operator)/billing/disputes/actions.ts` — `assembleEvidenceBundle` fetches ledger rows via `admin.billing_evidence_ledger_for_account` before building the ZIP.

## [ADR-0051 Sprint 1.2] — 2026-04-20

**ADR:** ADR-0051 — Billing evidence ledger
**Sprint:** Sprint 1.2 — admin dispute ledger viewer

### Added
- `admin/src/app/(operator)/billing/disputes/[disputeId]/page.tsx` — new "Evidence Ledger" section: compact table with when / event_type / source / source_ref / metadata preview. Shows first 50; full set always in the bundle ZIP.

### Changed
- `admin/src/app/(operator)/billing/disputes/actions.ts` — `getDisputeDetail` returns `ledger: LedgerEventRow[]`; `assembleEvidenceBundle` now reuses that ledger instead of re-fetching.

## [ADR-0052 Sprint 1.1] — 2026-04-20

**ADR:** ADR-0052 — Razorpay dispute contest submission

### Added
- `admin/src/app/(operator)/billing/disputes/[disputeId]/dispute-actions.tsx` — Razorpay contest section: prepare-packet flow (summary textarea, disabled until evidence bundle assembled) → review saved summary → "Mark submitted to Razorpay" (manual). Re-edit supported before submission.

### Changed
- `admin/src/app/(operator)/billing/disputes/actions.ts` — added `prepareContestPacket` + `markContestSubmitted` server actions; `DisputeRow` extended with contest fields; `listDisputes` + `getDisputeDetail` select them.
- Dispute detail page passes the new contest props to `DisputeActions`.

## [ADR-0052 Sprint 1.2] — 2026-04-20

**ADR:** ADR-0052 — Razorpay dispute contest submission

### Added
- Dispute detail page now surfaces both "Submit to Razorpay" (auto via Documents + Contest APIs) and "Mark submitted manually" (out-of-band fallback) when packet is prepared.

## [ADR-0053 Sprint 1.1] — 2026-04-20

**ADR:** ADR-0053 — GSTR-1 JSON export

### Added
- `admin/src/app/(operator)/billing/gst-statement/form.tsx` — new "GSTR-1 JSON (monthly filing)" block with MMYYYY period input (defaults to previous month) + download button. Disabled when issuer dropdown is "All issuers" (JSON is per-issuer).

### Changed
- `admin/src/app/(operator)/billing/gst-statement/actions.ts` — added `generateGstr1Json` server action wrapping `admin.billing_gstr1_json`; produces `gstr1-<gstin>-<MMYYYY>.json` filename.

## [ADR-0055 Sprint 1.1] — 2026-04-20

**ADR:** ADR-0055 — Account-scoped impersonation

### Added
- `admin/src/app/(operator)/accounts/actions.ts` — `startAccountImpersonationAction` server action.
- `admin/src/app/(operator)/accounts/[accountId]/action-bar.tsx` — "Impersonate account" button + modal with reason picker, detail textarea, duration dropdown.
- `app/src/app/(dashboard)/dashboard/support-sessions/page.tsx` — renders a small purple `account` pill next to the operator name for account-scoped sessions.

### Changed
- `admin/src/app/(operator)/accounts/[accountId]/page.tsx` — passes `accountName` through to the action bar so the impersonation modal can show "Impersonate account — {name}".

## [ADR-0056 Sprint 1.1] — 2026-04-20

**ADR:** ADR-0056 — Per-account feature-flag targeting

### Changed
- `admin/src/app/(operator)/flags/actions.ts` — `setFeatureFlag` + `deleteFeatureFlag` accept optional `accountId`; validates scope/target shape client-side; forwards `p_account_id` to RPC.
- `admin/src/components/flags/feature-flags-tab.tsx` — existing callers pass `accountId: null` for compatibility. Full UI (account picker + account-scoped row badge) lands in ADR-0056 Sprint 1.2.
