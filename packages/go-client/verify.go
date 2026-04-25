package consentshield

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
)

// MaxBatchIdentifiers is the server-enforced cap on the size of a
// single VerifyBatch request. Mirrors the Node + Python SDKs.
const MaxBatchIdentifiers = 10000

// VerifyParams are the inputs to Client.Verify.
type VerifyParams struct {
	PropertyID              string
	DataPrincipalIdentifier string
	IdentifierType          string
	PurposeCode             string
	TraceID                 string
}

// Verify checks a single data principal's consent for one purpose on
// one property. Compliance contract: 4xx ALWAYS returns error;
// 5xx/network/timeout + FailOpen=false returns *VerifyError;
// FailOpen=true returns OpenFailureEnvelope on the outcome.
func (c *Client) Verify(ctx context.Context, p VerifyParams) (VerifyOutcome, error) {
	if err := requireStr(p.PropertyID, "PropertyID"); err != nil {
		return VerifyOutcome{}, err
	}
	if err := requireStr(p.DataPrincipalIdentifier, "DataPrincipalIdentifier"); err != nil {
		return VerifyOutcome{}, err
	}
	if err := requireStr(p.IdentifierType, "IdentifierType"); err != nil {
		return VerifyOutcome{}, err
	}
	if err := requireStr(p.PurposeCode, "PurposeCode"); err != nil {
		return VerifyOutcome{}, err
	}

	q := url.Values{}
	q.Set("property_id", p.PropertyID)
	q.Set("data_principal_identifier", p.DataPrincipalIdentifier)
	q.Set("identifier_type", p.IdentifierType)
	q.Set("purpose_code", p.PurposeCode)

	resp, err := c.transport.do(ctx, &httpRequest{
		Method:  "GET",
		Path:    "/v1/consent/verify",
		Query:   q,
		TraceID: p.TraceID,
	})
	if err != nil {
		return c.decideVerifyFailure(err)
	}

	var env VerifyEnvelope
	if err := json.Unmarshal(resp.Body, &env); err != nil {
		return VerifyOutcome{}, fmt.Errorf("consentshield: decode verify response: %w", err)
	}
	return VerifyOutcome{Envelope: &env}, nil
}

// VerifyBatchParams are the inputs to Client.VerifyBatch.
type VerifyBatchParams struct {
	PropertyID     string
	IdentifierType string
	PurposeCode    string
	Identifiers    []string
	TraceID        string
}

// VerifyBatch checks multiple data principals at once. Client-side
// gates fire BEFORE network: empty → error, > MaxBatchIdentifiers →
// error matching server cap, exactly MaxBatchIdentifiers allowed.
func (c *Client) VerifyBatch(ctx context.Context, p VerifyBatchParams) (VerifyBatchOutcome, error) {
	if err := requireStr(p.PropertyID, "PropertyID"); err != nil {
		return VerifyBatchOutcome{}, err
	}
	if err := requireStr(p.IdentifierType, "IdentifierType"); err != nil {
		return VerifyBatchOutcome{}, err
	}
	if err := requireStr(p.PurposeCode, "PurposeCode"); err != nil {
		return VerifyBatchOutcome{}, err
	}
	if len(p.Identifiers) == 0 {
		return VerifyBatchOutcome{}, errors.New("consentshield: Identifiers must contain at least one identifier")
	}
	if len(p.Identifiers) > MaxBatchIdentifiers {
		return VerifyBatchOutcome{}, fmt.Errorf(
			"consentshield: Identifiers exceeds server cap of %d", MaxBatchIdentifiers,
		)
	}
	for i, id := range p.Identifiers {
		if id == "" {
			return VerifyBatchOutcome{}, fmt.Errorf("consentshield: Identifiers[%d] must be a non-empty string", i)
		}
	}

	body := map[string]any{
		"property_id":     p.PropertyID,
		"identifier_type": p.IdentifierType,
		"purpose_code":    p.PurposeCode,
		"identifiers":     p.Identifiers,
	}

	resp, err := c.transport.do(ctx, &httpRequest{
		Method:  "POST",
		Path:    "/v1/consent/verify/batch",
		Body:    body,
		TraceID: p.TraceID,
	})
	if err != nil {
		out, vErr := c.decideVerifyFailure(err)
		if vErr != nil {
			return VerifyBatchOutcome{}, vErr
		}
		return VerifyBatchOutcome{Open: out.Open}, nil
	}

	var env VerifyBatchEnvelope
	if err := json.Unmarshal(resp.Body, &env); err != nil {
		return VerifyBatchOutcome{}, fmt.Errorf("consentshield: decode verify_batch response: %w", err)
	}
	return VerifyBatchOutcome{Envelope: &env}, nil
}

// decideVerifyFailure encodes the non-negotiable compliance contract.
// 4xx ALWAYS rethrows; timeout/network/5xx fans out by FailOpen.
func (c *Client) decideVerifyFailure(err error) (VerifyOutcome, error) {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		if apiErr.Status >= 400 && apiErr.Status < 500 {
			// 4xx: ALWAYS surface, regardless of FailOpen.
			return VerifyOutcome{}, err
		}
	}

	if !c.cfg.FailOpen {
		// Fail-CLOSED default — wrap the cause so callers can
		// errors.As / errors.Is to discriminate.
		return VerifyOutcome{}, &VerifyError{Cause: err, traceID: traceIDOf(err)}
	}

	// Fail-OPEN — return an envelope with the cause discriminator.
	open := buildOpenEnvelope(err)
	return VerifyOutcome{Open: open}, nil
}

func buildOpenEnvelope(err error) *OpenFailureEnvelope {
	cause := OpenCauseNetwork
	reason := "transport_error"

	var (
		apiErr *APIError
		netErr *NetworkError
		toErr  *TimeoutError
	)
	switch {
	case errors.As(err, &toErr):
		cause = OpenCauseTimeout
		reason = "request_timeout"
	case errors.As(err, &apiErr) && apiErr.Status >= 500:
		cause = OpenCauseServerError
		reason = fmt.Sprintf("server_error_%d", apiErr.Status)
	case errors.As(err, &netErr):
		cause = OpenCauseNetwork
		reason = "transport_error"
	}

	return &OpenFailureEnvelope{
		Status:  "open_failure",
		Reason:  reason,
		Cause:   cause,
		TraceID: traceIDOf(err),
	}
}

func traceIDOf(err error) string {
	if e, ok := err.(Error); ok {
		return e.TraceID()
	}
	var (
		apiErr *APIError
		netErr *NetworkError
		toErr  *TimeoutError
		veErr  *VerifyError
	)
	switch {
	case errors.As(err, &apiErr):
		return apiErr.traceID
	case errors.As(err, &netErr):
		return netErr.traceID
	case errors.As(err, &toErr):
		return toErr.traceID
	case errors.As(err, &veErr):
		return veErr.traceID
	}
	return ""
}

// requireStr is the single shared validator.
func requireStr(v, name string) error {
	if v == "" {
		return fmt.Errorf("consentshield: %s is required and must be a non-empty string", name)
	}
	return nil
}
