# V2 Backlog — Deferred Items for Post-Phase-2 Review

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Purpose.** Single catalogue of items flagged for a later version
while Phase-2 sprints 1–11 ship. Each entry has a pointer back to
the originating ADR and the specific limitation / alternative that
was consciously accepted.

**Review cadence.** Revisit this list **after Phase 2 closes**, at
which point we will:

1. Review the existing code end-to-end.
2. Pick **2–3 architecture decision points** to raise as ADRs in the
   next phase.
3. Move picked items into their own ADRs; the rest stay here or get
   closed as "no longer relevant".

Do not implement anything from this list during Phase 2 — it is a
backlog, not a sprint queue.

---

## Test coverage

### V2-T1. Signup idempotency regression test  → see ADR-0042

---

## External services activation

### V2-X1. Vercel Preview env vars  *(origin: ADR-0014)*

Turnstile and Razorpay keys are set for Vercel **Production** only.
The current Vercel CLI requires per-branch targeting for Preview
env writes that our scripted approach doesn't hit cleanly, and the
admin app only deploys from `main` (Production) today.

**Why deferred.** Preview deploys happen only for non-`main`
branches, and the dev team (one person) hasn't used Preview yet. No
runtime impact on the live admin app.

**Shape of the v2 fix.** Either upgrade the Vercel CLI push script
to iterate through each feature branch, or flip the Marketplace
integrations to "all environments" via the Vercel Dashboard once
per integration.

### V2-X3. Audit-export R2 upload pipeline  → see ADR-0040

### V2-X2. End-to-end billing checkout UX smoke  *(origin: ADR-0014)*

Infrastructure is complete (Razorpay keys, plans, webhook secret).
No test account has opened the checkout modal, completed the test
card `4111 1111 1111 1111`, and seen `organisations.plan` update.

**Why deferred.** Requires a signed-in non-dev test account. Not a
blocker for closing ADR-0014; all signing-and-server paths are
verified (webhook returns 403 for bad signatures, key_id returns
correctly from `/api/orgs/[orgId]/billing/checkout`).

---

## Synthetic compliance (consent probes)

### V2-P1. Headless-browser probe runner  → see ADR-0041

### V2-P2. Probe CRUD UI  → see ADR-0041

---

## Ops / platform

### V2-O1. Unbuilt Edge Functions (cron slots reserved)  *(origin: ADR-0011 cleanup)*

- `check-stuck-buffers` — **→ see ADR-0038 Sprint 1.1** (done 2026-04-17).
- `run-security-scans` — **done** in ADR-0015.
- `check-retention-rules` — still deferred. Retention-rule enforcement is a Phase-3 feature (no target rules exist today). Re-evaluate when retention enforcement ships.

### V2-O2. Vercel Deployment Protection  *(origin: session handoff)*

Off on both Vercel projects (admin + demo sites). Fine for dev —
no real traffic — but flip on before any real-customer onboarding.

**Why deferred.** Single-dev project with no live customers.

### V2-O3. pg_cron failure detection  → see ADR-0038 Sprint 1.1

---

## Connectors

### V2-C1. OAuth flow for pre-built connectors  *(origin: ADR-0018)*

ADR-0018 Phase 1 authenticates with pasted API keys (Mailchimp API
keys, HubSpot private-app tokens). The full product promise — "click
Connect Mailchimp, complete OAuth in a popup, done" — requires:

1. Provider-specific OAuth app registration (Mailchimp, HubSpot).
2. `/api/integrations/oauth/{provider}/callback` route that handles
   the redirect + token exchange.
3. Refresh-token rotation job.
4. Replace the dashboard form's pasted-key inputs with a single
   "Connect" button per provider.

**Why deferred.** API-key auth closes 95% of the usability gap; the
remaining OAuth polish is a per-provider config effort with external
app-registration dependencies (each provider wants proof of a live
privacy policy, sometimes app review). Out of scope for the Phase-2
close.

**Shape of the v2 fix.** Per-provider `lib/connectors/{provider}/oauth.ts`
following the pattern established by the Razorpay webhook flow.

---

## DEPA

### V2-D1. Expiry-triggered connector fan-out  → see ADR-0037 Sprint 1.1

### V2-D2. Per-requestor artefact binding in Rights Centre  → see ADR-0037 Sprint 1.2

### V2-D3. CSV export for Consent Artefacts list  → see ADR-0037 Sprint 1.3

---

## API key format

### V2-K1. Edge Functions require `--no-verify-jwt`  *(origin: Edge Function gateway)*

Every HTTP-invoked Edge Function ships with `--no-verify-jwt` today
because the vault-stored `cs_orchestrator_key` is in the new
`sb_secret_*` format and the Edge Function gateway still expects
legacy JWT format. Function-internal PostgREST calls use the same
key successfully; only the gateway layer is downstream of the
bypass.

**Why deferred.** Supabase will eventually close the format gap at
the gateway. Watching for an announcement is cheaper than either
issuing a legacy JWT manually or fronting every function with
in-function auth verification.

**Shape of the v2 fix.** Remove `--no-verify-jwt` from deploy
commands once Supabase supports sb_secret_* keys at the gateway.
No code change, just redeploy.

---

## How to maintain this file

- Whenever an ADR consciously accepts a limitation or alternative,
  add an entry here.
- Entries are **write-once**: once an item is moved into its own
  follow-up ADR, replace the body with a one-line "→ see ADR-NNNN"
  pointer.
- Keep it short. Backlog documents that grow prose go unread.
