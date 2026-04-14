# ADR-0007: Deletion Orchestration (Generic Webhook Protocol)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-14
**Date completed:** 2026-04-14

---

## Context

When a Data Principal submits an erasure request (DPDP Section 12) and the compliance manager approves it, ConsentShield must orchestrate deletion across the customer's connected systems — CRMs, email platforms, data warehouses — and collect immutable receipts that prove the deletion happened.

Per the definitive architecture Section 8.4:

- **Generic webhook protocol** — universal fallback; customer hosts an endpoint, ConsentShield POSTs a signed deletion request, customer confirms via signed callback URL
- **Pre-built OAuth connectors** — Mailchimp, HubSpot, etc. (deferred to a future ADR)

Each deletion produces a row in `deletion_receipts` (buffer table, exported to customer storage as DPB evidence).

## Decision

Implement only the **generic webhook protocol** in this ADR. Pre-built connectors are deferred.

1. Connector management UI + API — customers add webhook connectors with URL + shared secret
2. Deletion trigger — from a rights request detail page ("Execute deletion"), or from a deletion API endpoint
3. Signed callback URL — customer's webhook confirms completion by POSTing back with HMAC-signed URL
4. Deletion receipt — immutable record stored in `deletion_receipts`

## Consequences

After this ADR:

- A customer can wire up their internal CRM/EMR/backend via a webhook and have ConsentShield trigger deletion on approved erasure requests
- Every deletion has a signed receipt trail
- The erasure request lifecycle is complete end-to-end

---

## Implementation Plan

### Phase 1: Generic Webhook Protocol

#### Sprint 1.1: Connector Management
**Estimated effort:** 3–4 hours
**Deliverables:**
- [ ] GET/POST /api/orgs/[orgId]/integrations — list + create webhook connectors
- [ ] DELETE /api/orgs/[orgId]/integrations/[id] — remove connector
- [ ] Encrypted storage of shared secret in integration_connectors.config (bytea, pgcrypto)
- [ ] /dashboard/integrations — list page with status, last health check, add form
- [ ] Health check endpoint ping (optional HEAD request to the webhook URL)
- [ ] Plan gating: Growth allows 3 connectors, Pro 13, Enterprise unlimited

**Testing plan:**
- [ ] Create webhook connector → row appears in list
- [ ] Encrypted config stored (verify bytea in DB, not plaintext)
- [ ] Delete connector → removed from list
- [ ] Growth org creating 4th connector → 402 plan_limit_reached

**Status:** `[x] complete`

#### Sprint 1.2: Deletion Dispatch + Signed Callback
**Estimated effort:** 4–5 hours
**Deliverables:**
- [ ] POST /api/orgs/[orgId]/rights-requests/[id]/execute-deletion — triggers webhook dispatch
- [ ] Creates deletion_receipts row per connector (status='pending')
- [ ] POSTs signed payload to each connector's webhook URL
- [ ] Signed callback URL: `/api/v1/deletion-receipts/[id]?sig=<HMAC>`
- [ ] POST /api/v1/deletion-receipts/[id] — callback verification, updates status
- [ ] Retry logic: 3 attempts with exponential backoff for network failures
- [ ] Timeout handling: callback not received in 24h → status='failed'

**Testing plan:**
- [ ] Dispatch webhook → receiver gets correctly-signed payload
- [ ] Callback with valid signature → status='completed'
- [ ] Callback with invalid signature → 403, status unchanged
- [ ] Network failure → retry_count increments, last_error populated
- [ ] After 3 failures → status='failed', alert written to audit_log

**Status:** `[x] complete`

#### Sprint 1.3: Rights Request → Deletion UI
**Estimated effort:** 2–3 hours
**Deliverables:**
- [ ] Rights request detail page shows "Execute Deletion" button for approved erasure requests
- [ ] Modal listing connected systems with per-system status
- [ ] Deletion receipts section on detail page (live status)
- [ ] Closing a rights request as completed requires all connectors either completed or explicitly skipped

**Testing plan:**
- [ ] Approved erasure request → button visible
- [ ] Click → dispatches to all active connectors
- [ ] Each row updates to completed as callbacks arrive
- [ ] Non-erasure request types → button hidden

**Status:** `[x] complete`

---

## Architecture Changes

_None — implements existing Section 8.4 and uses existing integration_connectors, deletion_receipts tables._

---

## Test Results

### All sprints — 2026-04-14

```
Migrations:
  20260414000002_encryption_rpc.sql — pgcrypto RPC helpers (encrypt_secret,
    decrypt_secret) using derived per-org key. Execute granted to service_role only.

Roundtrip test:
  select decrypt_secret(encrypt_secret('test-secret-123', 'key'), 'key')
  Result: 'test-secret-123' — PASS

Build: PASS (all routes compile, proxy detected)
Lint: PASS (clean)
RLS tests: 39/39 passing (no regressions)

Implementation:
- /lib/encryption/crypto.ts — HMAC-SHA256 per-org key derivation from
  MASTER_ENCRYPTION_KEY + org_id + encryption_salt. Calls pgcrypto via RPC.
- /lib/rights/callback-signing.ts — signed callback URLs
  (HMAC-SHA256(receipt_id, DELETION_CALLBACK_SECRET)), timing-safe verify
- /lib/rights/deletion-dispatch.ts — creates deletion_receipts (pending),
  decrypts connector config, POSTs signed payload (X-ConsentShield-Signature
  when shared_secret present), updates receipt status, writes audit_log
- API routes:
  - GET/POST /api/orgs/[orgId]/integrations (admin-only create, plan-gated)
  - DELETE /api/orgs/[orgId]/integrations/[id]
  - POST /api/orgs/[orgId]/rights-requests/[id]/execute-deletion
  - POST /api/v1/deletion-receipts/[id]?sig=... (public, signature-verified)
- Dashboard pages:
  - /dashboard/integrations — connector list + add form (webhook URL + secret)
  - Rights request detail now shows DeletionPanel for erasure requests with
    execute button and live receipt status table
- Generic webhook protocol implemented per definitive architecture Section 8.4
- Shared secrets encrypted with per-org derived key (non-negotiable rule 11)
- Plan gating: Growth=3, Pro=13, Enterprise=unlimited deletion connectors
```

---

## Changelog References

- CHANGELOG-api.md (integrations + deletion + callback routes)
- CHANGELOG-dashboard.md (integrations page, deletion UI on rights request detail)
