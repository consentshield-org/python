package consentshield

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
)

// DeletionReason values mirror the server contract.
const (
	DeletionReasonConsentRevoked  = "consent_revoked"
	DeletionReasonRightsRequest   = "rights_request"
	DeletionReasonAccountClosed   = "account_closed"
	DeletionReasonRetentionExpiry = "retention_expiry"
	DeletionReasonOperatorAction  = "operator_action"
)

// TriggerDeletionParams are the inputs to TriggerDeletion.
type TriggerDeletionParams struct {
	PropertyID              string
	DataPrincipalIdentifier string
	IdentifierType          string
	Reason                  string
	PurposeCodes            []string
	ScopeOverride           string
	ActorType               string
	ActorRef                string
	ClientRequestID         string
	TraceID                 string
}

// TriggerDeletion enqueues a deletion across the customer's wired
// connectors. PurposeCodes is REQUIRED when Reason="consent_revoked"
// (compliance gate, fires before network).
func (c *Client) TriggerDeletion(ctx context.Context, p TriggerDeletionParams) (*DeletionTriggerEnvelope, error) {
	if err := requireStr(p.PropertyID, "PropertyID"); err != nil {
		return nil, err
	}
	if err := requireStr(p.DataPrincipalIdentifier, "DataPrincipalIdentifier"); err != nil {
		return nil, err
	}
	if err := requireStr(p.IdentifierType, "IdentifierType"); err != nil {
		return nil, err
	}
	if err := requireStr(p.Reason, "Reason"); err != nil {
		return nil, err
	}
	if p.Reason == DeletionReasonConsentRevoked && len(p.PurposeCodes) == 0 {
		return nil, errors.New("consentshield: PurposeCodes is required when Reason=consent_revoked")
	}
	for i, code := range p.PurposeCodes {
		if code == "" {
			return nil, fmt.Errorf("consentshield: PurposeCodes[%d] must be a non-empty string", i)
		}
	}

	body := map[string]any{
		"property_id":               p.PropertyID,
		"data_principal_identifier": p.DataPrincipalIdentifier,
		"identifier_type":           p.IdentifierType,
		"reason":                    p.Reason,
	}
	if len(p.PurposeCodes) > 0 {
		body["purpose_codes"] = p.PurposeCodes
	}
	if p.ScopeOverride != "" {
		body["scope_override"] = p.ScopeOverride
	}
	if p.ActorType != "" {
		body["actor_type"] = p.ActorType
	}
	if p.ActorRef != "" {
		body["actor_ref"] = p.ActorRef
	}
	if p.ClientRequestID != "" {
		body["client_request_id"] = p.ClientRequestID
	}

	resp, err := c.transport.do(ctx, &httpRequest{
		Method:  "POST",
		Path:    "/v1/deletion/trigger",
		Body:    body,
		TraceID: p.TraceID,
	})
	if err != nil {
		return nil, err
	}
	var out DeletionTriggerEnvelope
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		return nil, fmt.Errorf("consentshield: decode trigger_deletion: %w", err)
	}
	return &out, nil
}

// ListDeletionReceiptsParams filters the receipts list.
type ListDeletionReceiptsParams struct {
	DeletionRequestID string
	Cursor            string
	Limit             int
	TraceID           string
}

func (p ListDeletionReceiptsParams) query() url.Values {
	q := url.Values{}
	if p.DeletionRequestID != "" {
		q.Set("deletion_request_id", p.DeletionRequestID)
	}
	if p.Cursor != "" {
		q.Set("cursor", p.Cursor)
	}
	if p.Limit > 0 {
		q.Set("limit", fmt.Sprintf("%d", p.Limit))
	}
	return q
}

// ListDeletionReceipts returns a single page of deletion receipts.
func (c *Client) ListDeletionReceipts(ctx context.Context, p ListDeletionReceiptsParams) (*DeletionReceiptsEnvelope, error) {
	resp, err := c.transport.do(ctx, &httpRequest{
		Method:  "GET",
		Path:    "/v1/deletion/receipts",
		Query:   p.query(),
		TraceID: p.TraceID,
	})
	if err != nil {
		return nil, err
	}
	var out DeletionReceiptsEnvelope
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		return nil, fmt.Errorf("consentshield: decode list_deletion_receipts: %w", err)
	}
	return &out, nil
}

// DeletionReceiptPaginator walks every page of /v1/deletion/receipts.
type DeletionReceiptPaginator struct {
	client *Client
	params ListDeletionReceiptsParams
	done   bool
	last   []DeletionReceiptRow
	err    error
}

// IterateDeletionReceipts returns a paginator.
func (c *Client) IterateDeletionReceipts(p ListDeletionReceiptsParams) *DeletionReceiptPaginator {
	return &DeletionReceiptPaginator{client: c, params: p}
}

func (it *DeletionReceiptPaginator) Next(ctx context.Context) bool {
	if it.done {
		return false
	}
	env, err := it.client.ListDeletionReceipts(ctx, it.params)
	if err != nil {
		it.err = err
		it.done = true
		return false
	}
	it.last = env.Receipts
	if env.NextCursor == nil || *env.NextCursor == "" {
		it.done = true
	} else {
		it.params.Cursor = *env.NextCursor
	}
	return true
}

func (it *DeletionReceiptPaginator) Page() []DeletionReceiptRow { return it.last }
func (it *DeletionReceiptPaginator) Err() error                 { return it.err }
