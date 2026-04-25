// ADR-1006 Phase 1 Sprint 1.2 — wire-format types for the v1 API.
//
// Mirrors `app/src/lib/consent/verify.ts` exactly so the SDK contract
// stays in lockstep with the server. snake_case fields are intentional —
// they're the actual JSON the server emits.
//
// Where the SDK exposes a higher-level method API, it accepts camelCase
// inputs (the JS/TS convention) and translates to snake_case at the
// network boundary; the response shapes stay snake_case so callers can
// pipe them straight into logging / audit storage without any rename.

/**
 * §5.1 verify-result statuses. Stable contract — adding a value is a
 * minor-version bump in `@consentshield/node`.
 */
export type VerifyStatus = 'granted' | 'revoked' | 'expired' | 'never_consented'

/**
 * Identifier classes accepted by `data_principal_identifier`. The server
 * may accept additional `custom` identifier sub-types via the
 * `custom_identifier_type` field on the artefact; from the SDK's
 * perspective only these five literal classes flow through.
 */
export type IdentifierType = 'email' | 'phone' | 'pan' | 'aadhaar' | 'custom'

/** Single-identifier verify response (HTTP 200). */
export interface VerifyEnvelope {
  property_id: string
  identifier_type: string
  purpose_code: string
  status: VerifyStatus
  active_artefact_id: string | null
  revoked_at: string | null
  revocation_record_id: string | null
  expires_at: string | null
  /** ISO 8601 UTC timestamp the server stamped at verify-time. */
  evaluated_at: string
}

/** One row of the batch verify response, in input order. */
export interface VerifyBatchResultRow {
  identifier: string
  status: VerifyStatus
  active_artefact_id: string | null
  revoked_at: string | null
  revocation_record_id: string | null
  expires_at: string | null
}

/** Batch verify response (HTTP 200). `results` preserves input order. */
export interface VerifyBatchEnvelope {
  property_id: string
  identifier_type: string
  purpose_code: string
  evaluated_at: string
  results: VerifyBatchResultRow[]
}

// ─────────────────────────────────────────────────────────────────────────
// ADR-1006 Sprint 1.3 — record + revoke + artefact CRUD + events + deletion
// + rights + audit envelope shapes. Mirror the server contracts in
// app/src/lib/{consent,deletion,api}/* exactly.
// ─────────────────────────────────────────────────────────────────────────

/** One artefact created by a `recordConsent` call. */
export interface RecordedArtefact {
  purpose_definition_id: string
  purpose_code: string
  artefact_id: string
  status: string
}

/** §5.2 record-consent response envelope. */
export interface RecordEnvelope {
  event_id: string
  created_at: string
  artefact_ids: RecordedArtefact[]
  /** True when the same `client_request_id` already produced this event — replay-safe by design. */
  idempotent_replay: boolean
}

/** §5.3 revoke-artefact response envelope. */
export interface RevokeEnvelope {
  artefact_id: string
  status: 'revoked'
  revocation_record_id: string
  /** True when the artefact was already revoked — replay-safe. */
  idempotent_replay: boolean
}

/** Single row in the GET /v1/consent/artefacts list. */
export interface ArtefactListItem {
  artefact_id: string
  property_id: string
  purpose_code: string
  purpose_definition_id: string
  data_scope: string[]
  framework: string
  status: string
  expires_at: string | null
  revoked_at: string | null
  revocation_record_id: string | null
  replaced_by: string | null
  identifier_type: string | null
  created_at: string
}

export interface ArtefactListEnvelope {
  items: ArtefactListItem[]
  /** Opaque cursor — pass back into `cursor` to fetch the next page; `null` when exhausted. */
  next_cursor: string | null
}

/** Revocation detail attached to GET /v1/consent/artefacts/{id}. */
export interface ArtefactRevocation {
  id: string
  reason: string | null
  revoked_by_type: string
  revoked_by_ref: string | null
  created_at: string
}

/** Full artefact detail returned by `getArtefact(id)`. */
export interface ArtefactDetail extends ArtefactListItem {
  revocation: ArtefactRevocation | null
  /** Chain of artefact_ids superseding this one, oldest → newest. */
  replacement_chain: string[]
}

/** Single row in the GET /v1/consent/events list. */
export interface EventListItem {
  id: string
  property_id: string
  source: string
  event_type: string
  purposes_accepted_count: number
  purposes_rejected_count: number
  identifier_type: string | null
  artefact_count: number
  created_at: string
}

export interface EventListEnvelope {
  items: EventListItem[]
  next_cursor: string | null
}

/** Reason discriminator for `triggerDeletion`. */
export type DeletionReason = 'consent_revoked' | 'erasure_request' | 'retention_expired'

/** §5.5 deletion-trigger response envelope. */
export interface DeletionTriggerEnvelope {
  reason: DeletionReason
  revoked_artefact_ids: string[]
  revoked_count: number | null
  initial_status: string
  note: string
}

/** Single row in the GET /v1/deletion/receipts list. */
export interface DeletionReceiptRow {
  id: string
  trigger_type: string
  trigger_id: string | null
  artefact_id: string | null
  connector_id: string | null
  target_system: string
  status: string
  retry_count: number
  failure_reason: string | null
  requested_at: string | null
  confirmed_at: string | null
  created_at: string
}

export interface DeletionReceiptsEnvelope {
  items: DeletionReceiptRow[]
  next_cursor: string | null
}

/** Allowed values for `createRightsRequest({ type })`. */
export type RightsRequestType = 'erasure' | 'access' | 'correction' | 'nomination'

/** Allowed values for `listRightsRequests({ status })`. */
export type RightsRequestStatus = 'new' | 'in_progress' | 'completed' | 'rejected'

/** Allowed values for `createRightsRequest({ capturedVia })`. */
export type RightsCapturedVia =
  | 'portal'
  | 'api'
  | 'kiosk'
  | 'branch'
  | 'call_center'
  | 'mobile_app'
  | 'email'
  | 'other'

/** Response envelope from POST /v1/rights/requests. */
export interface RightsRequestCreatedEnvelope {
  id: string
  status: RightsRequestStatus
  request_type: RightsRequestType
  captured_via: RightsCapturedVia
  identity_verified: boolean
  identity_verified_by: string
  /** ISO 8601 — DPDP §13(3) hard-coded 30-day SLA from the server. */
  sla_deadline: string
  created_at: string
}

/** Single row in the GET /v1/rights/requests list. */
export interface RightsRequestItem {
  id: string
  request_type: RightsRequestType
  requestor_name: string
  requestor_email: string
  status: RightsRequestStatus
  captured_via: RightsCapturedVia
  identity_verified: boolean
  identity_verified_at: string | null
  identity_method: string | null
  sla_deadline: string
  response_sent_at: string | null
  created_by_api_key_id: string | null
  created_at: string
  updated_at: string
}

export interface RightsRequestListEnvelope {
  items: RightsRequestItem[]
  next_cursor: string | null
}

/** Single row in the GET /v1/audit list. */
export interface AuditLogItem {
  id: string
  actor_id: string | null
  actor_email: string | null
  event_type: string
  entity_type: string | null
  entity_id: string | null
  payload: unknown
  created_at: string
}

export interface AuditLogEnvelope {
  items: AuditLogItem[]
  next_cursor: string | null
}

/**
 * Fail-open shape returned by `verify` / `verifyBatch` when:
 *   (a) the SDK is in fail-open mode (`failOpen: true` or
 *       `CONSENT_VERIFY_FAIL_OPEN=true`), AND
 *   (b) the verify request failed for an OPEN-eligible reason
 *       (timeout / network / 5xx — NEVER 4xx, which always throws).
 *
 * The compliance contract: when this shape surfaces, the calling code
 * MUST log it to the customer's audit trail (Sprint 1.3 wires the
 * automatic POST to /v1/audit; Sprint 1.2 ships the shape only).
 */
export interface OpenFailureEnvelope {
  status: 'open_failure'
  /** Free-form reason string suitable for audit-log inclusion. */
  reason: string
  /** The cause class name (`ConsentShieldTimeoutError` etc.) for downstream filtering. */
  cause: 'timeout' | 'network' | 'server_error'
  /** Trace id from the failed-request response header, when present. */
  traceId?: string
}
