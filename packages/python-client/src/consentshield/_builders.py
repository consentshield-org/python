"""ADR-1006 Phase 2 Sprint 2.1 — request builders + validation helpers.

Each public method on ``ConsentShieldClient`` / ``AsyncConsentShieldClient``
delegates to one of these ``build_*`` functions to:

  1. Run synchronous input validation (raises ``TypeError`` /
     ``ValueError`` BEFORE any network call).
  2. Construct the snake_case body / query string at the network
     boundary.
  3. Return an ``HttpRequest`` ready for ``http.request(req)``.

Keeping the build logic out of the client classes means the sync +
async clients share 100% of the validation + body-shape code; only
the ``await`` differs.
"""

from __future__ import annotations

from typing import (
    Any,
    Iterable,
    List,
    Mapping,
    Optional,
)

from ._http import HttpRequest

# ─────────────────────────────────────────────────────────────────────
# Validation helpers
# ─────────────────────────────────────────────────────────────────────


def _require_str(value: object, name: str) -> str:
    if not isinstance(value, str) or value == "":
        raise TypeError(
            f"consentshield: {name} is required and must be a non-empty string"
        )
    return value


def _require_str_list(values: object, name: str) -> List[str]:
    if not isinstance(values, list):
        raise TypeError(f"consentshield: {name} must be a list")
    out: List[str] = []
    for i, v in enumerate(values):
        if not isinstance(v, str) or v == "":
            raise TypeError(
                f"consentshield: {name}[{i}] must be a non-empty string"
            )
        out.append(v)
    return out


def _optional_str_list(values: object, name: str) -> Optional[List[str]]:
    if values is None:
        return None
    if not isinstance(values, list):
        raise TypeError(f"consentshield: {name} must be a list when provided")
    out: List[str] = []
    for i, v in enumerate(values):
        if not isinstance(v, str):
            raise TypeError(f"consentshield: {name}[{i}] must be a string")
        out.append(v)
    return out


def _require_in(value: object, allowed: Iterable[str], name: str) -> str:
    if not isinstance(value, str) or value not in set(allowed):
        raise TypeError(
            f"consentshield: {name} must be one of: " + ", ".join(allowed)
        )
    return value


# ─────────────────────────────────────────────────────────────────────
# verify + verify_batch
# ─────────────────────────────────────────────────────────────────────

MAX_BATCH_IDENTIFIERS = 10_000


def build_verify_request(
    *,
    property_id: str,
    data_principal_identifier: str,
    identifier_type: str,
    purpose_code: str,
    trace_id: Optional[str] = None,
) -> HttpRequest:
    return HttpRequest(
        method="GET",
        path="/consent/verify",
        query={
            "property_id": _require_str(property_id, "property_id"),
            "data_principal_identifier": _require_str(
                data_principal_identifier, "data_principal_identifier"
            ),
            "identifier_type": _require_str(identifier_type, "identifier_type"),
            "purpose_code": _require_str(purpose_code, "purpose_code"),
        },
        trace_id=trace_id,
    )


def build_verify_batch_request(
    *,
    property_id: str,
    identifier_type: str,
    purpose_code: str,
    identifiers: List[str],
    trace_id: Optional[str] = None,
) -> HttpRequest:
    _require_str(property_id, "property_id")
    _require_str(identifier_type, "identifier_type")
    _require_str(purpose_code, "purpose_code")
    if not isinstance(identifiers, list):
        raise TypeError("consentshield: identifiers must be a list")
    if len(identifiers) == 0:
        raise ValueError("consentshield: identifiers must be non-empty")
    if len(identifiers) > MAX_BATCH_IDENTIFIERS:
        raise ValueError(
            f"consentshield: identifiers length {len(identifiers)} exceeds "
            f"limit {MAX_BATCH_IDENTIFIERS}"
        )
    for i, v in enumerate(identifiers):
        if not isinstance(v, str) or v == "":
            raise TypeError(
                f"consentshield: identifiers[{i}] must be a non-empty string"
            )
    return HttpRequest(
        method="POST",
        path="/consent/verify/batch",
        body={
            "property_id": property_id,
            "identifier_type": identifier_type,
            "purpose_code": purpose_code,
            "identifiers": identifiers,
        },
        trace_id=trace_id,
    )


# ─────────────────────────────────────────────────────────────────────
# record + revoke
# ─────────────────────────────────────────────────────────────────────


def build_record_consent_request(
    *,
    property_id: str,
    data_principal_identifier: str,
    identifier_type: str,
    purpose_definition_ids: List[str],
    captured_at: str,
    rejected_purpose_definition_ids: Optional[List[str]] = None,
    client_request_id: Optional[str] = None,
    trace_id: Optional[str] = None,
) -> HttpRequest:
    body: dict[str, Any] = {
        "property_id": _require_str(property_id, "property_id"),
        "data_principal_identifier": _require_str(
            data_principal_identifier, "data_principal_identifier"
        ),
        "identifier_type": _require_str(identifier_type, "identifier_type"),
        "captured_at": _require_str(captured_at, "captured_at"),
    }
    accepted = _require_str_list(purpose_definition_ids, "purpose_definition_ids")
    if len(accepted) == 0:
        raise ValueError(
            "consentshield: purpose_definition_ids must be non-empty"
        )
    body["purpose_definition_ids"] = accepted
    rejected = _optional_str_list(
        rejected_purpose_definition_ids, "rejected_purpose_definition_ids"
    )
    if rejected is not None:
        body["rejected_purpose_definition_ids"] = rejected
    if client_request_id is not None:
        body["client_request_id"] = _require_str(client_request_id, "client_request_id")
    return HttpRequest(method="POST", path="/consent/record", body=body, trace_id=trace_id)


REVOKE_ACTOR_TYPES = ("user", "operator", "system")


def build_revoke_artefact_request(
    *,
    artefact_id: str,
    reason_code: str,
    actor_type: str,
    reason_notes: Optional[str] = None,
    actor_ref: Optional[str] = None,
    trace_id: Optional[str] = None,
) -> HttpRequest:
    _require_str(artefact_id, "artefact_id")
    _require_str(reason_code, "reason_code")
    _require_in(actor_type, REVOKE_ACTOR_TYPES, "actor_type")
    body: dict[str, Any] = {"reason_code": reason_code, "actor_type": actor_type}
    if reason_notes is not None:
        if not isinstance(reason_notes, str):
            raise TypeError("consentshield: reason_notes must be a string when provided")
        body["reason_notes"] = reason_notes
    if actor_ref is not None:
        if not isinstance(actor_ref, str):
            raise TypeError("consentshield: actor_ref must be a string when provided")
        body["actor_ref"] = actor_ref
    # URL-encode the path segment so artefact ids with /, #, &, ? are
    # safe — mirrors the Node SDK's defence.
    from urllib.parse import quote

    path = f"/consent/artefacts/{quote(artefact_id, safe='')}/revoke"
    return HttpRequest(method="POST", path=path, body=body, trace_id=trace_id)


# ─────────────────────────────────────────────────────────────────────
# Artefact + event + audit + receipt list builders
# ─────────────────────────────────────────────────────────────────────


def build_list_artefacts_request(
    *,
    property_id: Optional[str] = None,
    purpose_code: Optional[str] = None,
    status: Optional[str] = None,
    identifier_type: Optional[str] = None,
    cursor: Optional[str] = None,
    limit: Optional[int] = None,
    trace_id: Optional[str] = None,
) -> HttpRequest:
    return HttpRequest(
        method="GET",
        path="/consent/artefacts",
        query={
            "property_id": property_id,
            "purpose_code": purpose_code,
            "status": status,
            "identifier_type": identifier_type,
            "cursor": cursor,
            "limit": limit,
        },
        trace_id=trace_id,
    )


def build_get_artefact_request(
    *, artefact_id: str, trace_id: Optional[str] = None
) -> HttpRequest:
    _require_str(artefact_id, "artefact_id")
    from urllib.parse import quote

    return HttpRequest(
        method="GET",
        path=f"/consent/artefacts/{quote(artefact_id, safe='')}",
        trace_id=trace_id,
    )


def build_list_events_request(
    *,
    property_id: Optional[str] = None,
    source: Optional[str] = None,
    event_type: Optional[str] = None,
    identifier_type: Optional[str] = None,
    created_after: Optional[str] = None,
    created_before: Optional[str] = None,
    cursor: Optional[str] = None,
    limit: Optional[int] = None,
    trace_id: Optional[str] = None,
) -> HttpRequest:
    return HttpRequest(
        method="GET",
        path="/consent/events",
        query={
            "property_id": property_id,
            "source": source,
            "event_type": event_type,
            "identifier_type": identifier_type,
            "created_after": created_after,
            "created_before": created_before,
            "cursor": cursor,
            "limit": limit,
        },
        trace_id=trace_id,
    )


def build_list_audit_log_request(
    *,
    event_type: Optional[str] = None,
    entity_type: Optional[str] = None,
    created_after: Optional[str] = None,
    created_before: Optional[str] = None,
    cursor: Optional[str] = None,
    limit: Optional[int] = None,
    trace_id: Optional[str] = None,
) -> HttpRequest:
    return HttpRequest(
        method="GET",
        path="/audit",
        query={
            "event_type": event_type,
            "entity_type": entity_type,
            "created_after": created_after,
            "created_before": created_before,
            "cursor": cursor,
            "limit": limit,
        },
        trace_id=trace_id,
    )


def build_list_deletion_receipts_request(
    *,
    trigger_type: Optional[str] = None,
    status: Optional[str] = None,
    connector_id: Optional[str] = None,
    created_after: Optional[str] = None,
    created_before: Optional[str] = None,
    cursor: Optional[str] = None,
    limit: Optional[int] = None,
    trace_id: Optional[str] = None,
) -> HttpRequest:
    return HttpRequest(
        method="GET",
        path="/deletion/receipts",
        query={
            "trigger_type": trigger_type,
            "status": status,
            "connector_id": connector_id,
            "created_after": created_after,
            "created_before": created_before,
            "cursor": cursor,
            "limit": limit,
        },
        trace_id=trace_id,
    )


# ─────────────────────────────────────────────────────────────────────
# Trigger deletion
# ─────────────────────────────────────────────────────────────────────

DELETION_REASONS = ("consent_revoked", "erasure_request", "retention_expired")
DELETION_ACTOR_TYPES = ("user", "operator", "system")


def build_trigger_deletion_request(
    *,
    property_id: str,
    data_principal_identifier: str,
    identifier_type: str,
    reason: str,
    purpose_codes: Optional[List[str]] = None,
    scope_override: Optional[List[str]] = None,
    actor_type: Optional[str] = None,
    actor_ref: Optional[str] = None,
    trace_id: Optional[str] = None,
) -> HttpRequest:
    body: dict[str, Any] = {
        "property_id": _require_str(property_id, "property_id"),
        "data_principal_identifier": _require_str(
            data_principal_identifier, "data_principal_identifier"
        ),
        "identifier_type": _require_str(identifier_type, "identifier_type"),
        "reason": _require_in(reason, DELETION_REASONS, "reason"),
    }
    if purpose_codes is not None:
        body["purpose_codes"] = _require_str_list(purpose_codes, "purpose_codes")
    if reason == "consent_revoked":
        if not body.get("purpose_codes"):
            raise TypeError(
                "consentshield: purpose_codes is required when "
                "reason='consent_revoked'"
            )
    if scope_override is not None:
        if not isinstance(scope_override, list):
            raise TypeError("consentshield: scope_override must be a list")
        body["scope_override"] = scope_override
    if actor_type is not None:
        body["actor_type"] = _require_in(actor_type, DELETION_ACTOR_TYPES, "actor_type")
    if actor_ref is not None:
        if not isinstance(actor_ref, str):
            raise TypeError("consentshield: actor_ref must be a string when provided")
        body["actor_ref"] = actor_ref
    return HttpRequest(method="POST", path="/deletion/trigger", body=body, trace_id=trace_id)


# ─────────────────────────────────────────────────────────────────────
# Rights
# ─────────────────────────────────────────────────────────────────────

RIGHTS_TYPES = ("erasure", "access", "correction", "nomination")
RIGHTS_STATUSES = ("new", "in_progress", "completed", "rejected")
RIGHTS_CAPTURED_VIA = (
    "portal", "api", "kiosk", "branch", "call_center", "mobile_app", "email", "other",
)


def build_create_rights_request_request(
    *,
    type: str,
    requestor_name: str,
    requestor_email: str,
    identity_verified_by: str,
    request_details: Optional[str] = None,
    captured_via: Optional[str] = None,
    trace_id: Optional[str] = None,
) -> HttpRequest:
    body: dict[str, Any] = {
        "type": _require_in(type, RIGHTS_TYPES, "type"),
        "requestor_name": _require_str(requestor_name, "requestor_name"),
        "requestor_email": _require_str(requestor_email, "requestor_email"),
        "identity_verified_by": _require_str(
            identity_verified_by, "identity_verified_by"
        ),
    }
    if request_details is not None:
        if not isinstance(request_details, str):
            raise TypeError(
                "consentshield: request_details must be a string when provided"
            )
        body["request_details"] = request_details
    if captured_via is not None:
        body["captured_via"] = _require_in(
            captured_via, RIGHTS_CAPTURED_VIA, "captured_via"
        )
    return HttpRequest(
        method="POST", path="/rights/requests", body=body, trace_id=trace_id
    )


def build_list_rights_requests_request(
    *,
    status: Optional[str] = None,
    request_type: Optional[str] = None,
    captured_via: Optional[str] = None,
    created_after: Optional[str] = None,
    created_before: Optional[str] = None,
    cursor: Optional[str] = None,
    limit: Optional[int] = None,
    trace_id: Optional[str] = None,
) -> HttpRequest:
    if status is not None:
        _require_in(status, RIGHTS_STATUSES, "status")
    if request_type is not None:
        _require_in(request_type, RIGHTS_TYPES, "request_type")
    if captured_via is not None:
        _require_in(captured_via, RIGHTS_CAPTURED_VIA, "captured_via")
    return HttpRequest(
        method="GET",
        path="/rights/requests",
        query={
            "status": status,
            "request_type": request_type,
            "captured_via": captured_via,
            "created_after": created_after,
            "created_before": created_before,
            "cursor": cursor,
            "limit": limit,
        },
        trace_id=trace_id,
    )


__all__ = [
    "MAX_BATCH_IDENTIFIERS",
    "REVOKE_ACTOR_TYPES",
    "DELETION_REASONS",
    "DELETION_ACTOR_TYPES",
    "RIGHTS_TYPES",
    "RIGHTS_STATUSES",
    "RIGHTS_CAPTURED_VIA",
    "build_verify_request",
    "build_verify_batch_request",
    "build_record_consent_request",
    "build_revoke_artefact_request",
    "build_list_artefacts_request",
    "build_get_artefact_request",
    "build_list_events_request",
    "build_list_audit_log_request",
    "build_list_deletion_receipts_request",
    "build_trigger_deletion_request",
    "build_create_rights_request_request",
    "build_list_rights_requests_request",
]
