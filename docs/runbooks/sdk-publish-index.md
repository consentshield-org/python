# SDK publish runbooks — index

Operator runbooks for publishing the official ConsentShield SDKs to their respective package registries. Each runbook is a thin pointer to the canonical `PUBLISHING.md` co-located with its package; edits go to the source file in `packages/<sdk>/PUBLISHING.md` and are re-mirrored here.

## Tier 1 — hand-rolled (ADR-1006)

| Language | Registry | Runbook | Source |
|---|---|---|---|
| Python | PyPI | [sdk-publish-python.md](sdk-publish-python.md) | [`packages/python-client/PUBLISHING.md`](../../packages/python-client/PUBLISHING.md) |
| Go | module proxy | [sdk-publish-go.md](sdk-publish-go.md) | [`packages/go-client/PUBLISHING.md`](../../packages/go-client/PUBLISHING.md) |
| Node.js | npm | — (no PUBLISHING.md yet — `npm publish @consentshield/node@1.0.0` is operator-side carry-over from the prior session) | — |

## Tier 2 — OpenAPI-generated (ADR-1028)

| Language | Registry | Runbook | Source |
|---|---|---|---|
| Java | Maven Central | [sdk-publish-java.md](sdk-publish-java.md) | [`packages/java-client/PUBLISHING.md`](../../packages/java-client/PUBLISHING.md) |
| .NET | NuGet | [sdk-publish-dotnet.md](sdk-publish-dotnet.md) | [`packages/dotnet-client/PUBLISHING.md`](../../packages/dotnet-client/PUBLISHING.md) |
| PHP | Packagist | [sdk-publish-php.md](sdk-publish-php.md) | [`packages/php-client/PUBLISHING.md`](../../packages/php-client/PUBLISHING.md) |

## Common pre-publish checklist

1. **Version match** — the version field in the package manifest (pom.xml / .csproj / composer.json / pyproject.toml / Version constant) MUST match the git tag exactly.
2. **Pre-flight gates** — tests pass, lint clean, type-check clean. Each runbook lists the exact command.
3. **Tier-2 only** — `bun run check:tier2-sdks` from repo root MUST be green (CI gate); a stale generated tree means the published wrapper artefact will reference shapes that don't exist on the registry yet.
4. **Tier-2 publish order** — raw client BEFORE the wrapper, in every Tier-2 registry, so the wrapper's dependency resolves at install time.
5. **Recovery posture** — every registry treats published versions as immutable. If a release is broken, bump (1.0.1) and ship; never try to overwrite.

## Operator carry-overs (post-2026-04-26)

These runbooks describe the procedure but the actual publishes are pending operator action:

- [ ] Sonatype Central account + `com.consentshield` namespace TXT verification
- [ ] GPG signing key generation + keyserver publish
- [ ] NuGet account + scoped API key (`ConsentShield.*` glob)
- [ ] Packagist account + repo registration + GitHub webhook
- [ ] PyPI account + project-scoped API token (Tier 1, prior session)
- [ ] npm 2FA + `@consentshield` scope reservation (Tier 1, prior session)

Mark each item complete in this file (and update the carrying memory) when the corresponding `vX.Y.Z` lands on its registry.
