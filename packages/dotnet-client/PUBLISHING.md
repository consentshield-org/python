# Publishing the ConsentShield .NET SDK to NuGet

Operator runbook. NuGet package versions are immutable: once `1.0.0` is pushed, you cannot overwrite it. You can only deprecate or unlist.

## One-time onboarding

1. **Create a NuGet account** at <https://www.nuget.org/users/account/LogOn> using the same GitHub identity that owns `github.com/SAnegondhi/consentshield-dotnet`.
2. **Generate an API key** at <https://www.nuget.org/account/apikeys>:
   - Key name: `ConsentShield CI` (or `ConsentShield Local` for manual pushes).
   - Scopes: **Push** and **Push new packages**.
   - Glob pattern: `ConsentShield.*` (locks the key to the namespace).
   - Expiry: 365 days. Set a calendar reminder to rotate.
3. **Reserve the namespace** by pushing the first version (NuGet treats the namespace as held by the first publisher). Optionally request namespace prefix reservation via <https://learn.microsoft.com/en-us/nuget/nuget-org/id-prefix-reservation> once you have 2+ packages live.

## Pre-flight (every release)

```bash
cd packages/dotnet-client
dotnet restore ConsentShield.sln
dotnet build ConsentShield.sln -c Release --no-restore
dotnet test  ConsentShield.sln -c Release --no-build --collect:"XPlat Code Coverage"
```

Coverlet output goes under `wrapper/.../TestResults/`. Verify the wrapper coverage is ≥ 80 % via the generated `coverage.cobertura.xml` (CI gate; locally just check the percentage manually).

The `<Version>` element in BOTH `ConsentShield.Client.AspNetCore.csproj` and the generated `ConsentShield.Client.csproj` MUST match the git tag exactly.

## Cut a release tag

```bash
git tag -a v1.0.0 -m "ConsentShield .NET SDK 1.0.0"
git push origin v1.0.0
```

## Pack + push

```bash
dotnet pack wrapper/ConsentShield.Client.AspNetCore/ConsentShield.Client.AspNetCore.csproj \
    -c Release -o ./artifacts

dotnet pack generated/src/ConsentShield.Client/ConsentShield.Client.csproj \
    -c Release -o ./artifacts

dotnet nuget push ./artifacts/ConsentShield.Client.1.0.0.nupkg \
    --api-key "${NUGET_API_KEY}" --source https://api.nuget.org/v3/index.json

dotnet nuget push ./artifacts/ConsentShield.Client.AspNetCore.1.0.0.nupkg \
    --api-key "${NUGET_API_KEY}" --source https://api.nuget.org/v3/index.json
```

Push in this order — the wrapper depends on the raw client, so the indexer needs to see the raw client first.

NuGet validation runs automatically; the package becomes searchable on `https://www.nuget.org/packages/ConsentShield.Client.AspNetCore` within ~10 minutes.

## Smoke install

```bash
mkdir /tmp/cs-smoke && cd /tmp/cs-smoke
dotnet new console
dotnet add package ConsentShield.Client.AspNetCore --version 1.0.0
```

Wire `services.AddConsentShield(...)` and call `UtilityApi.Ping()` against the live API.

## If a release is broken

**You cannot delete a NuGet release.** Recovery: bump to `1.0.1` and ship the fix. You can also unlist `1.0.0` from search results (does not break existing consumers but discourages new ones) via the NuGet web UI.

For a critical security issue, `dotnet nuget delete ConsentShield.Client 1.0.0 --api-key ...` works within a short grace period after publish, but otherwise unlist + bump is the canonical path.

## v2+ release model

Package id stays `ConsentShield.Client.AspNetCore`. The `<Version>` field bumps. Major-version breaks (e.g. dropping .NET 8 baseline) require a v2 ADR alongside the version bump.

## Code-signing the package (optional, enterprise feeds only)

For BFSI customers running an Azure Artifacts feed with strict signing policy, sign the .nupkg with a code-signing cert before push:

```bash
dotnet nuget sign ./artifacts/ConsentShield.Client.AspNetCore.1.0.0.nupkg \
    --certificate-path /path/to/cert.pfx \
    --certificate-password "${CERT_PASSWORD}" \
    --timestamper http://timestamp.digicert.com
```

NuGet.org accepts both signed and unsigned packages; signing is required only for some private feeds.
