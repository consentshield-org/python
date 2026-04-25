# ADR-1018: Status page — Phase 1 self-hosted (superseded), Phase 2 Better Stack integration

**Status:** In Progress (Phase 1 Completed and superseded; Phase 2 Proposed)
**Date proposed:** 2026-04-22 (Phase 1) · 2026-04-25 (Phase 2 supersession)
**Phase 1 completed:** 2026-04-23
**Supersedes (in part):** ADR-1005 Phase 4 Sprint 4.1/4.2 (StatusPage.io provisioning)
**Related:** ADR-1017 (admin ops-readiness surface) · marketing-claims review 2026-04-25 Issue 18

---

## Supersession note (2026-04-25)

Phase 1 (self-hosted status page on admin + customer-app `/status`) was scoped, built, and live by 2026-04-23. The marketing-claims review on 2026-04-25 (`docs/reviews/2026-04-25-marketing-claims-vs-reality-review.md` Issue 18) re-examined the public-facing claims that point at `status.consentshield.in` — *"real-time platform health, uptime metrics, and incident history"* with seven monitored surfaces, per-surface uptime targets, and *"probed every 30 seconds from three geographic regions"* — and concluded the self-hosted Phase 1 implementation does not meet that wireframe today and would require non-trivial work to do so (multi-region probes, subscriber email/RSS/webhook notifications, uptime-history rollups, incident-comms templating, etc.).

Reversal of Phase 1's "no SaaS vendor" stance is deliberate. The self-hosted approach was the right v1 ship to retire ADR-1005's StatusPage.io scope; Phase 2 trades that for a vendor-managed surface that already does the work the marketing copy promises. Reasons to flip:

- The compliance-perimeter argument that drove Phase 1's self-host stance is weaker than it first read — the public status page renders **brand and aggregate uptime numbers**, not customer data; nothing privacy-sensitive lives in `status_*` tables. The marketing wireframe is the binding spec; the data classification is benign.
- BFSI / large-corporate procurement reads "Better Stack on `status.consentshield.in`" as a stronger trust signal than an in-product status route — the third-party ingestion path is what protects against "the platform telling us about its own outage."
- Multi-region synthetic probes from a SaaS vendor are an order of magnitude cheaper to operate than building region-spread synthetic-probe infrastructure ourselves. The opportunity cost of building those primitives in-house (rather than buying them) is not justified for the audience size.
- The Vercel password-protection rejection at $150/mo (which drove ADR-0502's in-house OTP gate) is a **different** category of decision. That was about gating access to consentshield.in's marketing content; the cost was unjustified for a confidential preview. Better Stack costs are on a different scale and produce a customer-facing trust artefact.

**Phase 1 disposition.** The self-hosted Phase 1 stays running for now; it stops being the **primary** uptime surface once Phase 2 ships. Sprint 2.7 (decommissioning) lays out which subsystems retire in place and which migrate. No data migration — `status_*` tables are buffer / observation surfaces and are not customer-facing canonical records.

**ADR-1300 retirement.** The marketing-claims review 2026-04-25 Issue 18 originally proposed an `ADR-1300` series for the Better Stack work. That series is **withdrawn**; this ADR-1018 absorbs it. Single ADR for "the public status page," with Phase 1 (self-hosted) and Phase 2 (Better Stack) as sequential phases of the same artefact. Avoids the open-ranges proliferation problem the review's "Pending corrections" trailer flagged.

---

## Phase 1 — Self-hosted status page (Completed 2026-04-23, superseded as primary surface)

### Context

ADR-1005 Phase 4 scoped a hosted `status.consentshield.in` via StatusPage.io (fallback: Cachet self-hosted on Vercel). BFSI procurement expects a real public status page. StatusPage.io is ~$29/mo for the entry-level plan and carries a third-party cookie + privacy-policy footprint; Cachet needs its own deployment.

Since we already own the admin app and the customer app, and we have the DB + cron infrastructure to probe subsystems, there is no meaningful reason to introduce a third hosting target or a SaaS vendor. Self-hosting keeps the data inside the compliance perimeter, aligns the brand styling with the rest of the product, and removes a monthly spend + vendor dependency.

The admin surface owns management (operators post incidents, adjust subsystems, see probe history). A thin public read-only view at `status.consentshield.in` renders the latest-known state of each subsystem + the last 90 days of resolved incidents. Automated probes run on pg_cron; operator-posted incidents overlay the automated state.

### Decision (Phase 1)

1. **Schema in `public`** (not `admin`) so the read path is unauthenticated — `status_subsystems`, `status_checks`, `status_incidents`. RLS opens SELECT to `anon`; INSERT / UPDATE restricted to admin roles via SECURITY DEFINER RPCs.
2. **Admin panel** at `/admin/(operator)/status` — list + edit subsystems, view recent `status_checks`, post + resolve incidents.
3. **Public page** at `/status` on the customer app (later DNS cutover to `status.consentshield.in`) — static-like render of subsystem cards (current state + 90-day uptime) + open-incidents banner.
4. **Automated probes** via pg_cron → Edge Function `run-status-probes` hitting each subsystem's health endpoint every 5 minutes. Results UPSERTed into `status_checks`. Non-200 / timeout transitions a subsystem's state from `operational` → `degraded` or `down`.

Design-wise the public page is deliberately plain — static-feeling, accessible, no cookies, no analytics. Operators see everything through the admin panel.

### Consequences (Phase 1)

- Zero new SaaS spend. Zero external vendor for the status surface.
- All status data stays inside ConsentShield's compliance perimeter — useful when the status page itself would need to reflect privacy-sensitive subsystem names.
- Trade-off: ConsentShield itself hosts its own uptime surface. If the customer-app deployment goes down, the public status page goes with it. Mitigation: probes run from a different region than the app; future enhancement moves `status.consentshield.in` to a dedicated ultra-minimal Vercel project with its own Supabase read replica.

The trade-off was the load-bearing reason to flip Phase 2 to Better Stack (Supersession note above) — *"the platform telling us about its own outage"* is exactly the failure mode the BFSI buyer rehearses.

---

## Implementation Plan

### Sprint 1.1 — Schema + seed + admin RPCs (~1.5h) — **complete 2026-04-22**

**Deliverables:**
- [x] Migration `20260804000013_status_page.sql`:
  - `public.status_subsystems` (id, slug, display_name, description, health_url, current_state, last_state_change_at, last_state_change_note, sort_order, is_public, created_at, updated_at).
  - `public.status_checks` (id, subsystem_id, checked_at, status, latency_ms, error_message, source_region).
  - `public.status_incidents` (id, title, description, severity, status, `affected_subsystems uuid[]`, started_at, identified_at, monitoring_at, resolved_at, postmortem_url, created_by, last_update_note, created_at, updated_at).
  - CHECKs: `current_state` in ('operational','degraded','down','maintenance'); incident `severity` in ('sev1','sev2','sev3'); incident `status` in ('investigating','identified','monitoring','resolved'); per-check status adds 'error'.
  - RLS: SELECT open to `anon` + `authenticated` (public page needs anon read); writes only via admin RPCs. `cs_orchestrator` has insert/update for probe-cron to land (Sprint 1.4).
  - Indexes: recent-check lookup (subsystem_id, checked_at desc); open-incidents (status, started_at desc) WHERE status <> 'resolved'; all-incidents (started_at desc).
- [x] Seeded 6 subsystems — banner_cdn, consent_capture_api, verification_api, deletion_orchestration, dashboard, notification_channels; all operational; health_url populated where known.
- [x] 4 admin RPCs all SECURITY DEFINER + audit-logged via `admin.admin_audit_log`: `set_status_subsystem_state`, `post_status_incident`, `update_status_incident`, `resolve_status_incident`. Gated by `admin.require_admin('support')`.

### Sprint 1.2 — Admin panel (~1.5h) — **complete 2026-04-22**

**Deliverables:**
- [x] `admin/src/app/(operator)/status/page.tsx` — server component; reads subsystems + last-50 incidents; passes `adminRole` for write-gating.
- [x] `admin/src/app/(operator)/status/actions.ts` — 4 server actions wrapping the 4 RPCs; `revalidatePath('/status')` on success.
- [x] `admin/src/components/status/status-panel.tsx` — subsystem cards with per-state chips + per-subsystem inline state-flip buttons; open-incidents section with **Post incident** modal (title / description / severity / affected subsystems); incident cards with progress + resolve + postmortem-URL input; recent-history collapsible for resolved incidents.
- [x] Sidebar entry "Status Page" → `/status`.

### Sprint 1.3 — Public read-only page (~1.5h) — **complete 2026-04-22**

**Deliverables:**
- [x] `app/src/app/(public)/status/page.tsx` — server component reading via anon supabase-js. Renders:
  - Overall banner with 4-tone mapping (green / amber / red / blue) + aria-live.
  - Subsystem list (state dot + state label + description).
  - Open-incidents section with severity + status badges + latest-update note.
  - Collapsible 90-day resolved-incidents history + postmortem links.
  - Minimal brand footer; no cookies, no analytics.
- [x] `export const revalidate = 60` — 60s edge cache.
- [x] Public-route behaviour: `/status` is not in `proxy.ts` matcher, so the proxy auth gate doesn't fire. Ships without further proxy changes.
- [ ] `/status` layout override stripping dashboard chrome — currently inherits `(public)/layout.tsx`. Acceptable for v1; can split further if design wants a dedicated chrome.

### Sprint 1.4 — Probe cron + Edge Function (~2h) — **complete 2026-04-22**

**Deliverables:**
- [x] `supabase/functions/run-status-probes/index.ts` — iterates subsystems with non-null `health_url`, fetches with 8s timeout, records one `status_checks` row per subsystem, reconciles `current_state` (eager recovery on a single operational probe; failure requires 3 consecutive non-operational checks before auto-flipping; respects manual `maintenance` without stomp).
- [x] `supabase/functions/health/index.ts` — unauthenticated liveness for the Edge-Functions surface. Named `health` (not `_health`) — Supabase rejects Function names that start with `_`.
- [x] `app/src/app/api/health/route.ts` — unauthenticated liveness for the customer app (outside `proxy.ts` matcher, so the Bearer gate does not fire). `GET` returns JSON envelope; `HEAD` returns 200 no-body.
- [x] `supabase/config.toml` — `verify_jwt = false` for both new Functions (cron carries Vault-stored HS256 Bearer; Supabase HS256 rotation 401s at the Functions gateway).
- [x] Migration `20260804000015_status_probes_cron.sql`:
  - Updates seeded `health_url`s for `verification_api` and `dashboard` to `https://app.consentshield.in/api/health` (single unauthenticated endpoint; no probe-key provisioning needed). `deletion_orchestration` now points at the new `functions/v1/health`. `notification_channels` stays null until Sprint 6.1 ships the adapters.
  - Schedules `status-probes-5min` on `*/5 * * * *` calling `run-status-probes`.
  - Schedules `status-probes-heartbeat-check` on `*/15 * * * *` — pure SQL; inserts `admin.ops_readiness_flags` row (`ADR-1018`, `infra`, `high`) if no `status_checks` row has been written in the last 30 minutes. Idempotent: only inserts when no matching `pending`/`in_progress` flag already exists.
- [x] Live smoke-test: `curl POST /functions/v1/run-status-probes` returned `{probed: 5, skipped: 1, flipped: 0}` against the seeded 6-subsystem set. `health` endpoint returns 200 JSON.

### Sprint 1.4b — Audit-log column fix (follow-up) — **complete 2026-04-22**

**Bundled with ADR-1017 Sprint 1.3.** The four status-page admin RPCs landed in `20260804000013` inserted into `admin.admin_audit_log` using non-existent columns (`target_kind`, `payload`) and omitted the required `reason`. Migration `20260804000019_audit_log_column_fix.sql` rewrites the four RPCs with the canonical column set.

**Deliverables:**
- [x] `admin.set_status_subsystem_state`, `admin.post_status_incident`, `admin.update_status_incident`, `admin.resolve_status_incident` — rewritten `create or replace function` to use `target_table`/`target_id`/`target_pk`/`old_value`/`new_value`/`reason`. Function signatures unchanged.
- [x] `tests/admin/status-page-rpcs.test.ts` — 11 assertions covering state transitions, incident lifecycle, public-anon SELECT, invalid-input rejection, unknown-slug/id errors.

### Sprint 1.5 — DNS cutover — **complete 2026-04-23**

**Deliverables:**
- [x] CNAME `status.consentshield.in` → `cname.vercel-dns.com` added by operator.
- [x] `status.consentshield.in` aliased to the `app` Vercel project (`bunx vercel domains add status.consentshield.in`).
- [x] Host-based redirect in `app/src/app/page.tsx` — when `host === 'status.consentshield.in'`, redirect to `/status`. Without this, the alias root would fall through to the auth-only Home() handler and redirect to `/login` (wrong destination for a public uptime page). Picked the page.tsx location over a proxy-level rewrite to keep `app/src/proxy.ts` host-agnostic; a tighter guard (proxy.ts host whitelist) is overkill for v1.
- [x] TLS issued automatically by Vercel.
- [x] Smoke test: `curl -I https://status.consentshield.in` → `307 location: /status`; `curl -L https://status.consentshield.in` → `200` with the public status page HTML. Production deploy `dpl_DZCmm8n7AiGqBMkfB6BHxBq8VrsV`.
- [x] `admin.ops_readiness_flags` row resolved via migration `20260804000032`.

**Deferred (low priority):** linking from marketing footer + admin UI. Trivial follow-ups; no operational dependency.

**Status:** `[x] complete` — and **superseded as the primary public surface by Phase 2** (see Supersession note above). The `app.consentshield.in/status` route + admin panel + pg_cron probes continue to run as a secondary internal-readout until Sprint 2.7 retires them.

---

## Phase 2 — Better Stack integration (Proposed 2026-04-25)

### Context

Phase 1 shipped a working self-hosted status page but the Phase-1 wireframe doesn't satisfy the marketing-claims review's Issue-18 spec (multi-region 30-second probes, per-surface uptime targets, subscriber notifications, incident-comms post-mortems, public 90-day rolling history with per-component availability). Building those primitives in-house adds ~3–4 weeks of work for surface that isn't a product wedge. Better Stack (formerly Better Uptime + Better Logs / Logtail) ships every primitive the marketing copy promises and integrates in days — see the Supersession note for the full reasoning.

### Decision (Phase 2)

1. **External status surface** — `status.consentshield.in` cuts over from the Vercel-aliased self-hosted page to the Better Stack hosted public status page. The Better Stack page renders ConsentShield branding (custom domain + colours + logo) so the third-party-vendor framing stays implicit, not loud.
2. **Seven monitors** mirroring the existing `marketing/src/app/docs/status/page.mdx` ParamTable (REST API v1, Worker event ingestion, Rights-request portal, Dashboard, Admin console, Deletion-connector dispatch, Notification dispatch). Cadences and targets per the marketing copy: 30-second from EU + US + APAC for the v1 REST API and Worker; 1-minute for the Dashboard; per-minute synthetic for Rights-request portal; internal heartbeat for Admin console; queue-depth/latency heartbeat for Deletion-connector and Notification dispatch.
3. **Incident-comms templates** — sev1 / sev2 / sev3 incident severity, statuses `investigating` → `identified` → `monitoring` → `resolved`. Post-mortems for sev1 incidents publish within 14 business days; auto-link from the resolved incident card.
4. **SLA surface alignment** — per-surface uptime targets currently rendered in the marketing copy (REST API 99.9%/mo, Worker 99.99%/mo, Dashboard 99.5%/mo) are honoured by Better Stack monitors; if the live measured value drops below the marketing target for any month, the status page surfaces the actual measured number rather than the marketing aspiration.
5. **Subscriber notifications** — public subscribe form on the status page; channels: email (via Better Stack's native sender + Resend fallback for India-bound delivery), RSS, webhook. Customers self-serve subscription per-component.
6. **Phase 1 disposition** — admin status panel + customer-app `/status` route + pg_cron probes stay running as **internal operator readouts**. They no longer power the public surface; they act as a redundant in-perimeter view that's useful when Better Stack itself is degraded (rare; their availability is order-of-magnitude better than ours).
7. **No new ADR series** — Phase 2 lands inside this ADR-1018 rather than a new ADR-1300 series. The marketing-claims review's `1300–1399` band reservation is withdrawn.

### Consequences (Phase 2)

- **Cost:** Better Stack pricing is per-monitor / per-incident-channel; 7 monitors + email/SMS subscriber notifications + Slack incident integration sits in the low-three-figures-per-month band. Documented in the charter sprint when the operator picks the plan tier.
- **Stronger trust artefact:** the BFSI / large-corporate buyer reads "Better Stack on `status.consentshield.in`" as more credible than an in-product status route — the third-party ingestion path is the safety against "the platform telling us about its own outage."
- **Marketing copy at `marketing/src/app/docs/status/page.mdx`** continues to render unchanged; Better Stack's surface is the canonical truth it points at. No `/docs/status` rewrite needed beyond removing wording that no longer applies (e.g., the "hosted outside our primary infrastructure" line is now literally true).
- **Phase 1 internal-readout cost** stays at zero — pg_cron + Edge Function are already running and serve as a backup view.
- **Reversibility:** if Better Stack proves too expensive or insufficient, the Phase 1 internal route still works and can be re-promoted to primary by reversing Sprint 2.6's DNS cutover.

### Implementation Plan

#### Sprint 2.1 — Charter, plan tier selection, account creation

**Deliverables:**
- [x] Operator created Better Stack account, owned by `info@consentshield.in`. Completed 2026-04-25.
- [x] Plan tier selected: **Free / $0/mo**. Founder direction (2026-04-25): stay on free tier through pre-launch; upgrade at the moment we open external distribution of `status.consentshield.in`. Marketing copy at `marketing/src/app/docs/status/page.mdx` stays as the post-upgrade target spec; aspirational-but-not-misleading because the page itself is gated behind the marketing OTP gate (ADR-0502) until launch.
- [x] Cost recorded: $0/mo while on free tier; Sprint 2.5 launch-gate triggers the upgrade decision (likely the Hobbyist or Team tier, whichever exposes 30-second multi-region + custom domain + email/RSS/webhook subscribers).
- [x] API token generated, named `consentshield-marketing-prod`, account-level scope.
- [x] Token stored in `vercel env` for the `consentshield-marketing` project as `BETTERSTACK_API_TOKEN` on **Production + Preview** scopes. Verified via `bunx vercel@latest env ls`.

**Operator runbook:** `docs/runbooks/adr-1018-phase-2-better-stack-sprint-2-1.md`.

### Free-tier vs marketing-copy reconciliation note

The marketing copy promises 30-second multi-region cadence, custom domain, and email/RSS/webhook subscribers — none of which BS free typically exposes. Sprint 2.2 below will configure what free actually allows (likely 3-minute single-region monitors); Sprints 2.4 + 2.5 + 2.6 are **gated on an upgrade-at-launch operator decision**. Pre-release blocker on external distribution of `status.consentshield.in` therefore now reads *"upgrade tier + complete Sprints 2.4 → 2.6"* rather than *"complete Sprint 2.4 DNS cutover"* alone.

The marketing copy stays untouched in the meantime because:
1. It's the post-upgrade target spec (no honesty gap once we ship).
2. The `/docs/status` page is itself behind the ADR-0502 marketing-site OTP gate — a confidential-preview reader who hits the claims is also under invitation, not a member of the public who'd be misled by aspirational copy.

#### Sprint 2.2 — Monitor matrix configured

**Deliverables:**
- [ ] **REST API v1** — 7 group-level synthetic checks (one per `/v1/*` group: `health`, `consent`, `deletion`, `rights`, `security`, `account`, plus a `_ping`-style global liveness). 30-second cadence; latency p50 / p95 / p99 thresholds.
- [ ] **Worker event ingestion** — synthetic POST to `/v1/events` and `/v1/observations` with valid HMAC signature; 30-second cadence; verify signed-200 round-trip end-to-end so a green check actually proves the ingest path.
- [ ] **Rights-request portal** — synthetic GET on `/rights` + Turnstile presence check; 5-minute cadence; OTP synthetic-delivery covered separately under (7).
- [ ] **Dashboard** — auth'd synthetic login probe (test account, MFA-aware) + DEPA-panel render check + billing-page read; per-minute cadence.
- [ ] **Admin console** — Better Stack heartbeat from inside the admin proxy (no external probe — leaks subsystem names otherwise); surfaces a binary up/down only.
- [ ] **Deletion-connector dispatch** — heartbeat URL from `process-artefact-revocation` Edge Function on each successful sweep; surfaces "no successful dispatch in N minutes" as a fail.
- [ ] **Notification dispatch** — Resend delivery health + custom-webhook adapter health; tracks per-org delivery-success rate.

#### Sprint 2.3 — Incident-comms templates + post-mortem flow

**Deliverables:**
- [ ] Incident severity matrix in Better Stack — sev1 (full outage / data-path down), sev2 (degraded / partial), sev3 (advisory / planned).
- [ ] Template library — `investigating` / `identified` / `monitoring` / `resolved` per severity; ConsentShield brand voice; aligns with the marketing copy's wording on `marketing/src/app/docs/status/page.mdx`.
- [ ] Post-mortem publishing rule — sev1 / sev2 published within 14 business days; auto-linked from resolved incident card.
- [ ] SLA-credit calculator surface — links to ADR-0806 (enterprise SLA surface from the `0800` Enterprise-platform series, when that ships).

#### Sprint 2.4 — DNS cutover from Phase-1 self-hosted to Better Stack

**Deliverables:**
- [ ] Better Stack hosted status page resource created (slug chosen at creation time — a per-status-page identifier, not an account-level slug); smoke-tested at whatever `status.betterstack.com/<slug>` URL BS assigns.
- [ ] Custom domain configured in Better Stack: `status.consentshield.in`. ConsentShield logo + brand palette uploaded.
- [ ] DNS CNAME `status.consentshield.in` flipped from `cname.vercel-dns.com` (Phase 1) to Better Stack's status-page CNAME target.
- [ ] Vercel domain alias removed from the `app` project: `bunx vercel domains rm status.consentshield.in --scope sanegondhis-projects`.
- [ ] Host-based redirect in `app/src/app/page.tsx` (Phase 1 Sprint 1.5) left in place but now unreachable — Sprint 2.7 cleanup will remove it.
- [ ] TLS verified: `curl -I https://status.consentshield.in` → `200` from Better Stack's CDN; ConsentShield-branded page renders.

#### Sprint 2.5 — Uptime-target alignment + auto-degrade

**Deliverables:**
- [ ] Per-monitor SLA targets configured in Better Stack to match the marketing copy: REST API 99.9%/mo, Worker ingestion 99.99%/mo, Dashboard 99.5%/mo.
- [ ] Acceptance criterion enforced on the public surface: if the live measured value drops below the marketing target for any month, the status-page rolling-90-day numbers are the source of truth (Better Stack does this natively; verify the rendering).
- [ ] Marketing-side reconciliation: if a target is repeatedly missed for two consecutive months, the marketing copy at `marketing/src/app/docs/status/page.mdx` is rewritten down to the achievable number (per the "no aspirational claims" review discipline). Open a follow-up issue when triggered.

#### Sprint 2.6 — Subscriber notifications

**Deliverables:**
- [ ] Public subscribe form on the Better Stack status page — channels: email, RSS, webhook.
- [ ] Email sender — Better Stack native; `noreply@consentshield.in` verified as additional sender via Resend fallback (per `reference_email_deliverability` memory) for India-bound deliverability.
- [ ] RSS feed verified — `https://status.consentshield.in/feed.xml` (or Better Stack's path) consumable by standard readers.
- [ ] Webhook payload contract documented in `marketing/src/app/docs/status/page.mdx` as a follow-up.

#### Sprint 2.7 — Phase 1 disposition

Self-hosted Phase 1 stays running as an internal operator readout. This sprint records the long-term plan rather than retiring the code:

**Disposition:**
- [ ] **Keep running:** `public.status_subsystems` / `status_checks` / `status_incidents` tables; `run-status-probes` Edge Function on pg_cron `*/5 * * * *`; admin status panel at `/admin/(operator)/status`; customer-app `/status` route. These remain useful as an in-perimeter readout for operator triage.
- [ ] **Remove:** the host-based redirect in `app/src/app/page.tsx` that maps `status.consentshield.in` → `/status` — that host now points at Better Stack so the redirect is dead code. Replace with `// host=status.consentshield.in is served by Better Stack — see ADR-1018 Phase 2.` comment.
- [ ] **Vercel domain alias:** `bunx vercel domains rm status.consentshield.in` from the `app` Vercel project (Sprint 2.4 deliverable; reaffirmed here).
- [ ] **Marketing copy:** the line *"hosted outside our primary infrastructure so the page stays reachable when the API itself is degraded"* in `marketing/src/app/docs/status/page.mdx` was true in Phase 1 only by virtue of being on a different Vercel project, and is **literally true** under Phase 2 (Better Stack runs entirely outside our infrastructure). Leave the line; possibly soften the qualifier when the rest of `/docs/status` is reviewed.
- [ ] **Internal-only re-purposing:** an admin operator can still post a private incident in the Phase-1 admin panel for internal-only tracking (e.g., a maintenance window not yet ready for public communication). The `/admin/(operator)/status` panel remains the right tool for that. Better Stack publishes only what an operator publishes there.

#### Sprint 2.8 — Marketing copy alignment

**Deliverables:**
- [ ] Audit `marketing/src/app/docs/status/page.mdx` against the Better Stack monitor matrix — confirm every claim resolves to a configured Better Stack monitor.
- [ ] Confirm the marketing-claims review Issue 18 is fully resolved.
- [ ] Update the marketing-claims review's "Pending corrections" trailer with a "Resolved" status pointing at this ADR.

### Pre-release gate (Phase 2)

External distribution of any link to `status.consentshield.in` holds until **Sprint 2.4 (DNS cutover)** completes. Sprints 2.5–2.8 can follow without blocking external distribution but are pre-launch blockers for the Issue-18 acceptance criterion (uptime-target alignment + subscriber notifications + copy alignment).

---

## Architecture Changes

- `docs/architecture/consentshield-definitive-architecture.md` — new subsection under Surface 5 (Operator Console) describing the status-page schema + admin vs public split.
- `docs/architecture/consentshield-complete-schema-design.md` — add the three `status_*` tables with column descriptions.

---

## Test Results

### Sprint 1.4 — 2026-04-22

**Live smoke-test against dev Supabase.** Both Edge Functions deployed to `xlqiakmkdjycfiioslgs`; migration `20260804000015` applied.

- `GET https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/health` — `200 OK` — `{"ok":true,"surface":"edge_functions","at":"..."}`
- `POST https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/run-status-probes` — `200 OK` — `{"ok":true,"probed":5,"skipped":1,"flipped":0}` — 5 subsystems with non-null `health_url` probed; `notification_channels` skipped (null). All checks operational → no state flips. One row per subsystem written to `public.status_checks`.

Consecutive-failure flip path, maintenance-override safety, and heartbeat-check cron are exercised in production once probes accumulate; not in the v1 smoke test.

---

## Changelog References

- `CHANGELOG-schema.md` — Sprint 1.1 schema + seed + admin RPCs
- `CHANGELOG-dashboard.md` — Sprint 1.2 admin panel + Sprint 1.3 public page
- `CHANGELOG-edge-functions.md` — Sprint 1.4 run-status-probes
- `CHANGELOG-infra.md` — Sprint 1.5 DNS + Vercel alias
- `CHANGELOG-docs.md` — ADR + runbook
