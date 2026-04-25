# consentshield-go

Official Go client for the [ConsentShield](https://www.consentshield.in)
DPDP compliance API.

```sh
go get github.com/consentshield/go-client@v1.0.0
```

```go
import (
    "context"
    "log"
    "os"

    consentshield "github.com/consentshield/go-client"
)

client, err := consentshield.NewClient(consentshield.Config{
    APIKey: os.Getenv("CS_API_KEY"),
})
if err != nil {
    log.Fatal(err)
}

out, err := client.Verify(context.Background(), consentshield.VerifyParams{
    PropertyID:              "PROP_UUID",
    DataPrincipalIdentifier: "user@example.com",
    IdentifierType:          "email",
    PurposeCode:             "marketing",
})
if err != nil {
    // fail-CLOSED default → respond 503 to your caller
    log.Fatal(err)
}
if out.Envelope.Status != "granted" {
    // 451 to your caller
}
```

## What's in the box

100% method parity with the Node + Python SDKs. 14 verbs + 5
paginators.

### Consent

| Method | Verb | Notes |
|---|---|---|
| `Verify(ctx, p)` | `GET /v1/consent/verify` | Single-identifier verify. Compliance-load-bearing. |
| `VerifyBatch(ctx, p)` | `POST /v1/consent/verify/batch` | Up to `MaxBatchIdentifiers` (10 000) per call. |
| `RecordConsent(ctx, p)` | `POST /v1/consent/record` | Idempotent via `ClientRequestID`. |
| `RevokeArtefact(ctx, p)` | `POST /v1/consent/artefacts/{id}/revoke` | 409 surfaces on terminal-state. |

### Listing + iteration

| Method | Verb |
|---|---|
| `ListArtefacts` / `IterateArtefacts` | `GET /v1/consent/artefacts` |
| `GetArtefact` | `GET /v1/consent/artefacts/{id}` (returns `nil, nil` for unknown id) |
| `ListEvents` / `IterateEvents` | `GET /v1/consent/events` |
| `ListAuditLog` / `IterateAuditLog` | `GET /v1/audit` |

### Deletion + rights

| Method | Verb | Notes |
|---|---|---|
| `TriggerDeletion(ctx, p)` | `POST /v1/deletion/trigger` | `PurposeCodes` REQUIRED when `Reason=consent_revoked`. |
| `ListDeletionReceipts` / `IterateDeletionReceipts` | `GET /v1/deletion/receipts` | |
| `CreateRightsRequest(ctx, p)` | `POST /v1/rights/requests` | `IdentityVerifiedBy` REQUIRED. |
| `ListRightsRequests` / `IterateRightsRequests` | `GET /v1/rights/requests` | |

### Health

| Method | Verb |
|---|---|
| `Ping(ctx)` | `GET /v1/_ping` |

## Compliance contract (non-negotiable)

The same contract as every other ConsentShield SDK:

| Outcome | Default (`FailOpen=false`) | `FailOpen=true` |
|---|---|---|
| 4xx (caller bug / scope / 422 / 404 / 413) | returns `*APIError` | returns `*APIError` (4xx **always** surfaces) |
| timeout | returns `*VerifyError` wrapping `*TimeoutError` | returns `OpenFailureEnvelope{Cause: timeout}` |
| network (DNS / TCP / TLS reset) | returns `*VerifyError` wrapping `*NetworkError` | returns `OpenFailureEnvelope{Cause: network}` |
| 5xx | returns `*VerifyError` wrapping `*APIError` | returns `OpenFailureEnvelope{Cause: server_error}` |

The default (fail-CLOSED) protects the data principal whenever
ConsentShield is briefly unreachable — your service responds 503 to
its caller rather than silently default-granting consent that may
have been withdrawn 30 seconds ago.

To opt into fail-OPEN per call site:

```go
client, err := consentshield.NewClient(consentshield.Config{
    APIKey: os.Getenv("CS_API_KEY"),
}.WithFailOpen(true))

// or via env:
//   CONSENT_VERIFY_FAIL_OPEN=true ./your-service
```

When `FailOpen=true` and a 5xx / network / timeout occurs, the
returned `VerifyOutcome` carries `Open != nil` and your audit trail
MUST log it.

## Idiomatic Go

- Every method takes `context.Context` first.
- Errors come back via the second return; `errors.As` to
  discriminate `*APIError`, `*VerifyError`, `*NetworkError`,
  `*TimeoutError`.
- Paginators are explicit: `for it.Next(ctx) { for _, x := range it.Page() { ... } }`
  + `it.Err()` at the end.
- The `Client` is concurrency-safe — share one across your service.
- The transport accepts a caller-supplied `*http.Client` for testing,
  custom retry, IPv6-only, mTLS:
  ```go
  client, _ := consentshield.NewClient(consentshield.Config{
      APIKey: "cs_live_...",
      HTTPClient: &http.Client{Transport: yourCustomRT},
  })
  ```

## Configuration knobs

| Field | Default | Notes |
|---|---|---|
| `APIKey` | — | Required. Must start with `cs_live_`. |
| `BaseURL` | `https://api.consentshield.in` | Trailing slash trimmed. |
| `Timeout` | `2 * time.Second` | Per-attempt. NEVER retried. |
| `MaxRetries` | `2` | On 5xx + transport errors only. |
| `FailOpen` | `false` | See compliance contract. Override via env or `WithFailOpen`. |
| `HTTPClient` | `&http.Client{}` | Swap for tests / mTLS / custom transport. |

## Examples

- `examples/nethttp-middleware/` — framework-agnostic
  `func(http.Handler) http.Handler` middleware. Drops into chi /
  gorilla/mux / alice / any router.
- `examples/gin-middleware/` — gin `HandlerFunc` adapter.

## Trace-id round-trip

Every request can carry an `X-CS-Trace-Id` (set on `*Params.TraceID`)
that the server echoes back. Errors expose the server-emitted trace
id via the `Error` interface:

```go
out, err := client.Verify(ctx, params)
if err != nil {
    if e, ok := err.(consentshield.Error); ok {
        log.Printf("trace_id=%s err=%v", e.TraceID(), err)
    }
}
```

Sentry / structured loggers should always attach the trace id so
your end-to-end correlation works across the SDK ↔ ConsentShield
boundary.

## License

(c) 2026 Sudhindra Anegondhi. All rights reserved. See `LICENSE.md`.
