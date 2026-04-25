package consentshield

// ─────────────────────────────────────────────────────────────────────
// Verify
// ─────────────────────────────────────────────────────────────────────

// VerifyEnvelope is the §5.1 single-identifier verify response.
type VerifyEnvelope struct {
	PropertyID         string  `json:"property_id"`
	IdentifierType     string  `json:"identifier_type"`
	PurposeCode        string  `json:"purpose_code"`
	Status             string  `json:"status"`
	ActiveArtefactID   *string `json:"active_artefact_id"`
	RevokedAt          *string `json:"revoked_at"`
	RevocationRecordID *string `json:"revocation_record_id"`
	ExpiresAt          *string `json:"expires_at"`
	EvaluatedAt        string  `json:"evaluated_at"`
}

// VerifyBatchResultRow is one entry of a batch verify response, in
// input order.
type VerifyBatchResultRow struct {
	Identifier         string  `json:"identifier"`
	Status             string  `json:"status"`
	ActiveArtefactID   *string `json:"active_artefact_id"`
	RevokedAt          *string `json:"revoked_at"`
	RevocationRecordID *string `json:"revocation_record_id"`
	ExpiresAt          *string `json:"expires_at"`
}

// VerifyBatchEnvelope is the §5.1 batch verify response.
type VerifyBatchEnvelope struct {
	PropertyID     string                 `json:"property_id"`
	IdentifierType string                 `json:"identifier_type"`
	PurposeCode    string                 `json:"purpose_code"`
	EvaluatedAt    string                 `json:"evaluated_at"`
	Results        []VerifyBatchResultRow `json:"results"`
}

// OpenFailureCause discriminates the reason verify took the
// fail-OPEN path. The compliance audit trail MUST log it.
type OpenFailureCause string

const (
	OpenCauseTimeout     OpenFailureCause = "timeout"
	OpenCauseNetwork     OpenFailureCause = "network"
	OpenCauseServerError OpenFailureCause = "server_error"
)

// OpenFailureEnvelope is the shape returned by Verify / VerifyBatch
// when the SDK is in fail-open mode AND the verify call failed for
// an OPEN-eligible reason (timeout / network / 5xx — NEVER 4xx).
type OpenFailureEnvelope struct {
	Status  string           `json:"status"`
	Reason  string           `json:"reason"`
	Cause   OpenFailureCause `json:"cause"`
	TraceID string           `json:"trace_id,omitempty"`
}

// VerifyOutcome is the discriminated union returned by Verify().
// Exactly one of Envelope / Open is non-nil.
type VerifyOutcome struct {
	Envelope *VerifyEnvelope
	Open     *OpenFailureEnvelope
}

// VerifyBatchOutcome is the discriminated union returned by
// VerifyBatch(). Exactly one of Envelope / Open is non-nil.
type VerifyBatchOutcome struct {
	Envelope *VerifyBatchEnvelope
	Open     *OpenFailureEnvelope
}

// IsOpen reports whether the outcome took the fail-open path.
func (o VerifyOutcome) IsOpen() bool { return o.Open != nil }

// IsOpen reports whether the batch outcome took the fail-open path.
func (o VerifyBatchOutcome) IsOpen() bool { return o.Open != nil }

// ─────────────────────────────────────────────────────────────────────
// Record consent + revoke artefact
// ─────────────────────────────────────────────────────────────────────

// RecordedArtefact is one artefact created by a RecordConsent call.
type RecordedArtefact struct {
	PurposeDefinitionID string `json:"purpose_definition_id"`
	PurposeCode         string `json:"purpose_code"`
	ArtefactID          string `json:"artefact_id"`
	Status              string `json:"status"`
}

// RecordEnvelope is the §5.2 record-consent response envelope.
type RecordEnvelope struct {
	EventID          string             `json:"event_id"`
	CreatedAt        string             `json:"created_at"`
	ArtefactIDs      []RecordedArtefact `json:"artefact_ids"`
	IdempotentReplay bool               `json:"idempotent_replay"`
}

// RevokeEnvelope is the §5.2 artefact-revoke response envelope.
type RevokeEnvelope struct {
	ArtefactID         string `json:"artefact_id"`
	Status             string `json:"status"`
	RevokedAt          string `json:"revoked_at"`
	RevocationRecordID string `json:"revocation_record_id"`
}

// ─────────────────────────────────────────────────────────────────────
// Artefact list / detail
// ─────────────────────────────────────────────────────────────────────

// ArtefactListItem is one row of the artefact list endpoint.
type ArtefactListItem struct {
	ArtefactID              string  `json:"artefact_id"`
	PropertyID              string  `json:"property_id"`
	PurposeDefinitionID     string  `json:"purpose_definition_id"`
	PurposeCode             string  `json:"purpose_code"`
	IdentifierType          string  `json:"identifier_type"`
	DataPrincipalIdentifier string  `json:"data_principal_identifier"`
	Status                  string  `json:"status"`
	GrantedAt               string  `json:"granted_at"`
	RevokedAt               *string `json:"revoked_at"`
	ExpiresAt               *string `json:"expires_at"`
}

// ArtefactListEnvelope is the cursor-paginated response for
// /v1/consent/artefacts.
type ArtefactListEnvelope struct {
	Artefacts  []ArtefactListItem `json:"artefacts"`
	NextCursor *string            `json:"next_cursor"`
}

// ArtefactRevocation is the optional revocation-detail block on
// ArtefactDetail.
type ArtefactRevocation struct {
	RevokedAt          string  `json:"revoked_at"`
	RevocationRecordID string  `json:"revocation_record_id"`
	Reason             *string `json:"reason"`
}

// ArtefactDetail is the GET /v1/consent/artefacts/{id} response.
type ArtefactDetail struct {
	ArtefactID              string              `json:"artefact_id"`
	PropertyID              string              `json:"property_id"`
	PurposeDefinitionID     string              `json:"purpose_definition_id"`
	PurposeCode             string              `json:"purpose_code"`
	IdentifierType          string              `json:"identifier_type"`
	DataPrincipalIdentifier string              `json:"data_principal_identifier"`
	Status                  string              `json:"status"`
	GrantedAt               string              `json:"granted_at"`
	ExpiresAt               *string             `json:"expires_at"`
	Revocation              *ArtefactRevocation `json:"revocation"`
}

// ─────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────

// EventListItem is one row of the consent-events list.
type EventListItem struct {
	EventID                 string `json:"event_id"`
	PropertyID              string `json:"property_id"`
	IdentifierType          string `json:"identifier_type"`
	DataPrincipalIdentifier string `json:"data_principal_identifier"`
	Status                  string `json:"status"`
	CapturedAt              string `json:"captured_at"`
}

// EventListEnvelope is the cursor-paginated response for
// /v1/consent/events.
type EventListEnvelope struct {
	Events     []EventListItem `json:"events"`
	NextCursor *string         `json:"next_cursor"`
}

// ─────────────────────────────────────────────────────────────────────
// Deletion
// ─────────────────────────────────────────────────────────────────────

// DeletionTriggerEnvelope is the POST /v1/deletion/trigger response.
type DeletionTriggerEnvelope struct {
	DeletionRequestID string `json:"deletion_request_id"`
	Reason            string `json:"reason"`
	CreatedAt         string `json:"created_at"`
	InitialStatus     string `json:"initial_status"`
}

// DeletionReceiptRow is one row of the deletion-receipts list.
type DeletionReceiptRow struct {
	DeletionRequestID string  `json:"deletion_request_id"`
	ConnectorID       string  `json:"connector_id"`
	Status            string  `json:"status"`
	CompletedAt       *string `json:"completed_at"`
	FailureReason     *string `json:"failure_reason"`
}

// DeletionReceiptsEnvelope is the cursor-paginated receipts response.
type DeletionReceiptsEnvelope struct {
	Receipts   []DeletionReceiptRow `json:"receipts"`
	NextCursor *string              `json:"next_cursor"`
}

// ─────────────────────────────────────────────────────────────────────
// Rights requests
// ─────────────────────────────────────────────────────────────────────

// RightsRequestCreatedEnvelope is the POST /v1/rights/requests
// response.
type RightsRequestCreatedEnvelope struct {
	RightsRequestID string `json:"rights_request_id"`
	Status          string `json:"status"`
	CreatedAt       string `json:"created_at"`
}

// RightsRequestItem is one row of the rights-requests list.
type RightsRequestItem struct {
	RightsRequestID string `json:"rights_request_id"`
	RequestType     string `json:"request_type"`
	Status          string `json:"status"`
	CreatedAt       string `json:"created_at"`
}

// RightsRequestListEnvelope is the cursor-paginated rights-requests
// response.
type RightsRequestListEnvelope struct {
	Requests   []RightsRequestItem `json:"requests"`
	NextCursor *string             `json:"next_cursor"`
}

// ─────────────────────────────────────────────────────────────────────
// Audit log
// ─────────────────────────────────────────────────────────────────────

// AuditLogItem is one row of the audit-log list.
type AuditLogItem struct {
	AuditID    string `json:"audit_id"`
	OccurredAt string `json:"occurred_at"`
	Actor      string `json:"actor"`
	Action     string `json:"action"`
	Subject    string `json:"subject"`
}

// AuditLogEnvelope is the cursor-paginated audit-log response.
type AuditLogEnvelope struct {
	Items      []AuditLogItem `json:"items"`
	NextCursor *string        `json:"next_cursor"`
}
