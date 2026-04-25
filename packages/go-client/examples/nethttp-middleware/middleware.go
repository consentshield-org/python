// Package nethttpmiddleware shows how to gate any net/http handler
// on a successful ConsentShield verify call. Same outcome contract as
// the Express / Django / Flask / FastAPI peers:
//
//   - status:granted          → handler runs (X-CS-Evaluated-At header)
//   - status:revoked/expired  → 451 Unavailable For Legal Reasons
//   - fail-OPEN override      → handler runs (X-CS-Override header)
//   - VerifyError (CLOSED)    → 503 Service Unavailable
//   - APIError (4xx)          → 502 Bad Gateway
package nethttpmiddleware

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	consentshield "github.com/consentshield-org/go-client"
)

// Options configure the middleware per route.
type Options struct {
	PropertyID     string
	PurposeCode    string
	IdentifierType string
	// GetIdentifier extracts the data-principal identifier from the
	// inbound request. Return "" to short-circuit with a 400.
	GetIdentifier func(*http.Request) string
}

// Wrap returns a middleware that runs Verify on every inbound request
// and only calls `next` when the response is `granted` (or the
// caller has opted into fail-OPEN).
func Wrap(client *consentshield.Client, opts Options) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := opts.GetIdentifier(r)
			if id == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_identifier"})
				return
			}

			out, err := client.Verify(r.Context(), consentshield.VerifyParams{
				PropertyID:              opts.PropertyID,
				DataPrincipalIdentifier: id,
				IdentifierType:          opts.IdentifierType,
				PurposeCode:             opts.PurposeCode,
				TraceID:                 r.Header.Get("X-Trace-Id"),
			})
			if err != nil {
				var verifyErr *consentshield.VerifyError
				var apiErr *consentshield.APIError
				switch {
				case errors.As(err, &verifyErr):
					if verifyErr.TraceID() != "" {
						w.Header().Set("X-CS-Trace-Id", verifyErr.TraceID())
					}
					writeJSON(w, http.StatusServiceUnavailable, map[string]any{
						"error":    "consent_verification_unavailable",
						"trace_id": verifyErr.TraceID(),
					})
					return
				case errors.As(err, &apiErr):
					if apiErr.TraceID() != "" {
						w.Header().Set("X-CS-Trace-Id", apiErr.TraceID())
					}
					writeJSON(w, http.StatusBadGateway, map[string]any{
						"error":    "consent_check_failed",
						"status":   apiErr.Status,
						"trace_id": apiErr.TraceID(),
					})
					return
				default:
					writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
					return
				}
			}

			if out.IsOpen() {
				w.Header().Set("X-CS-Override", string(out.Open.Cause)+":"+out.Open.Reason)
				if out.Open.TraceID != "" {
					w.Header().Set("X-CS-Trace-Id", out.Open.TraceID)
				}
				next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), verifyKey{}, out)))
				return
			}

			if out.Envelope.Status != "granted" {
				writeJSON(w, 451, map[string]any{
					"error":         "consent_not_granted",
					"status":        out.Envelope.Status,
					"property_id":   out.Envelope.PropertyID,
					"purpose_code":  out.Envelope.PurposeCode,
					"evaluated_at":  out.Envelope.EvaluatedAt,
				})
				return
			}

			w.Header().Set("X-CS-Evaluated-At", out.Envelope.EvaluatedAt)
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), verifyKey{}, out)))
		})
	}
}

type verifyKey struct{}

// FromContext returns the verify outcome stashed by Wrap, or the
// zero value if no outcome is present.
func FromContext(ctx context.Context) consentshield.VerifyOutcome {
	if v, ok := ctx.Value(verifyKey{}).(consentshield.VerifyOutcome); ok {
		return v
	}
	return consentshield.VerifyOutcome{}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
