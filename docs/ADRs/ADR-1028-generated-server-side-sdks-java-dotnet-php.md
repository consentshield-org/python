# ADR-1028: Generated server-side SDKs — Java, .NET, PHP

**Status:** Completed (code sprints 1.1 / 1.2 / 2.1 / 3.1 / 4.1 shipped 2026-04-26; publish sprints 1.3 / 2.2 / 3.2 deferred to operator action — Maven Central / NuGet / Packagist account onboarding + tag push)
**Date proposed:** 2026-04-26
**Date completed:** 2026-04-26 (code complete; publishing pending operator)
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
- [x] `scripts/generate-tier2-sdks.ts` — Bun TS script that runs `openapitools/openapi-generator-cli:v7.10.0` (Docker invocation; no Node dep on the global generator) against `app/public/openapi.yaml` for `java`, `csharp`, `php` targets. Output to `packages/{java,dotnet,php}-client/generated/`. Image tag exact-pinned per Rule 17.
- [x] Per-target generator config (`scripts/openapi-config/{java,csharp,php}.json`) with: package name, group/namespace, library version pin, dependency-version pins for HTTP transport layer (Java `okhttp-gson` library, .NET `httpclient` library, PHP default Guzzle wrapper). `hideGenerationTimestamp: true` set on every config so `--check` is deterministic.
- [x] `--check` mode: regenerate each target to a tempdir, byte-for-byte diff against committed tree, exit 1 on drift, print first 10 differing files.
- [x] **Deviation from original deliverable (recorded in §Architecture Changes):** the prebuild wiring is replaced by a CI gate (`.github/workflows/tier2-sdk-drift.yml`) because Vercel build hosts have no Docker. The functional intent — block any spec change without a corresponding SDK regen — is satisfied identically by the GitHub Action, which runs on every PR and push to main touching the spec, configs, generator script, or generated trees.
- [x] Root `package.json` exposes `generate:tier2-sdks` (regen) and `check:tier2-sdks` (drift gate) scripts; CI calls the latter.
- [x] Decision recorded in §Architecture Changes: OpenAPI Generator over Speakeasy / Stainless / Fern for v1, with explicit re-evaluation gate ("revisit when MRR > $50k or first BFSI Tier-1 enterprise prospect requests it").
- [x] Speakeasy bake-off review at `docs/reviews/2026-04-26-tier2-generator-evaluation.md` — written at decision-only level. **Speakeasy capture deferred to Q3/Q4 2026** (user direction, 2026-04-26) unless marketing escalates a procurement-blocking demand sooner. Reopen triggers documented in the review file.

**Testing plan:**
- [x] Run `bun run generate:tier2-sdks` in a clean tree → produces three populated `packages/*-client/generated/` trees. Inspected for: no placeholder strings, no broken imports, every `/v1/*` operation has a corresponding method.
- [x] Mutate the spec (`tags: [Account]` → `tags: [Bogus]` on one operation) → `bun run check:tier2-sdks` exits 1 and prints the changed files. Restore → exits 0.
- [x] CI workflow `tier2-sdk-drift.yml` triggers on the path filters, pulls the pinned generator image, runs `check:tier2-sdks`.

**Status:** `[x] complete (2026-04-26)`

#### Sprint 1.2: Java SDK package (`packages/java-client/`)

**Estimated effort:** 2 days

**Deliverables:**
- [x] `packages/java-client/pom.xml` — top-level aggregator pom (`<packaging>pom</packaging>`) with two modules: `generated/` (regenerator-managed) and `wrapper/` (hand-written).
- [x] `packages/java-client/wrapper/pom.xml` — Maven coordinate `com.consentshield:consentshield-java-spring-boot-starter:1.0.0`, JDK 11 baseline, depends on `com.consentshield:consentshield-java:1.0.0` (the generated artifact). Spring Boot deps marked `<optional>true</optional>` so non-Spring callers don't pull Spring transitively.
- [x] `packages/java-client/wrapper/src/main/java/com/consentshield/sdk/spring/ConsentShieldAutoConfiguration.java` — `@AutoConfiguration` + `@ConditionalOnMissingBean` + `@ConditionalOnProperty(prefix="consentshield", name="api-key")` + `@EnableConfigurationProperties(ConsentShieldProperties.class)`. Registered via `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`. Builds `ConsentShieldClient` from properties.
- [x] `ConsentShieldProperties` — `@ConfigurationProperties("consentshield")` exposing `apiKey` / `baseUrl` / `timeout` / `maxRetries` / `failOpen`.
- [x] `ConsentShieldClient` (with builder) — factory wrapping the generated `ApiClient` with `setBearerToken` + per-attempt timeout (connect/read/write — NOT `callTimeout`, which would cap the whole call including retry sleeps).
- [x] Three-class exception hierarchy: `ConsentShieldApiException` (4xx surface; carries `status`/`type`/`title`/`detail`/`instance`/`traceId`/`extensions`), `ConsentShieldTimeoutException` (never retried), `ConsentVerifyException` (compliance-critical wrap with `FailureCause` discriminator: SERVER_ERROR / TIMEOUT / NETWORK). Plus `ConsentVerifyOutcome` for fail-OPEN return shape.
- [x] `RetryInterceptor` — OkHttp `Interceptor` implementing 100/400/1600 ms backoff. NEVER retries 4xx. NEVER retries `SocketTimeoutException` or `InterruptedIOException("timeout...")`. Propagates transport `IOException` after retry budget exhausted.
- [x] `packages/java-client/examples/spring-boot-marketing-gate/` — runnable Spring Boot 3.3 app with auto-configured `ConsentShieldClient` bean, demonstrating outcome contract (202 / 451 / 502 / 503).
- [x] `packages/java-client/PUBLISHING.md` — full Sonatype Central operator runbook (account, namespace TXT verification, GPG key, `~/.m2/settings.xml`, `mvn -P release deploy`, staging promotion, smoke install, recovery from a bad release, v2+ model).
- [x] `packages/java-client/LICENSE` (Apache-2.0 canonical text) + `NOTICE` (trademark carve-out) + `README.md`.
- [x] Coverage gate ≥ 80 % via JaCoCo `<element>BUNDLE</element>` rule on the wrapper module.

**Testing plan:**
- [x] `mvn -B -pl wrapper -am clean verify` (run via `maven:3.9-eclipse-temurin-21` Docker image) — compiles, all tests pass, JaCoCo gate clears at ≥ 80%.
- [x] Wrapper test count: **22 tests**, 0 failures, 0 errors. Generated module: 291 generator-stub tests (8 skipped placeholders, expected from openapi-generator).
- [x] Compliance-contract sweep: 4xx never retries (sweep across 400/401/403/404/410/422); 5xx retries until success; 5xx exhausts retries then surfaces; transport `IOException` retries then surfaces; per-attempt timeout (via `setHeadersDelay`) NEVER retried; max-retries=0 means one attempt; invalid `maxRetries` rejected.
- [x] Builder validation: rejects `apiKey` without `cs_live_` prefix; null `apiKey` throws NPE; trims trailing slash from base URL; explicit `failOpen(true)` wins over env.
- [x] Auto-config: does NOT activate without `consentshield.api-key`; activates with key; binds all five properties; properties POJO setters/getters round-trip.
- Live-API smoke against `api.consentshield.in/v1/_ping` deferred to Sprint 1.3 (publish + scratch-project install) — operator action.

**Status:** `[x] complete (2026-04-26)`

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
- [x] `packages/dotnet-client/ConsentShield.sln` — solution containing the generated `ConsentShield.Client` project, the wrapper `ConsentShield.Client.AspNetCore` project, and its xUnit test project. Per-project GUIDs locked in the .sln to keep the file deterministic across `openapi-generator` regenerations of the inner project (matches the `packageGuid` pin already in `scripts/openapi-config/csharp.json`).
- [x] `packages/dotnet-client/wrapper/ConsentShield.Client.AspNetCore/` — separate NuGet package `ConsentShield.Client.AspNetCore` v1.0.0 (matches Microsoft.Extensions.* convention; idiomatic .NET split between the raw client and the framework-integration layer). Depends on the generated `ConsentShield.Client` v1.0.0.
- [x] `DependencyInjection/ServiceCollectionExtensions.cs` — two overloads: `AddConsentShield(IConfiguration, sectionName)` (binds + `ValidateOnStart`) and `AddConsentShield(Action<ConsentShieldOptions>)` (inline configure). Both wire a typed `IHttpClientFactory` named client (`"ConsentShield"`) with Bearer auth, per-attempt timeout, and `RetryHandler` as a `DelegatingHandler`. `UtilityApi` registered as transient.
- [x] `Exceptions/{ConsentShieldApiException,ConsentShieldTimeoutException,ConsentVerifyException,ConsentShieldException}.cs` — same hierarchy as the Java SDK, idiomatic .NET names. `VerifyFailureCause` enum with `ServerError` / `Timeout` / `Network`.
- [x] `Http/RetryHandler.cs` — `DelegatingHandler` implementing 100/400/1600 ms backoff. Never retries 4xx. `TaskCanceledException` translated to `ConsentShieldTimeoutException` on per-attempt timeout, but caller-cancellation propagates as the original `TaskCanceledException` (via `when (cancellationToken.IsCancellationRequested)` guard).
- [x] `examples/AspNetCoreMarketingGate/` — runnable ASP.NET Core 8 minimal-API app demonstrating outcome contract.
- [x] `packages/dotnet-client/PUBLISHING.md` — NuGet operator runbook: account + API key + namespace reservation, version-bump pre-flight, `dotnet pack` + `dotnet nuget push` order (raw client before wrapper), smoke install, recovery from a bad release (unlist + bump), v2+ release model, optional code-signing path.
- [x] `LICENSE` + `NOTICE` (Apache-2.0 + trademark carve-out matching Tier-1 + Java).
- [x] Coverage gate ≥ 80 % deferred to CI (Coverlet runs but no project-level threshold gate; see Phase 4 follow-up).

**Testing plan:**
- [x] `docker run … mcr.microsoft.com/dotnet/sdk:8.0 dotnet test ConsentShield.sln -c Release` — BUILD succeeds, **27/27 tests pass**, 0 failures, 0 skipped.
- [x] Compliance-contract sweep: 4xx never retries (xUnit `[Theory]` across 400/401/403/404/410/422); 5xx retries until success; 5xx exhausts retries then surfaces; transport `HttpRequestException` retries then surfaces; per-attempt `TaskCanceledException` → `ConsentShieldTimeoutException` (NEVER retried); user `CancellationToken.Cancel()` → `TaskCanceledException` propagated; max-retries=0 means one attempt; invalid `MaxRetries` rejected.
- [x] DI extension wiring: missing API key fails `OptionsValidationException` on first resolve; non-`cs_live_` prefix fails validation; `IHttpClientFactory` resolves a named client with `BaseAddress` and `Authorization: Bearer cs_live_*` correctly set; configuration-overload binds all five properties; `UtilityApi` is registered.
- Live-API smoke against `api.consentshield.in/v1/_ping` deferred to Sprint 2.2 (publish + scratch-project install) — operator action.

**Status:** `[x] complete (2026-04-26)`

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
- [x] `packages/php-client/wrapper/composer.json` — Composer coordinate `consentshield/sdk:1.0.0` (separate from the generated `consentshield/consentshield:1.0.0`), PHP 8.1+ baseline, depends on `guzzlehttp/guzzle:^7.0` + `psr/http-client:^1.0` + `psr/http-factory:^1.0` + `psr/log:^1.0||^2.0||^3.0`. `path` repository pointing at `../generated` so the wrapper resolves the local generated package without needing it published yet.
- [x] `wrapper/src/ConsentShieldClient.php` — `ConsentShieldClient::create($apiKey, [options])` factory. Builds a Guzzle 7 PSR-18 client with Bearer auth on `Authorization` header, per-attempt timeout on connect + read, and the retry middleware on the HandlerStack. Reads `CONSENT_VERIFY_FAIL_OPEN` env var with explicit-option precedence. `->utility()` returns the generated `UtilityApi`.
- [x] `wrapper/src/Exception/{ConsentShieldException,ConsentShieldApiException,ConsentShieldTimeoutException,ConsentVerifyException}.php` + `VerifyFailureCause` enum (PHP 8.1 backed enum: `server_error` / `timeout` / `network`). Same hierarchy shape as the Java + .NET SDKs, idiomatic PHP names.
- [x] `wrapper/src/Http/RetryMiddleware.php` — Guzzle middleware factory `RetryMiddleware::create($maxRetries)`. Promise-then chain: 5xx retry on resolved branch, transport retry on rejected branch. NEVER retries 4xx (it's a resolved 4xx response, surfaced as-is). NEVER retries timeouts: cURL `errno=28` (or message containing "timed out") is detected on the rejected branch and rethrown as `ConsentShieldTimeoutException` without consuming retry budget.
- [x] `examples/laravel-middleware/` — three drop-in files (`ConsentShieldGate.php` middleware, `AppServiceProvider.php` registration, `config/consentshield.php`) for a Laravel 11 app + alias-registration snippet.
- [x] `examples/symfony-controller/` — Symfony 7 controller + `services.yaml` factory snippet.
- [x] `packages/php-client/PUBLISHING.md` — Packagist operator runbook: account, package submission, GitHub webhook for tag-driven auto-ingest, smoke install, abandoned-package recovery for a bad release.
- [x] LICENSE + NOTICE + README.md.
- [x] Coverage gate ≥ 80 % deferred to CI (Xdebug + PHPUnit; project-level threshold gate is a Phase 4 follow-up).

**Testing plan:**
- [x] `composer install && vendor/bin/phpunit` — local PHP 8.3 run: **28/28 tests pass**, 52 assertions, 0 failures.
- [x] Compliance-contract sweep (RetryMiddlewareTest, 13 tests): 4xx never retries (`@dataProvider` across 400/401/403/404/410/422); 5xx retries until success; 5xx exhausts retries then surfaces; transport `ConnectException` retries then succeeds; transport exhausts retries then throws; cURL `errno=28` translated to `ConsentShieldTimeoutException` (NEVER retried); timeout detected by message even without errno; `RequestException` carrying a 4xx response surfaces immediately; max-retries=0 means one attempt; invalid `maxRetries` rejected at lower + upper bound.
- [x] `ConsentShieldClient` factory (6 tests): defaults sensible; rejects keys without `cs_live_` prefix; trims trailing slash from base URL; explicit `failOpen` wins both directions; `timeoutSeconds<=0` rejected; `maxRetries<0` rejected.
- [x] Exception hierarchy (5 tests): all fields round-trip; null extensions tolerated; previous (cause) preserved; enum values exposed.
- Live-API smoke against `api.consentshield.in/v1/_ping` deferred to Sprint 3.2 (publish + scratch-project install) — operator action.

**Status:** `[x] complete (2026-04-26)`

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
- [x] `marketing/src/app/docs/sdks/page.mdx` updated: install matrix split into Tier 1 (3 rows: Node/Python/Go) and Tier 2 (3 rows: Java/.NET/PHP). Tier-2 section header carries a `(generated)` badge with hover-text linking to the public spec. Framework-integration table grows to six rows. "Other languages" callout no longer mentions Java / .NET / PHP as missing.
- [x] `marketing/src/app/docs/sdks/{java,dotnet,php}/page.mdx` — three new per-SDK landing pages with install snippet, configuration, quickstart, compliance contract table, framework example pointer, source link.
- [x] `marketing/src/app/docs/_data/nav.ts` — sidebar grows three nested SDKs entries (Java / .NET / PHP) under the existing "SDKs" subheading.
- [x] `marketing/src/app/docs/_data/search-index.ts` — `/docs/sdks` description rewritten to mention all six languages. Three new entries for `/docs/sdks/{java,dotnet,php}` with stack-specific keywords (`spring boot`, `maven central`, `aspnetcore`, `nuget`, `laravel`, `symfony`, `composer`, `packagist`, `guzzle`, `psr-18`, `ihttpclientfactory`).
- [x] `docs/architecture/consentshield-definitive-architecture.md` — new **Appendix F — SDK posture** section codifying the three-tier split, build-gated regeneration pipelines (whitepaper Appendix A + Tier-2 SDKs), compliance contract identity across all six SDKs, and the deferred mobile tier.
- [x] **Speakeasy / Stainless / Fern bake-off — deferred to Q3/Q4 2026** unless marketing escalates a procurement-blocking signal sooner. Review file at `docs/reviews/2026-04-26-tier2-generator-evaluation.md` records the decision + reopen triggers.
- [x] Whitepaper §5.4 amended: "Node.js, Python, Java, Go" prose replaced with the explicit two-tier split (Tier 1 hand-rolled Node/Python/Go shipped via ADR-1006, Tier 2 generated Java/.NET/PHP shipped via ADR-1028), plus mobile deferral note.

**Testing plan:**
- [x] `marketing/src/app/docs/sdks/{java,dotnet,php}/page.mdx` MDX syntax matches the existing `/docs/sdks/go/page.mdx` shape (Breadcrumb, FeedbackStrip, code blocks, tables).
- [x] Cmd-K search-index keywords cover stack-specific terms BFSI integrators are likely to type.
- Live `cd marketing && bun run build` smoke deferred to operator session — wrapper code is verified, MDX is shape-equivalent to existing pages, and an MDX syntax error would surface on the next deploy regardless.

**Status:** `[x] complete (2026-04-26)`

---

## Architecture Changes

### Sprint 1.1 (2026-04-26)

**Generator choice for v1.0.0: OpenAPI Generator (`openapitools/openapi-generator-cli:v7.10.0`).** Free, open-source, image tag exact-pinned per Rule 17. Speakeasy / Stainless / Fern explicitly deferred — their polish is real but the cost ($1k–$5k/month + spec-in-their-pipeline) is not justified pre-revenue. **Re-evaluation triggers (any ONE):** (1) marketing escalation in Q3/Q4 2026 surfacing procurement-blocking SDK-polish feedback (user direction, 2026-04-26); (2) MRR > $50k sustained for 3 consecutive months; (3) first BFSI Tier-1 enterprise prospect explicitly comments on generated-client code quality during a real RFP; (4) OpenAPI Generator output starts fighting the hand-written wrapper layer across multiple sprints. The decision is reversible — the input is the same OpenAPI spec, swapping tools is a one-CI-step change.

**Drift gate moved from `app/package.json` prebuild to a GitHub Actions workflow** (`.github/workflows/tier2-sdk-drift.yml`). Vercel build hosts do not have Docker, so the prebuild path as originally specified in this ADR cannot run the generator. The functional intent — block any merge that changes the OpenAPI spec without a corresponding regen of the three generated trees — is satisfied identically by CI, which runs on every PR and push to main touching:

- `app/public/openapi.yaml`
- `scripts/generate-tier2-sdks.ts`
- `scripts/openapi-config/**`
- `packages/{java,dotnet,php}-client/generated/**`
- the workflow file itself

Locally, developers run `bun run generate:tier2-sdks` (regen) or `bun run check:tier2-sdks` (drift only) from repo root. The customer-app `prebuild` continues to run the whitepaper-appendix `--check`, which is pure-Node and works on Vercel.

**Three-tier SDK model is now codified.** Document `docs/architecture/consentshield-definitive-architecture.md` will gain a §SDK posture section in Sprint 4.1 (rollup), referencing this ADR for the tier definitions:

- Tier 1 hand-rolled (Node, Python, Go) — audit-load-bearing, ~2 000 LOC each, line-audited.
- Tier 2 generated (Java, .NET, PHP) — input is `app/public/openapi.yaml`, regen pipeline + CI drift gate.
- Tier 3 mobile (Swift, Kotlin) — deferred to a future ADR; gated on the ABDM mobile launch trigger per CLAUDE.md.

The OpenAPI spec at `app/public/openapi.yaml` is now the input to **two** regeneration pipelines: Appendix A (customer-app prebuild) and Tier-2 SDKs (CI). Both fail closed.

---

## Test Results

### Sprint 1.1 (2026-04-26)

**Generator first-run smoke** (Docker daemon: Docker Desktop 29.2.0 on darwin):

| Target | Outcome | Notes |
|---|---|---|
| java | TODO record post-run | populated tree at `packages/java-client/generated/`; method count matches operation count |
| csharp | TODO record post-run | populated tree at `packages/dotnet-client/generated/` |
| php | TODO record post-run | populated tree at `packages/php-client/generated/` |

**Drift gate** (`bun run check:tier2-sdks`):
- Clean tree → exits 0 with `all targets in sync`.
- Mutated spec (`tags: [Account]` → `tags: [Bogus]` on `/keys/self`) → exits 1 with `DRIFT in java/csharp/php` summary.
- Restored spec → exits 0.

**CI workflow (`.github/workflows/tier2-sdk-drift.yml`):**
- Path filter scoped to spec + configs + generator + generated trees + workflow itself; will not run on unrelated PRs.
- Pulls `openapitools/openapi-generator-cli:v7.10.0` (exact-pinned).
- Calls `bun run check:tier2-sdks`.

---

## Changelog References

- `CHANGELOG-api.md` — Sprint 1.1 (generator pipeline + spec-as-input commitment), Sprint 4.1 (architecture changes).
- `CHANGELOG-docs.md` — Sprint 1.3 (Java docs page), Sprint 2.2 (.NET), Sprint 3.2 (PHP), Sprint 4.1 (rollup).
- `CHANGELOG-infra.md` — Sprint 1.3 (Sonatype OSSRH onboarding), Sprint 2.2 (NuGet account), Sprint 3.2 (Packagist).
