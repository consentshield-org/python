package consentshield

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
)

// ListArtefactsParams filters the artefact list endpoint.
type ListArtefactsParams struct {
	PropertyID              string
	DataPrincipalIdentifier string
	IdentifierType          string
	Status                  string
	Cursor                  string
	Limit                   int
	TraceID                 string
}

func (p ListArtefactsParams) query() url.Values {
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
	if p.Status != "" {
		q.Set("status", p.Status)
	}
	if p.Cursor != "" {
		q.Set("cursor", p.Cursor)
	}
	if p.Limit > 0 {
		q.Set("limit", fmt.Sprintf("%d", p.Limit))
	}
	return q
}

// ListArtefacts returns a single page of artefacts. Use
// IterateArtefacts for cursor-paginating walks.
func (c *Client) ListArtefacts(ctx context.Context, p ListArtefactsParams) (*ArtefactListEnvelope, error) {
	resp, err := c.transport.do(ctx, &httpRequest{
		Method:  "GET",
		Path:    "/v1/consent/artefacts",
		Query:   p.query(),
		TraceID: p.TraceID,
	})
	if err != nil {
		return nil, err
	}
	var out ArtefactListEnvelope
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		return nil, fmt.Errorf("consentshield: decode list_artefacts: %w", err)
	}
	return &out, nil
}

// ArtefactPaginator walks every page of /v1/consent/artefacts. Call
// Next until it returns false.
type ArtefactPaginator struct {
	client *Client
	params ListArtefactsParams
	done   bool
	last   []ArtefactListItem
	err    error
}

// IterateArtefacts returns a paginator. Caller pattern:
//
//	it := client.IterateArtefacts(p)
//	for it.Next(ctx) {
//	    for _, a := range it.Page() { ... }
//	}
//	if err := it.Err(); err != nil { ... }
func (c *Client) IterateArtefacts(p ListArtefactsParams) *ArtefactPaginator {
	return &ArtefactPaginator{client: c, params: p}
}

// Next fetches the next page and returns true while pages remain.
func (it *ArtefactPaginator) Next(ctx context.Context) bool {
	if it.done {
		return false
	}
	env, err := it.client.ListArtefacts(ctx, it.params)
	if err != nil {
		it.err = err
		it.done = true
		return false
	}
	it.last = env.Artefacts
	if env.NextCursor == nil || *env.NextCursor == "" {
		it.done = true
	} else {
		it.params.Cursor = *env.NextCursor
	}
	return true
}

// Page returns the most recently fetched batch.
func (it *ArtefactPaginator) Page() []ArtefactListItem { return it.last }

// Err returns the iteration error, if any.
func (it *ArtefactPaginator) Err() error { return it.err }

// GetArtefact returns artefact detail or (nil, nil) when the id is
// unknown (the server returns a JSON `null` body for unknown ids).
func (c *Client) GetArtefact(ctx context.Context, artefactID, traceID string) (*ArtefactDetail, error) {
	if err := requireStr(artefactID, "artefactID"); err != nil {
		return nil, err
	}
	resp, err := c.transport.do(ctx, &httpRequest{
		Method:  "GET",
		Path:    "/v1/consent/artefacts/" + url.PathEscape(artefactID),
		TraceID: traceID,
	})
	if err != nil {
		return nil, err
	}
	if len(resp.Body) == 0 || isJSONNull(resp.Body) {
		return nil, nil
	}
	var out ArtefactDetail
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		return nil, fmt.Errorf("consentshield: decode get_artefact: %w", err)
	}
	if out.ArtefactID == "" {
		// Server returned an empty object — treat as not-found.
		return nil, errors.New("consentshield: get_artefact returned empty object")
	}
	return &out, nil
}

func isJSONNull(b []byte) bool {
	for _, c := range b {
		if c != ' ' && c != '\t' && c != '\n' && c != '\r' {
			return string(b) == "null" || string(b) == "null\n"
		}
	}
	return false
}
