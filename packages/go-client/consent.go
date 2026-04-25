package consentshield

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
)

// ─────────────────────────────────────────────────────────────────────
// Ping
// ─────────────────────────────────────────────────────────────────────

// PingEnvelope is the GET /v1/_ping response.
type PingEnvelope struct {
	Status string `json:"status"`
}

// Ping is the cheapest call against the API — useful as a smoke
// check for credentials + base URL on boot.
func (c *Client) Ping(ctx context.Context) (*PingEnvelope, error) {
	resp, err := c.transport.do(ctx, &httpRequest{Method: "GET", Path: "/v1/_ping"})
	if err != nil {
		return nil, err
	}
	var out PingEnvelope
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		return nil, fmt.Errorf("consentshield: decode ping: %w", err)
	}
	return &out, nil
}

// ─────────────────────────────────────────────────────────────────────
// Record consent
// ─────────────────────────────────────────────────────────────────────

// RecordConsentParams are the inputs to RecordConsent.
type RecordConsentParams struct {
	PropertyID                   string
	DataPrincipalIdentifier      string
	IdentifierType               string
	PurposeDefinitionIDs         []string
	RejectedPurposeDefinitionIDs []string
	CapturedAt                   string
	CapturedVia                  string
	NoticeVersionID              string
	ClientRequestID              string
	TraceID                      string
}

// RecordConsent records a consent event with one or more granted
// purposes. ClientRequestID makes the call idempotent — replays
// surface IdempotentReplay=true on the response.
func (c *Client) RecordConsent(ctx context.Context, p RecordConsentParams) (*RecordEnvelope, error) {
	if err := requireStr(p.PropertyID, "PropertyID"); err != nil {
		return nil, err
	}
	if err := requireStr(p.DataPrincipalIdentifier, "DataPrincipalIdentifier"); err != nil {
		return nil, err
	}
	if err := requireStr(p.IdentifierType, "IdentifierType"); err != nil {
		return nil, err
	}
	if len(p.PurposeDefinitionIDs) == 0 {
		return nil, errors.New("consentshield: PurposeDefinitionIDs must contain at least one id")
	}
	for i, id := range p.PurposeDefinitionIDs {
		if id == "" {
			return nil, fmt.Errorf("consentshield: PurposeDefinitionIDs[%d] must be a non-empty string", i)
		}
	}
	for i, id := range p.RejectedPurposeDefinitionIDs {
		if id == "" {
			return nil, fmt.Errorf("consentshield: RejectedPurposeDefinitionIDs[%d] must be a non-empty string", i)
		}
	}

	body := map[string]any{
		"property_id":               p.PropertyID,
		"data_principal_identifier": p.DataPrincipalIdentifier,
		"identifier_type":           p.IdentifierType,
		"purpose_definition_ids":    p.PurposeDefinitionIDs,
	}
	if len(p.RejectedPurposeDefinitionIDs) > 0 {
		body["rejected_purpose_definition_ids"] = p.RejectedPurposeDefinitionIDs
	}
	if p.CapturedAt != "" {
		body["captured_at"] = p.CapturedAt
	}
	if p.CapturedVia != "" {
		body["captured_via"] = p.CapturedVia
	}
	if p.NoticeVersionID != "" {
		body["notice_version_id"] = p.NoticeVersionID
	}
	if p.ClientRequestID != "" {
		body["client_request_id"] = p.ClientRequestID
	}

	resp, err := c.transport.do(ctx, &httpRequest{
		Method:  "POST",
		Path:    "/v1/consent/record",
		Body:    body,
		TraceID: p.TraceID,
	})
	if err != nil {
		return nil, err
	}
	var out RecordEnvelope
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		return nil, fmt.Errorf("consentshield: decode record_consent: %w", err)
	}
	return &out, nil
}

// ─────────────────────────────────────────────────────────────────────
// Revoke artefact
// ─────────────────────────────────────────────────────────────────────

// RevokeArtefactParams are the inputs to RevokeArtefact.
type RevokeArtefactParams struct {
	ArtefactID  string
	ActorType   string
	ActorRef    string
	ReasonNotes string
	TraceID     string
}

// RevokeArtefact revokes a single consent artefact. The artefact id
// is URL-encoded into the path so it survives `/`/`#`/`&`/`?`. 409
// surfaces on terminal-state artefacts (already revoked / expired).
func (c *Client) RevokeArtefact(ctx context.Context, p RevokeArtefactParams) (*RevokeEnvelope, error) {
	if err := requireStr(p.ArtefactID, "ArtefactID"); err != nil {
		return nil, err
	}
	body := map[string]any{}
	if p.ActorType != "" {
		body["actor_type"] = p.ActorType
	}
	if p.ActorRef != "" {
		body["actor_ref"] = p.ActorRef
	}
	if p.ReasonNotes != "" {
		body["reason_notes"] = p.ReasonNotes
	}

	resp, err := c.transport.do(ctx, &httpRequest{
		Method:  "POST",
		Path:    "/v1/consent/artefacts/" + url.PathEscape(p.ArtefactID) + "/revoke",
		Body:    body,
		TraceID: p.TraceID,
	})
	if err != nil {
		return nil, err
	}
	var out RevokeEnvelope
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		return nil, fmt.Errorf("consentshield: decode revoke_artefact: %w", err)
	}
	return &out, nil
}
