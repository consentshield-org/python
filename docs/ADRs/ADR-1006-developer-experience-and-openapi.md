# ADR-1006: Developer Experience — Client Libraries + OpenAPI Spec + CI Drift Check

**Status:** In Progress
**Date proposed:** 2026-04-19
**Date started:** 2026-04-25
**Date completed:** —
**Related plan:** `docs/plans/ConsentShield-V2-Whitepaper-Closure-Plan.md` Phase 6
**Depends on:** ADR-1002 (every `/v1/*` endpoint must exist and be stable), ADR-1009 (cs_api Bearer-token auth shape stable), ADR-1014 Phase 4 (v1 surface mutation-locked at 100% so the SDK can rely on regex/scope/rate-tier helpers being correct).
**Related gaps:** G-002, G-003, G-024, G-045

## Scope amendments (2026-04-25)

The proposal listed four languages (Node, Python, Java, Go). This ADR ships **three** — Node, Python, Go — per the user-confirmed v2 split. Java is dropped from the immediate scope:

- Indian BFSI + healthcare ICP skews to Node/Python/Go; Java demand has not surfaced in any partner conversation to date.
- The original ADR text already positions Java as "lower-priority than Node + Python" — formalising the deferral rather than carrying a paper deliverable.
- Java can be added back as its own ADR if an enterprise prospect requires it; the OpenAPI spec (Phase 3 deliverable, already shipped at `marketing/public/openapi.yaml`) means a Java client could be code-generated rather than hand-written.

The endpoint surface has grown since this ADR was drafted. The current `/v1/*` set is 21 routes (per `find app/src/app/api/v1 -name route.ts`):

| Group | Endpoints |
|---|---|
| Health | `/v1/_ping` |
| Account | `/v1/keys/self`, `/v1/plans`, `/v1/usage` |
| Property | `/v1/properties`, `/v1/purposes`, `/v1/score` |
| Consent | `/v1/consent/record`, `/v1/consent/verify`, `/v1/consent/verify/batch`, `/v1/consent/events`, `/v1/consent/artefacts`, `/v1/consent/artefacts/[id]`, `/v1/consent/artefacts/[id]/revoke` |
| Rights | `/v1/rights/requests` |
| Deletion | `/v1/deletion/trigger`, `/v1/deletion/receipts`, `/v1/deletion-receipts/[id]` |
| Audit & security | `/v1/audit`, `/v1/security/scans` |
| Connectors | `/v1/integrations/[connector_id]/test_delete` |

Each method on the SDK maps to one of these routes. The Phase 1/2/3 sprint deliverables below are amended in place to reference the actual route names.

## OpenAPI status

`marketing/public/openapi.yaml` already exists (2211 lines, served at `https://consentshield.in/openapi.yaml`, linked from `/docs` nav under Reference, listed in the Cmd-K palette). Phase 3 of this ADR (originally "spec completion + CI drift check") is partly de-scoped: the spec file is in tree; what remains is the `scripts/regenerate-whitepaper-appendix.ts` generator + the CI drift check that fails the build when `app/src/app/api/v1/**/route.ts` and `marketing/public/openapi.yaml` diverge.

---

## Context

The whitepaper §5.4 promises client libraries in Node.js, Python, Java, and Go that ship with a 2-second default timeout and fail-closed behaviour (`CONSENT_VERIFY_FAIL_OPEN=true` opts out, with the override recorded in the audit trail). This is not a library-convenience feature; it is the compliance posture ConsentShield promises by default. A BFSI customer that calls the verify endpoint with no client library and no configured timeout will, in many common failure modes, default-open and silently act on withdrawn consent — the worst DPDP outcome. The libraries encode the correct default.

Appendix A of the whitepaper is a hand-written table of `/v1/*` endpoints. Once ADRs 1001–1005 land, that table needs to match code exactly. A CI check that regenerates Appendix A from an OpenAPI spec and fails the build on drift is how we prevent the document from decaying over time (CC-F + G-045).

This ADR delivers libraries and the spec-as-SSOT commitment.

## Decision

Ship four languages and one specification:

1. **Node.js library (G-002)** — `@consentshield/node` on npm at v1.0.0. Methods: `verify`, `verifyBatch`, `recordConsent`, `revoke`, `triggerDeletion`, plus artefact-CRUD helpers. Fail-closed default with env override. TypeScript types. Express + Next.js integration examples.
2. **Python library (G-003)** — `consentshield` on PyPI at v1.0.0. API parity with Node. Python 3.9+. Django + Flask + FastAPI examples.
3. **Java + Go libraries (G-024)** — `com.consentshield:consentshield-client:1.0.0` on Maven Central; `github.com/consentshield/go-client` Go module. API parity. Spring Boot (Java) + net/http (Go) examples.
4. **OpenAPI spec + CI drift check (G-045)** — `app/public/openapi.yaml` becomes the single source of truth for `/v1/*`. `scripts/regenerate-whitepaper-appendix.ts` emits markdown; CI fails if Appendix A diverges.

## Consequences

- Every `/v1/*` shape change in future PRs must edit both the code and the OpenAPI spec (enforced by CI). The whitepaper Appendix A regenerates automatically.
- Customers integrating in Node or Python can go from "npm install / pip install" to first verify call in under an hour (target documented in README).
- The `CONSENT_VERIFY_FAIL_OPEN` override is an explicit compliance trade-off: it is opt-in, it is documented, and it writes to the customer's audit trail. This matches the whitepaper's §5.4 stance exactly.
- Java + Go are lower-priority than Node + Python (the Indian BFSI + healthcare customer base skews heavily to Node/Python); they ship in the same ADR for convenience and to hold the API conventions stable across all four languages.
- Library maintenance becomes a per-release discipline: a `/v1/*` shape change bumps the libraries' minor version.

---

## Implementation Plan

### Phase 1: Node.js library (G-002)

#### Sprint 1.1: Package scaffold

**Deliverables:**
- [x] New Bun workspace at `packages/node-client/` (chose monorepo over standalone repo to keep the SDK in lockstep with the v1 API surface; the OpenAPI spec, the integration tests, and the Phase 4 mutation suites all live in this repo).
- [x] Package scaffolding: `package.json` (`@consentshield/node` v`1.0.0-alpha.1`, ESM-only, `engines: ">=18"`, exact-pinned devDeps per Rule 17), `tsconfig.json` (extends `tsconfig.base.json` + ES2022 + node + vitest globals types), `vitest.config.ts`, `README.md` (alpha-status banner + quickstart + compliance-posture defaults table + error-model summary + config reference).
- [x] **Source files:**
  - `src/errors.ts` — `ConsentShieldError` base + `ConsentShieldApiError` (RFC 7807 `problem` field exposed) + `ConsentShieldNetworkError` (transport failures, retried before surfacing) + `ConsentShieldTimeoutError` (never retried — second attempt would compound past the consent-decision budget) + `ConsentVerifyError` (compliance-critical — wraps the underlying cause when a verify call fails closed). Every error carries an optional `traceId` lifted from the response's `X-CS-Trace-Id` header (ADR-1014 Sprint 3.2 contract).
  - `src/http.ts` — `HttpClient` class. Builds `${baseUrl}/v1${path}?${query}`. Bearer auth + `Accept: application/json` + JSON-body marshalling + Content-Type stamping. **2-second default timeout** via `AbortController` composed with caller-supplied `signal`. **Exponential backoff** at 100 ms / 400 ms / 1 600 ms (bounded so even `maxRetries=3` stays within ~2 s of cumulative wait). **Retry policy:** 5xx + transport errors retried up to `maxRetries`; **never** retries on 4xx (caller bug) or timeouts (compounds latency past budget); **never** retries when caller-supplied `AbortSignal` aborts (re-throws caller's `AbortError`). Returns `{ status, body, traceId }`. 204 → null body; non-JSON 2xx → text body. Problem-document parsing is content-type-aware + tolerates non-JSON 5xx bodies (`problem: undefined`).
  - `src/client.ts` — `ConsentShieldClient` constructor. Validates `apiKey` starts with `cs_live_` (case-sensitive, defends against `CS_LIVE_` / `cs_test_` / opaque-key callers). Validates `timeoutMs > 0` (positive finite) + `maxRetries >= 0` (non-negative integer). Resolves `failOpen` from option OR `CONSENT_VERIFY_FAIL_OPEN=true`/`1` env var (option wins when explicit). Trims trailing slashes off `baseUrl`. Exposes `baseUrl` / `timeoutMs` / `maxRetries` / `failOpen` as readonly so test asserts can read them. Ships one method this sprint: `ping()` against `/v1/_ping` — useful as a deploy-time health check of the Bearer key + base URL.
  - `src/index.ts` — public re-exports. Sprint 1.1 surface: `ConsentShieldClient` + `ConsentShieldClientOptions` + the five error classes + `ProblemJson` + `FetchImpl` + `HttpRequest`.
- [x] **Tests:** 38 cases across three test files.
  - `tests/errors.test.ts` (7 cases) — instanceof hierarchy / `name` field correctness / message composition (status + detail / fallback to title when detail empty or absent / fallback to "HTTP {status}" when problem undefined) / `traceId` propagation through every subclass / `ConsentVerifyError.cause` chaining.
  - `tests/http.test.ts` (24 cases) — happy-path GET (URL composition with `/v1` prefix + Bearer + Accept) / POST with JSON body + Content-Type / `X-CS-Trace-Id` request + response round-trip / query-string composition skipping undefined+null values / 204 → null body / **timeout fires + throws `ConsentShieldTimeoutError`** (with `vi.useFakeTimers` + `.rejects` attached BEFORE timer advance to avoid `PromiseRejectionHandledWarning`) / **timeout never retries** (single fetch call after 5 retries configured) / 5xx retry up to N + succeeds on Nth attempt / 5xx retry exhausted → `ConsentShieldApiError` with status + traceId / network error retry → `ConsentShieldNetworkError` after N attempts / 4xx never retries (sweep across 400/401/403/404/410/422) / `maxRetries: 0` honoured (single attempt) / caller `AbortSignal` re-throws caller's `AbortError` / RFC 7807 problem-body parsing onto `error.problem` / non-JSON error body tolerated.
  - `tests/client.test.ts` (7 cases) — constructor accepts valid `apiKey` + applies SDK defaults / honours custom `baseUrl` (trims trailing slashes) / honours custom `timeoutMs` + `maxRetries` / rejects missing options / rejects non-string `apiKey` / rejects wrong prefix (`sk_live_`, `cs_test_`, `CS_LIVE_`) / rejects non-positive `timeoutMs` (0 / negative / Infinity) / rejects non-integer or negative `maxRetries` / honours explicit `failOpen=true` / reads `CONSENT_VERIFY_FAIL_OPEN=true|1` from env when option absent / explicit `failOpen=false` overrides env / treats env=falsy as `false` / `ping()` GETs the right URL with the Bearer header.

**Architecture note — published-package layout deferred to Sprint 1.4.** The package currently exports TS source directly (`main: src/index.ts`). This works for internal monorepo consumption + Vitest. Sprint 1.4 adds the dual ESM+CJS build via `tsup` + `.d.ts` emission and flips `exports`/`main` to point at `dist/`. Holding off the build step now avoids paying for it on every sprint commit — the API surface is still in flux.

**Tested:**
- [x] `cd packages/node-client && bun run test` — 38 passed (3 files) — PASS
- [x] `cd packages/node-client && bun run typecheck` — clean — PASS

**Status:** `[x] complete 2026-04-25 — Bun workspace + ConsentShieldClient + HttpClient + 5 error classes + ping(); 38 unit tests pass; typecheck clean. v1.0.0-alpha.1 in package.json. Ready for Sprint 1.2 (verify + verifyBatch).`

#### Sprint 1.2: Verify + verifyBatch methods

**Deliverables:**
- [x] `packages/node-client/src/types.ts` — wire-format types mirroring `app/src/lib/consent/verify.ts` exactly: `VerifyStatus` (`granted | revoked | expired | never_consented`), `IdentifierType` (`email | phone | pan | aadhaar | custom`), `VerifyEnvelope` (§5.1), `VerifyBatchEnvelope`, `VerifyBatchResultRow`, `OpenFailureEnvelope` (`{ status: 'open_failure', reason, cause: 'timeout' | 'network' | 'server_error', traceId? }`). snake_case field names preserved on response shapes (server contract); camelCase only on the SDK input shapes.
- [x] `packages/node-client/src/verify.ts` — `verify()` + `verifyBatch()` core. Implements the **non-negotiable compliance contract** at the `decideFailureOutcome()` helper:
  - 4xx (caller bug / scope / 422 / 404 / 413) → ALWAYS throws `ConsentShieldApiError` regardless of `failOpen`. A failOpen flag MUST NEVER mask a real validation/scope error.
  - timeout / network / 5xx + `failOpen=false` (default) → throws `ConsentVerifyError` wrapping the `ConsentShieldError` cause; calling code MUST treat the data principal as "consent NOT verified".
  - timeout / network / 5xx + `failOpen=true` → returns `OpenFailureEnvelope` with `cause: 'timeout' | 'network' | 'server_error'` discriminator + `traceId` from the failed-request response header. Sprint 1.3 wires the automatic POST to `/v1/audit` for the override; Sprint 1.2 ships the shape only.
- [x] `client.verify({ propertyId, dataPrincipalIdentifier, identifierType, purposeCode, traceId?, signal? })` — GETs `/v1/consent/verify` with snake_case query string composition at the network boundary. Returns `VerifyEnvelope | OpenFailureEnvelope` per the failOpen flag.
- [x] `client.verifyBatch({ propertyId, identifierType, purposeCode, identifiers, traceId?, signal? })` — POSTs `/v1/consent/verify/batch`. **Client-side gates BEFORE network**: empty array → `RangeError` synchronously; > 10 000 entries → `RangeError` synchronously (matches server cap, saves the 413 round-trip); non-string entry → `TypeError` synchronously; missing required scalar → `TypeError` synchronously. Server-side cap is honoured exactly (10 000 is allowed; 10 001 is not).
- [x] `isOpenFailure(result)` ergonomic type guard — re-exported from `index.ts` so callers can branch without a `.status === 'open_failure'` string check.
- [x] `client.ts` — wires `verify` + `verifyBatch` onto the public surface. JSDoc on each method spells out the behaviour table (200 / 4xx / 5xx-or-timeout-or-network × failOpen=true|false) so the contract is visible at the call site.
- [x] `index.ts` — re-exports `isOpenFailure` + `VerifyInput` + `VerifyBatchInput` + the new `types.ts` shapes.

**Tested:**
- [x] `cd packages/node-client && bun run test` — **64 passed** (5 files, +26 over Sprint 1.1's 38) — PASS
- [x] `cd packages/node-client && bun run typecheck` — clean — PASS
- [x] `tests/verify.test.ts` (15 cases) — happy path returns envelope verbatim / camelCase → snake_case query / Authorization Bearer / traceId forward; synchronous validation rejects each missing/empty required field; **fail-closed default** throws `ConsentVerifyError` (not raw API error) on 5xx + on transport error; **fail-open opt-in** returns `OpenFailureEnvelope` on 5xx + transport + timeout (with correct `cause` discriminator); **4xx ALWAYS throws** even when failOpen=true (sweep across 422 / 403 / 404 — scope, validation, not-found errors must NEVER be silenced).
- [x] `tests/verify-batch.test.ts` (15 cases) — POST shape (snake_case body, Content-Type) / input-order preserved in results; **client-side gates** (empty → RangeError, >10000 → RangeError matching server cap, exactly 10000 allowed at boundary, non-array → TypeError, non-string entry → TypeError, empty entry → TypeError, each missing required scalar → TypeError) — none of these gates trigger fetch; fail-closed/open + 4xx-never-opens (422 + 413).

**Status:** `[x] complete 2026-04-25 — verify + verifyBatch ship with the non-negotiable compliance contract (4xx-always-throws + fail-closed default + fail-open opt-in with cause discriminator). 64 unit tests pass; typecheck clean. Sprint 1.3 next: record + revoke + triggerDeletion + artefact CRUD + automatic audit POST for fail-open overrides.`

#### Sprint 1.3: Record + revoke + triggerDeletion + artefact helpers + audit-trail wiring

**Deliverables:**
- [x] `src/types.ts` extended with every Sprint 1.3 envelope: `RecordEnvelope` + `RecordedArtefact`, `RevokeEnvelope`, `ArtefactListItem` + `ArtefactListEnvelope` + `ArtefactDetail` + `ArtefactRevocation`, `EventListItem` + `EventListEnvelope`, `DeletionReason` + `DeletionTriggerEnvelope` + `DeletionReceiptRow` + `DeletionReceiptsEnvelope`, `RightsRequestType` + `RightsRequestStatus` + `RightsCapturedVia` + `RightsRequestCreatedEnvelope` + `RightsRequestItem` + `RightsRequestListEnvelope`, `AuditLogItem` + `AuditLogEnvelope`. snake_case fields preserved (server contract).
- [x] **Eight method modules** under `packages/node-client/src/`:
  - `record.ts` — `recordConsent({ propertyId, dataPrincipalIdentifier, identifierType, purposeDefinitionIds, rejectedPurposeDefinitionIds?, capturedAt, clientRequestId? })` → POST `/v1/consent/record`. Synchronous gates: empty `purposeDefinitionIds` → `RangeError`; non-string entry → `TypeError`. `clientRequestId` is the idempotency key — same id within the org dedupes to the same `event_id` with `idempotent_replay: true`.
  - `revoke.ts` — `revokeArtefact(artefactId, { reasonCode, reasonNotes?, actorType, actorRef? })` → POST `/v1/consent/artefacts/{id}/revoke`. URL-encodes the artefact id. Synchronous gates: missing reasonCode → `TypeError`; invalid actorType (not `user|operator|system`) → `TypeError`. Server returns 409 Conflict on terminal-state artefact (revoked + replaced) — surfaced as `ConsentShieldApiError`.
  - `artefacts.ts` — `listArtefacts({ propertyId?, purposeCode?, status?, identifierType?, cursor?, limit? })` + `iterateArtefacts(...)` async-iterator + `getArtefact(id, { traceId?, signal? })` (returns `ArtefactDetail | null` — null when the JSON body is `null` for an unknown id; URL-encoded path).
  - `events.ts` — `listEvents` + `iterateEvents`.
  - `deletion.ts` — `triggerDeletion({ propertyId, dataPrincipalIdentifier, identifierType, reason, purposeCodes?, scopeOverride?, actorType?, actorRef? })` + `listDeletionReceipts` + `iterateDeletionReceipts`. Synchronous gates: `reason` must be `consent_revoked|erasure_request|retention_expired`; `purposeCodes` REQUIRED when `reason === 'consent_revoked'`.
  - `rights.ts` — `createRightsRequest({ type, requestorName, requestorEmail, requestDetails?, identityVerifiedBy, capturedVia? })` + `listRightsRequests` + `iterateRightsRequests`. Synchronous gates: `type` must be `erasure|access|correction|nomination`; `status` must be `new|in_progress|completed|rejected`; `capturedVia` must be one of the eight whitelisted strings.
  - `audit.ts` — `listAuditLog({ eventType?, entityType?, createdAfter?, createdBefore?, cursor?, limit? })` + `iterateAuditLog`.
- [x] **Compliance-load-bearing audit-trail wiring** — closes the Sprint 1.2 deferred deliverable. New `onFailOpen` constructor option of type `FailOpenCallback = (envelope, ctx: { method: 'verify' | 'verifyBatch' }) => void | Promise<void>`. Default implementation: structured `console.warn('[@consentshield/node] fail-open verify override', { method, cause, reason, traceId })`. Production callers wire to Sentry / a structured logger / a custom `/v1/audit` POST. Fire-and-forget — promise return is NOT awaited; throws inside the callback are caught + emitted via `console.error` and never break the verify call site. `verify()` and `verifyBatch()` invoke it once after building the `OpenFailureEnvelope`, before returning.
- [x] `client.ts` — wires the 9 new methods + 5 async-iterator helpers + the `onFailOpen` option onto `ConsentShieldClient`. JSDoc on each method spells out the route + idempotency semantics.
- [x] `index.ts` — re-exports every new envelope type + input type + `FailOpenCallback`.

**Tested:**
- [x] `cd packages/node-client && bun run test` — **94 passed** (7 files, +30 over Sprint 1.2's 64) — PASS
- [x] `cd packages/node-client && bun run typecheck` — clean — PASS
- [x] `tests/methods.test.ts` (~22 cases) — for each of the 8 method modules: snake_case body / query composition, URL encoding for path params (artefact id with `/`/`#`/`&`/`?`), synchronous validation gates fire BEFORE fetch (none of these gate-trigger cases call `fetchMock`), 4xx surfaces as `ConsentShieldApiError` (sample: revoke 409 Conflict on terminal-state artefact), `getArtefact` returns null on JSON-null body for unknown id, `iterateArtefacts` walks 2 pages by following `next_cursor`, `triggerDeletion` rejects `reason=consent_revoked` without `purposeCodes` synchronously, `triggerDeletion` allows `reason=erasure_request` without `purposeCodes`, `createRightsRequest` rejects invalid `type`, `listRightsRequests` rejects invalid `status`.
- [x] `tests/fail-open-callback.test.ts` (8 cases) — fires once on `verify` fail-open with method ctx + envelope + traceId; fires once on `verifyBatch` fail-open with `method=verifyBatch`; does NOT fire on success / `failOpen=false` / 4xx (4xx-always-throws); does not crash the call site when callback throws synchronously OR returns a rejected promise (both surfaced via `console.error`); default callback (no `onFailOpen` supplied) emits a structured `console.warn`.

**Status:** `[x] complete 2026-04-25 — record + revoke + triggerDeletion + 5 list+iterate helpers + getArtefact + createRightsRequest + listRightsRequests + listAuditLog ship; onFailOpen audit-trail callback closes the Sprint 1.2 deferred deliverable. 94 unit tests pass; typecheck clean. Sprint 1.4 next: dual ESM+CJS build via tsup + .d.ts emission + npm publish + Express/Next.js integration examples.`

#### Sprint 1.4: Publish + integration examples

**Estimated effort:** 1 day

**Deliverables:**
- [ ] TypeScript type definitions shipped (generated from OpenAPI where possible)
- [ ] README with quickstart
- [ ] `examples/express-verify-middleware/` — Express middleware that verifies marketing consent before every request
- [ ] `examples/nextjs-mobile-record/` — Next.js API route recording consent from a mobile app
- [ ] Publish to npm at v1.0.0
- [ ] Internal smoke test in ConsentShield admin app uses the library against staging

**Testing plan:**
- [ ] `npm install @consentshield/node` in a scratch project; example runs against staging
- [ ] Coverage ≥ 80% (`npm test -- --coverage`)

**Status:** `[ ] planned`

### Phase 2: Python library (G-003)

#### Sprint 2.1: Package scaffold + method parity

**Estimated effort:** 3 days

**Deliverables:**
- [ ] `consentshield` package layout with Poetry/uv or pip-tools
- [ ] Py 3.9+ compatibility
- [ ] Type hints on every public API; mypy clean
- [ ] API parity with Node: same method names (snake_case adapted), same error types, same fail-closed default, same `CONSENT_VERIFY_FAIL_OPEN` env override
- [ ] `httpx` for HTTP (supports async + sync)

**Testing plan:**
- [ ] Method-parity tests: same fixtures as Node library, same assertions
- [ ] `mypy --strict` passes

**Status:** `[ ] planned`

#### Sprint 2.2: Integration examples + PyPI publish

**Estimated effort:** 2 days

**Deliverables:**
- [ ] Django middleware example
- [ ] Flask decorator example
- [ ] FastAPI dependency-injection example
- [ ] README with quickstart
- [ ] Publish to PyPI at v1.0.0
- [ ] Internal smoke test

**Testing plan:**
- [ ] `pip install consentshield` in a scratch project; examples run against staging

**Status:** `[ ] planned`

### Phase 3: OpenAPI spec completion + CI drift check (G-045)

#### Sprint 3.1: Full spec + Appendix A generator

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `app/public/openapi.yaml` covers every `/v1/*` endpoint shipped in ADRs 1001–1005 with full request/response schemas, scopes, error shapes
- [ ] Spec published at `https://api.consentshield.in/openapi.yaml`
- [ ] `scripts/regenerate-whitepaper-appendix.ts` reads OpenAPI and emits the Markdown table that replaces Appendix A in the whitepaper

**Testing plan:**
- [ ] `redocly lint` passes
- [ ] Generated Appendix A matches current whitepaper (diff is empty at time of merge)

**Status:** `[ ] planned`

#### Sprint 3.2: CI drift check

**Estimated effort:** 1 day

**Deliverables:**
- [ ] CI workflow step: run the generator; diff against `docs/design/ConsentShield-Customer-Integration-Whitepaper-v2.md` Appendix A section; fail build on any difference
- [ ] Developer ergonomics: a `bun run sync:whitepaper-appendix` command updates the whitepaper in place from the spec

**Testing plan:**
- [ ] Introduce a fake drift (add an endpoint in code but not in spec) → CI fails
- [ ] Remove the drift → CI passes

**Status:** `[ ] planned`

### Phase 4: Java + Go libraries (G-024)

#### Sprint 4.1: Java library

**Estimated effort:** 5 days

**Deliverables:**
- [ ] `com.consentshield:consentshield-client:1.0.0` Maven artefact
- [ ] API parity with Node/Python
- [ ] Fail-closed default; `CONSENT_VERIFY_FAIL_OPEN` via Java system property or env
- [ ] Spring Boot integration example with auto-configuration
- [ ] Publish to Maven Central (Sonatype OSSRH onboarding done during this sprint)
- [ ] Coverage ≥ 80%

**Testing plan:**
- [ ] `mvn install` in a scratch Spring Boot project; example runs against staging
- [ ] Integration tests: same fixtures

**Status:** `[ ] planned`

#### Sprint 4.2: Go library

**Estimated effort:** 3 days

**Deliverables:**
- [ ] `github.com/consentshield/go-client` Go module
- [ ] API parity with other languages (Go-idiomatic: `context.Context` first arg, explicit error returns)
- [ ] Fail-closed default; `CONSENT_VERIFY_FAIL_OPEN` via env
- [ ] `net/http` example + middleware for `chi`/`gin`
- [ ] Tag v1.0.0 on the module proxy
- [ ] Coverage ≥ 80%

**Testing plan:**
- [ ] `go get github.com/consentshield/go-client@v1.0.0` in scratch project; example runs against staging

**Status:** `[ ] planned`

---

## Architecture Changes

- `docs/architecture/consentshield-definitive-architecture.md`: add a "Client libraries" section with the four supported languages + API conventions
- `docs/architecture/nextjs-16-reference.md`: OpenAPI spec as part of the public static assets

_None yet._

---

## Test Results

_Empty until Sprint 1.1 runs._

---

## V2 Backlog (explicitly deferred)

- PHP client library — wait for WordPress plugin + customer demand (ADR-1007).
- Ruby / Rust / C# libraries — defer to future ADR on customer signal.
- Async-first Python client (current library exposes both sync + async from httpx) — no further work unless users complain.

---

## Changelog References

- `CHANGELOG-api.md` — Sprint 3.1 (OpenAPI spec), Sprint 3.2 (CI drift)
- `CHANGELOG-docs.md` — Sprints 1.4, 2.2 (examples), Sprint 3.2 (drift-check docs)
- External: per-library release notes in each library repo
