# ADR-1028: Generated server-side SDKs — Java, .NET, PHP

**Status:** Proposed
**Date proposed:** 2026-04-26
**Date completed:** —
**Related plan:** Closes the v2 whitepaper §5.4 multi-language SDK promise (Tier 2 of the three-tier split — see Context).
**Depends on:** ADR-1006 (closed at 9/9; OpenAPI spec at `app/public/openapi.yaml` is now the build-gated source of truth)
**Related gaps:** G-002, G-003, G-024, G-045 (closed by ADR-1006); ADR-1028 extends G-024 to Java, .NET, PHP

---

## Context

### What the v2 whitepaper promised

ConsentShield-V2-Customer-Integration-Whitepaper-v2.md, §5.4 ("SDK availability") and Appendix A list the following languages as committed SDK targets:

> TypeScript/Node, Python, Go, Java, .NET, PHP, Swift, Kotlin

Three of those (Node, Python, Go) shipped in ADR-1006 and went live as v1.0.0 on 2026-04-25–26. The remaining five are still owed to integrators per the whitepaper.

### Why ADR-1006 stopped at three

ADR-1006 hand-rolled its three SDKs — ~2 000 lines per language, line-by-line audited, exact-pinned, with hand-written validators / paginators / fail-CLOSED contracts. That made sense for the three languages Indian BFSI + healthcare actually integrates from today (Node/Python in product, Go in infra). The audit cost was justified by the compliance-load-bearing nature of `verify` + the need for the founder to be able to attest to every line.

Hand-rolling five more languages would not be justified:

- **8× audit surface** on every API change. A `/v1/*` shape change becomes 8 PRs across 8 repos with 8 different test stacks — sustainable for a solo founder this is not.
- **Java + .NET + PHP teams expect generated SDKs.** AWS, Stripe, Twilio, Anthropic all ship Java/.NET/PHP via OpenAPI Generator + Speakeasy + Stainless. A hand-rolled Java client looks suspicious to an enterprise procurement team — "why is this not a generated client like every other vendor's?" Hand-rolled is more risk to enterprise adoption, not less.
- **Swift + Kotlin are mobile, not backend.** They have a fundamentally different security model (no `cs_live_*` keys client-side; mobile SDKs render banners + capture events, the customer's *backend* is the actual ConsentShield caller). They require a different surface design that does not exist yet, and are gated on the ABDM mobile launch trigger per CLAUDE.md.

### The three-tier split

ADR-1028 codifies the three-tier model the eight-language promise actually fragments into:

| Tier | Languages | Approach | Status |
|---|---|---|---|
| **1 — Hand-rolled, server-side, compliance-load-bearing** | Node, Python, Go | Hand-written, line-audited, exact-pinned. ~2 000 LOC each. | ✓ shipped (ADR-1006, 2026-04-25–26) |
| **2 — OpenAPI-generated, server-side** | Java, .NET, PHP | Generated from `app/public/openapi.yaml` via OpenAPI Generator. Hand-written wrapper per language for framework integration (Spring Boot auto-config / ASP.NET Core DI / PSR-18) + fail-CLOSED defaults. | **This ADR** |
| **3 — Hand-rolled, client-side, mobile** | Swift, Kotlin | Different surface entirely — banner render + event capture, no `cs_live_*` keys, talks to customer-controlled backend not directly to ConsentShield. | Deferred until ABDM mobile trigger; will be its own ADR |

### Why OpenAPI Generator (not Speakeasy / Stainless / Fern) for the v1

Speakeasy and Stainless (and Fern) generate visibly cleaner clients than OpenAPI Generator. They also charge $1k–$5k/month and require committing the spec to their build pipeline. For a solo founder pre-revenue:

- **OpenAPI Generator is free, open-source, and stable.** Output is "good enough" — Java/.NET/PHP procurement teams accept it because it's the same generator AWS uses for unofficial SDKs and the same shape `swagger-codegen` has emitted for a decade.
- **The decision is reversible.** If/when we have BFSI customers paying enough to justify the polish ($50k+ MRR is a sane threshold), swapping to Speakeasy is a one-CI-step change because the input is the same OpenAPI spec we already lock down.
- **The Speakeasy question is a separate decision from "should we have Java/.NET/PHP SDKs at all".** This ADR commits to having them; the generator choice is a sub-decision documented in Phase 1.

We will revisit the Speakeasy/Stainless/Fern question after this ADR's Phase 1 lands, with v1.0.0 OpenAPI-Generator output in hand to compare against. That follow-up is tracked as a Phase 1 §Architecture Changes amendment, not as a blocker on ADR-1028.

### Why now

- **The whitepaper has been advertising 8 languages.** Marketing copy at /docs/sdks now says "Node / Python / Go" honestly, but customers reading the whitepaper see 8. Either the whitepaper is amended (ADR-1006 already did partial amendment) or we make good on the promise. Three more shipped languages closes the gap to "Tier 1 + Tier 2 cover everything except mobile, mobile is a Phase 2 product".
- **The OpenAPI spec is build-gated SOT as of 2026-04-26.** ADR-1006 Phase 3 just landed. The generator input is now stable; any spec change has to go through the regenerator, which means Tier-2 SDK regeneration is the natural next CI step.
- **Enterprise BFSI sales motion.** Tata-scale Indian BFSI procurement teams will ask for Java + .NET in any RFP. Having a published Maven artefact + NuGet package + Composer package — even generated — clears that procurement gate at zero engineering ongoing cost.

---

## Decision

Ship three OpenAPI-generated SDKs as v1.0.0 against the now-locked spec:

1. **Java** — `com.consentshield:consentshield-java:1.0.0` published to **Maven Central** via Sonatype OSSRH. Spring Boot auto-configuration wrapper (`@AutoConfiguration` + `ConsentShieldAutoConfiguration` exposing `ConsentShieldClient` as a bean).
2. **.NET** — `ConsentShield.Client` v1.0.0 published to **NuGet**. ASP.NET Core dependency-injection wrapper (`IServiceCollection.AddConsentShield()` + `IHttpClientFactory`-based transport).
3. **PHP** — `consentshield/consentshield` v1.0.0 published to **Packagist** (Composer). PSR-18 HTTP client adapter; PSR-3 logger integration.

All three are **generated by `OpenAPI Generator` from `app/public/openapi.yaml`**, with thin hand-written framework-integration wrappers layered on top.

**Generator choice for v1**: `openapitools/openapi-generator-cli` (open-source, free, stable). Speakeasy/Stainless re-evaluation is an explicit Phase 1 follow-up after we have v1.0.0 output to compare.

**Compliance contract identical to Tier 1**:
- 4xx ALWAYS surfaces as the language-native error type.
- Timeout / network / 5xx + fail-OPEN=false (default) returns a `ConsentVerifyError`-equivalent.
- Timeout / network / 5xx + fail-OPEN=true returns an `OpenFailureEnvelope` with `cause` discriminator.
- `CONSENT_VERIFY_FAIL_OPEN` env var override (or `consentshield.failOpen=true` Java system property; or `ConsentShield__FailOpen=true` ASP.NET configuration; or `CONSENT_VERIFY_FAIL_OPEN=true` PHP env).
- `X-CS-Trace-Id` round-trip on the wire.
- 2-second per-attempt timeout, exponential backoff 100/400/1600 ms on 5xx + transport errors only — never retries 4xx, never retries timeouts.

**Repos**: published under the same `SAnegondhi` GitHub account as the Tier-1 SDKs:
- `github.com/SAnegondhi/consentshield-java`
- `github.com/SAnegondhi/consentshield-dotnet`
- `github.com/SAnegondhi/consentshield-php`

(Once `consentshield` GitHub org becomes available, repos migrate via vanity import paths — Java's `com.consentshield` Maven coordinate insulates the customer-facing surface from any GitHub-side rename.)

**License**: Apache-2.0 (matches Tier-1 SDKs). `NOTICE` file in each repo reserves the "ConsentShield" trademark separately.

---

## Consequences

- **OpenAPI spec ownership tightens.** Every `/v1/*` shape change must (a) edit `app/public/openapi.yaml`, (b) regenerate the whitepaper Appendix A (already enforced by ADR-1006 Phase 3 prebuild hook), and (c) regenerate the three Tier-2 SDKs (NEW: enforced by `scripts/regenerate-tier2-sdks.ts --check` in the same prebuild hook). Drift in any of the three trees blocks deploy.
- **Three new repos to maintain.** All three are auto-regenerated; the maintenance bill is one-CI-step per spec change, not three hand-edits.
- **Three new operator publish flows.** Maven Central onboarding (Sonatype OSSRH) is the heaviest — ~3-day approval, GPG signing keys, namespace verification. NuGet + Packagist are same-day. Each ships its own `PUBLISHING.md` operator runbook on the pattern set by Tier-1 SDKs.
- **Customer perception**: Tier-2 SDKs are clearly labelled "Generated from OpenAPI" on `/docs/sdks/{java,dotnet,php}`. This is a feature for enterprise procurement (the spec is auditable, the generation is reproducible), not a caveat.
- **Mobile (Swift + Kotlin) explicitly OUT of this ADR.** They get their own ADR when ABDM mobile work triggers.
- **Whitepaper §5.4 + Appendix A no longer over-promise.** After ADR-1028 closes, the whitepaper's 8-language list is honest: Tier 1 + Tier 2 = 6 server-side languages shipped; Tier 3 = 2 mobile languages explicitly deferred to a future ADR.

---

## Implementation Plan

### Phase 1: Generator wiring + Java target

**Goal:** Land the generator pipeline; ship Java first because Sonatype OSSRH onboarding is the longest-lead step (lock it in early, let it bake while .NET + PHP go through their own publish flows).

#### Sprint 1.1: Generator pipeline (`scripts/generate-tier2-sdks.ts`)

**Estimated effort:** 1 day

**Deliverables:**
- [ ] `scripts/generate-tier2-sdks.ts` — Bun TS script that runs `openapi-generator-cli@7.x` (Docker invocation; no Node dep on the global generator) against `app/public/openapi.yaml` for `java`, `csharp`, `php` targets. Output to `packages/{java,dotnet,php}-client/generated/`.
- [ ] Per-target generator config (`scripts/openapi-config/{java,dotnet,php}.json`) with: package name, group/namespace, library version pin, dependency-version pins for HTTP transport layer (e.g. Java `okhttp`-4.12, .NET `System.Net.Http` (stdlib), PHP `guzzlehttp/guzzle`-7.x).
- [ ] `--check` mode: regenerate to a temp dir, diff against `packages/{java,dotnet,php}-client/generated/`, exit 1 on drift. Wire into `app/package.json` `prebuild` so any spec change without a regen blocks deploy.
- [ ] Decision recorded in §Architecture Changes: OpenAPI Generator over Speakeasy / Stainless / Fern for v1, with explicit re-evaluation gate ("revisit when MRR > $50k or first BFSI Tier-1 enterprise prospect requests it").

**Testing plan:**
- [ ] Run `bunx tsx scripts/generate-tier2-sdks.ts` in a clean tree → produces three populated `packages/*-client/generated/` trees. Inspect for: no placeholder strings, no broken imports, every `/v1/*` operation has a corresponding method.
- [ ] Mutate the spec (`tags: [Account]` → `tags: [Bogus]` somewhere) → `--check` exits 1. Restore → exits 0.
- [ ] `cd app && bun run build` includes the new gate, fails on drift, succeeds on sync.

**Status:** `[ ] planned`

#### Sprint 1.2: Java SDK package (`packages/java-client/`)

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `packages/java-client/pom.xml` — Maven coordinate `com.consentshield:consentshield-java:1.0.0`, JDK 11+ baseline, `okhttp`-4.12 + `gson`-2.10 + `swagger-annotations`-2.x exact-pinned.
- [ ] `packages/java-client/src/main/java/com/consentshield/sdk/spring/ConsentShieldAutoConfiguration.java` — Spring Boot `@AutoConfiguration` + `@ConditionalOnMissingBean` + `@ConditionalOnProperty(name="consentshield.api-key")`. Reads `consentshield.api-key` / `consentshield.base-url` / `consentshield.timeout-ms` / `consentshield.fail-open` / `consentshield.max-retries` from `application.properties` or env (`SPRING_APPLICATION_JSON` / standard Spring Boot env binding). Exposes `ConsentShieldClient` as a singleton bean.
- [ ] `packages/java-client/src/main/java/com/consentshield/sdk/ConsentVerifyException.java` (compliance-critical wrap matching `ConsentVerifyError` from Tier 1) + `ConsentShieldApiException` (4xx surface) + `ConsentShieldTimeoutException` (never retried).
- [ ] `packages/java-client/src/main/java/com/consentshield/sdk/internal/RetryInterceptor.java` — `okhttp` `Interceptor` implementing the 100/400/1600 ms backoff on 5xx + transport, never retries 4xx, never retries timeouts.
- [ ] `packages/java-client/examples/spring-boot-marketing-gate/` — runnable Spring Boot 3 app demonstrating `ConsentShieldClient` injected into a `@RestController`, gating `/api/marketing/send` with HTTP 451 on non-granted, HTTP 503 on fail-CLOSED.
- [ ] `packages/java-client/PUBLISHING.md` — Sonatype OSSRH operator runbook: account creation, namespace verification (`com.consentshield`), GPG key generation + upload, `mvn deploy` flow, staging-repository smoke install, `nexus-staging-maven-plugin` release, recovery from a bad release (immutable on Maven Central; bump + re-deploy).
- [ ] `packages/java-client/LICENSE` (Apache-2.0) + `NOTICE` (trademark carve-out).
- [ ] Coverage gate ≥ 80 % via JaCoCo (run on the generated client + the hand-written wrappers).

**Testing plan:**
- [ ] `mvn clean verify` against the generated tree — compiles, tests pass, JaCoCo ≥ 80 %.
- [ ] Spring Boot example runs against the live `api.consentshield.in` with a `cs_live_*` key from env: `client.ping()` returns the key context envelope; `client.verify(...)` against a bogus property throws `ConsentShieldApiException(404)` with the RFC 7807 `detail` parsed.
- [ ] Compliance-contract sweep: 4xx-always-throws (sweep across 400/401/403/404/410/422); fail-CLOSED returns `ConsentVerifyException`; fail-OPEN with `consentshield.fail-open=true` returns the open envelope with `cause` discriminator.

**Status:** `[ ] planned`

#### Sprint 1.3: Java publish to Maven Central + smoke

**Estimated effort:** 2 days (3-day Sonatype approval window is the long pole; engineering work is ~4 hours)

**Deliverables:**
- [ ] Sonatype OSSRH account + `com.consentshield` namespace verification (DNS TXT record proof on `consentshield.in`).
- [ ] GPG signing key generated, uploaded to public key servers, key id recorded in `packages/java-client/PUBLISHING.md`.
- [ ] `mvn deploy` against staging repository; `nexus-staging-maven-plugin` release; v1.0.0 visible on Maven Central within 30 min of release.
- [ ] Smoke install in a scratch project: `mvn dependency:get -Dartifact=com.consentshield:consentshield-java:1.0.0`; `import com.consentshield.sdk.ConsentShieldClient`; client.ping() against live API succeeds.
- [ ] Marketing site `/docs/sdks/java` page added (Maven coordinate + Spring Boot quickstart + compliance contract table — same shape as the Tier-1 pages).
- [ ] `nav.ts` + `search-index.ts` updated.

**Testing plan:**
- [ ] `mvn dependency:get` from a fresh JDK 11 install on a clean machine succeeds.
- [ ] Spring Boot example app deployed to a scratch GCP/Heroku instance, calls `api.consentshield.in/v1/_ping`, returns 200 with the key context.

**Status:** `[ ] planned`

### Phase 2: .NET SDK package + publish

**Goal:** Same shape as Phase 1, .NET-idiomatic.

#### Sprint 2.1: .NET SDK package (`packages/dotnet-client/`)

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `packages/dotnet-client/ConsentShield.Client.csproj` — .NET 8.0 LTS target, NuGet coordinate `ConsentShield.Client` v1.0.0, `System.Net.Http.Json` + `Microsoft.Extensions.Http`-9.x exact-pinned.
- [ ] `packages/dotnet-client/src/DependencyInjection/ServiceCollectionExtensions.cs` — `IServiceCollection.AddConsentShield(Action<ConsentShieldOptions>)` + `IHttpClientFactory`-based transport (named client `ConsentShield`); reads `ConsentShield:ApiKey` / `ConsentShield:BaseUrl` / `ConsentShield:TimeoutMs` / `ConsentShield:FailOpen` from `IConfiguration`.
- [ ] `packages/dotnet-client/src/Exceptions/{ConsentVerifyException,ConsentShieldApiException,ConsentShieldTimeoutException}.cs` — same five-class hierarchy, idiomatic .NET names.
- [ ] `packages/dotnet-client/src/Http/RetryHandler.cs` — `DelegatingHandler` implementing 100/400/1600 ms backoff on 5xx + transport, never retries 4xx, never retries timeouts. Composed via `IHttpClientBuilder.AddHttpMessageHandler(...)`.
- [ ] `packages/dotnet-client/examples/AspNetCoreMarketingGate/` — runnable ASP.NET Core 8 minimal-API project demonstrating consent gating on `POST /api/marketing/send`.
- [ ] `packages/dotnet-client/PUBLISHING.md` — NuGet operator runbook: API key generation on nuget.org, `dotnet pack` + `dotnet nuget push`, signing the package with a code-signing cert (optional; required only for enterprise customers using a strict NuGet feed policy), recovery from a bad release.
- [ ] LICENSE + NOTICE.
- [ ] Coverage gate ≥ 80 % via Coverlet.

**Testing plan:**
- [ ] `dotnet test` against the generated tree — all tests pass, Coverlet ≥ 80 %.
- [ ] ASP.NET Core example calls `api.consentshield.in/v1/_ping` via `IHttpClientFactory`-managed `HttpClient`, returns 200.
- [ ] Compliance-contract sweep — same as Java.

**Status:** `[ ] planned`

#### Sprint 2.2: .NET publish to NuGet + smoke

**Estimated effort:** 1 day

**Deliverables:**
- [ ] NuGet account + API key generated.
- [ ] `ConsentShield.Client` 1.0.0 pushed to nuget.org.
- [ ] Marketing site `/docs/sdks/dotnet` page added.
- [ ] `nav.ts` + `search-index.ts` updated.

**Testing plan:**
- [ ] `dotnet add package ConsentShield.Client --version 1.0.0` in a scratch console app succeeds.
- [ ] Smoke call against `api.consentshield.in/v1/_ping` — 200.

**Status:** `[ ] planned`

### Phase 3: PHP SDK package + publish

**Goal:** Same shape as Phases 1–2, PHP-idiomatic.

#### Sprint 3.1: PHP SDK package (`packages/php-client/`)

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `packages/php-client/composer.json` — Composer coordinate `consentshield/consentshield` v1.0.0, PHP 8.1+ baseline, PSR-18 + PSR-17 + PSR-3 interfaces (no concrete HTTP-client dep — caller provides via DI; default convenience wrapper uses `guzzlehttp/guzzle`-7.x exact-pinned).
- [ ] `packages/php-client/src/ConsentShieldClient.php` — accepts a PSR-18 `ClientInterface` + PSR-17 `RequestFactoryInterface` + `StreamFactoryInterface`. `ConsentShieldClient::create($apiKey)` static helper instantiates a Guzzle-backed default for callers who don't already use DI.
- [ ] `packages/php-client/src/Exception/{ConsentVerifyException,ConsentShieldApiException,ConsentShieldTimeoutException}.php` — same five-class hierarchy.
- [ ] `packages/php-client/src/Http/RetryMiddleware.php` — `Psr\Http\Client` decorator implementing 100/400/1600 ms backoff on 5xx + transport, never retries 4xx, never retries timeouts.
- [ ] `packages/php-client/examples/laravel-middleware/` — runnable Laravel 11 middleware demonstrating consent gating on a marketing route. + `examples/symfony-controller/` — Symfony 7 controller equivalent.
- [ ] `packages/php-client/PUBLISHING.md` — Packagist operator runbook: account creation, GitHub repo registration with Packagist, version-tag-driven publish (Packagist auto-detects new tags), recovery from a bad release.
- [ ] LICENSE + NOTICE.
- [ ] Coverage gate ≥ 80 % via PHPUnit + Xdebug.

**Testing plan:**
- [ ] `composer install && vendor/bin/phpunit` — all tests pass, coverage ≥ 80 %.
- [ ] Laravel example calls `api.consentshield.in/v1/_ping` via the PSR-18 client, returns 200.
- [ ] Compliance-contract sweep — same as Java + .NET.

**Status:** `[ ] planned`

#### Sprint 3.2: PHP publish to Packagist + smoke

**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] Packagist account + repo registration.
- [ ] `git tag -a v1.0.0 && git push origin v1.0.0` on `github.com/SAnegondhi/consentshield-php` — Packagist auto-ingests within 5 min.
- [ ] Marketing site `/docs/sdks/php` page added.
- [ ] `nav.ts` + `search-index.ts` updated.

**Testing plan:**
- [ ] `composer require consentshield/consentshield:^1.0` in a scratch project succeeds.
- [ ] Smoke call against `api.consentshield.in/v1/_ping` — 200.

**Status:** `[ ] planned`

### Phase 4: Documentation rollup + ADR closeout

**Goal:** Marketing-site documentation parity across all six server-side SDKs (Tier 1 hand-rolled + Tier 2 generated).

#### Sprint 4.1: `/docs/sdks/*` rollup + Generator decision review

**Estimated effort:** 1 day

**Deliverables:**
- [ ] `marketing/src/app/docs/sdks/page.mdx` updated: install matrix grows from 3 rows (Node/Python/Go) to 6 rows (+ Java/.NET/PHP). Each Tier-2 row carries a small "Generated from OpenAPI" badge that links to the spec at `https://api.consentshield.in/openapi.yaml`.
- [ ] `nav.ts` + `search-index.ts` carry all six SDK pages.
- [ ] **Speakeasy / Stainless / Fern re-evaluation review** — comparison doc at `docs/reviews/2026-MM-DD-tier2-generator-evaluation.md` after Phase 1 ships, comparing OpenAPI Generator output against a Speakeasy trial run on the same spec. Decision either: stay on OpenAPI Generator until $50k MRR threshold, OR switch now if the polish gap materially blocks BFSI procurement. Outcome recorded as a §Architecture Changes amendment.
- [ ] Whitepaper §5.4 + Appendix A re-amendment: 8-language list now reads "6 server-side SDKs shipped + 2 mobile deferred to a future ADR".

**Testing plan:**
- [ ] `cd marketing && bun run build` — all six per-SDK pages render.
- [ ] Cmd-K search in the docs site finds Java / .NET / PHP via stack-name keywords (`spring boot`, `aspnet`, `laravel`, `symfony`).

**Status:** `[ ] planned`

---

## Architecture Changes

_To be recorded as each sprint lands._

The major architecture decision this ADR commits to is **the three-tier SDK model**. Document `docs/architecture/consentshield-definitive-architecture.md` will gain a §SDK posture section once Sprint 1.1 lands, codifying:

- Tier 1 hand-rolled languages and the audit-load justification.
- Tier 2 generated languages and the regen pipeline.
- Tier 3 mobile deferral to a future ADR.

The OpenAPI spec at `app/public/openapi.yaml` becomes the input to **two** regeneration pipelines after this ADR ships (Appendix A + Tier 2 SDKs); both gated by the customer-app `prebuild` hook.

---

## Test Results

_To be recorded as each sprint completes._

---

## Changelog References

- `CHANGELOG-api.md` — Sprint 1.1 (generator pipeline + spec-as-input commitment), Sprint 4.1 (architecture changes).
- `CHANGELOG-docs.md` — Sprint 1.3 (Java docs page), Sprint 2.2 (.NET), Sprint 3.2 (PHP), Sprint 4.1 (rollup).
- `CHANGELOG-infra.md` — Sprint 1.3 (Sonatype OSSRH onboarding), Sprint 2.2 (NuGet account), Sprint 3.2 (Packagist).
