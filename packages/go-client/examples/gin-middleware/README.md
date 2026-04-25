# gin consent middleware example

`ConsentRequired(client, opts)` is a `gin.HandlerFunc` that gates any
gin route on a successful ConsentShield verify call.

The file ships with `//go:build ignore` so the SDK's `go test ./...`
doesn't compile the gin import. To run the demo, vendor it into its
own module:

```sh
cd packages/go-client/examples/gin-middleware
go mod init consentshield-gin-example
go get github.com/gin-gonic/gin
go get github.com/consentshield/go-client@latest
# (then drop the `//go:build ignore` line off middleware.go +
#  add a main.go that mounts the route)
go run .
```

| Outcome | HTTP response | Notes |
|---|---|---|
| `granted` | route runs | response carries `X-CS-Evaluated-At`, verify outcome on `c.Get("consentshield.verify")` |
| `revoked` / `expired` / `never_consented` | **451** | abort + JSON envelope |
| fail-OPEN override | route runs | response carries `X-CS-Override: <cause>:<reason>` |
| `*VerifyError` (fail-CLOSED default) | **503** | abort |
| `*APIError` (4xx) | **502** | abort |

## Sample wiring

```go
r := gin.Default()
verify := mw.ConsentRequired(client, mw.Options{
    PropertyID:     os.Getenv("CS_PROPERTY_ID"),
    PurposeCode:    "marketing",
    IdentifierType: "email",
    GetIdentifier: func(c *gin.Context) string {
        var body struct{ Email string `json:"email"` }
        _ = c.ShouldBindJSON(&body)
        return body.Email
    },
})
r.POST("/api/marketing/send", verify, func(c *gin.Context) {
    c.JSON(200, gin.H{"sent": true})
})
```

## Why fail-CLOSED → 503

See the net/http example's README — the rationale is identical
across every framework.
