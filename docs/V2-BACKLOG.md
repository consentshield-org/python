# V2 Backlog — Deferred Items

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Purpose.** Single catalogue of items flagged for a later version. Each entry has a pointer back to the originating ADR and the specific limitation / alternative that was consciously accepted.

**Review cadence.** Reviewed each time a phase closes. After 2026-04-21 sweep: only genuinely-deferred items remain here. Everything already shipped is collapsed under *Closed (tracked in ADRs)*.

---

## Closed (tracked in ADRs) — 2026-04-21 sweep

One-line pointers to completed work. Originally had prose bodies; collapsed after implementation shipped.

- **V2-T1** Signup idempotency regression test → ADR-0042
- **V2-X3** Audit-export R2 upload pipeline → ADR-0040
- **V2-P1** Headless-browser probe runner → ADR-0041
- **V2-P2** Probe CRUD UI → ADR-0041
- **V2-A1** Admin user invite + role change + disable → ADR-0045
- **V2-O1** `check-stuck-buffers` Edge Function → ADR-0038 Sprint 1.1
- **V2-O1** `run-security-scans` Edge Function → ADR-0015
- **V2-O3** pg_cron failure detection → ADR-0038 Sprint 1.1
- **V2-C1** OAuth flow for pre-built connectors → ADR-0039
- **V2-D1** Expiry-triggered connector fan-out → ADR-0037 Sprint 1.1
- **V2-D2** Per-requestor artefact binding in Rights Centre → ADR-0037 Sprint 1.2
- **V2-D3** CSV export for Consent Artefacts list → ADR-0037 Sprint 1.3
- **ADR-1001 C-1** rotate+revoke 401-vs-410 → ADR-1011 (tombstone; landed 2026-04-21)
- **ADR-1001 C-2** rate-tier static map drift check → `tests/integration/rate-tier-drift.test.ts` (landed 2026-04-21)
- **ADR-1009 follow-up** Cloudflare Worker HS256 migration → ADR-1010 (scoped 2026-04-21)

---

## Open — pre-launch only

These are correctly deferred until real-customer traffic begins. Each has a trivial flip-at-launch remediation.

### V2-X1. Vercel Preview env vars  *(origin: ADR-0014)*

Turnstile and Razorpay keys are set for Vercel **Production** only. Preview deploys happen only for non-`main` branches, and the dev team (one person) hasn't used Preview yet. No runtime impact on the live apps.

**Shape of fix.** Either upgrade the Vercel CLI push script to iterate through each feature branch, or flip the Marketplace integrations to "all environments" via the Vercel Dashboard once per integration.

### V2-X2. End-to-end billing checkout UX smoke  *(origin: ADR-0014)*

Infrastructure is complete. No test account has opened the checkout modal, completed the test card `4111 1111 1111 1111`, and seen `organisations.plan` update. All server-side signing paths are verified.

**Shape of fix.** Manual walkthrough on a test account.

### V2-O2. Vercel Deployment Protection  *(origin: session handoff)*

Off on both Vercel projects. Fine for dev; flip on before any real-customer onboarding.

---

## Open — waiting on external platform

### V2-K1. Edge Functions require `--no-verify-jwt`  *(origin: Edge Function gateway)*

Every HTTP-invoked Edge Function ships with `--no-verify-jwt` because the vault-stored `cs_orchestrator_key` is in the new `sb_secret_*` format and the Edge Function gateway still expects legacy JWT format. Function-internal PostgREST calls use the same key successfully; only the gateway layer is downstream of the bypass.

**Shape of fix.** Remove `--no-verify-jwt` from deploy commands once Supabase supports `sb_secret_*` keys at the gateway. No code change, just redeploy.

---

## Open — blocked on downstream ADR

### V2-O1. `check-retention-rules` Edge Function  *(origin: ADR-0011 cleanup)*

Still deferred. Retention-rule enforcement is the Regulatory Exemption Engine surface planned in **ADR-1004** (v2 Whitepaper Phase 4). No target rules exist today; implementing the cron without rules to enforce is premature. Re-evaluate when ADR-1004 ships.

### ADR-1010 Sprint 4.3. Strip the Worker REST fallback  *(origin: ADR-1010 Phase 4)*

Every Worker source file (`banner.ts`, `origin.ts`, `signatures.ts`, `events.ts`, `observations.ts`, `worker-errors.ts`) still carries a dual-path branch: Hyperdrive SQL when `env.HYPERDRIVE` is bound, REST against Supabase PostgREST otherwise. Production uses only the Hyperdrive path (ADR-1010 Phase 4 closed); the REST fallback exists solely to keep the 20 Miniflare tests in `app/tests/worker/` passing against a mock Supabase.

**Shape of fix.** Either (a) wire Miniflare's `hyperdrives` config to a local Postgres so the Hyperdrive path runs in the test harness too, or (b) migrate those 20 tests to `tests/integration/` where they can hit dev Supabase directly. Both are real work; neither is Phase-4-blocking — promote only when the fallback's drift becomes a maintenance burden.

---

## How to maintain this file

- Add an entry whenever an ADR consciously accepts a limitation or alternative.
- Entries are **write-once**: once an item is moved into its own follow-up ADR, replace the body with a one-line pointer in the *Closed (tracked in ADRs)* section.
- Keep it short. Backlog documents that grow prose go unread.
