# SDK publish runbook — PHP (Packagist)

> **Source of truth:** [`packages/php-client/PUBLISHING.md`](../../packages/php-client/PUBLISHING.md). This file mirrors the canonical runbook so operators discovering `docs/runbooks/` can find it.
>
> Edits go in the source file, not here.

---

Open [`packages/php-client/PUBLISHING.md`](../../packages/php-client/PUBLISHING.md) for the full runbook (Packagist account, package submission, GitHub webhook for tag-driven auto-ingest, smoke install, abandoned-package recovery for a bad release, v2+ model with `require.php` constraint as the runtime range).

## Quick reference

| Phase | Command |
|---|---|
| Pre-flight | `cd packages/php-client/wrapper && composer install && vendor/bin/phpunit` |
| Tag | `git tag -a v1.0.0 -m "ConsentShield PHP SDK 1.0.0" && git push origin v1.0.0` |
| Auto-ingest | Packagist webhook auto-ingests within ~5 min — no manual upload |
| Smoke | `composer require consentshield/sdk:^1.0` |

**Coordinates published:**
- `consentshield/consentshield` 1.0.0 (raw client)
- `consentshield/sdk` 1.0.0 (compliance-contract wrapper + Laravel/Symfony examples, depends on raw)

The wrapper depends on the raw client via a `path` repository at `../generated` for local dev. For Packagist publish, the raw client must be live first so the wrapper's `consentshield/consentshield: 1.0.0` requirement resolves on install.
