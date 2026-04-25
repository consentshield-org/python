package consentshield

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
)

// ListAuditLogParams filters the audit-log list endpoint.
type ListAuditLogParams struct {
	Action  string
	Subject string
	Cursor  string
	Limit   int
	TraceID string
}

func (p ListAuditLogParams) query() url.Values {
	q := url.Values{}
	if p.Action != "" {
		q.Set("action", p.Action)
	}
	if p.Subject != "" {
		q.Set("subject", p.Subject)
	}
	if p.Cursor != "" {
		q.Set("cursor", p.Cursor)
	}
	if p.Limit > 0 {
		q.Set("limit", fmt.Sprintf("%d", p.Limit))
	}
	return q
}

// ListAuditLog returns a single page of audit events.
func (c *Client) ListAuditLog(ctx context.Context, p ListAuditLogParams) (*AuditLogEnvelope, error) {
	resp, err := c.transport.do(ctx, &httpRequest{
		Method:  "GET",
		Path:    "/v1/audit",
		Query:   p.query(),
		TraceID: p.TraceID,
	})
	if err != nil {
		return nil, err
	}
	var out AuditLogEnvelope
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		return nil, fmt.Errorf("consentshield: decode list_audit_log: %w", err)
	}
	return &out, nil
}

// AuditLogPaginator walks every page of /v1/audit.
type AuditLogPaginator struct {
	client *Client
	params ListAuditLogParams
	done   bool
	last   []AuditLogItem
	err    error
}

// IterateAuditLog returns a paginator over /v1/audit.
func (c *Client) IterateAuditLog(p ListAuditLogParams) *AuditLogPaginator {
	return &AuditLogPaginator{client: c, params: p}
}

func (it *AuditLogPaginator) Next(ctx context.Context) bool {
	if it.done {
		return false
	}
	env, err := it.client.ListAuditLog(ctx, it.params)
	if err != nil {
		it.err = err
		it.done = true
		return false
	}
	it.last = env.Items
	if env.NextCursor == nil || *env.NextCursor == "" {
		it.done = true
	} else {
		it.params.Cursor = *env.NextCursor
	}
	return true
}

func (it *AuditLogPaginator) Page() []AuditLogItem { return it.last }
func (it *AuditLogPaginator) Err() error           { return it.err }
