# End-to-end test specifications — ConsentShield (ADR-1014)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

---

## Why spec docs exist

Per ADR-1014, **the spec doc IS the contract.** Before a reviewer (auditor, investor, enterprise evaluator) reads a `.spec.ts` file they will read the matching `.md` in this folder. The code is the implementation of the spec; the spec states intent and expected proofs in plain language a non-TypeScript reader can follow.

Every `tests/e2e/**/*.spec.ts` MUST have a sibling `tests/e2e/specs/<name>.md`. CI fails if the 1:1 mapping is broken.

---

## Anatomy of a spec doc

A spec doc has exactly these sections, in this order. No extras. No reordering.

### 1. Title + identifiers

```
# E2E-<sprint>-<slug>: <short declarative title>

**ADR:** ADR-1014 (or the feature ADR under test)
**Sprint:** Phase X, Sprint Y
**Sibling negative:** <filename of paired negative control> | n/a (if this IS the negative)
**Category:** @smoke | @pipeline | @rights | @deletion | @admin | @billing | @depa
```

### 2. Intent — one paragraph

Plain English: what does this test prove? What would regressing this spec mean for the product? If the code change path this test protects is unclear, rewrite the intent.

**Bad:** "Tests the consent record endpoint."
**Good:** "Proves that a consent recorded at the marketing-site origin is observable as an `active` artefact within 5 seconds, with a trace id that survives all six pipeline hops. Regressing this spec means a customer recording consent gets no proof of it — the primary DPDP failure mode."

### 3. Setup (preconditions)

Bullet list of the world state this test assumes. Each bullet is falsifiable. Examples:

- Supabase test project reachable at `SUPABASE_URL`, migrations up to `20260803000010` applied
- Fixture organisation `ecommerce_fixture` exists with seeded API key `TEST_API_KEY_ECOM`
- Worker running locally (`wrangler dev`) with HMAC signing secret seeded for the fixture web property
- Buffer tables empty (Sprint 1.2 reset script has run since last suite)

If any precondition cannot be asserted from inside the test (e.g., migration state), the spec must say how the harness verifies it at startup.

### 4. Invariants (what MUST hold throughout)

Cross-cutting properties that must remain true during and after the test. Examples:

- No row is ever written to `tracker_observations` carrying FHIR field names
- The fixture organisation's `org_id` is the only `org_id` appearing in buffer rows produced by this test
- `public.invoices` is read-only from `authenticated`; the test uses no internal import to bypass this

Invariants are observable from test teardown queries + an evidence-archive scan. They are not dependent on the test's own happy path succeeding.

### 5. Expected proofs — observable state

Numbered list of the **observable state** that must exist at the end of the test. Every positive assertion in the `.spec.ts` file maps to one proof here. HTTP status alone is NEVER a proof (per ADR-1014 acceptance criterion).

Format each proof as: `<source>: <specific predicate>`.

Examples:

1. `consent_events` table: exactly 1 new row where `trace_id = <test trace id>` and `origin = https://demo-ecommerce.consentshield.in`
2. `consent_artefacts` table: row matching the event, `status = 'active'`, `issued_at` within 5 s of request
3. R2 delivery bucket: object at `deliveries/<org_id>/<yyyy>/<mm>/<dd>/<artefact_id>.json` whose SHA-256 matches the response body's `artefact_hash`
4. Worker log export: line `hmac_verified=true trace_id=<test trace id>` present; line `hmac_verified=false` absent
5. Response body: shape matches `schemas/ConsentRecordResponse` in `openapi.yaml`

### 6. Pair-with-negative

State the sibling negative control filename and what single condition it flips. A test without a pair is rejected in review unless this spec doc IS the negative (in which case: name the positive it defends).

Examples:

- **Pair:** `record-consent-ecom-negative.spec.ts` — flips the HMAC signature byte 17. Expected: 403, zero `consent_events` rows, Worker log shows `hmac_verified=false`.

### 7. Why this spec is not a fake positive

A short statement (2–3 lines) explaining what could make this test always-pass even when the code is broken, and how the test is structured to prevent that. Helps Stryker review.

Example: "If we asserted only the HTTP 201, a Worker that accepted everything would pass. We assert on the DB row + R2 object hash + Worker log trace id — each of which is in a distinct system with no shared code path."

### 8. Evidence outputs

What this test emits to the run archive (Sprint 1.4 evidence writer). Typical list:

- `trace-id.txt`
- `db-snapshot-<test-name>.sql` (redacted pg_dump of the touched tables)
- `worker-log-<test-name>.log` (captured from wrangler tail)
- `r2-manifest-<test-name>.json` (keys + hashes of delivered objects)
- Playwright trace + screenshot on failure

---

## Writing checklist (before opening a PR)

- [ ] Spec doc lives at `specs/<matching-slug>.md`
- [ ] Intent paragraph passes the "bad/good" bar above
- [ ] Every positive assertion has a proof in section 5 (no naked HTTP-status assertions)
- [ ] Sibling negative exists OR this IS the negative (section 6 states which)
- [ ] Section 7 (fake-positive defence) is not skippable boilerplate
- [ ] Section 8 lists evidence outputs matching what the `.spec.ts` actually attaches

---

## Partner reading order

An external reviewer examining this suite should:

1. Start with this README.
2. Read `specs/pair-matrix.md` (Sprint 3.7 will produce this) — the index of positive↔negative pairings.
3. Pick a category. Read `specs/<category>-*.md` before the matching `.spec.ts`.
4. Run `bun run test:e2e:partner -- --grep <category>` to reproduce locally.
5. Compare produced evidence archive against `testing.consentshield.in/runs/<reference-sha>/`.

This discipline is how we earn the "partner-evidence-grade" label claimed by ADR-1014.
