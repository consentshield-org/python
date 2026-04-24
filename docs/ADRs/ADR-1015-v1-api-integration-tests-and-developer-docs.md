# ADR-1015: v1 API integration tests + customer developer documentation

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** In Progress
**Date proposed:** 2026-04-22
**Date started:** 2026-04-24
**Date completed:** —
**Supersedes:** —
**Depends on:**
- ADR-1009 (`cs_api` direct-Postgres) — the runtime the integration suite exercises.
- ADR-1011 (revoked-key tombstone) — tests must observe 410 on rotated keys.
- ADR-1012 (v1 DX gap fixes + OpenAPI examples) — the OpenAPI spec is the Scalar playground source and the endpoint set is stable.
**Sibling:** ADR-1014 (E2E harness + vertical demos — the /docs pages in this ADR link to the test-verification surface ADR-1014 publishes).
**Related:** ADR-1006 (client libraries in Node / Python / Java / Go — their READMEs link to the docs surface this ADR ships).
**Wireframe (normative):** `docs/design/screen designs and ux/consentshield-developer-docs.html`. Per `feedback_wireframes_before_adrs.md`, the wireframe is the visual + interaction spec; the ADR references it as acceptance criterion.

---

## Context

ADR-1012 shipped the OpenAPI spec with complete examples for all 15 `/v1/*` endpoints. ADR-1006 is Proposed for client libraries. There is currently no **public** developer-docs surface — no `/docs/*` on the marketing site, no quickstart, no cookbook, no interactive playground. A developer evaluating ConsentShield before signup has to either click through to the raw YAML or read ADRs, which is not a defensible onboarding experience for prospective partners and customers.

Separately, the `/v1/*` surface has unit tests (`app/tests/`) and Phase 3 of ADR-1014 exercises it end-to-end as part of the broader harness, but there is no **external-consumer perspective** integration suite — one that exercises all 15 endpoints with a Bearer API key, in a realistic sequence a real customer would follow, with no privileged access. That is the exact suite a prospective partner would want to run against their own Bearer key to verify our API behaves as documented.

These two concerns — public documentation and external-consumer integration tests — share a common centre of gravity (the OpenAPI spec + the /v1/ surface) and should ship together. They inform each other: every documented behaviour must be tested; every passing test is a documentation receipt.

## Decision

Ship a four-phase deliverable: the `/docs/*` surface on the marketing site (Next.js MDX + `@scalar/api-reference`) and a v1 API integration test suite that exercises all 15 endpoints as an external consumer would.

**Key choices (locked with the user before drafting):**

| Decision | Choice | Reason |
|----------|--------|--------|
| Docs home | `marketing/` at `/docs/*` (public, SEO-indexed) | Developers evaluate before signup; authenticated-docs would gate evaluation. |
| Docs tooling | Next.js 16 MDX + `@scalar/api-reference` mounted at `/docs/api` | In-repo (Rule 15 — no new managed-service dependency), polished, OpenAPI-aware. |
| Integration-test host | Part of the `tests/e2e/` workspace from ADR-1014 — separate directory `tests/integration/v1-api/` | Shares the partner bootstrap + evidence machinery. |
| Test perspective | External consumer: Bearer key only, no DB privileges, no internal imports | Matches what a partner would run. |
| Coverage | All 15 endpoints, every documented 4xx and 5xx | Every error code in `/docs/errors` has a failing test. |

**Not in scope:**
- Client libraries (ADR-1006).
- In-app authenticated developer dashboard (out of scope; a future ADR will address in-app key management UX separately).
- Localisation of docs — English only for v1. Regional DPDP-language versions are V2.

## Consequences

- **Marketing deploys gain a new surface.** `/docs/*` is non-trivial content; the marketing workspace grows by ~30 MDX pages. Build time increases; Turbopack remains the bundler.
- **Scalar dependency.** `@scalar/api-reference` is a mature MIT package. We pin exact-version per project norms. Rule 15 justification: the alternative is a from-scratch OpenAPI renderer, which is ~3 weeks of work; Scalar is ~3 days of integration.
- **Content maintenance rhythm.** Every `/v1/*` ADR that ships from now on must include a docs update in the same PR: at minimum an entry in the API changelog, and a cookbook update when the endpoint's public contract changes.
- **External-consumer tests.** `tests/integration/v1-api/` runs with a Bearer key and no internal imports. Shares evidence infrastructure with ADR-1014 but is scoped to the API surface only.
- **Turnstile + Rate-limit awareness.** External tests must respect the live rate limits; the suite uses sandbox keys with elevated quotas via a new `cs_test_*` key prefix seeded by ADR-1014's bootstrap.

---

## Implementation Plan

### Phase 1 — Marketing /docs/* surface foundations

#### Sprint 1.1: MDX pipeline + shell · **[x] complete 2026-04-24**

**Estimated effort:** 2 days

**Deliverables:**
- [x] `marketing/src/app/docs/layout.tsx` — three-pane shell (sidebar + content + ToC rail). Top-level `<Nav>` / `<Footer>` inherit from the marketing root layout.
- [x] MDX config: `@next/mdx@16.2.4` chosen for route colocation (any `/docs/**/*.mdx` file auto-routes). `pageExtensions: ['ts', 'tsx', 'md', 'mdx']` added to `next.config.ts`; `createMDX({})` wraps the nextConfig before `withSentryConfig` so Sentry instrumentation still applies.
- [x] Shared components under `marketing/src/app/docs/_components/` — `<Breadcrumb>`, `<Callout>` (four tones: tip / info / warn / security), `<CodeTabs>` (client; active-tab state + clipboard copy), `<EndpointHeader>` (method pill + path with `{param}` highlighting + auth/rate/idempotent metadata row), `<ParamTable>`, `<StatusGrid>`, `<FeedbackStrip>`, `<DocsSidebar>` (client; active-link via `usePathname`), `<DocsTocRail>` (client; walks `<main class="docs-content">` DOM on mount + IntersectionObserver for active anchor). Every component matches wireframe class names so drift checks can diff by selector.
- [x] Sidebar taxonomy: `marketing/src/app/docs/_data/nav.ts` — five groups (Get started · Core concepts · Cookbook · API Reference · Reference) with every link from the wireframe. HTTP-method pills render via `sb-method` classes; subheadings (`Health`, `Consent`, `Deletion`, `Account & plans`) nest under API Reference.
- [x] `marketing/mdx-components.tsx` — top-level MDX component registry so MDX pages auto-resolve `<Callout>` / `<CodeTabs>` / etc. without per-file imports.
- [x] `marketing/src/app/docs/_styles/docs.css` — ported from the wireframe. Owns docs-specific layout + typography (class names match the spec: `.docs-shell`, `.sb-*`, `.callout`, `.param-table`, `.endpoint-head`, `.code-card`, `.status-grid`, `.feedback-strip`, `.docs-toc`, `.docs-breadcrumb`). Colour tokens come from marketing's `globals.css`.
- [x] `marketing/src/app/docs/page.tsx` — placeholder Developer Hub shell that proves the layout renders. Sprint 2.1 replaces the body.

**Testing plan:**
- [x] `cd marketing && bunx tsc --noEmit` — PASS.
- [x] `cd marketing && bun run lint` — PASS (one eslint-disable on toc-rail's setState-in-effect, explained in comment; the DOM walk is legitimately an effect).
- [x] `cd marketing && bun run build` — PASS. Route manifest includes `/docs` (static).
- [ ] Visual check via dev server — recommended before Sprint 1.2.

**Status:** `[x] complete`

#### Sprint 1.2: `@scalar/api-reference` mount · **[x] complete 2026-04-24**

**Estimated effort:** 1 day

**Deliverables:**
- [x] `@scalar/api-reference-react@0.9.27` exact-pinned (React 19 compatible; the React wrapper over Scalar's core engine fits the Next.js 16 app router better than the vanilla-JS variant).
- [x] `marketing/scripts/copy-openapi.ts` — reads `app/public/openapi.yaml` and writes `marketing/public/openapi.yaml`. Wired into `prebuild` after the existing env-isolation + legal-downloads scripts. Fails loudly (exit 1) if the source is missing. Added to `marketing/.gitignore` with a justifying comment so the copy doesn't accumulate in git.
- [x] `marketing/src/app/docs/api/page.tsx` mounts the full playground via `<ScalarPlayground>` (client component). Config: `url: '/openapi.yaml'`, `theme: 'default'`, metadata carrying the product title + description.
- [x] `marketing/src/app/docs/api/_components/scalar-overrides.css` re-maps the Scalar CSS variables to the marketing site's navy/teal palette (`--scalar-color-accent: var(--teal)`, `--scalar-font: var(--sans)`, `--scalar-heading-font: var(--display)`, etc.). Playground reads as part of the site rather than a drop-in.
- [x] Per-endpoint deep-links: `marketing/src/app/docs/api/[...path]/page.tsx` is a server-side catch-all that maps structured URLs (e.g. `/docs/api/consent/record`) to Scalar's native anchor form (`/docs/api#tag/consent/post-consent-record`). 15 endpoints indexed; sidebar entries in `_data/nav.ts` all resolve through this shim. Unknown deep links fall back to `/docs/api`.

**Testing plan:**
- [x] `cd marketing && bunx tsc --noEmit` — PASS.
- [x] `cd marketing && bun run lint` — PASS.
- [x] `cd marketing && bun run build` — PASS. Route manifest lists `/docs/api` (static prerender) + `/docs/api/[...path]` (dynamic). Pre-build `copy-openapi.ts` emits `marketing/public/openapi.yaml` (83 KB) every build.
- [ ] Visual check via dev server — recommended before Sprint 1.3.

**Status:** `[x] complete`

#### Sprint 1.3: Navigation + search · **[x] complete 2026-04-24**

**Estimated effort:** 2 days

**Deliverables:**
- [x] `marketing/src/app/docs/_data/search-index.ts` — in-repo search index built from `DOCS_NAV` with author-curated `description` + `keywords` overlays per route. Fuzzy scorer with four tiers (exact-substring-in-label → exact-substring-in-any-field → label-subsequence → cross-field-subsequence). No library dependency (Rule 15).
- [x] `marketing/src/app/docs/_components/search-palette.tsx` — Cmd-K palette. Keyboard contract: `⌘K`/`Ctrl+K` toggles, `/` opens (not when already typing), `Esc` closes, `↑`/`↓` navigate results, `Enter` follows. Empty-query state shows a curated top-6 list so the palette is useful on first open. External links open in a new tab.
- [x] Launcher button in the sidebar top slot — mimics the wireframe search affordance. Renders the `⌘K` hint kbd pill.
- [x] Active-page highlight in sidebar (Sprint 1.1) + active-anchor in ToC rail (Sprint 1.1) remain unchanged.
- [x] "Edit on GitHub" — `DocsTocRail` now auto-derives the repo-relative file path from `usePathname()`. `/docs` + `/docs/api` point at the `page.tsx`; all other `/docs/*` routes default to `page.mdx` (matching Sprint 2.x authoring convention). Dynamic catchalls (`/docs/api/[...path]`) return null so the footer gracefully hides.
- [x] `docs.css` grew `.search-launcher`, `.search-overlay`, `.search-palette`, `.search-input-row`, `.search-results`, `.search-result` (with `.active`), `.search-group-tag`, `.search-foot`, `.search-empty`. Overlay has a navy-tinted backdrop-filter blur.

**Testing plan:**
- [x] `cd marketing && bunx tsc --noEmit` — PASS.
- [x] `cd marketing && bun run lint` — PASS.
- [x] `cd marketing && bun run build` — PASS.
- [ ] Interactive: `⌘K` → palette opens → typing narrows results → `↵` follows → `Esc` closes. Requires a visual check against the dev server.

**Status:** `[x] complete` — Phase 1 closes with this sprint.

---

### Phase 2 — Content authoring

Each page is authored in MDX and cross-links to the Scalar playground for interactive examples.

#### Sprint 2.1: Developer Hub + Quickstart + Concepts

**Estimated effort:** 3 days

**Deliverables:**
- [ ] `/docs` — Developer Hub landing (per wireframe §Page 1): 4-card layout, at-a-glance table, "stay in the loop".
- [ ] `/docs/quickstart` — 15-minute path with 4 steps (per wireframe §Page 2).
- [ ] `/docs/concepts/dpdp-in-3-minutes`
- [ ] `/docs/concepts/artefacts-vs-events`
- [ ] `/docs/concepts/purpose-definitions`
- [ ] `/docs/concepts/rights-requests-lifecycle`
- [ ] `/docs/concepts/deletion-connectors`
- [ ] `/docs/concepts/key-rotation-and-tombstones`
- [ ] `/docs/authentication` — Bearer scheme, key prefixes (`cs_live_` vs `cs_test_`), rotation procedure, tombstone behaviour (ADR-1011).
- [ ] `/docs/rate-limits` — plan-scoped limits, `X-RateLimit-*` headers, 429 handling.

**Testing plan:**
- [ ] Every page renders. Every internal link resolves.
- [ ] Lighthouse score ≥ 95 on the /docs hub page (accessibility + performance).

**Status:** `[ ] planned`

#### Sprint 2.2: Cookbook — 7 recipes

**Estimated effort:** 5 days

**Deliverables (each recipe includes problem / shape / full code in 3 languages / gotchas / related):**
- [ ] `/docs/cookbook/record-consent-at-checkout` (per wireframe §Page 3).
- [ ] `/docs/cookbook/build-a-preference-center`
- [ ] `/docs/cookbook/handle-a-rights-request`
- [ ] `/docs/cookbook/wire-deletion-connector-webhook`
- [ ] `/docs/cookbook/batch-verify-consents`
- [ ] `/docs/cookbook/rotate-api-key-safely`
- [ ] `/docs/cookbook/build-dpb-audit-export`

**Testing plan:**
- [ ] Each code sample in each recipe is copy-paste runnable in its stated language; verify by shelling the snippet in the integration-test harness (Phase 3).
- [ ] Every recipe cross-links to the corresponding API-reference endpoint page.

**Status:** `[ ] planned`

#### Sprint 2.3: Error catalog + API changelog

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `/docs/errors` — every error code surfaced by any `/v1/*` endpoint, with meaning, cause, and recommended remediation. Generated from a canonical enum in `app/src/lib/api/errors.ts` at build time.
- [ ] `/docs/changelog` — API-specific changelog (distinct from product changelog). Entries generated from ADR close-outs that touched `/v1/*`.
- [ ] `/docs/webhook-signatures` — HMAC-SHA256 signing used on deletion callbacks, timestamp window, replay defence.
- [ ] `/docs/status` — embed of status page (external link; do not build a dashboard in-app).

**Testing plan:**
- [ ] Every error code in the enum appears on the page.
- [ ] The corresponding test (Phase 3) exists for every listed error code.

**Status:** `[ ] planned`

---

### Phase 3 — v1 API integration test suite

External-consumer perspective: only a Bearer API key, no internal imports, no DB access, no CI secrets beyond what a customer would have. Tests live in `tests/integration/v1-api/` and share ADR-1014's partner-bootstrap + evidence machinery.

#### Sprint 3.1: External-consumer test harness

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `tests/integration/v1-api/setup.ts` — reads `CS_TEST_API_KEY` + `CS_TEST_BASE_URL` from `.env.integration` (never imports from `app/`).
- [ ] Fetch wrapper: `callV1(method, path, body?, { idempotencyKey?, headers? })`.
- [ ] Fixture factory: `issueTestKey()` via an ADR-1014 fixture endpoint (behind a sandbox-only gate).
- [ ] Trace-ID propagation: every test tags its requests with a unique `X-Request-Id` and asserts it echoes in the response headers.

**Testing plan:**
- [ ] Harness can issue a key and hit `/_ping` with it.
- [ ] Evidence artefact for the sprint records the trace IDs.

**Status:** `[ ] planned`

#### Sprint 3.2: Happy-path sequence across all endpoints

**Estimated effort:** 3 days

**Deliverables:**
- [ ] `happy-path.spec.ts` — the canonical customer flow end-to-end:
  1. `GET /_ping` → 200.
  2. `GET /keys/self` → current key metadata.
  3. `GET /plans` → current plan row + limits.
  4. `GET /purposes` → seeded purposes.
  5. `GET /properties` → seeded web properties.
  6. `POST /consent/record` → 201 artefact_id.
  7. `POST /consent/verify/batch` → 200 with the just-recorded artefact marked `active`.
  8. `GET /consent/artefacts` → list contains the artefact.
  9. `GET /consent/artefacts/{id}` → detailed view.
  10. `POST /consent/artefacts/{id}/revoke` → 200.
  11. `GET /consent/verify` → now `revoked`.
  12. `GET /consent/events` → both the record and revoke events present.
  13. `POST /deletion/trigger` → 202 with a deletion_id.
  14. `GET /deletion/receipts` → the trigger eventually produces a receipt.
  15. `GET /usage` → counters advanced by exactly the expected deltas.

**Testing plan:**
- [ ] Every assertion is on observable state, not just status code.
- [ ] Pair with `happy-path-negative.spec.ts` — every step repeated with a tampered input; each must return the expected 4xx.

**Status:** `[ ] planned`

#### Sprint 3.3: Error-path exhaustive assertions

**Estimated effort:** 3 days

**Deliverables:**
- [ ] One test per documented error code. Errors come from `/docs/errors` (Sprint 2.3).
- [ ] Test matrix: for each endpoint × each applicable error, assert the exact `error.code`, `error.message` shape, and that no side-effects are observable.
- [ ] Specific coverage: 401 unauthorised (missing / malformed / wrong scheme), 410 Gone on rotated key (ADR-1011), 403 origin_not_registered, 404 purpose_not_found, 409 on double-revoke, 429 on rate-limit, 503 on simulated buffer unavailability.

**Testing plan:**
- [ ] 100% of error codes listed on `/docs/errors` have a corresponding test.
- [ ] CI gate: missing-error-test count === 0.

**Status:** `[ ] planned`

#### Sprint 3.4: Rate-limit + idempotency assertions

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `rate-limit.spec.ts` — burst beyond the plan limit, assert `X-RateLimit-Remaining=0`, `Retry-After`, 429. Wait, retry, assert success.
- [ ] `idempotency.spec.ts` — record consent with `Idempotency-Key`; duplicate request returns 200 with the same artefact_id; a different key creates a new artefact.
- [ ] `key-rotation.spec.ts` — rotate the test key via a sandbox RPC, old plaintext returns 410 Gone, new plaintext succeeds (ADR-1011 receipt).

**Testing plan:**
- [ ] All three spec files green.
- [ ] Evidence artefact includes the rate-limit response headers from the burst.

**Status:** `[ ] planned`

---

### Phase 4 — Alignment + publication

#### Sprint 4.1: Cross-link audit

**Estimated effort:** 1 day

**Deliverables:**
- [ ] Every cookbook recipe links to the relevant API-reference endpoint.
- [ ] Every API-reference endpoint links to the cookbook recipe(s) that use it.
- [ ] Every client-library README (once ADR-1006 lands) links to the docs home.
- [ ] Every `/docs/*` page has an "On this page" ToC rendered from its MDX headings.

**Status:** `[ ] planned`

#### Sprint 4.2: Wireframe reconciliation

**Estimated effort:** 1 day

**Deliverables:**
- [ ] Visual QA: rendered `/docs/*` pages side-by-side with the wireframe at `docs/design/screen designs and ux/consentshield-developer-docs.html`.
- [ ] Tick the wireframe's acceptance-criteria checklist (to be added to the wireframe HTML in this sprint).
- [ ] Any drift: amend the wireframe (with ADR note) OR fix the code — never ignore. Per the wireframes-normative rule.

**Status:** `[ ] planned`

#### Sprint 4.3: Docs-issue template + "Edit on GitHub"

**Deliverables:**
- [ ] `.github/ISSUE_TEMPLATE/docs-issue.yml` — structured form for "this page is wrong / missing / unclear".
- [ ] Every `/docs/*` page renders an "Edit on GitHub" link computed from its file path.
- [ ] Feedback strip (per wireframe) submits to the issue form with page context pre-filled.

**Status:** `[ ] planned`

---

## Acceptance criteria

The ADR is **Completed** when all of the following hold:

- [ ] `/docs/*` on marketing renders per wireframe on desktop (1280px) and mobile (375px).
- [ ] All 15 `/v1/*` endpoints have a reference page; each documents auth, request body, response, error codes, and example.
- [ ] Scalar playground works at `/docs/api` for every endpoint. Sandbox vs live toggle respected.
- [ ] 7 cookbook recipes live, each with copy-paste-runnable code in cURL + Node + Python.
- [ ] `/docs/errors` lists every error code; each has an integration test in `tests/integration/v1-api/`.
- [ ] Happy-path external-consumer suite green end-to-end, including `/v1/usage` delta assertions.
- [ ] Every API-referenced shape in the MDX pages is pulled from (or regenerated from) `app/public/openapi.yaml` — single source of truth.
- [ ] Lighthouse ≥ 95 on the Developer Hub landing and Quickstart pages.
- [ ] Every `/docs/*` page has a working "Edit on GitHub" link.
- [ ] Wireframe reconciliation tracker (§ to be added to the wireframe HTML in Sprint 4.2) shows zero drift.

## V2 backlog (explicitly deferred)

Logged in `docs/V2-BACKLOG.md` with a pointer back to ADR-1015.

- **Docs localisation** — Hindi, Tamil, Bengali. Deferred until a customer signal demands it.
- **In-app authenticated /docs** — requires a separate product decision about key management UX.
- **Language-specific recipe variants beyond cURL/Node/Python** — Java and Go recipes will ride on ADR-1006's client-library delivery.
- **Interactive tutorials** (embedded sandboxes like CodeSandbox) — the static examples + Scalar playground cover v1 needs.
- **AI search on docs** — deferred; fuzzy + Cmd-K search is sufficient for v1.
- **Versioned docs** (v1 vs future v2) — the OpenAPI spec is versioned at the path level (`/v1/*`); the docs surface is a single version until v2 ships.

---

## Architecture Changes

On close-out, update `docs/architecture/consentshield-definitive-architecture.md` §10 (API surface) with a pointer to `/docs/api` as the public reference. Update CLAUDE.md's "Reviews" section to include the new `docs/design/screen designs and ux/consentshield-developer-docs.html` wireframe in the normative-wireframes list.

## Test Results

*(Populated per sprint close-out.)*
