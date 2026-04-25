// Package ginmiddleware adapts the Wrap middleware shape to gin's
// HandlerFunc convention.
//
// Note: this example imports github.com/gin-gonic/gin but the
// go.mod for the SDK does NOT depend on gin — the example is built
// in its own module so the SDK stays dependency-free at the binary
// level. To run the demo:
//
//	cd packages/go-client/examples/gin-middleware
//	go mod init consentshield-gin-example
//	go get github.com/gin-gonic/gin
//	go get github.com/consentshield-org/go-client@latest
//	go run .

//go:build ignore

package ginmiddleware

import (
	"errors"

	"github.com/gin-gonic/gin"

	consentshield "github.com/consentshield-org/go-client"
)

// Options mirror the net/http example.
type Options struct {
	PropertyID     string
	PurposeCode    string
	IdentifierType string
	GetIdentifier  func(c *gin.Context) string
}

// ConsentRequired returns a gin middleware that runs Verify on every
// request matched by the calling route.
func ConsentRequired(client *consentshield.Client, opts Options) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := opts.GetIdentifier(c)
		if id == "" {
			c.AbortWithStatusJSON(400, gin.H{"error": "missing_identifier"})
			return
		}

		out, err := client.Verify(c.Request.Context(), consentshield.VerifyParams{
			PropertyID:              opts.PropertyID,
			DataPrincipalIdentifier: id,
			IdentifierType:          opts.IdentifierType,
			PurposeCode:             opts.PurposeCode,
			TraceID:                 c.GetHeader("X-Trace-Id"),
		})
		if err != nil {
			var verifyErr *consentshield.VerifyError
			var apiErr *consentshield.APIError
			switch {
			case errors.As(err, &verifyErr):
				if verifyErr.TraceID() != "" {
					c.Header("X-CS-Trace-Id", verifyErr.TraceID())
				}
				c.AbortWithStatusJSON(503, gin.H{
					"error":    "consent_verification_unavailable",
					"trace_id": verifyErr.TraceID(),
				})
			case errors.As(err, &apiErr):
				if apiErr.TraceID() != "" {
					c.Header("X-CS-Trace-Id", apiErr.TraceID())
				}
				c.AbortWithStatusJSON(502, gin.H{
					"error":    "consent_check_failed",
					"status":   apiErr.Status,
					"trace_id": apiErr.TraceID(),
				})
			default:
				c.AbortWithStatusJSON(500, gin.H{"error": err.Error()})
			}
			return
		}

		if out.IsOpen() {
			c.Header("X-CS-Override", string(out.Open.Cause)+":"+out.Open.Reason)
			if out.Open.TraceID != "" {
				c.Header("X-CS-Trace-Id", out.Open.TraceID)
			}
			c.Set("consentshield.verify", out)
			c.Next()
			return
		}

		if out.Envelope.Status != "granted" {
			c.AbortWithStatusJSON(451, gin.H{
				"error":        "consent_not_granted",
				"status":       out.Envelope.Status,
				"property_id":  out.Envelope.PropertyID,
				"purpose_code": out.Envelope.PurposeCode,
				"evaluated_at": out.Envelope.EvaluatedAt,
			})
			return
		}

		c.Header("X-CS-Evaluated-At", out.Envelope.EvaluatedAt)
		c.Set("consentshield.verify", out)
		c.Next()
	}
}
