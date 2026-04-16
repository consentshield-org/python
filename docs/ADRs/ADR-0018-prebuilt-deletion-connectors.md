# ADR-0018: Pre-built Deletion Connectors (Mailchimp, HubSpot)

**Status:** Completed (Phase 1)
**Date proposed:** 2026-04-16
**Date completed:** 2026-04-16
**Superseded by:** —

---

## Context

ADR-0007 shipped the generic webhook connector: customers stand up
their own endpoint, ConsentShield POSTs a signed payload, the
customer replies to a signed callback URL when the deletion is
done. Works, but onboarding a customer who lives in Mailchimp or
HubSpot means asking them to write glue code. That is the single
biggest friction point we can fix in Phase 2.

## Decision

Add two pre-built connector types that call the provider's API
directly. No customer-side endpoint required.

### Connector types

| `connector_type` | Auth | API call for erasure |
|------------------|------|---------------------|
| `webhook` (existing) | HMAC-signed POST to customer URL | N/A — customer's endpoint does the work |
| `mailchimp` (new) | HTTP Basic (API key) | `DELETE /3.0/lists/{audience_id}/members/{md5(lowercase(email))}` |
| `hubspot` (new) | `Authorization: Bearer {private app token}` | `DELETE /crm/v3/objects/contacts/{email}?idProperty=email` |

### Auth choice — API keys, not OAuth

OAuth flows would add a full authorisation round-trip UI and
per-provider redirect handling. We accept API-key auth for v1:

- **Mailchimp:** Users create an API key in their account settings
  (Account → Extras → API Keys) and paste it. The key embeds the
  `server_prefix` (e.g. `abc123-us21`) — we split on `-` to build
  the API base URL.
- **HubSpot:** Users create a Private App (Settings → Integrations
  → Private Apps) with the `crm.objects.contacts.write` scope and
  paste the resulting token.

OAuth is captured as **V2-C1** in `docs/V2-BACKLOG.md`.

### Dispatch behaviour change

For `webhook` connectors, `dispatchDeletion` leaves the receipt in
`awaiting_callback` until the customer confirms. For `mailchimp`
and `hubspot` there is no separate callback — the provider's DELETE
response IS the confirmation. So:

- HTTP 2xx (including 204, and 404 which indicates the contact was
  already absent) → receipt transitions straight to `confirmed`.
- Any other status → `dispatch_failed` with the provider's response
  body as `failure_reason`. Retry via ADR-0011 still applies.

### Config shape per type (stored encrypted)

- `webhook`: `{ webhook_url, shared_secret }` (existing)
- `mailchimp`: `{ api_key, audience_id }`
- `hubspot`: `{ api_key }`

## Consequences

- One refactor in `src/lib/rights/deletion-dispatch.ts`: split the
  single inline dispatch into a per-type dispatcher.
- One route-validation tweak in
  `src/app/api/orgs/[orgId]/integrations/route.ts`.
- Dashboard form gets a type selector + conditional fields.
- No schema change — `integration_connectors.connector_type` is
  already `text`, `config` is already `bytea`.
- Unit tests for the two new dispatchers against a mocked
  `global.fetch`.
- Customers still owe us the API key under their provider's T&Cs —
  the encrypted storage means a DB dump doesn't leak it.

---

## Implementation Plan

### Phase 1: API-key connectors + tests

#### Sprint 1.1

**Estimated effort:** ~6 h
**Deliverables:**
- [x] `src/lib/rights/deletion-dispatch.ts`: branch on
  `connector_type`; `dispatchWebhook` (existing logic moved),
  `dispatchMailchimp`, `dispatchHubspot`.
- [x] `src/app/api/orgs/[orgId]/integrations/route.ts`: expand
  `VALID_CONNECTOR_TYPES`; per-type required-field validation;
  per-type `configPayload` shape.
- [x] `src/app/(dashboard)/dashboard/integrations/integrations-table.tsx`:
  type selector + conditional form fields.
- [x] `tests/rights/connectors.test.ts`: mocked-fetch tests for
  Mailchimp + HubSpot success + failure paths.
- [x] ADR-0018, ADR-index, CHANGELOG-api, CHANGELOG-dashboard,
  STATUS; V2-BACKLOG gains **V2-C1** for OAuth flow.

**Testing plan:**
- [x] `bun run lint` + `bun run build` + `bun run test` — suite
  grows by ~6, all green.
- [ ] Manual end-to-end with a real test Mailchimp/HubSpot account
  deferred (no test accounts right now). Infrastructure in place
  for first customer to exercise.

**Status:** `[x] complete`

---

## Architecture Changes

None to the definitive architecture.

---

## Test Results

### Sprint 1.1 — 2026-04-16

```
Test: Suite regression after dispatcher refactor + 2 provider dispatchers
Method: bun run lint && bun run test && bun run build
Expected: 81 + 5 new tests pass; lint + build clean
Actual: 86/86 pass (added Mailchimp ×3, HubSpot ×2 via mocked fetch);
  lint clean; build clean.
Result: PASS
```

```
Test: Mailchimp dispatcher URL + auth shape
Method: Unit test — spy on global fetch, call dispatchDeletion
Expected: DELETE to https://<server_prefix>.api.mailchimp.com/3.0/lists/
  <audience_id>/members/<md5(lowercase_email)>, HTTP Basic
  (user='anystring', pass=api_key), Authorization header begins 'Basic '
Actual: matched exactly; md5 hash of 'erasure.target@example.com'
  computed correctly
Result: PASS
```

```
Test: 2xx + 404 → confirmed; 5xx → dispatch_failed
Method: mockFetch variations
Expected: 204 → confirmed; 404 → confirmed; 500 → dispatch_failed with
  Mailchimp response body included in failure_reason
Actual: all three PASS
Result: PASS
```

```
Test: HubSpot dispatcher URL + Bearer auth
Method: Unit test — spy on global fetch
Expected: DELETE to https://api.hubapi.com/crm/v3/objects/contacts/
  <url_encoded_email>?idProperty=email; Authorization 'Bearer <token>'
Actual: matched exactly
Result: PASS
```

```
Test: HubSpot missing api_key → dispatch_failed
Method: empty config.api_key
Expected: dispatch_failed with 'api_key' in failure_reason
Actual: PASS
Result: PASS
```

---

## Changelog References

- CHANGELOG-api.md — 2026-04-16 — ADR-0018 Phase 1
- CHANGELOG-dashboard.md — 2026-04-16 — connector-form type selector
