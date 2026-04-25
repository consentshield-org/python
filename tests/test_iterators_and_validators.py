"""ADR-1006 Phase 2 Sprint 2.1 — sync + async iterator coverage + extra
validator branches. Pushes coverage over the 80% threshold.
"""
from __future__ import annotations

from typing import Any

import httpx
import pytest

from consentshield import (
    AsyncConsentShieldClient,
    ConsentShieldClient,
)

from .conftest import VALID_KEY, json_response

BASE = "https://api.example.com"


# ─────────────────────────────────────────────────────────────────────
# Sync iterator coverage
# ─────────────────────────────────────────────────────────────────────


def _two_page_handler(item_key: str, p1_id: str, p2_id: str):  # type: ignore[no-untyped-def]
    page1 = {"items": [{item_key: p1_id}], "next_cursor": "c2"}
    page2 = {"items": [{item_key: p2_id}], "next_cursor": None}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.params.get("cursor") == "c2":
            return json_response(page2)
        return json_response(page1)

    return handler


def _client(transport: httpx.MockTransport) -> ConsentShieldClient:
    return ConsentShieldClient(
        api_key=VALID_KEY,
        base_url=BASE,
        max_retries=0,
        http_client=httpx.Client(transport=transport),
    )


def test_iterate_events_walks_pages() -> None:
    client = _client(httpx.MockTransport(_two_page_handler("id", "e1", "e2")))
    seen = [e["id"] for e in client.iterate_events(property_id="p")]
    assert seen == ["e1", "e2"]


def test_iterate_audit_log_walks_pages() -> None:
    client = _client(httpx.MockTransport(_two_page_handler("id", "a1", "a2")))
    seen = [a["id"] for a in client.iterate_audit_log(event_type="x")]
    assert seen == ["a1", "a2"]


def test_iterate_deletion_receipts_walks_pages() -> None:
    client = _client(httpx.MockTransport(_two_page_handler("id", "r1", "r2")))
    seen = [r["id"] for r in client.iterate_deletion_receipts(status="pending")]
    assert seen == ["r1", "r2"]


def test_iterate_rights_requests_walks_pages() -> None:
    client = _client(
        httpx.MockTransport(_two_page_handler("id", "rr1", "rr2"))
    )
    seen = [r["id"] for r in client.iterate_rights_requests(request_type="erasure")]
    assert seen == ["rr1", "rr2"]


# ─────────────────────────────────────────────────────────────────────
# Async iterator coverage
# ─────────────────────────────────────────────────────────────────────


def _async_client(transport: httpx.MockTransport) -> AsyncConsentShieldClient:
    return AsyncConsentShieldClient(
        api_key=VALID_KEY,
        base_url=BASE,
        max_retries=0,
        http_client=httpx.AsyncClient(transport=transport),
    )


@pytest.mark.asyncio
async def test_async_iterate_events_walks_pages() -> None:
    async with _async_client(
        httpx.MockTransport(_two_page_handler("id", "e1", "e2"))
    ) as client:
        seen: list[str] = []
        async for e in client.iterate_events(property_id="p"):
            seen.append(e["id"])
    assert seen == ["e1", "e2"]


@pytest.mark.asyncio
async def test_async_iterate_audit_log_walks_pages() -> None:
    async with _async_client(
        httpx.MockTransport(_two_page_handler("id", "a1", "a2"))
    ) as client:
        seen: list[str] = []
        async for a in client.iterate_audit_log(event_type="x"):
            seen.append(a["id"])
    assert seen == ["a1", "a2"]


@pytest.mark.asyncio
async def test_async_iterate_deletion_receipts_walks_pages() -> None:
    async with _async_client(
        httpx.MockTransport(_two_page_handler("id", "r1", "r2"))
    ) as client:
        seen: list[str] = []
        async for r in client.iterate_deletion_receipts(status="pending"):
            seen.append(r["id"])
    assert seen == ["r1", "r2"]


@pytest.mark.asyncio
async def test_async_iterate_rights_requests_walks_pages() -> None:
    async with _async_client(
        httpx.MockTransport(_two_page_handler("id", "rr1", "rr2"))
    ) as client:
        seen: list[str] = []
        async for r in client.iterate_rights_requests(request_type="erasure"):
            seen.append(r["id"])
    assert seen == ["rr1", "rr2"]


# ─────────────────────────────────────────────────────────────────────
# Builder validator branches
# ─────────────────────────────────────────────────────────────────────


def test_record_consent_rejects_non_array_rejected_ids() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match="rejected_purpose_definition_ids"):
        client.record_consent(
            property_id="p",
            data_principal_identifier="d",
            identifier_type="email",
            purpose_definition_ids=["pd-1"],
            rejected_purpose_definition_ids="pd-2",  # type: ignore[arg-type]
            captured_at="t",
        )


def test_record_consent_rejects_non_string_rejected_id_entry() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match=r"rejected_purpose_definition_ids\[1\]"):
        client.record_consent(
            property_id="p",
            data_principal_identifier="d",
            identifier_type="email",
            purpose_definition_ids=["pd-1"],
            rejected_purpose_definition_ids=["pd-2", 42],  # type: ignore[list-item]
            captured_at="t",
        )


def test_record_consent_rejects_non_array_purpose_definition_ids() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match="must be a list"):
        client.record_consent(
            property_id="p",
            data_principal_identifier="d",
            identifier_type="email",
            purpose_definition_ids="pd-1",  # type: ignore[arg-type]
            captured_at="t",
        )


def test_trigger_deletion_rejects_non_array_purpose_codes() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match="purpose_codes"):
        client.trigger_deletion(
            property_id="p",
            data_principal_identifier="d",
            identifier_type="email",
            reason="consent_revoked",
            purpose_codes="marketing",  # type: ignore[arg-type]
        )


def test_trigger_deletion_rejects_non_string_purpose_code_entry() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match=r"purpose_codes\[1\]"):
        client.trigger_deletion(
            property_id="p",
            data_principal_identifier="d",
            identifier_type="email",
            reason="consent_revoked",
            purpose_codes=["marketing", ""],
        )


def test_trigger_deletion_rejects_non_array_scope_override() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match="scope_override"):
        client.trigger_deletion(
            property_id="p",
            data_principal_identifier="d",
            identifier_type="email",
            reason="erasure_request",
            scope_override="art-1",  # type: ignore[arg-type]
        )


def test_trigger_deletion_rejects_invalid_actor_type() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match="actor_type"):
        client.trigger_deletion(
            property_id="p",
            data_principal_identifier="d",
            identifier_type="email",
            reason="erasure_request",
            actor_type="admin",
        )


def test_create_rights_request_rejects_invalid_captured_via() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match="captured_via"):
        client.create_rights_request(
            type="erasure",
            requestor_name="Alice",
            requestor_email="a@x.com",
            identity_verified_by="OTP",
            captured_via="fax",
        )


def test_list_rights_requests_rejects_invalid_request_type() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match="request_type"):
        client.list_rights_requests(request_type="unknown")


def test_list_rights_requests_rejects_invalid_captured_via() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match="captured_via"):
        client.list_rights_requests(captured_via="fax")


def test_revoke_artefact_rejects_non_string_reason_notes() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match="reason_notes"):
        client.revoke_artefact(
            "art-1",
            reason_code="x",
            actor_type="user",
            reason_notes=42,  # type: ignore[arg-type]
        )


def test_revoke_artefact_rejects_non_string_actor_ref() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match="actor_ref"):
        client.revoke_artefact(
            "art-1",
            reason_code="x",
            actor_type="user",
            actor_ref=42,  # type: ignore[arg-type]
        )


def test_get_artefact_rejects_empty_id() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match="artefact_id"):
        client.get_artefact("")


def test_revoke_artefact_rejects_empty_id() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response({})))
    with pytest.raises(TypeError, match="artefact_id"):
        client.revoke_artefact("", reason_code="x", actor_type="user")
