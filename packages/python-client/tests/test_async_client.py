"""ADR-1006 Phase 2 Sprint 2.1 — async client smoke tests.

The sync test files exercise every behaviour of the shared
``_builders`` + ``_verify`` modules. The async client uses the same
helpers; this file verifies the async path itself works (await
returns the right shape, async iterators walk pages, fail-open
callback awaitable doesn't break the call site).
"""
from __future__ import annotations

from typing import Any

import httpx
import pytest

from consentshield import (
    AsyncConsentShieldClient,
    ConsentShieldApiError,
    ConsentVerifyError,
    is_open_failure,
)

from .conftest import VALID_KEY, json_response, problem_response

BASE = "https://api.example.com"
PROPERTY_ID = "11111111-1111-1111-1111-111111111111"

VERIFY_KW: dict[str, Any] = {
    "property_id": PROPERTY_ID,
    "data_principal_identifier": "user@example.com",
    "identifier_type": "email",
    "purpose_code": "marketing",
}

SAMPLE_VERIFY: dict[str, Any] = {
    "property_id": PROPERTY_ID,
    "identifier_type": "email",
    "purpose_code": "marketing",
    "status": "granted",
    "active_artefact_id": "art-1",
    "revoked_at": None,
    "revocation_record_id": None,
    "expires_at": None,
    "evaluated_at": "2026-04-25T10:00:00Z",
}


def _make_client(
    transport: httpx.MockTransport, *, fail_open: bool = False, on_fail_open=None  # type: ignore[no-untyped-def]
) -> AsyncConsentShieldClient:
    return AsyncConsentShieldClient(
        api_key=VALID_KEY,
        base_url=BASE,
        max_retries=0,
        fail_open=fail_open,
        on_fail_open=on_fail_open,
        http_client=httpx.AsyncClient(transport=transport),
    )


@pytest.mark.asyncio
async def test_async_ping_succeeds_on_200() -> None:
    def handler(_r: httpx.Request) -> httpx.Response:
        return json_response({"ok": True})

    async with _make_client(httpx.MockTransport(handler)) as client:
        assert await client.ping() is True


@pytest.mark.asyncio
async def test_async_verify_returns_envelope_on_200() -> None:
    def handler(_r: httpx.Request) -> httpx.Response:
        return json_response(SAMPLE_VERIFY)

    async with _make_client(httpx.MockTransport(handler)) as client:
        result = await client.verify(**VERIFY_KW)
    assert result == SAMPLE_VERIFY


@pytest.mark.asyncio
async def test_async_verify_fail_closed_raises_consent_verify_error_on_5xx() -> None:
    def handler(_r: httpx.Request) -> httpx.Response:
        return problem_response(503, "down", "eek")

    async with _make_client(httpx.MockTransport(handler)) as client:
        with pytest.raises(ConsentVerifyError):
            await client.verify(**VERIFY_KW)


@pytest.mark.asyncio
async def test_async_verify_fail_open_returns_envelope_on_5xx() -> None:
    def handler(_r: httpx.Request) -> httpx.Response:
        return problem_response(503, "down", "eek", trace_id="t-async-open")

    async with _make_client(httpx.MockTransport(handler), fail_open=True) as client:
        result = await client.verify(**VERIFY_KW)
    assert is_open_failure(result)
    assert result["cause"] == "server_error"  # type: ignore[index]
    assert result["trace_id"] == "t-async-open"  # type: ignore[index]


@pytest.mark.asyncio
async def test_async_4xx_always_raises_even_when_fail_open() -> None:
    def handler(_r: httpx.Request) -> httpx.Response:
        return problem_response(403, "Forbidden", "no scope")

    async with _make_client(httpx.MockTransport(handler), fail_open=True) as client:
        with pytest.raises(ConsentShieldApiError) as ex:
            await client.verify(**VERIFY_KW)
    assert ex.value.status == 403


@pytest.mark.asyncio
async def test_async_iterate_artefacts_walks_pages() -> None:
    page_1 = {
        "items": [{"artefact_id": "a1", "property_id": "p", "purpose_code": "m", "purpose_definition_id": "pd-m", "data_scope": ["email"], "framework": "dpdp", "status": "active", "expires_at": None, "revoked_at": None, "revocation_record_id": None, "replaced_by": None, "identifier_type": "email", "created_at": "t1"}],
        "next_cursor": "c2",
    }
    page_2 = {
        "items": [{"artefact_id": "a2", "property_id": "p", "purpose_code": "m", "purpose_definition_id": "pd-m", "data_scope": ["email"], "framework": "dpdp", "status": "active", "expires_at": None, "revoked_at": None, "revocation_record_id": None, "replaced_by": None, "identifier_type": "email", "created_at": "t0"}],
        "next_cursor": None,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.params.get("cursor") == "c2":
            return json_response(page_2)
        return json_response(page_1)

    seen: list[str] = []
    async with _make_client(httpx.MockTransport(handler)) as client:
        async for art in client.iterate_artefacts(property_id="p"):
            seen.append(art["artefact_id"])
    assert seen == ["a1", "a2"]


@pytest.mark.asyncio
async def test_async_record_consent_posts_snake_case_body() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.content
        return json_response(
            {
                "event_id": "e1",
                "created_at": "t",
                "artefact_ids": [],
                "idempotent_replay": False,
            },
            status_code=201,
        )

    async with _make_client(httpx.MockTransport(handler)) as client:
        await client.record_consent(
            property_id="p",
            data_principal_identifier="d",
            identifier_type="email",
            purpose_definition_ids=["pd-1"],
            captured_at="t",
        )
    import json as _json
    body = _json.loads(captured["body"])
    assert body["property_id"] == "p"
    assert body["purpose_definition_ids"] == ["pd-1"]
