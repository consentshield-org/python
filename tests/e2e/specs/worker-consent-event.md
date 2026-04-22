# E2E-1.3-worker-consent-event: HMAC-signed consent event reaches the buffer

**ADR:** ADR-1014 (Sprint 1.3 — Worker local harness + first pipeline test)
**Sprint:** Phase 1, Sprint 1.3
**Sibling negative:** `worker-consent-event-tampered.spec.ts` (paired; lives at `tests/e2e/worker-consent-event-tampered.spec.ts`).
**Category:** @pipeline @worker

---

## 1. Intent

Proves the **first pipeline hop is honest**. A server-to-server caller that signs a consent-event envelope with the web property's `event_signing_secret` is accepted by the Worker (202) and a buffer row appears in `public.consent_events` with the expected `org_id` / `property_id` / `banner_id`. A caller that tampers with the HMAC by one hex character is rejected at the signature check (403) and writes no buffer row.

Regressing the positive means the Worker stopped accepting legitimate server-to-server events — data principals would silently lose consent artefacts, the primary DPDP failure mode. Regressing the negative means the Worker started accepting invalid signatures — customer vandalism or tenant cross-writes would become possible.

## 2. Setup

- `WORKER_URL` is reachable (either `bunx wrangler dev` from `worker/` or a deployed URL).
- `.env.e2e` contains the ecommerce fixture (account + org + property + banner + signing_secret) seeded by `scripts/e2e-bootstrap.ts` Sprint 1.2+.
- `SUPABASE_SERVICE_ROLE_KEY` is set in ambient env or `.env.local` so the test can query `public.consent_events` for observable-state assertions.
- `scripts/e2e-reset.ts` may be run before the test to clean prior buffer rows; the test scopes its assertions with a `cutoffIso = new Date().toISOString()` stamp captured at test start, so pre-existing rows are ignored.

## 3. Invariants

- The fixture's `event_signing_secret` is never written to logs, evidence archive, or test attachments. Only its derived HMAC appears in the envelope.
- The negative test writes **zero** rows to `public.consent_events` for the fixture property during its run window. Rechecked at teardown.
- The positive test's trace id is attached to the run; the tampered test's trace id is attached too (evidence shows which id was expected to fail).
- **Test isolation:** the positive uses `ecommerce.properties[0]`; the negative uses `ecommerce.properties[1]`. Two distinct fixture properties so the two tests can run in parallel without their count-since-cutoff assertions observing each other's rows under clock skew between Node and Postgres. Using the same property would be a test-isolation bug, not a real pipeline regression.

## 4. Expected proofs

**Positive:**

1. `POST ${WORKER_URL}/v1/events` with signed envelope → status **202**.
2. Within 5 s, `public.consent_events` contains a row where:
   - `property_id = fixture.properties[0].id`
   - `org_id      = fixture.orgId`
   - `banner_id   = fixture.properties[0].bannerId`
   - `event_type  = 'consent_given'`
   - `origin_verified = 'hmac-verified'` (HMAC path, no Origin header sent)
   - `created_at >= cutoffIso`
3. Row count delta since `cutoffIso` for this property = exactly **1**.

**Negative:**

1. Same envelope but with one hex character of the HMAC flipped → status **403**.
2. Response body includes "Invalid signature".
3. Row count for `property_id` since `cutoffIso` remains **0**.

## 5. Pair-with-negative

**Pair:** `tests/e2e/worker-consent-event-tampered.spec.ts` — identical setup and envelope, but the signature is mutated via `tamperSignature()` from `utils/hmac.ts`. The mutation flips a deterministic middle-position hex character so the test is reproducible across runs.

## 6. Why this spec is not a fake positive

The positive asserts on *observable DB state* (a row in `public.consent_events` with five specific columns matching the fixture), not on the 202 alone. A Worker that always returned 202 without writing to the buffer would fail the count-delta assertion. The negative asserts both the 403 status AND zero row delta — a Worker that always rejected and yet somehow still wrote would fail the second assertion. The two checks live in different systems (Worker HTTP response + Supabase Postgres), so a single silent-success bug cannot satisfy both.

Additionally, `computeHmac` is verified implicitly by the positive: if the Node-side helper drifted from the Worker's Web-Crypto implementation, the Worker would reject the signature and the positive would fail with 403 instead of 202. That is the drift tripwire.

## 7. Evidence outputs

- `trace-id.txt` — both positive and negative tests.
- Response attachment per request (status, headers, truncated body).
- For positive: the observed `consent_events` row serialised as JSON.
- For negative: the pre/post row count + the 403 body.
- Playwright trace on failure.
