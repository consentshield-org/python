# `net/http` consent-middleware example

Framework-agnostic middleware that wraps any `http.Handler` and gates
it on a successful ConsentShield verify call.

| Outcome | HTTP response | Notes |
|---|---|---|
| `granted` | handler runs | response carries `X-CS-Evaluated-At` |
| `revoked` / `expired` / `never_consented` | **451** | with the verify envelope in the body |
| fail-OPEN override | handler runs | response carries `X-CS-Override: <cause>:<reason>` |
| `*VerifyError` (fail-CLOSED default) | **503** | NEVER default-grants |
| `*APIError` (4xx) | **502** | with the original status surfaced |

## Run

```sh
cd packages/go-client/examples/nethttp-middleware
CS_API_KEY=cs_live_xxx CS_PROPERTY_ID=PROP_UUID go run .

curl -X POST http://localhost:4040/api/marketing/send \
     -H 'Content-Type: application/json' \
     -d '{"email":"user@example.com"}'
```

## Use with chi

```go
import "github.com/go-chi/chi/v5"

r := chi.NewRouter()
r.With(mw.Wrap(client, mw.Options{...})).Post("/api/marketing/send", handler)
```

The middleware is a `func(http.Handler) http.Handler`, which is the
universal middleware shape — drop it into chi, gorilla/mux, alice, or
any router that consumes that signature.
