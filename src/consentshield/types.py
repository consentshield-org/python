"""ADR-1006 Phase 2 Sprint 2.1 — wire-format types for the v1 API.

Mirrors ``app/src/lib/consent/verify.ts`` + the rest of
``app/src/lib/{consent,deletion,api}/`` exactly. snake_case fields are
intentional — they're the actual JSON the server emits, and the SDK
exposes them verbatim so callers can pipe them straight into logging
/ audit storage without any rename.

Where the SDK exposes a higher-level method API, it ALSO accepts
snake_case keyword arguments per Python convention. The Node SDK uses
camelCase inputs (JS/TS convention); the Python SDK keeps snake_case
end-to-end.
"""

from __future__ import annotations

from typing import List, Literal, Optional, TypedDict, Union

# ─────────────────────────────────────────────────────────────────────
# Verify (Sprint 1.2 / 2.1)
# ─────────────────────────────────────────────────────────────────────

VerifyStatus = Literal["granted", "revoked", "expired", "never_consented"]
"""§5.1 verify-result statuses. Stable contract — adding a value is a
minor-version bump in ``consentshield``."""

IdentifierType = Literal["email", "phone", "pan", "aadhaar", "custom"]
"""Identifier classes accepted by ``data_principal_identifier``. The
server may accept additional ``custom`` identifier sub-types via the
``custom_identifier_type`` field on the artefact; from the SDK's
perspective only these five literal classes flow through."""


class VerifyEnvelope(TypedDict):
    """Single-identifier verify response (HTTP 200)."""

    property_id: str
    identifier_type: str
    purpose_code: str
    status: VerifyStatus
    active_artefact_id: Optional[str]
    revoked_at: Optional[str]
    revocation_record_id: Optional[str]
    expires_at: Optional[str]
    evaluated_at: str


class VerifyBatchResultRow(TypedDict):
    """One row of the batch verify response, in input order."""

    identifier: str
    status: VerifyStatus
    active_artefact_id: Optional[str]
    revoked_at: Optional[str]
    revocation_record_id: Optional[str]
    expires_at: Optional[str]


class VerifyBatchEnvelope(TypedDict):
    """Batch verify response (HTTP 200). ``results`` preserves input order."""

    property_id: str
    identifier_type: str
    purpose_code: str
    evaluated_at: str
    results: List[VerifyBatchResultRow]


OpenFailureCause = Literal["timeout", "network", "server_error"]


class OpenFailureEnvelope(TypedDict):
    """Fail-open shape returned by ``verify`` / ``verify_batch``.

    Returned when the SDK is in fail-open mode (``fail_open=True`` or
    ``CONSENT_VERIFY_FAIL_OPEN=true`` env) AND the verify request
    failed for an OPEN-eligible reason (timeout / network / 5xx —
    NEVER 4xx, which always raises).

    The compliance contract: when this shape surfaces, the calling
    code MUST log it to the customer's audit trail. The
    ``on_fail_open`` callback fires automatically with this envelope.
    """

    status: Literal["open_failure"]
    reason: str
    cause: OpenFailureCause
    trace_id: Optional[str]


VerifyOutcome = Union[VerifyEnvelope, OpenFailureEnvelope]
VerifyBatchOutcome = Union[VerifyBatchEnvelope, OpenFailureEnvelope]


# ─────────────────────────────────────────────────────────────────────
# Record consent (Sprint 1.3 / 2.1)
# ─────────────────────────────────────────────────────────────────────

class RecordedArtefact(TypedDict):
    """One artefact created by a ``record_consent`` call."""

    purpose_definition_id: str
    purpose_code: str
    artefact_id: str
    status: str


class RecordEnvelope(TypedDict):
    """§5.2 record-consent response envelope."""

    event_id: str
    created_at: str
    artefact_ids: List[RecordedArtefact]
    idempotent_replay: bool


# ─────────────────────────────────────────────────────────────────────
# Revoke (Sprint 1.3 / 2.1)
# ─────────────────────────────────────────────────────────────────────

RevokeActorType = Literal["user", "operator", "system"]


class RevokeEnvelope(TypedDict):
    """§5.3 revoke-artefact response envelope."""

    artefact_id: str
    status: Literal["revoked"]
    revocation_record_id: str
    idempotent_replay: bool


# ─────────────────────────────────────────────────────────────────────
# Artefact CRUD (Sprint 1.3 / 2.1)
# ─────────────────────────────────────────────────────────────────────

class ArtefactListItem(TypedDict):
    artefact_id: str
    property_id: str
    purpose_code: str
    purpose_definition_id: str
    data_scope: List[str]
    framework: str
    status: str
    expires_at: Optional[str]
    revoked_at: Optional[str]
    revocation_record_id: Optional[str]
    replaced_by: Optional[str]
    identifier_type: Optional[str]
    created_at: str


class ArtefactListEnvelope(TypedDict):
    items: List[ArtefactListItem]
    next_cursor: Optional[str]


class ArtefactRevocation(TypedDict):
    id: str
    reason: Optional[str]
    revoked_by_type: str
    revoked_by_ref: Optional[str]
    created_at: str


class ArtefactDetail(ArtefactListItem):
    revocation: Optional[ArtefactRevocation]
    replacement_chain: List[str]


# ─────────────────────────────────────────────────────────────────────
# Events (Sprint 1.3 / 2.1)
# ─────────────────────────────────────────────────────────────────────

class EventListItem(TypedDict):
    id: str
    property_id: str
    source: str
    event_type: str
    purposes_accepted_count: int
    purposes_rejected_count: int
    identifier_type: Optional[str]
    artefact_count: int
    created_at: str


class EventListEnvelope(TypedDict):
    items: List[EventListItem]
    next_cursor: Optional[str]


# ─────────────────────────────────────────────────────────────────────
# Deletion (Sprint 1.3 / 2.1)
# ─────────────────────────────────────────────────────────────────────

DeletionReason = Literal["consent_revoked", "erasure_request", "retention_expired"]
DeletionActorType = Literal["user", "operator", "system"]


class DeletionTriggerEnvelope(TypedDict):
    """§5.5 deletion-trigger response envelope."""

    reason: DeletionReason
    revoked_artefact_ids: List[str]
    revoked_count: Optional[int]
    initial_status: str
    note: str


class DeletionReceiptRow(TypedDict):
    id: str
    trigger_type: str
    trigger_id: Optional[str]
    artefact_id: Optional[str]
    connector_id: Optional[str]
    target_system: str
    status: str
    retry_count: int
    failure_reason: Optional[str]
    requested_at: Optional[str]
    confirmed_at: Optional[str]
    created_at: str


class DeletionReceiptsEnvelope(TypedDict):
    items: List[DeletionReceiptRow]
    next_cursor: Optional[str]


# ─────────────────────────────────────────────────────────────────────
# Rights (Sprint 1.3 / 2.1)
# ─────────────────────────────────────────────────────────────────────

RightsRequestType = Literal["erasure", "access", "correction", "nomination"]
RightsRequestStatus = Literal["new", "in_progress", "completed", "rejected"]
RightsCapturedVia = Literal[
    "portal", "api", "kiosk", "branch", "call_center", "mobile_app", "email", "other"
]


class RightsRequestCreatedEnvelope(TypedDict):
    id: str
    status: RightsRequestStatus
    request_type: RightsRequestType
    captured_via: RightsCapturedVia
    identity_verified: bool
    identity_verified_by: str
    sla_deadline: str
    created_at: str


class RightsRequestItem(TypedDict):
    id: str
    request_type: RightsRequestType
    requestor_name: str
    requestor_email: str
    status: RightsRequestStatus
    captured_via: RightsCapturedVia
    identity_verified: bool
    identity_verified_at: Optional[str]
    identity_method: Optional[str]
    sla_deadline: str
    response_sent_at: Optional[str]
    created_by_api_key_id: Optional[str]
    created_at: str
    updated_at: str


class RightsRequestListEnvelope(TypedDict):
    items: List[RightsRequestItem]
    next_cursor: Optional[str]


# ─────────────────────────────────────────────────────────────────────
# Audit (Sprint 1.3 / 2.1)
# ─────────────────────────────────────────────────────────────────────

class AuditLogItem(TypedDict):
    id: str
    actor_id: Optional[str]
    actor_email: Optional[str]
    event_type: str
    entity_type: Optional[str]
    entity_id: Optional[str]
    payload: object
    created_at: str


class AuditLogEnvelope(TypedDict):
    items: List[AuditLogItem]
    next_cursor: Optional[str]


__all__ = [
    "VerifyStatus",
    "IdentifierType",
    "VerifyEnvelope",
    "VerifyBatchResultRow",
    "VerifyBatchEnvelope",
    "OpenFailureCause",
    "OpenFailureEnvelope",
    "VerifyOutcome",
    "VerifyBatchOutcome",
    "RecordedArtefact",
    "RecordEnvelope",
    "RevokeActorType",
    "RevokeEnvelope",
    "ArtefactListItem",
    "ArtefactListEnvelope",
    "ArtefactRevocation",
    "ArtefactDetail",
    "EventListItem",
    "EventListEnvelope",
    "DeletionReason",
    "DeletionActorType",
    "DeletionTriggerEnvelope",
    "DeletionReceiptRow",
    "DeletionReceiptsEnvelope",
    "RightsRequestType",
    "RightsRequestStatus",
    "RightsCapturedVia",
    "RightsRequestCreatedEnvelope",
    "RightsRequestItem",
    "RightsRequestListEnvelope",
    "AuditLogItem",
    "AuditLogEnvelope",
]
