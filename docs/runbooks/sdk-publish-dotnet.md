# SDK publish runbook — .NET (NuGet)

> **Source of truth:** [`packages/dotnet-client/PUBLISHING.md`](../../packages/dotnet-client/PUBLISHING.md). This file mirrors the canonical runbook so operators discovering `docs/runbooks/` can find it.
>
> Edits go in the source file, not here.

---

Open [`packages/dotnet-client/PUBLISHING.md`](../../packages/dotnet-client/PUBLISHING.md) for the full runbook (NuGet account + scoped API key, namespace reservation, `dotnet pack` + `dotnet nuget push` order — raw client before wrapper so the indexer resolves the dependency, smoke install, recovery from a bad release, v2+ model, optional code-signing for enterprise feeds).

## Quick reference

| Phase | Command |
|---|---|
| Pre-flight | `cd packages/dotnet-client && dotnet test ConsentShield.sln -c Release` |
| Tag | `git tag -a v1.0.0 -m "ConsentShield .NET SDK 1.0.0" && git push origin v1.0.0` |
| Pack | `dotnet pack ... -c Release -o ./artifacts` (both projects) |
| Push | `dotnet nuget push ./artifacts/ConsentShield.Client.1.0.0.nupkg` then `…AspNetCore.1.0.0.nupkg` (this order — wrapper depends on raw) |
| Smoke | `dotnet add package ConsentShield.Client.AspNetCore --version 1.0.0` |

**Coordinates published:**
- `ConsentShield.Client` 1.0.0 (raw client)
- `ConsentShield.Client.AspNetCore` 1.0.0 (DI-aware wrapper, depends on raw client)
