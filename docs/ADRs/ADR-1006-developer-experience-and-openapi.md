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

#### Sprint 1.4: Publish + integration examples + coverage gate

**Deliverables:**
- [x] **Dual ESM + CJS build via `tsup` 8.5.1.** `packages/node-client/tsup.config.ts` emits `dist/index.{mjs,cjs}` + `dist/index.d.{ts,cts}` + sourcemaps; treeshake on; target `node18`. Build artefacts: 31.31 KB ESM / 31.53 KB CJS / 27.68 KB types. `packages/node-client/tsconfig.json` overrides `incremental: false` so the tsup DTS step doesn't reject the inherited `tsBuildInfoFile`-less incremental setting.
- [x] **Published-package layout flipped from TS-source to `dist/`.** `package.json`: `version` 1.0.0-alpha.1 → **1.0.0**; `type: module`; `main`: `./dist/index.cjs`; `module`: `./dist/index.mjs`; `types`: `./dist/index.d.ts`; `exports` map (conditional `import`/`require` with `types` per condition); `sideEffects: false` for tree-shaking; `files: [dist, README.md, LICENSE.md]`. New scripts: `build` (tsup), `build:watch`, `test:coverage`, `prepublishOnly` (`bun run build && bun run typecheck && bun run test`).
- [x] **`packages/node-client/LICENSE.md`** — proprietary text per CLAUDE.md authorship rules (single copyright line, permitted-use carve-out for the SDK's own client purpose, anti-redistribution clause, no-warranty).
- [x] **README rewritten for v1.0.0.** Drops the alpha banner. Adds the 14-method matrix (consent / listing+iteration / deletion+rights tables) + the explicit fail-open behaviour table for `verify`/`verifyBatch` + the 4-default compliance-posture table now including `onFailOpen` + a pointer to both example directories.
- [x] **Coverage gate at ≥80%** wired into `vitest.config.ts` via `@vitest/coverage-v8` 4.1.4. Thresholds: lines / functions / branches / statements all ≥80. Final coverage: **statements 94.82% / branches 90.56% / functions 95.31% / lines 95.52%**. New `packages/node-client/tests/iterators.test.ts` (~9 cases) brings `iterateEvents`/`iterateAuditLog`/`iterateDeletionReceipts`/`iterateRightsRequests` over the threshold + adds extra validator-branch coverage on `recordConsent` (rejected-purpose-defs forwarding + non-array gates) and `triggerDeletion` (non-array purposeCodes/scopeOverride + invalid actorType + non-string entry index).
- [x] **`examples/express-verify-middleware/`** — Express 5.1 middleware (`consentRequired(client, opts)`) that verifies consent on every request and refuses with HTTP 451 ("Unavailable For Legal Reasons") on `revoked`/`expired`/`never_consented`. Honours fail-CLOSED default → HTTP 503; honours `failOpen=true` opt-in → passes through with `X-CS-Override` + `X-CS-Trace-Id` headers. README explains the fail-CLOSED → 503 rationale (defaulting to "send anyway" is the worst DPDP outcome). Includes `app.ts` runnable demo.
- [x] **`examples/nextjs-mobile-record/`** — Next.js 16.2.3 App Router API route at `app/api/consent/route.ts` that accepts a mobile-app POST and records consent via `client.recordConsent`. Module-load init of `ConsentShieldClient` (validates `CS_API_KEY` at `next build` / first cold start, never inside a request). Trace-id round-trip from inbound `X-CS-Trace-Id` → SDK call → response header. Error surface: `ConsentShieldApiError` → forwards status + problem; SDK `TypeError`/`RangeError` validation → 422; network/timeout → 502.
- [x] `.gitignore` extended with `packages/node-client/dist/` + `packages/node-client/coverage/`.
- [x] `packages/node-client/tsconfig.json` excludes `dist`, `examples`, `node_modules` so the SDK's own typecheck doesn't try to resolve `express` / `next` from the example workspaces (which aren't installed in the SDK workspace itself).

**Spec amendment for Sprint 1.4 scope:**
- "**Publish to npm at v1.0.0**" deferred to operator follow-up. The SDK is publish-ready (dist/ builds clean, prepublishOnly script wired, version flipped to 1.0.0, LICENSE in place, README finalised); the actual `npm publish` requires the npm token + 2FA token, which is operator-level (parallels the `vercel link` Sprint 5.3 deferral). Tracked in the V2 backlog under "Sprint 1.4 follow-up — npm publish".
- "**Internal smoke test in ConsentShield admin app uses the library against staging**" also deferred to operator follow-up — needs a running staging environment with the SDK npm-installed (vs the workspace-linked form used by the examples).

**Tested:**
- [x] `cd packages/node-client && bun run typecheck` — clean — PASS
- [x] `cd packages/node-client && bun run test` — **103 passed** (8 files, +9 over Sprint 1.3's 94) — PASS
- [x] `cd packages/node-client && bun run build` — emits 31.31 KB ESM / 31.53 KB CJS / 27.68 KB types in ~600 ms — PASS
- [x] `cd packages/node-client && bun run test:coverage` — **94.82 / 90.56 / 95.31 / 95.52** (statements / branches / functions / lines) — PASS, well above the 80% gate.

**Status:** `[x] complete 2026-04-25 — Phase 1 closes. @consentshield/node v1.0.0 publish-ready: dual ESM+CJS build; 103 unit tests; coverage 94.82% / 90.56% / 95.31% / 95.52%; LICENSE.md + README.md finalised; two integration examples (Express middleware + Next.js App Router route) shipped. npm publish + staging smoke test deferred to operator follow-up.`

### Phase 2: Python library (G-003)

#### Sprint 2.1: Package scaffold + method parity (sync + async)

**Scope amendment (2026-04-25).** The original deliverable list said
"`httpx` for HTTP (supports async + sync)" without committing to a
client shape. After Phase-1's Node-SDK pattern landed, the natural
choice for Python is **two clients** — sync `ConsentShieldClient` and
async `AsyncConsentShieldClient` — matching the convention every
major Python SDK uses (`httpx`, `openai`, `anthropic`, `redis-py`).
Doubles the implementation surface; halves the integration friction
(FastAPI users get native async, Django/Flask users get native sync).
User-confirmed before Sprint 2.1 work started.

**Deliverables:**
- [x] `packages/python-client/` Bun-workspace-adjacent layout (no Bun deps; pure Python). `pyproject.toml` with `hatchling` build backend; py.typed marker per PEP 561; Python ≥ 3.9 baseline; `httpx` dep `>=0.27,<1.0`; optional `[test]` extras (`pytest`, `pytest-httpx`, `respx`, `pytest-cov`); optional `[dev]` extras (`mypy`, `ruff`); strict tool configs for `pytest`, `coverage`, `mypy`, `ruff`. `LICENSE.md` proprietary text per CLAUDE.md authorship rules. `README.md` with the full method matrix + fail-open behaviour table.
- [x] **Sync `ConsentShieldClient`** + **async `AsyncConsentShieldClient`** ship in parallel — 100% method parity. The only difference is every method on the async client returns `Awaitable[T]` and cursor iterators are `AsyncIterator[T]` instead of `Iterator[T]`.
- [x] **Shared core** keeps the duplication minimal:
  - `_config.py` — constructor validation + defaults + env override (cs_live_ prefix, positive timeout, non-negative integer max_retries, bool-only fail_open, `CONSENT_VERIFY_FAIL_OPEN=true|1` env honoured when option absent).
  - `_builders.py` — every `build_*_request(...)` function runs synchronous validation + constructs the snake_case body/query at the network boundary + returns an `HttpRequest`. Both sync + async clients delegate to these builders, so validation logic exists in one place.
  - `_verify.py` — `decide_failure_outcome(err, fail_open)` encodes the **non-negotiable compliance contract** (4xx ALWAYS raises, timeout/network/5xx + fail_open=False → `ConsentVerifyError`, fail_open=True → `OpenFailureEnvelope` with cause discriminator). Used by both sync + async verify.
- [x] **HTTP transport** — `_http.py` ships sync `HttpClient` + async `AsyncHttpClient`. 2-second default timeout via `httpx.Timeout`. Exponential-backoff retry (100/400/1600 ms) on 5xx + transport errors up to `max_retries`. **Never** retries 4xx (caller bug). **Never** retries timeouts (compounds latency past compliance budget). RFC 7807 problem-document parsing onto `error.problem`. `X-CS-Trace-Id` round-trip.
- [x] **Five-class error hierarchy** mirrors the Node SDK 1:1: `ConsentShieldError` base + `ConsentShieldApiError` (with `status` + `problem` fields) + `ConsentShieldNetworkError` + `ConsentShieldTimeoutError` (never retried) + `ConsentVerifyError` (compliance-critical wrapper). Every error carries optional `trace_id`.
- [x] **14 methods + 5 cursor-iterating helpers** ship on each client (sync + async = 28 + 10 = 38 callable surfaces total): `ping` / `verify` / `verify_batch` / `record_consent` / `revoke_artefact` / `list_artefacts` / `iterate_artefacts` / `get_artefact` / `list_events` / `iterate_events` / `trigger_deletion` / `list_deletion_receipts` / `iterate_deletion_receipts` / `create_rights_request` / `list_rights_requests` / `iterate_rights_requests` / `list_audit_log` / `iterate_audit_log`. Same input names + same wire-format envelopes as the Node SDK (snake_case all the way through; Python convention + matches the server contract directly).
- [x] **`on_fail_open` callback** closes the audit-trail wiring in both sync + async clients. Sync default: `logging.warning` with structured key/value pairs. Async default: same. Async path schedules awaitable callbacks fire-and-forget on the running event loop; sync throws + async rejections both swallowed with stderr log + never break the verify call site.
- [x] **`is_open_failure(result)`** type guard re-exported from the package root.

**Tested:**
- [x] `pytest -q --cov` — **119 passed**; coverage **88.54%** total (statements/branches/functions/lines combined; all per-file ≥ 81% except `_http.py` at 81% — the lowest, still over the 80% gate). Fail-under = 80 enforced via `pyproject.toml` `[tool.coverage.report]`.
- [x] `mypy --strict src/consentshield` — clean across 9 source files.
- [x] **Test files (10 across `tests/`):**
  - `test_errors.py` (7) — class hierarchy, message composition, trace_id propagation, `except ConsentShieldError` uniform catch.
  - `test_client.py` (14) — constructor validation (cs_live_ prefix, timeout, max_retries, fail_open env override × 4 truthy/falsy cases), ping(), context-manager close.
  - `test_http.py` (16) — URL composition, Bearer auth, 5xx exponential-backoff retry, retry exhaustion, transport-error retry, **4xx never retries** (sweep across 400/401/403/404/410/422), **timeout never retries**, problem-body parsing, non-JSON tolerance, query-string skips None.
  - `test_verify.py` (12) — happy path, snake_case query, trace_id forward, synchronous validation, **fail-closed** raises `ConsentVerifyError` on 5xx + transport, **fail-open** returns envelope on 5xx + transport + timeout (with correct `cause`), **4xx ALWAYS raises** even when fail_open=True (sweep across 422/403/404).
  - `test_verify_batch.py` (12) — POST shape, input order preserved; **client-side gates** (empty array → ValueError, > 10 000 → ValueError matching server cap, exactly 10 000 allowed at boundary, non-list → TypeError, non-string entry → TypeError); fail-closed/open + 4xx-never-opens (422 + 413).
  - `test_methods.py` (15) — record/revoke/CRUD method shapes; URL encoding for path params; sync validation gates; 409 Conflict surfacing; trigger_deletion `purpose_codes` REQUIRED when `reason='consent_revoked'` enforced synchronously.
  - `test_async_client.py` (7) — async smoke: ping, verify happy path, fail-closed/open on 5xx, 4xx-always-raises, async iterator walks pages, record_consent body shape.
  - `test_fail_open_callback.py` (7) — fires once on verify fail-open with method ctx + envelope + trace_id; fires once on verify_batch fail-open; does NOT fire on success / fail_open=False / 4xx; sync throw inside callback doesn't break call site (caught + logged); default callback emits `logging.warning`.
  - `test_iterators_and_validators.py` (22) — sync + async iterators for events/audit/deletion-receipts/rights-requests; extra builder validator branches (rejected_purpose_definition_ids non-array / non-string entries; trigger_deletion non-array purpose_codes / scope_override / invalid actor_type / non-string entry index; rights captured_via reject; revoke_artefact non-string reason_notes / actor_ref / empty id; get_artefact empty id).

**Spec amendment for Sprint 2.1 — `pip publish` / `wheel` build / examples deferred to Sprint 2.2.** SDK is publish-ready (pyproject.toml validated, mypy clean, 88.54% coverage); `python -m build` + `twine upload` + the Django/Flask/FastAPI examples ship in Sprint 2.2 (mirrors Sprint 1.4's deferral pattern for the Node SDK).

**Status:** `[x] complete 2026-04-25 — sync + async clients ship with 100% Node-SDK method parity. 119 pytest tests; mypy --strict clean; coverage 88.54%. Sprint 2.2 next: Django middleware + Flask decorator + FastAPI dependency + PyPI publish.`

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
