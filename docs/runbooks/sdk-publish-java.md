# SDK publish runbook — Java (Maven Central)

> **Source of truth:** [`packages/java-client/PUBLISHING.md`](../../packages/java-client/PUBLISHING.md). This file mirrors the canonical runbook so operators discovering `docs/runbooks/` can find it.
>
> Edits go in the source file, not here. Changes there will be re-mirrored.

---

```markdown
{{see source}}
```

Open [`packages/java-client/PUBLISHING.md`](../../packages/java-client/PUBLISHING.md) for the full runbook (Sonatype Central onboarding, GPG key generation + key-server publish, `~/.m2/settings.xml` shape, `mvn -P release deploy`, staging promotion, smoke install, recovery from a bad release, v2+ release model).

## Quick reference

| Phase | Command |
|---|---|
| Pre-flight | `cd packages/java-client && mvn -B clean verify` |
| Tag | `git tag -a v1.0.0 -m "ConsentShield Java SDK 1.0.0" && git push origin v1.0.0` |
| Stage | `cd packages/java-client && mvn -B -P release deploy` |
| Promote | Sonatype Central UI → "Publish" on the staged release |
| Smoke | `mvn dependency:get -Dartifact=com.consentshield:consentshield-java-spring-boot-starter:1.0.0` |

**Coordinates published:**
- `com.consentshield:consentshield-java:1.0.0` (raw client)
- `com.consentshield:consentshield-java-spring-boot-starter:1.0.0` (Spring Boot starter, depends on raw client)
