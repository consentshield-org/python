"""ADR-1006 Phase 2 Sprint 2.1 — record/revoke/CRUD method coverage.

Pooled file (mirrors the Node SDK's methods.test.ts) — each method's
shape is small + the pattern is identical (snake_case body/query at
boundary, 4xx surfaces ConsentShieldApiError, query strings skip
None values). Method-specific edge cases get their own test.
"""
from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from consentshield import ConsentShieldApiError, ConsentShieldClient

from .conftest import VALID_KEY, json_response, problem_response

BASE = "https://api.example.com"


def _client(transport: httpx.MockTransport) -> ConsentShieldClient:
    return ConsentShieldClient(
        api_key=VALID_KEY,
        base_url=BASE,
        max_retries=0,
        http_client=httpx.Client(transport=transport),
    )


# ─────────────────────────────────────────────────────────────────────
# record_consent
# ─────────────────────────────────────────────────────────────────────

RECORD_SAMPLE: dict[str, Any] = {
    "event_id": "evt-1",
    "created_at": "2026-04-25T10:00:00Z",
    "artefact_ids": [
        {"purpose_definition_id": "pd-1", "purpose_code": "marketing", "artefact_id": "art-1", "status": "active"}
    ],
    "idempotent_replay": False,
}


def test_record_consent_posts_snake_case_body() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = request.content
        return json_response(RECORD_SAMPLE, status_code=201)

    client = _client(httpx.MockTransport(handler))
    result = client.record_consent(
        property_id="prop-1",
        data_principal_identifier="user@x.com",
        identifier_type="email",
        purpose_definition_ids=["pd-1"],
        captured_at="2026-04-25T10:00:00Z",
        client_request_id="req-abc",
    )
    assert result == RECORD_SAMPLE
    assert captured["url"] == "https://api.example.com/v1/consent/record"
    body = json.loads(captured["body"])
    assert body == {
        "property_id": "prop-1",
        "data_principal_identifier": "user@x.com",
        "identifier_type": "email",
        "captured_at": "2026-04-25T10:00:00Z",
        "purpose_definition_ids": ["pd-1"],
        "client_request_id": "req-abc",
    }


def test_record_consent_omits_optional_fields_when_not_provided() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return json_response(RECORD_SAMPLE, status_code=201)

    client = _client(httpx.MockTransport(handler))
    client.record_consent(
        property_id="p",
        data_principal_identifier="u@x.com",
        identifier_type="email",
        purpose_definition_ids=["pd-1"],
        captured_at="t",
    )
    assert sorted(captured["body"].keys()) == [
        "captured_at",
        "data_principal_identifier",
        "identifier_type",
        "property_id",
        "purpose_definition_ids",
    ]


def test_record_consent_rejects_empty_purpose_definition_ids_synchronously() -> None:
    calls = 0

    def handler(_r: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return json_response(RECORD_SAMPLE)

    client = _client(httpx.MockTransport(handler))
    with pytest.raises(ValueError, match="non-empty"):
        client.record_consent(
            property_id="p",
            data_principal_identifier="d",
            identifier_type="email",
            purpose_definition_ids=[],
            captured_at="t",
        )
    assert calls == 0


def test_record_consent_forwards_rejected_purpose_definition_ids() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return json_response(RECORD_SAMPLE, status_code=201)

    client = _client(httpx.MockTransport(handler))
    client.record_consent(
        property_id="p",
        data_principal_identifier="d",
        identifier_type="email",
        purpose_definition_ids=["pd-1"],
        rejected_purpose_definition_ids=["pd-2", "pd-3"],
        captured_at="t",
    )
    assert captured["body"]["rejected_purpose_definition_ids"] == ["pd-2", "pd-3"]


# ─────────────────────────────────────────────────────────────────────
# revoke_artefact
# ─────────────────────────────────────────────────────────────────────

REVOKE_SAMPLE: dict[str, Any] = {
    "artefact_id": "art-1",
    "status": "revoked",
    "revocation_record_id": "rev-1",
    "idempotent_replay": False,
}


def test_revoke_artefact_posts_to_url_encoded_path() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        return json_response(REVOKE_SAMPLE)

    client = _client(httpx.MockTransport(handler))
    client.revoke_artefact(
        "with/slashes#and&special",
        reason_code="user_request",
        actor_type="user",
    )
    assert captured["url"] == (
        "https://api.example.com/v1/consent/artefacts/"
        "with%2Fslashes%23and%26special/revoke"
    )
    assert captured["body"] == {"reason_code": "user_request", "actor_type": "user"}


def test_revoke_artefact_rejects_invalid_actor_type_synchronously() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response(REVOKE_SAMPLE)))
    with pytest.raises(TypeError, match="actor_type"):
        client.revoke_artefact("art-1", reason_code="x", actor_type="admin")


def test_revoke_artefact_surfaces_409_as_api_error() -> None:
    def handler(_r: httpx.Request) -> httpx.Response:
        return problem_response(409, "Conflict", "already revoked")

    client = _client(httpx.MockTransport(handler))
    with pytest.raises(ConsentShieldApiError) as ex:
        client.revoke_artefact("art-1", reason_code="x", actor_type="user")
    assert ex.value.status == 409


# ─────────────────────────────────────────────────────────────────────
# list + iterate artefacts
# ─────────────────────────────────────────────────────────────────────

ARTEFACT_PAGE_1: dict[str, Any] = {
    "items": [
        {"artefact_id": "a1", "property_id": "p", "purpose_code": "m", "purpose_definition_id": "pd-m", "data_scope": ["email"], "framework": "dpdp", "status": "active", "expires_at": None, "revoked_at": None, "revocation_record_id": None, "replaced_by": None, "identifier_type": "email", "created_at": "2026-04-25T10:00:00Z"},
    ],
    "next_cursor": "cursor-2",
}
ARTEFACT_PAGE_2: dict[str, Any] = {
    "items": [
        {"artefact_id": "a2", "property_id": "p", "purpose_code": "m", "purpose_definition_id": "pd-m", "data_scope": ["email"], "framework": "dpdp", "status": "active", "expires_at": None, "revoked_at": None, "revocation_record_id": None, "replaced_by": None, "identifier_type": "email", "created_at": "2026-04-25T09:00:00Z"},
    ],
    "next_cursor": None,
}


def test_iterate_artefacts_walks_pages() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.params.get("cursor") == "cursor-2":
            return json_response(ARTEFACT_PAGE_2)
        return json_response(ARTEFACT_PAGE_1)

    client = _client(httpx.MockTransport(handler))
    seen = [a["artefact_id"] for a in client.iterate_artefacts(property_id="p")]
    assert seen == ["a1", "a2"]


def test_get_artefact_returns_none_on_json_null_body() -> None:
    def handler(_r: httpx.Request) -> httpx.Response:
        return json_response(None)

    client = _client(httpx.MockTransport(handler))
    assert client.get_artefact("missing") is None


def test_get_artefact_url_encodes_id() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return json_response(None)

    client = _client(httpx.MockTransport(handler))
    client.get_artefact("id with/special?")
    assert captured["url"] == "https://api.example.com/v1/consent/artefacts/id%20with%2Fspecial%3F"


# ─────────────────────────────────────────────────────────────────────
# trigger_deletion
# ─────────────────────────────────────────────────────────────────────


def test_trigger_deletion_requires_purpose_codes_for_consent_revoked() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match="purpose_codes"):
        client.trigger_deletion(
            property_id="p",
            data_principal_identifier="d",
            identifier_type="email",
            reason="consent_revoked",
        )


def test_trigger_deletion_allows_erasure_request_without_purpose_codes() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return json_response(
            {
                "reason": "erasure_request",
                "revoked_artefact_ids": [],
                "revoked_count": 0,
                "initial_status": "pending",
                "note": "queued",
            }
        )

    client = _client(httpx.MockTransport(handler))
    client.trigger_deletion(
        property_id="p",
        data_principal_identifier="d",
        identifier_type="email",
        reason="erasure_request",
    )
    assert captured["body"]["reason"] == "erasure_request"


def test_trigger_deletion_rejects_invalid_reason() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match="reason"):
        client.trigger_deletion(
            property_id="p",
            data_principal_identifier="d",
            identifier_type="email",
            reason="misc",
        )


# ─────────────────────────────────────────────────────────────────────
# rights
# ─────────────────────────────────────────────────────────────────────


def test_create_rights_request_rejects_invalid_type() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match="type"):
        client.create_rights_request(
            type="lookup",
            requestor_name="Alice",
            requestor_email="alice@x.com",
            identity_verified_by="OTP",
        )


def test_list_rights_requests_rejects_invalid_status() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match="status"):
        client.list_rights_requests(status="pending")


# ─────────────────────────────────────────────────────────────────────
# audit
# ─────────────────────────────────────────────────────────────────────


def test_list_audit_log_composes_snake_case_query() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return json_response({"items": [], "next_cursor": None})

    client = _client(httpx.MockTransport(handler))
    client.list_audit_log(
        event_type="consent_recorded",
        entity_type="artefact",
        created_after="2026-04-01",
        limit=100,
    )
    url = captured["url"]
    assert "/v1/audit?" in url
    assert "event_type=consent_recorded" in url
    assert "entity_type=artefact" in url
    assert "created_after=2026-04-01" in url
    assert "limit=100" in url
