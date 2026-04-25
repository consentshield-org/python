package consentshield

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
)

// RightsRequestType values mirror the server contract.
const (
	RightsRequestTypeAccess      = "access"
	RightsRequestTypeCorrection  = "correction"
	RightsRequestTypeErasure     = "erasure"
	RightsRequestTypePortability = "portability"
)

// CreateRightsRequestParams are the inputs to CreateRightsRequest.
type CreateRightsRequestParams struct {
	PropertyID              string
	DataPrincipalIdentifier string
	IdentifierType          string
	RequestType             string
	IdentityVerifiedBy      string
	CapturedVia             string
	Notes                   string
	ClientRequestID         string
	TraceID                 string
}

// CreateRightsRequest opens a new rights request. IdentityVerifiedBy
// is REQUIRED — the SDK refuses to forward unverified rights requests.
func (c *Client) CreateRightsRequest(ctx context.Context, p CreateRightsRequestParams) (*RightsRequestCreatedEnvelope, error) {
	if err := requireStr(p.PropertyID, "PropertyID"); err != nil {
		return nil, err
	}
	if err := requireStr(p.DataPrincipalIdentifier, "DataPrincipalIdentifier"); err != nil {
		return nil, err
	}
	if err := requireStr(p.IdentifierType, "IdentifierType"); err != nil {
		return nil, err
	}
	if err := requireStr(p.RequestType, "RequestType"); err != nil {
		return nil, err
	}
	if err := requireStr(p.IdentityVerifiedBy, "IdentityVerifiedBy"); err != nil {
		return nil, err
	}

	body := map[string]any{
		"property_id":               p.PropertyID,
		"data_principal_identifier": p.DataPrincipalIdentifier,
		"identifier_type":           p.IdentifierType,
		"request_type":              p.RequestType,
		"identity_verified_by":      p.IdentityVerifiedBy,
	}
	if p.CapturedVia != "" {
		body["captured_via"] = p.CapturedVia
	}
	if p.Notes != "" {
		body["notes"] = p.Notes
	}
	if p.ClientRequestID != "" {
		body["client_request_id"] = p.ClientRequestID
	}

	resp, err := c.transport.do(ctx, &httpRequest{
		Method:  "POST",
		Path:    "/v1/rights/requests",
		Body:    body,
		TraceID: p.TraceID,
	})
	if err != nil {
		return nil, err
	}
	var out RightsRequestCreatedEnvelope
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		return nil, fmt.Errorf("consentshield: decode create_rights_request: %w", err)
	}
	return &out, nil
}

// ListRightsRequestsParams filters the rights-requests list.
type ListRightsRequestsParams struct {
	PropertyID  string
	Status      string
	RequestType string
	Cursor      string
	Limit       int
	TraceID     string
}

func (p ListRightsRequestsParams) query() url.Values {
	q := url.Values{}
	if p.PropertyID != "" {
		q.Set("property_id", p.PropertyID)
	}
	if p.Status != "" {
		q.Set("status", p.Status)
	}
	if p.RequestType != "" {
		q.Set("request_type", p.RequestType)
	}
	if p.Cursor != "" {
		q.Set("cursor", p.Cursor)
	}
	if p.Limit > 0 {
		q.Set("limit", fmt.Sprintf("%d", p.Limit))
	}
	return q
}

// ListRightsRequests returns a single page of rights requests.
func (c *Client) ListRightsRequests(ctx context.Context, p ListRightsRequestsParams) (*RightsRequestListEnvelope, error) {
	resp, err := c.transport.do(ctx, &httpRequest{
		Method:  "GET",
		Path:    "/v1/rights/requests",
		Query:   p.query(),
		TraceID: p.TraceID,
	})
	if err != nil {
		return nil, err
	}
	var out RightsRequestListEnvelope
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		return nil, fmt.Errorf("consentshield: decode list_rights_requests: %w", err)
	}
	return &out, nil
}

// RightsRequestPaginator walks every page of /v1/rights/requests.
type RightsRequestPaginator struct {
	client *Client
	params ListRightsRequestsParams
	done   bool
	last   []RightsRequestItem
	err    error
}

// IterateRightsRequests returns a paginator.
func (c *Client) IterateRightsRequests(p ListRightsRequestsParams) *RightsRequestPaginator {
	return &RightsRequestPaginator{client: c, params: p}
}

func (it *RightsRequestPaginator) Next(ctx context.Context) bool {
	if it.done {
		return false
	}
	env, err := it.client.ListRightsRequests(ctx, it.params)
	if err != nil {
		it.err = err
		it.done = true
		return false
	}
	it.last = env.Requests
	if env.NextCursor == nil || *env.NextCursor == "" {
		it.done = true
	} else {
		it.params.Cursor = *env.NextCursor
	}
	return true
}

func (it *RightsRequestPaginator) Page() []RightsRequestItem { return it.last }
func (it *RightsRequestPaginator) Err() error                { return it.err }
