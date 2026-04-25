package consentshield

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
)

// ListEventsParams filters the consent-events list endpoint.
type ListEventsParams struct {
	PropertyID              string
	DataPrincipalIdentifier string
	IdentifierType          string
	Cursor                  string
	Limit                   int
	TraceID                 string
}

func (p ListEventsParams) query() url.Values {
	q := url.Values{}
	if p.PropertyID != "" {
		q.Set("property_id", p.PropertyID)
	}
	if p.DataPrincipalIdentifier != "" {
		q.Set("data_principal_identifier", p.DataPrincipalIdentifier)
	}
	if p.IdentifierType != "" {
		q.Set("identifier_type", p.IdentifierType)
	}
	if p.Cursor != "" {
		q.Set("cursor", p.Cursor)
	}
	if p.Limit > 0 {
		q.Set("limit", fmt.Sprintf("%d", p.Limit))
	}
	return q
}

// ListEvents returns a single page of events.
func (c *Client) ListEvents(ctx context.Context, p ListEventsParams) (*EventListEnvelope, error) {
	resp, err := c.transport.do(ctx, &httpRequest{
		Method:  "GET",
		Path:    "/v1/consent/events",
		Query:   p.query(),
		TraceID: p.TraceID,
	})
	if err != nil {
		return nil, err
	}
	var out EventListEnvelope
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		return nil, fmt.Errorf("consentshield: decode list_events: %w", err)
	}
	return &out, nil
}

// EventPaginator walks every page of /v1/consent/events.
type EventPaginator struct {
	client *Client
	params ListEventsParams
	done   bool
	last   []EventListItem
	err    error
}

// IterateEvents returns a paginator over /v1/consent/events.
func (c *Client) IterateEvents(p ListEventsParams) *EventPaginator {
	return &EventPaginator{client: c, params: p}
}

func (it *EventPaginator) Next(ctx context.Context) bool {
	if it.done {
		return false
	}
	env, err := it.client.ListEvents(ctx, it.params)
	if err != nil {
		it.err = err
		it.done = true
		return false
	}
	it.last = env.Events
	if env.NextCursor == nil || *env.NextCursor == "" {
		it.done = true
	} else {
		it.params.Cursor = *env.NextCursor
	}
	return true
}

func (it *EventPaginator) Page() []EventListItem { return it.last }
func (it *EventPaginator) Err() error            { return it.err }
