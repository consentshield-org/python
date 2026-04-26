# ADR-1018: Status page — Phase 1 in-app (superseded), Phase 2 self-hosted Uptime Kuma at status.consentshield.in

**Status:** In Progress (Phase 1 Completed and superseded; Phase 2 In Progress)
**Date proposed:** 2026-04-22 (Phase 1) · 2026-04-25 (Phase 2 supersession; Better Stack approach) · **2026-04-26 (Phase 2 vendor pivot to self-hosted Uptime Kuma)**
**Phase 1 completed:** 2026-04-23
**Phase 2 vendor pivot completed:** 2026-04-26 — Better Stack account dormant; resources torn down; replaced by self-hosted Uptime Kuma at `status.consentshield.in` (Railway-hosted).
**Supersedes (in part):** ADR-1005 Phase 4 Sprint 4.1/4.2 (StatusPage.io provisioning)
**Related:** ADR-1017 (admin ops-readiness surface) · marketing-claims review 2026-04-25 Issue 18

---

## Supersession notes

### 2026-04-25 — Phase 1 (in-app self-hosted) → Phase 2 (third-party SaaS)

Phase 1 (self-hosted status page on admin + customer-app `/status`) was scoped, built, and live by 2026-04-23. The marketing-claims review on 2026-04-25 (`docs/reviews/2026-04-25-marketing-claims-vs-reality-review.md` Issue 18) re-examined the public-facing claims that point at `status.consentshield.in` — *"real-time platform health, uptime metrics, and incident history"* with seven monitored surfaces, per-surface uptime targets, and *"probed every 30 seconds from three geographic regions"* — and concluded the in-app Phase 1 implementation did not meet that wireframe today and would require non-trivial work to do so (multi-region probes, subscriber email/RSS/webhook notifications, uptime-history rollups, incident-comms templating, etc.).

Phase 2 was therefore proposed to lift the public surface to a vendor-managed page. Reasons recorded at the time:

- The compliance-perimeter argument was weak — the public status page renders brand + aggregate uptime, not customer data.
- BFSI / large-corporate procurement reads a third-party page as a stronger trust signal than an in-product status route.
- Buying multi-region synthetic probes is order-of-magnitude cheaper than building them in-house.

### 2026-04-26 — Phase 2 vendor pivot: Better Stack → self-hosted Uptime Kuma

Better Stack was originally selected for Phase 2 because its hosted SaaS surface satisfied the wireframe spec without us building the multi-region probe primitive. Sprint 2.1 created the BS account; Sprint 2.2 path-A created four monitors; Sprint 2.4 reconnaissance created the BS status page resource. The blocker that surfaced: free-tier silently drops `custom_domain`, `subscribable`, and `password_enabled`, and the BS marketing copy spec required all three. The launch-time tier upgrade was the recorded gate.

Operator decision 2026-04-26: drop Better Stack entirely; self-host **Uptime Kuma** at `status.consentshield.in`. Reasoning:

- **No SaaS spend at any tier.** Kuma is open-source; the only cost is the hosting (Railway, ~$5/mo or free under the existing Railway allowance).
- **No artificial limits.** Kuma has no monitor cap, no cadence floor, no paywall on subscribers / custom domain / password protection.
- **Custom domain works on day one.** `status.consentshield.in` already serves the Kuma instance.
- **Operator already runs it.** Railway-hosted Kuma instance is up, dashboard reachable, `KUMA_API_KEY` provisioned in `.secrets`. Lower friction than ongoing BS workspace management.
- **Compliance perimeter trade-off accepted.** The 2026-04-25 reasoning that pushed toward a third-party page (BFSI procurement reads "third party" as trust signal) is partially eroded by the Phase-1 supersession argument anyway: the public status page renders brand + aggregate uptime, not customer data. A self-hosted Kuma reads exactly like a vendor-hosted page to a procurement reviewer; the trust signal lives in the **brand-domain + clean rendering**, not in the underlying SaaS.

**Better Stack teardown record (2026-04-26):**

- BS monitors `4326425`, `4326426`, `4326427`, `4326428` deleted via `DELETE /api/v2/monitors/{id}` (returned 204 each).
- BS status page resource `245019` deleted via `DELETE /api/v2/status-pages/245019` (204).
- Pre-existing operator-created paused monitor `4325807` left in place (not Sprint-2.x work; harmless).
- `BETTERSTACK_API_TOKEN` removed from `consentshield-marketing` Vercel project Production + Preview scopes.
- BS account on `info@consentshield.in` left dormant ($0/mo free tier; no reason to close immediately).

**Phase 1 disposition (unchanged from 2026-04-25 framing).** The customer-app `/status` route + admin panel + pg_cron probes + `status_*` tables stay running as **internal operator readout** for in-perimeter triage when Kuma itself is degraded. The host-based redirect in `app/src/app/page.tsx` that mapped `status.consentshield.in` → `/status` is now dead code (DNS no longer points at the `app` Vercel project for that hostname); Sprint 2.7 cleanup retires it.

**ADR-1300 retirement (unchanged from 2026-04-25 framing).** The marketing-claims review's proposed `ADR-1300` series stays withdrawn; this ADR-1018 absorbs both the BS-investigation-and-retirement record and the Kuma-adoption plan as a single coherent ADR.

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

## Phase 2 — Self-hosted Uptime Kuma at `status.consentshield.in` (In Progress 2026-04-26)

### Context

Phase 1 (in-app self-hosted) didn't meet the marketing wireframe; Better Stack was selected on 2026-04-25 as the SaaS replacement; on 2026-04-26 the operator pivoted to **self-hosted Uptime Kuma** on Railway after the BS free-tier blockers (custom domain, subscribers, password protection all paid-tier-gated) and the price-vs-value calculation made BS unattractive. See the Supersession notes above for the full reasoning trail.

Uptime Kuma is an open-source uptime monitor + status page in one. Operator runs it on Railway (asia-southeast1; ~$5/mo or under existing Railway allowance). No artificial limits on monitor count, cadence floor, subscribers, custom domain, or password protection — all features Kuma exposes by default. The Kuma dashboard is the management surface; `status.consentshield.in/<status-page-slug>` is the public surface; `/api/push/<token>` is the per-monitor heartbeat ingest URL; `/metrics` is the Prometheus-format scrape target authenticated with `KUMA_API_KEY` as the HTTP Basic password.

### Decision (Phase 2)

1. **Public status surface** — `status.consentshield.in` now serves Uptime Kuma directly (Railway-hosted; DNS already pointed at Kuma's edge as of 2026-04-26). No Vercel alias, no third-party CDN in the path.
2. **Seven monitors** mirroring the existing `marketing/src/app/docs/status/page.mdx` ParamTable (REST API v1, Worker event ingestion, Rights-request portal, Dashboard, Admin console, Deletion-connector dispatch, Notification dispatch). Mix of HTTP-pull monitors (anything that exposes an unauthenticated probe URL) and **push** monitors (any subsystem that's better instrumented to emit a heartbeat than to be probed externally — Worker after each successful HMAC-verified write, Edge Function after each successful sweep, etc.). Kuma exposes both monitor types with no extra cost.
3. **Status-page configuration** — branded ConsentShield status page in Kuma with the seven monitors grouped by area (Public API · Customer App · Operator surfaces · Background pipelines). Custom domain configured (`status.consentshield.in`). Password-free public read. Subscriber form enabled (email; Slack/webhook integration as Phase 2.6).
4. **Incident-comms templates** — Kuma's native incident system: sev1 / sev2 / sev3 severity, `investigating` → `identified` → `monitoring` → `resolved` lifecycle. Post-mortems for sev1 / sev2 published within 14 business days. Operator posts incidents from the Kuma dashboard.
5. **SLA surface alignment** — Kuma's native per-monitor uptime tracking honours the marketing-copy targets (REST API 99.9%/mo, Worker 99.99%/mo, Dashboard 99.5%/mo). If a target is repeatedly missed, marketing copy at `marketing/src/app/docs/status/page.mdx` rewrites down to the achievable number (per the "no aspirational claims" review discipline).
6. **Subscriber notifications** — Kuma supports email out of the box (SMTP config; reuse Resend SMTP credentials). Slack / Discord / webhook notification channels configured per monitor or globally. RSS feed exposed at `status.consentshield.in/api/rss/<status-page-slug>` natively.
7. **Phase 1 disposition** — customer-app `/status` route + admin status panel + pg_cron probes + `status_*` tables stay running as **internal operator readouts** for in-perimeter triage. The host-based redirect in `app/src/app/page.tsx` that mapped `status.consentshield.in` → `/status` is now dead code (DNS no longer routes there); Sprint 2.7 cleanup retires it.
8. **No new ADR series** — Phase 2 lands inside this ADR-1018 (unchanged from the 2026-04-25 framing). The retired `ADR-1300` reservation stays withdrawn.

### Consequences (Phase 2)

- **Cost:** Kuma is open source; only the Railway hosting cost (low-single-digit USD/month or under the existing Railway allowance). Compared to BS's tier-upgrade trajectory ($30+/mo at the tier that exposed the wireframe-spec features), this is order-of-magnitude cheaper.
- **No paywall friction.** Custom domain works on day one; no "tier upgrade gate" delaying Sprints 2.4–2.6. Pre-release blocker on `status.consentshield.in` distribution is now keyed on Sprint 2.2 monitor configuration + Sprint 2.3 status-page config — not on a tier-upgrade event.
- **Operator manages monitor inventory in the Kuma dashboard.** Kuma's REST API is dashboard-shaped (the `KUMA_API_KEY` is a metrics-scrape + push-URL token, not a control plane), so monitor creation is human-driven through the UI, not a scriptable provisioning step. For a 7-monitor inventory at our audience size, this is acceptable.
- **`KUMA_API_KEY` lives in `.secrets`** (gitignored). Used for: (a) `/metrics` Prometheus scraping when we wire that into a future operator dashboard, (b) push monitor URLs that are themselves long-lived bearers (each push URL contains its own per-monitor token).
- **Marketing copy at `marketing/src/app/docs/status/page.mdx`** continues to render unchanged. Kuma satisfies every claim the wireframe makes; the line *"hosted outside our primary infrastructure so the page stays reachable when the API itself is degraded"* is **literally true** — Kuma runs on Railway in `asia-southeast1`, not on the `consentshield-marketing` / `consentshield` / `consentshield-admin` Vercel projects.
- **Phase 1 internal-readout cost** stays at zero — pg_cron + Edge Function continue to run; the in-app `/status` route is still anon-readable from the customer app at `app.consentshield.in/status`.
- **Reversibility:** if Kuma proves insufficient (e.g., we need multi-region external probes that Kuma can't run from a single Railway region), the Phase 1 internal route still works and can be re-promoted to primary by repointing DNS at the `app` Vercel project. Or we re-enter the BS conversation with a known cost.

### Implementation Plan

#### Sprint 2.1 — Kuma instance up + DNS + secret in place

**Deliverables (landed 2026-04-26):**
- [x] Operator deployed Uptime Kuma on Railway (`asia-southeast1`). Dashboard reachable at `https://status.consentshield.in/dashboard`.
- [x] DNS for `status.consentshield.in` repointed at the Railway-hosted Kuma instance (replaces the Phase 1 alias to the `app` Vercel project).
- [x] Operator-created Kuma admin login; API key generated in dashboard → Settings.
- [x] `KUMA_API_KEY` saved to repo-root `.secrets` (gitignored). Used for `/metrics` Basic-auth scrape + future operator-side observability wiring.

**Better Stack teardown (also landed 2026-04-26):**
- [x] BS monitors `4326425`, `4326426`, `4326427`, `4326428` deleted via `DELETE /api/v2/monitors/{id}` (204 each).
- [x] BS status page resource `245019` deleted via `DELETE /api/v2/status-pages/245019` (204).
- [x] `BETTERSTACK_API_TOKEN` env var removed from `consentshield-marketing` Vercel project Production + Preview scopes.
- [x] BS account on `info@consentshield.in` left dormant (free tier, $0/mo; close manually whenever convenient).
- [x] Operator runbook `docs/runbooks/adr-1018-phase-2-better-stack-sprint-2-1.md` deleted (superseded by `docs/runbooks/adr-1018-phase-2-uptime-kuma.md`).

**Operator runbook (Kuma):** `docs/runbooks/adr-1018-phase-2-uptime-kuma.md` (Sprint 2.2 onward — monitor matrix, status-page config, notification channels).

#### Sprint 2.2 — Monitor matrix configured (Kuma)

Path-A scope: HTTP-pull monitors against already-live unauthenticated surfaces. The remaining wireframe monitors split into seven sub-sprints (2.2.1 → 2.2.7), each unblocked when its target surface or heartbeat instrumentation lands.

Kuma-shaped notes:
- **Monitor management is dashboard-only.** Kuma's REST surface is metrics-scrape + push-URL only; control-plane operations (create / list / edit / delete monitors, status pages, notification channels) live in the dashboard. The seven monitors land via the operator runbook `docs/runbooks/adr-1018-phase-2-uptime-kuma.md`.
- **Push monitors** (a.k.a. heartbeat monitors) — Kuma generates a unique ingest URL per push monitor: `https://status.consentshield.in/api/push/<token>?status=up&msg=&ping=`. Caller pings it on each successful operation; Kuma alerts when no ping received for the configured interval. This is the cheapest way to monitor the Worker / Edge / Notification subsystems where building an external probe is harder than emitting a single fetch from inside the application code.
- **HTTP-pull monitors** — standard "GET URL every N seconds, expect 200" against unauthenticated endpoints.

**Path-A monitors (HTTP-pull; create in Kuma dashboard):**

| Name | URL | Cadence | Maps to wireframe |
|---|---|---|---|
| Customer App — `/api/health` | `https://app.consentshield.in/api/health` | 60s | partial cover for Dashboard + REST API v1 |
| Supabase Edge — `/functions/v1/health` | `https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/health` | 60s | partial cover for Edge Functions surface |
| Marketing gate — `/gate` | `https://consentshield.in/gate` | 60s | covers the marketing surface |
| Customer App — `/login` | `https://app.consentshield.in/login` | 60s | partial cover for Dashboard surface |

Cadences: Kuma has no paywall on cadence; 60s is comfortable. Single-region (Railway `asia-southeast1`) — multi-region requires a second Kuma instance or a paid third-party (deferred to "if-and-when launch demands").

**Deliverables:**
- [ ] Operator creates the four HTTP-pull monitors above in the Kuma dashboard. Records the resulting Kuma monitor IDs in `docs/runbooks/adr-1018-phase-2-uptime-kuma.md` Sprint 2.2 section.
- [ ] All four monitors transition from `Pending` → `Up` within one cadence cycle.
- [ ] Kuma `Tags` applied: `area:public-api`, `area:edge`, `area:marketing`, `area:dashboard` for the four monitors respectively. Powers the status-page grouping in Sprint 2.3.

**Seven follow-up sub-sprints — each one unblocks a wireframe-true monitor:**

##### Sprint 2.2.1 — REST API v1 monitor

- **Unblock trigger:** customer app exposes an unauthenticated liveness endpoint on the `/v1/*` URL space — either `/v1/_ping` patched to short-circuit before the Bearer middleware, or a sibling `/v1/health` route added. The api.consentshield.in DNS + host-conditional rewrite already landed (2026-04-25); only the auth-on-`_ping` posture remains. Customer-app code change (Terminal A's territory).
- **Kuma monitor to add when unblocked:** HTTP-pull monitor against `https://api.consentshield.in/v1/_ping` (or `/v1/health`), 60s cadence, expect 200.

##### Sprint 2.2.2 — Worker event ingestion monitor

- **Unblock trigger:** Worker code wires a heartbeat ping to a Kuma push URL on each successful HMAC-verified write (cheaper + safer than asking Kuma to construct an HMAC-signed POST from outside).
- **Implementation:** operator creates a push monitor in the Kuma dashboard named "Worker — event ingestion"; captures the per-monitor push URL `https://status.consentshield.in/api/push/<token>?status=up&msg=&ping=`; that URL is added to the Worker as a wrangler secret `KUMA_HEARTBEAT_WORKER_EVENTS`; `worker/src/events.ts` + `worker/src/observations.ts` add a single fire-and-forget `fetch()` to the URL after the buffer write succeeds. Rule 16 carve-out not triggered (single fetch, no new dep).
- **Heartbeat interval:** match natural Worker traffic; alert when no ping received for `expected_interval × 2` (configured in the Kuma push monitor).

##### Sprint 2.2.3 — Rights-request portal monitor

- **Unblock trigger:** the public rights-request portal goes live at `app.consentshield.in/rights` (or its actual route once shipped) and returns 200 with the Turnstile widget. Today the path returns 404.
- **Kuma monitor to add when unblocked:** HTTP-pull on the rights-portal URL with `Keyword` match on a Turnstile-presence string; 5-min cadence.

##### Sprint 2.2.4 — Dashboard auth'd probe

- **Unblock trigger:** decision on whether Kuma's Playwright-style auth probe (recently added to upstream Kuma) is enabled on the operator's instance. If the deployed Kuma version supports authenticated synthetic monitors, no third-party tier upgrade is needed; the deliverable is purely operator configuration.
- **Kuma monitor to add when unblocked:** Authenticated synthetic that signs in with a test-account + AAL2 OTP fixture, navigates to `/dashboard`, asserts DEPA-panel render, asserts billing-page read; 1-min cadence.
- **Fallback if Kuma version lacks Playwright support:** keep Sprint 2.2's `/login` HTTP-pull as the Dashboard proxy; defer authenticated probing to Kuma upgrade or Phase 3 enhancement.

##### Sprint 2.2.5 — Admin console monitor

- **Unblock trigger:** Admin-proxy code adds a heartbeat ping to a Kuma push URL on every authed admin request (or on a per-minute internal cron — whichever is cheaper). Admin code change.
- **Kuma monitor to add:** push monitor with the URL stored as wrangler-secret-equivalent in the admin Vercel project env (`KUMA_HEARTBEAT_ADMIN_HEALTH`). Surfaces binary up/down only — no admin-route names exposed.

##### Sprint 2.2.6 — Deletion-connector dispatch monitor

- **Unblock trigger:** `supabase/functions/process-artefact-revocation/index.ts` adds a heartbeat ping to a Kuma push URL on each successful sweep that produced ≥ 1 receipt. Edge Function code change (Terminal A's territory).
- **Kuma monitor to add:** push monitor; alert when no ping received for 30 min (covers the natural cadence of the safety-net pg_cron). Push URL stored as Supabase Edge Function secret `KUMA_HEARTBEAT_DELETION_DISPATCH`.

##### Sprint 2.2.7 — Notification dispatch monitor

- **Unblock trigger:** Resend delivery health + custom-webhook adapter health both ping a Kuma push URL on successful dispatch. Customer-app or Edge Function code change.
- **Kuma monitor to add:** push monitor `KUMA_HEARTBEAT_NOTIFICATION_DISPATCH`; alert when no ping received within the configured threshold.

##### Sub-sprint sequencing note

2.2.1 is the cheapest (single unauthenticated route on the customer app). 2.2.2 / 2.2.5 / 2.2.6 / 2.2.7 are all "add a heartbeat ping from N" — minimal Worker / Edge / app-code changes; can run in parallel as their owning code surfaces are touched. 2.2.3 waits on a route that hasn't been authored yet. 2.2.4 depends on the deployed Kuma version's Playwright support (no third-party gate any more).

#### Sprint 2.3 — Status page configuration + incident-comms templates

**Deliverables:**
- [ ] Kuma status page resource created via dashboard. Slug: `consentshield`. Custom domain: `status.consentshield.in` (already DNS-pointed; Kuma takes ownership).
- [ ] Branding — ConsentShield logo, brand palette (navy / teal accents), title `ConsentShield Status`, footer link to `https://consentshield.in`.
- [ ] Monitor groups: **Public API** (REST API v1, Worker event ingestion), **Customer App** (Dashboard, Rights-request portal), **Operator** (Admin console), **Background pipelines** (Deletion-connector dispatch, Notification dispatch).
- [ ] Incident severity matrix configured in Kuma — sev1 (full outage / data-path down), sev2 (degraded / partial), sev3 (advisory / planned).
- [ ] Template library for incident updates — `investigating` / `identified` / `monitoring` / `resolved` per severity; ConsentShield brand voice; aligns with the marketing copy's wording on `marketing/src/app/docs/status/page.mdx`.
- [ ] Post-mortem publishing rule documented — sev1 / sev2 published within 14 business days; linked from resolved incident.
- [ ] SLA-credit calculator surface — placeholder; links forward to ADR-0806 (enterprise SLA surface from the `0800` Enterprise-platform series, when that ships).

#### Sprint 2.4 — Custom domain + first public-facing render

**Status:** DNS cutover **done** as part of operator's 2026-04-26 work; this sprint covers the remaining configuration.

**Deliverables:**
- [x] DNS for `status.consentshield.in` pointed at the Kuma instance on Railway (operator action 2026-04-26).
- [ ] Custom-domain field configured inside Kuma → Status Page settings → `status.consentshield.in`. (Kuma serves the public status page on the custom domain.)
- [ ] TLS verified: `curl -I https://status.consentshield.in/<status-page-slug>` → `200`; ConsentShield-branded page renders.
- [ ] Phase-1 cleanup deferred to Sprint 2.7: host-based redirect in `app/src/app/page.tsx`, Vercel domain alias on `app` project — both are dead code now that DNS routes elsewhere; sweep happens in 2.7.

#### Sprint 2.5 — Uptime-target alignment + auto-degrade

**Deliverables:**
- [ ] Per-monitor uptime targets configured / annotated in Kuma to match the marketing copy: REST API 99.9%/mo, Worker ingestion 99.99%/mo, Dashboard 99.5%/mo. Kuma surfaces measured uptime per monitor on the status page natively; the targets become operator-side reference numbers in the runbook rather than hard-enforced thresholds.
- [ ] Acceptance criterion: if the live measured value drops below the marketing target for any month, the status-page rolling-90-day numbers are the source of truth (no aspirational rendering).
- [ ] Marketing-side reconciliation: if a target is repeatedly missed for two consecutive months, the marketing copy at `marketing/src/app/docs/status/page.mdx` is rewritten down to the achievable number (per the "no aspirational claims" review discipline). Open a follow-up issue when triggered.

#### Sprint 2.6 — Subscriber notifications

**Deliverables:**
- [ ] Email subscriber form enabled on the Kuma status page. SMTP config in Kuma → Settings → Notifications → Email; reuse Resend's SMTP credentials (`smtp.resend.com:465`, username `resend`, password = the same `RESEND_API_KEY` already on the customer app + admin app).
- [ ] Slack notification channel configured in Kuma → Settings → Notifications → Slack; OAuth into the ConsentShield Slack workspace; default channel `#consentshield-status` (create if absent). Map sev1 + sev2 to Slack; sev3 stays email-only.
- [ ] RSS feed verified — Kuma exposes `/api/rss/<status-page-slug>` natively; consumable by standard readers from `https://status.consentshield.in/api/rss/<slug>`.
- [ ] Webhook channel configured for any partner customer who wants raw incident events; payload shape documented in `marketing/src/app/docs/status/page.mdx` as a follow-up.

#### Sprint 2.7 — Phase 1 disposition + dead-code sweep

Self-hosted Phase 1 stays running as an internal operator readout. The Kuma instance is now the public surface, so the Phase-1 routing path that exposed `/status` via the customer-app deploy is dead code that can be retired:

**Disposition:**
- [ ] **Keep running:** `public.status_subsystems` / `status_checks` / `status_incidents` tables; `run-status-probes` Edge Function on pg_cron `*/5 * * * *`; admin status panel at `/admin/(operator)/status`; customer-app `/status` route accessible at `app.consentshield.in/status` (now no longer aliased through `status.consentshield.in`). These remain useful as an in-perimeter readout for operator triage.
- [ ] **Remove dead code:** the host-based redirect in `app/src/app/page.tsx` that maps `host === 'status.consentshield.in'` → `/status` — that hostname now resolves to Kuma's edge, not Vercel, so the redirect can never fire. Replace with `// host=status.consentshield.in is served by Uptime Kuma — see ADR-1018 Phase 2.` comment.
- [ ] **Vercel domain alias:** `bunx vercel domains rm status.consentshield.in --scope sanegondhis-projects` on the `app` Vercel project. The Phase 1 alias is no longer claimed in DNS but Vercel may still hold the binding internally; remove for cleanliness.
- [ ] **Marketing copy:** the line *"hosted outside our primary infrastructure so the page stays reachable when the API itself is degraded"* in `marketing/src/app/docs/status/page.mdx` is **literally true** under Phase 2 (Kuma runs on Railway, entirely outside the `consentshield-marketing` / `consentshield` / `consentshield-admin` Vercel projects). Leave as-is.
- [ ] **Internal-only re-purposing:** an admin operator can still post a private incident in the Phase-1 admin panel for internal-only tracking (e.g., a maintenance window not yet ready for public communication). The `/admin/(operator)/status` panel remains the right tool for that. Kuma publishes only what an operator publishes there.

#### Sprint 2.8 — Marketing copy alignment + Issue 18 closeout

**Deliverables:**
- [ ] Audit `marketing/src/app/docs/status/page.mdx` against the Kuma monitor matrix — confirm every claim resolves to a configured Kuma monitor or is honestly downgraded.
- [ ] Confirm the marketing-claims review Issue 18 is fully resolved against the Kuma deployment.
- [ ] Update the marketing-claims review's "Pending corrections" trailer with a "Resolved" status pointing at this ADR.

### Pre-release gate (Phase 2)

External distribution of any link to `status.consentshield.in` holds until **Sprints 2.2 + 2.3 + 2.4 (monitors + status page config + custom domain)** complete. Sprints 2.5–2.8 can follow without blocking external distribution but are pre-launch blockers for the Issue-18 acceptance criterion (uptime-target alignment + subscriber notifications + copy alignment). The DNS cutover sub-deliverable is already done (operator action 2026-04-26).

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
