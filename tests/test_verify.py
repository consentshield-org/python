"""ADR-1006 Phase 2 Sprint 2.1 — verify() compliance behaviour (sync)."""
from __future__ import annotations

from typing import Any

import httpx
import pytest

from consentshield import (
    ConsentShieldApiError,
    ConsentShieldClient,
    ConsentVerifyError,
    is_open_failure,
)

from .conftest import VALID_KEY, json_response, problem_response

BASE = "https://api.example.com"
PROPERTY_ID = "11111111-1111-1111-1111-111111111111"

SAMPLE_ENVELOPE: dict[str, Any] = {
    "property_id": PROPERTY_ID,
    "identifier_type": "email",
    "purpose_code": "marketing",
    "status": "granted",
    "active_artefact_id": "22222222-2222-2222-2222-222222222222",
    "revoked_at": None,
    "revocation_record_id": None,
    "expires_at": None,
    "evaluated_at": "2026-04-25T10:00:00.000Z",
}

VERIFY_KW = {
    "property_id": PROPERTY_ID,
    "data_principal_identifier": "user@example.com",
    "identifier_type": "email",
    "purpose_code": "marketing",
}


def _client(transport: httpx.MockTransport, *, fail_open: bool = False) -> ConsentShieldClient:
    return ConsentShieldClient(
        api_key=VALID_KEY,
        base_url=BASE,
        max_retries=0,
        fail_open=fail_open,
        http_client=httpx.Client(transport=transport),
    )


# ─────────────────────────────────────────────────────────────────────
# Happy path
# ─────────────────────────────────────────────────────────────────────


def test_verify_returns_envelope_verbatim_on_200() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["method"] = request.method
        return json_response(SAMPLE_ENVELOPE)

    client = _client(httpx.MockTransport(handler))
    result = client.verify(**VERIFY_KW)
    assert result == SAMPLE_ENVELOPE
    assert captured["method"] == "GET"
    assert "/v1/consent/verify?" in captured["url"]
    assert "property_id=" in captured["url"]
    assert "data_principal_identifier=user%40example.com" in captured["url"]


def test_verify_forwards_caller_trace_id() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["trace"] = request.headers.get("x-cs-trace-id")
        return json_response(SAMPLE_ENVELOPE)

    client = _client(httpx.MockTransport(handler))
    client.verify(**VERIFY_KW, trace_id="caller-trace-1")
    assert captured["trace"] == "caller-trace-1"


# ─────────────────────────────────────────────────────────────────────
# Synchronous input validation
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "field",
    ["property_id", "data_principal_identifier", "identifier_type", "purpose_code"],
)
def test_verify_rejects_each_missing_required_field(field: str) -> None:
    captured: dict[str, Any] = {"calls": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        captured["calls"] += 1
        return json_response(SAMPLE_ENVELOPE)

    client = _client(httpx.MockTransport(handler))
    bad = {**VERIFY_KW, field: ""}
    with pytest.raises(TypeError, match=field):
        client.verify(**bad)
    assert captured["calls"] == 0


# ─────────────────────────────────────────────────────────────────────
# Fail-CLOSED default behaviour
# ─────────────────────────────────────────────────────────────────────


def test_fail_closed_raises_consent_verify_error_on_5xx() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return problem_response(503, "down", "eek", trace_id="trace-503")

    client = _client(httpx.MockTransport(handler))
    with pytest.raises(ConsentVerifyError) as ex:
        client.verify(**VERIFY_KW)
    assert isinstance(ex.value.cause, ConsentShieldApiError)
    assert ex.value.trace_id == "trace-503"


def test_fail_closed_raises_consent_verify_error_on_transport_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("dns down")

    client = _client(httpx.MockTransport(handler))
    with pytest.raises(ConsentVerifyError):
        client.verify(**VERIFY_KW)


# ─────────────────────────────────────────────────────────────────────
# Fail-OPEN opt-in
# ─────────────────────────────────────────────────────────────────────


def test_fail_open_returns_envelope_on_5xx() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return problem_response(503, "down", "eek", trace_id="trace-open")

    client = _client(httpx.MockTransport(handler), fail_open=True)
    result = client.verify(**VERIFY_KW)
    assert is_open_failure(result)
    assert result["status"] == "open_failure"  # type: ignore[index]
    assert result["cause"] == "server_error"  # type: ignore[index]
    assert result["trace_id"] == "trace-open"  # type: ignore[index]


def test_fail_open_envelope_on_transport_error_has_network_cause() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("dns down")

    client = _client(httpx.MockTransport(handler), fail_open=True)
    result = client.verify(**VERIFY_KW)
    assert is_open_failure(result)
    assert result["cause"] == "network"  # type: ignore[index]


def test_fail_open_envelope_on_timeout_has_timeout_cause() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timeout")

    client = _client(httpx.MockTransport(handler), fail_open=True)
    result = client.verify(**VERIFY_KW)
    assert is_open_failure(result)
    assert result["cause"] == "timeout"  # type: ignore[index]


# ─────────────────────────────────────────────────────────────────────
# 4xx-always-throws contract
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("status", [422, 403, 404])
def test_4xx_always_raises_even_when_fail_open_true(status: int) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return problem_response(status, "x", f"code-{status}")

    client = _client(httpx.MockTransport(handler), fail_open=True)
    with pytest.raises(ConsentShieldApiError) as ex:
        client.verify(**VERIFY_KW)
    assert ex.value.status == status
