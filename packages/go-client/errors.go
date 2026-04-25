package consentshield

import (
	"errors"
	"fmt"
)

// Error is the base interface every consentshield-emitted error
// satisfies. Use errors.As / errors.Is to discriminate.
type Error interface {
	error
	// TraceID returns the X-CS-Trace-Id from the response when
	// available (server-emitted, ADR-1014 §3.2 round-trip).
	TraceID() string
}

// ProblemJSON mirrors the RFC 7807 problem-document shape parsed from
// 4xx / 5xx responses when the body is `application/problem+json`.
type ProblemJSON struct {
	Type     string `json:"type,omitempty"`
	Title    string `json:"title,omitempty"`
	Detail   string `json:"detail,omitempty"`
	Status   int    `json:"status,omitempty"`
	Instance string `json:"instance,omitempty"`
}

// APIError surfaces a 4xx or 5xx response from ConsentShield. 4xx is
// ALWAYS surfaced as an error — no fail-open path masks a 4xx.
type APIError struct {
	Status  int
	Problem *ProblemJSON
	traceID string
}

func (e *APIError) Error() string {
	detail := ""
	if e.Problem != nil {
		switch {
		case e.Problem.Detail != "":
			detail = e.Problem.Detail
		case e.Problem.Title != "":
			detail = e.Problem.Title
		}
	}
	if detail == "" {
		detail = fmt.Sprintf("HTTP %d", e.Status)
	}
	return fmt.Sprintf("consentshield: API error %d: %s", e.Status, detail)
}

// TraceID returns the X-CS-Trace-Id header value from the response.
func (e *APIError) TraceID() string { return e.traceID }

// NetworkError wraps a transport-level failure (DNS / TCP / TLS /
// connection reset). The 100 / 400 / 1600 ms backoff retry chain has
// been exhausted by the time this surfaces.
type NetworkError struct {
	Cause   error
	traceID string
}

func (e *NetworkError) Error() string {
	return fmt.Sprintf("consentshield: network error: %v", e.Cause)
}

func (e *NetworkError) Unwrap() error   { return e.Cause }
func (e *NetworkError) TraceID() string { return e.traceID }

// TimeoutError surfaces when the request exceeds Config.Timeout. The
// transport NEVER retries timeouts — compounding latency past the
// compliance budget defeats the purpose of the budget.
type TimeoutError struct {
	TimeoutMS int
	traceID   string
}

func (e *TimeoutError) Error() string {
	return fmt.Sprintf("consentshield: request exceeded %d ms", e.TimeoutMS)
}

func (e *TimeoutError) TraceID() string { return e.traceID }

// VerifyError is the compliance-critical wrapper raised when verify
// fails CLOSED — i.e. when fail_open is disabled (the default) AND
// the underlying call hit a timeout / network / 5xx outcome. Callers
// should respond with HTTP 503 to their own clients.
type VerifyError struct {
	Cause   error
	traceID string
}

func (e *VerifyError) Error() string {
	return fmt.Sprintf("consentshield: verify failed CLOSED: %v", e.Cause)
}

func (e *VerifyError) Unwrap() error   { return e.Cause }
func (e *VerifyError) TraceID() string { return e.traceID }

// IsAPIError reports whether err is or wraps an *APIError.
func IsAPIError(err error) bool {
	var e *APIError
	return errors.As(err, &e)
}

// IsVerifyError reports whether err is or wraps a *VerifyError.
func IsVerifyError(err error) bool {
	var e *VerifyError
	return errors.As(err, &e)
}
