# Runbook — ADR-1018 Phase 2: Self-hosted Uptime Kuma at `status.consentshield.in`

**Owning ADR:** `docs/ADRs/ADR-1018-self-hosted-status-page.md` Phase 2.
**Last update:** 2026-04-26.
**Replaces:** `docs/runbooks/adr-1018-phase-2-better-stack-sprint-2-1.md` (deleted; Better Stack approach abandoned).

This runbook walks the operator through Sprints 2.2 → 2.6 of ADR-1018 Phase 2. Sprint 2.1 (Kuma instance up + DNS + `KUMA_API_KEY`) is already done as part of the 2026-04-26 operator setup.

---

## Operator pre-flight

Before starting any sprint:

- [ ] Confirm `https://status.consentshield.in/dashboard` returns the Kuma login page.
- [ ] Confirm you can sign in with the Kuma admin account.
- [ ] Confirm `.secrets` at the repo root contains `KUMA_API_KEY=…` (gitignored).
- [ ] Confirm `/usr/bin/curl -sI https://status.consentshield.in/` returns a 302 redirect to `/dashboard` (Kuma's standard root behaviour).

If any of these fail, fix Sprint 2.1 before proceeding.

---

## Sprint 2.2 — Monitor matrix

Goal: get four HTTP-pull monitors live in Kuma covering the wireframe-spec surfaces that already expose unauthenticated probe URLs. The remaining three wireframe surfaces ship as sub-sprints 2.2.1 → 2.2.7 against this same instance.

### Path-A monitors — operator dashboard steps

In Kuma → **Monitors** → **+ Add new monitor**, create each of the four:

| Setting | Value (Monitor 1 — Customer App `/api/health`) |
|---|---|
| Monitor type | `HTTP(s)` |
| Friendly name | `Customer App — /api/health` |
| URL | `https://app.consentshield.in/api/health` |
| Heartbeat interval | `60` (seconds) |
| Retries | `2` |
| Heartbeat retry interval | `60` |
| Request timeout | `30` |
| Method | `GET` |
| Accepted Status Codes | `200-299` |
| Tags | add tag `area:dashboard` (create if absent — colour green) |

| Setting | Value (Monitor 2 — Supabase Edge `/functions/v1/health`) |
|---|---|
| Monitor type | `HTTP(s)` |
| Friendly name | `Supabase Edge — /functions/v1/health` |
| URL | `https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/health` |
| Heartbeat interval | `60` |
| Tags | `area:edge` (colour blue) |

| Setting | Value (Monitor 3 — Marketing gate `/gate`) |
|---|---|
| Monitor type | `HTTP(s)` |
| Friendly name | `Marketing gate — /gate` |
| URL | `https://consentshield.in/gate` |
| Heartbeat interval | `60` |
| Tags | `area:marketing` (colour orange) |

| Setting | Value (Monitor 4 — Customer App `/login`) |
|---|---|
| Monitor type | `HTTP(s)` |
| Friendly name | `Customer App — /login` |
| URL | `https://app.consentshield.in/login` |
| Heartbeat interval | `60` |
| Tags | `area:dashboard` |

After creating each, wait one cadence cycle (~60 s) and confirm the monitor card flips from `Pending` → `Up`.

### Record monitor IDs

Append to this file under the heading below once you've created them:

```
ADR-1018 Sprint 2.2 — Kuma monitor IDs (recorded YYYY-MM-DD by operator)
- monitor 1 — Customer App /api/health: id <fill in>
- monitor 2 — Supabase Edge /functions/v1/health: id <fill in>
- monitor 3 — Marketing gate /gate: id <fill in>
- monitor 4 — Customer App /login: id <fill in>
```

(Kuma surfaces the numeric monitor id in the URL when you click into a monitor: `/dashboard/<id>`.)

### Sprint 2.2.x sub-sprints — push monitors

For Sprints 2.2.2 / 2.2.5 / 2.2.6 / 2.2.7, the pattern is:

1. Kuma dashboard → **+ Add new monitor**.
2. Monitor type → **Push**.
3. Friendly name per ADR (e.g. `Worker — event ingestion`).
4. Heartbeat interval = expected natural cadence in seconds (Worker = 60s; Edge dispatch = 1800s; Notification = 300s — adjust per the actual subsystem traffic).
5. Save → Kuma generates a **Push URL** of the form `https://status.consentshield.in/api/push/<token>?status=up&msg=&ping=`.
6. Copy the push URL.
7. Add it as a wrangler / Vercel / Supabase secret with the corresponding name from the ADR Sprint:
   - 2.2.2 Worker — wrangler secret `KUMA_HEARTBEAT_WORKER_EVENTS` on the worker project.
   - 2.2.5 Admin — Vercel env var `KUMA_HEARTBEAT_ADMIN_HEALTH` on the `consentshield-admin` project Production scope.
   - 2.2.6 Edge — Supabase Edge Function secret `KUMA_HEARTBEAT_DELETION_DISPATCH` (`supabase secrets set …`).
   - 2.2.7 Notification dispatch — same project + scope as the dispatcher's home; secret name `KUMA_HEARTBEAT_NOTIFICATION_DISPATCH`.
8. Tell Terminal C / whoever's wiring the application code to add a single fire-and-forget `fetch(url)` call to the relevant code path (non-blocking; Rule 16 carve-out not triggered — single fetch, no new dep).

For Sprints 2.2.1 (REST API v1) and 2.2.3 (Rights portal), the unblock is a customer-app code change (unauthenticated `/v1/_ping` or `/v1/health`; rights portal route shipped) — once the route is live, create the monitor as a standard HTTP-pull (same pattern as the path-A four).

For Sprint 2.2.4 (Dashboard auth'd probe), check whether the Kuma version installed exposes "Authenticated synthetic" / Playwright-style monitors. If yes, configure that monitor type per Kuma docs. If no, defer until a Kuma upgrade or skip in favour of the path-A `/login` HTTP-pull.

---

## Sprint 2.3 — Status page configuration

Kuma → **Status pages** → **+ New status page**.

| Setting | Value |
|---|---|
| Slug | `consentshield` |
| Title | `ConsentShield Status` |
| Description | `Live status of the ConsentShield platform — public API, customer app, operator surfaces, background pipelines.` |
| Theme | `Light` (or align with current marketing palette later) |
| Footer text | `© 2026 ConsentShield · consentshield.in` |
| Custom CSS | None (Phase 2 ships plain; Phase 3 can iterate on brand) |
| Show powered by | `false` |
| Show certificate expiry | `true` (BFSI procurement reads this favourably) |
| Show tags | `true` (powers the area-grouped layout) |

In **Add monitors**, attach all four path-A monitors plus any sub-sprint push monitors that have come online. Group by tag:
- `area:public-api` group → Worker, REST API monitors (when 2.2.1, 2.2.2 land)
- `area:dashboard` group → Customer App `/api/health`, `/login`, eventual auth'd Dashboard probe
- `area:edge` group → Supabase Edge, Deletion-connector dispatch (when 2.2.6 lands)
- `area:marketing` group → Marketing gate, Rights-request portal (when 2.2.3 lands)

Save → Kuma assigns the status page URL `https://status.consentshield.in/status/consentshield`.

### Custom domain

Kuma → Status page → Edit → **Domain Names** field → add `status.consentshield.in`. The operator already pointed DNS at the Kuma instance on 2026-04-26; this step tells Kuma to serve the status page on that hostname.

After saving, hitting `https://status.consentshield.in/` directly should show the status page (Kuma routes the bare hostname to the configured status page).

### Incident severity templates

Kuma → Settings → **Maintenance** templates and **Incident** templates. Configure three severity tiers:

| Severity | Use for | Default duration | Default message |
|---|---|---|---|
| sev1 | Full outage / data-path down | until resolved | `We are investigating a service outage affecting <component>. Updates every 30 minutes until resolved.` |
| sev2 | Degraded / partial | until resolved | `Degraded performance on <component>. Service is functional with elevated latency or partial unavailability.` |
| sev3 | Advisory / planned | per-incident | `Scheduled maintenance on <component> from <start> to <end>. No customer action required.` |

Status flow: `investigating` → `identified` → `monitoring` → `resolved`. Kuma uses these by default on incident posts; the templates above just save the operator typing on the announcement field.

Post-mortem rule: sev1 + sev2 incidents publish a post-mortem within 14 business days. Operator-discipline only at this scale; no automation today.

---

## Sprint 2.4 — Custom domain + first public render

Already done as part of Sprint 2.3 (custom-domain field), which couples DNS + Kuma config. Verify:

```sh
/usr/bin/curl -sI https://status.consentshield.in/ | /usr/bin/awk 'NR<=10{print}'
```

Expect `HTTP/2 200` (or a 302 → `/status/consentshield`).

```sh
/usr/bin/curl -sI https://status.consentshield.in/status/consentshield | /usr/bin/awk 'NR<=10{print}'
```

Expect `HTTP/2 200` and HTML rendering the four monitors.

---

## Sprint 2.5 — Uptime targets + auto-degrade

Kuma surfaces measured uptime per monitor on the status page automatically. The wireframe-spec targets become operator-side reference numbers:

| Monitor area | Marketing-copy target | Action if missed two consecutive months |
|---|---|---|
| REST API v1 | 99.9% / month | Open issue; rewrite copy down to achievable number per "no aspirational claims" review discipline |
| Worker ingestion | 99.99% / month | Same |
| Dashboard | 99.5% / month | Same |

No Kuma config required — Kuma renders the actual rolling-90-day percentage automatically.

---

## Sprint 2.6 — Notifications

### Email (Resend SMTP)

Kuma → Settings → **Notifications** → + New → type `SMTP`.

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Secure (SSL/TLS) | `true` |
| Username | `resend` |
| Password | reuse `RESEND_API_KEY` from the existing customer-app / admin / marketing setup (per `reference_email_deliverability` memory). Pull from `app/.env.local` or `marketing/.env.local`. |
| From email | `noreply@consentshield.in` |
| To email (default operator) | `info@consentshield.in` |

Test with the **Test** button in Kuma; expect an email within seconds.

### Slack

Kuma → Settings → **Notifications** → + New → type `Slack`.

OAuth into the ConsentShield Slack workspace; pick channel `#consentshield-status` (create the channel first in Slack if absent).

Map sev1 + sev2 to this Slack channel; sev3 stays email-only by default.

### RSS feed

No configuration needed — Kuma exposes `https://status.consentshield.in/api/rss/consentshield` natively once the status page is created. Verify in any standard RSS reader.

### Webhook (optional, partner-driven)

If a specific partner customer wants raw incident events, add a webhook channel in Settings → Notifications → Webhook. Document the payload shape in `marketing/src/app/docs/status/page.mdx` Phase-2 follow-up.

---

## Sprint 2.7 — Phase 1 dead-code sweep

This is Terminal-A territory (customer-app `app/`); track here only as a checklist:

- [ ] `app/src/app/page.tsx` — remove the host-based redirect (`if (host === 'status.consentshield.in') redirect('/status')`). Replace with a one-line comment: `// host=status.consentshield.in is served by Uptime Kuma — see ADR-1018 Phase 2.`
- [ ] `bunx vercel@latest domains rm status.consentshield.in --scope sanegondhis-projects` from the **app** Vercel project (the Phase-1 alias).
- [ ] Confirm `app/src/app/(public)/status/page.tsx` and the `run-status-probes` Edge Function continue to work — they're now internal-only operator readouts, not public surface.

No data migration. The `public.status_*` tables and the pg_cron schedule keep running.

---

## Acceptance criteria — Phase 2 done

- [ ] Four HTTP-pull monitors created in Kuma (Sprint 2.2 path-A).
- [ ] Status page `consentshield` configured with custom domain `status.consentshield.in` (Sprints 2.3 + 2.4).
- [ ] Email + Slack + RSS notification channels live (Sprint 2.6).
- [ ] Phase-1 dead-code sweep complete (Sprint 2.7).
- [ ] Marketing copy at `marketing/src/app/docs/status/page.mdx` audited against the live Kuma monitor matrix; review Issue-18 trailer flipped to `Resolved` (Sprint 2.8).
- [ ] At least one of the heartbeat sub-sprints (2.2.2 / 2.2.5 / 2.2.6 / 2.2.7) live as a working push-monitor proof.

---

## Sprint 2.2 — Kuma monitor IDs (recorded YYYY-MM-DD by operator)

(Fill in once the four path-A monitors are created.)

- monitor 1 — Customer App /api/health: id `<fill in>`
- monitor 2 — Supabase Edge /functions/v1/health: id `<fill in>`
- monitor 3 — Marketing gate /gate: id `<fill in>`
- monitor 4 — Customer App /login: id `<fill in>`
