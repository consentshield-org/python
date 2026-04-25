# Runbook — ADR-1018 Phase 2 Sprint 2.1: Better Stack account + token

**Owning ADR:** `docs/ADRs/ADR-1018-self-hosted-status-page.md` Phase 2 Sprint 2.1.
**Date:** 2026-04-25.
**Estimated time:** 15 minutes (operator account creation) + 1 minute (Terminal C env-var seeding).

This is the first sprint of the Phase 2 Better Stack integration. It establishes the workspace, selects a plan tier that meets the marketing-copy spec (7 monitors, 30-second checks, multi-region, subscriber notifications, incident posts, custom domain), generates an API token, and seeds the token on the `consentshield-marketing` Vercel project as `BETTERSTACK_API_TOKEN`.

Sprints 2.2 → 2.6 (monitor matrix, incident-comms, DNS cutover, SLA alignment, subscriber notifications) are gated on this sprint completing.

---

## Pre-flight

- You are signed in as the `consentshield` operator identity.
- You have access to the `consentshield-marketing` Vercel project (env-var write rights).
- DNS for `status.consentshield.in` currently points at Vercel's `cname.vercel-dns.com` (Phase 1) — leave it alone for now; Sprint 2.4 cuts it over to Better Stack.

## Step 1 — Create the Better Stack workspace

1. Open <https://betterstack.com/> in a new tab.
2. **Sign up** with `a.d.sudhindra@gmail.com` (the founder identity that already owns Vercel + Cloudflare access).
3. When prompted for a workspace / team name, use **`consentshield`** exactly (matches the existing Sentry org naming convention from `marketing/next.config.ts:81`).
4. Skip any "invite teammates" prompt — you're solo right now.

## Step 2 — Pick the plan tier

The marketing copy at `marketing/src/app/docs/status/page.mdx` promises:
- 7 monitored surfaces.
- 30-second probe cadence (multi-region — EU + US + APAC at minimum).
- Per-surface uptime targets (REST API 99.9%/mo, Worker 99.99%/mo, Dashboard 99.5%/mo).
- Subscriber notifications via email + RSS + webhook.
- Incident posts + post-mortems for sev1 / sev2 incidents.
- Custom domain on the status page (`status.consentshield.in`).

**Required minimum tier features:**
- ≥ 10 monitors (we'll use 7 immediately; headroom for growth).
- 30-second check cadence (free tier is typically 3-minute or 1-minute — too slow).
- Multi-region probes (EU + US + APAC; some tiers expose all 14 BS regions).
- Custom domain on status page.
- Slack / webhook incident integration.

Open <https://betterstack.com/pricing> in a new tab. Map the offer to the requirements above and pick the **lowest tier** that meets all five:
- Free / Hobbyist tiers usually fall short on 30-second cadence or multi-region.
- The Hobbyist or Team tier (whatever it's called this month) is normally the right fit.
- Enterprise is overkill for a confidential preview.

**Record on this runbook before subscribing:**

| Field | Your answer |
|---|---|
| Tier name | <fill in> |
| Monthly cost (₹ or $) | <fill in> |
| Number of monitors included | <fill in> |
| Check cadence (seconds) | <fill in> |
| Regions available | <fill in> |
| Custom-domain on status page included | yes / no |

If no tier meets all five at a price you're willing to pay, **stop here** and reopen the ADR-1018 Phase 2 charter — the supersession assumed Better Stack would be order-of-magnitude cheaper than building region-spread probes ourselves; if pricing has changed, the supersession needs to be re-litigated.

Once you're satisfied with the tier:

1. Subscribe with a card (or invoice, if BS supports that for your tier). The card lives in the founder's expense pool.
2. Note the renewal date in your calendar.
3. Cost goes back into ADR-1018 Phase 2 Sprint 2.1 acceptance criteria.

## Step 3 — Generate the API token

1. In the Better Stack dashboard, navigate to **Settings → API tokens** (or wherever the current UI surfaces them — typically under team / workspace settings).
2. Create a new token. Name it **`consentshield-marketing-prod`** so it's clear what it gates.
3. Scope: workspace-wide (BS tokens usually don't have finer scope; if there's a "monitors-write + status-page-write" combo, grant that minimum).
4. **Copy the token to your clipboard.** Better Stack typically shows the token only once.

## Step 4 — Seed the token on Vercel

Two options. Pick whichever suits you:

### Option 4a — paste the token to Terminal C (the agent will set it via CLI)

Reply to Terminal C with the token verbatim, prefixed with `BETTERSTACK_TOKEN:`. Example:

```
BETTERSTACK_TOKEN: prod_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Terminal C will:
1. Run `bunx vercel@39 env add BETTERSTACK_API_TOKEN production` from `marketing/` with the token piped via stdin.
2. Run the same for `preview` if Sprint 2.1 says so.
3. Verify with `bunx vercel@latest env ls` and discard the token from terminal output.
4. Trigger a marketing redeploy via empty commit (so the next deploy can read the new env).

### Option 4b — set it yourself via dashboard

1. Open the `consentshield-marketing` Vercel project → Settings → Environment Variables.
2. Add `BETTERSTACK_API_TOKEN` with the token value, scope **Production** (and **Preview** if you want preview deploys to also call BS).
3. Click Save.
4. Trigger a redeploy (empty commit + push, or click Redeploy on the latest deployment).

Either way, the token should NEVER be committed to the repo. The `marketing/scripts/check-env-isolation.ts` prebuild guard does not currently forbid `BETTERSTACK_*` (it's not in the FORBIDDEN list), so the token will be passed to the build cleanly.

## Step 5 — Optional: install the Better Stack Slack integration

1. In Better Stack, navigate to **Integrations → Slack**.
2. OAuth into your Slack workspace.
3. Pick a channel (suggest `#consentshield-status` if it exists; create one if not).
4. Map sev1 and sev2 incidents to that channel; sev3 stays email-only by default.

This isn't strictly part of Sprint 2.1 (Slack lands in Sprint 2.3 incident-comms), but if you're already in the dashboard it's a 60-second add.

## Step 6 — Update the ADR

After the token is seeded:

1. Edit `docs/ADRs/ADR-1018-self-hosted-status-page.md` Sprint 2.1 deliverables — flip the four `[ ]` checkboxes to `[x]`. Record:
   - Selected tier name + monthly cost.
   - Workspace slug (the URL-fragment Better Stack assigns, e.g. `consentshield.betterstack.com`).
   - Confirmation that the token is on Vercel Production.
2. Append a one-line entry to `docs/changelogs/CHANGELOG-infra.md` referencing ADR-1018 Sprint 2.1.

## Acceptance criteria

- [ ] Better Stack account exists at workspace name `consentshield`.
- [ ] Plan tier subscribed; tier name + cost recorded in the ADR.
- [ ] API token generated and named `consentshield-marketing-prod`.
- [ ] `BETTERSTACK_API_TOKEN` set on `consentshield-marketing` Vercel project Production scope (Preview optional).
- [ ] ADR-1018 Phase 2 Sprint 2.1 checkboxes flipped to `[x]`.
- [ ] Changelog entry appended.

## Next sprint

Sprint 2.2 (monitor matrix) — configure the 7 synthetic checks per the ADR. Operator-light: most of the work is API-driven from the marketing project's Sprint 2.1 token, callable from Terminal C once the token is in place.
