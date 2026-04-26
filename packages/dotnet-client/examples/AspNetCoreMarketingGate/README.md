# ASP.NET Core marketing gate — ConsentShield .NET SDK example

Runnable ASP.NET Core 8 minimal-API app demonstrating consent gating on a marketing endpoint via `services.AddConsentShield(IConfiguration)` + `IHttpClientFactory`.

## Run

```bash
dotnet user-secrets set ConsentShield:ApiKey cs_live_...
dotnet run
```

## Outcomes

| Scenario | HTTP status |
|---|---|
| Consent granted | 202 Accepted |
| Consent not granted | 451 Unavailable for Legal Reasons |
| Upstream 4xx (bad property / bad key) | 502 Bad Gateway |
| Upstream 5xx / network / timeout (fail-CLOSED) | 503 Service Unavailable |
| Upstream 5xx / network / timeout (fail-OPEN) | 202 with `open: true` |
