"""ADR-1006 Phase 2 Sprint 2.1 — verify_batch() compliance behaviour."""
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

BASE_KW: dict[str, Any] = {
    "property_id": PROPERTY_ID,
    "identifier_type": "email",
    "purpose_code": "marketing",
    "identifiers": ["a@x.com", "b@x.com", "c@x.com"],
}

SAMPLE: dict[str, Any] = {
    "property_id": PROPERTY_ID,
    "identifier_type": "email",
    "purpose_code": "marketing",
    "evaluated_at": "2026-04-25T10:00:00.000Z",
    "results": [
        {"identifier": "a@x.com", "status": "granted", "active_artefact_id": "aid-a", "revoked_at": None, "revocation_record_id": None, "expires_at": None},
        {"identifier": "b@x.com", "status": "revoked", "active_artefact_id": None, "revoked_at": "2026-04-01T00:00:00Z", "revocation_record_id": "rev-b", "expires_at": None},
        {"identifier": "c@x.com", "status": "never_consented", "active_artefact_id": None, "revoked_at": None, "revocation_record_id": None, "expires_at": None},
    ],
}


def _client(transport: httpx.MockTransport, *, fail_open: bool = False) -> ConsentShieldClient:
    return ConsentShieldClient(
        api_key=VALID_KEY,
        base_url=BASE,
        max_retries=0,
        fail_open=fail_open,
        http_client=httpx.Client(transport=transport),
    )


def test_posts_snake_case_body_and_returns_envelope() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["method"] = request.method
        captured["body"] = request.content
        return json_response(SAMPLE)

    client = _client(httpx.MockTransport(handler))
    result = client.verify_batch(**BASE_KW)
    assert result == SAMPLE
    assert captured["url"] == "https://api.example.com/v1/consent/verify/batch"
    assert captured["method"] == "POST"
    import json as _json
    assert _json.loads(captured["body"]) == {
        "property_id": PROPERTY_ID,
        "identifier_type": "email",
        "purpose_code": "marketing",
        "identifiers": ["a@x.com", "b@x.com", "c@x.com"],
    }


def test_preserves_input_order_in_results() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return json_response(SAMPLE)

    client = _client(httpx.MockTransport(handler))
    result = client.verify_batch(**BASE_KW)
    assert not is_open_failure(result)
    assert [r["identifier"] for r in result["results"]] == ["a@x.com", "b@x.com", "c@x.com"]  # type: ignore[index]


# ─────────────────────────────────────────────────────────────────────
# Client-side gates fire BEFORE network
# ─────────────────────────────────────────────────────────────────────


def test_empty_identifiers_raises_value_error_synchronously() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return json_response(SAMPLE)

    client = _client(httpx.MockTransport(handler))
    with pytest.raises(ValueError, match="non-empty"):
        client.verify_batch(**{**BASE_KW, "identifiers": []})
    assert calls == 0


def test_more_than_10000_raises_value_error_synchronously() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return json_response(SAMPLE)

    client = _client(httpx.MockTransport(handler))
    too_many = [f"id-{i}@x.com" for i in range(10_001)]
    with pytest.raises(ValueError, match="exceeds limit 10000"):
        client.verify_batch(**{**BASE_KW, "identifiers": too_many})
    assert calls == 0


def test_exactly_10000_allowed_at_boundary() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return json_response(SAMPLE)

    client = _client(httpx.MockTransport(handler))
    at_limit = [f"id-{i}@x.com" for i in range(10_000)]
    client.verify_batch(**{**BASE_KW, "identifiers": at_limit})
    assert calls == 1


def test_non_list_identifiers_raises_type_error() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response(SAMPLE)))
    with pytest.raises(TypeError, match="must be a list"):
        client.verify_batch(**{**BASE_KW, "identifiers": "not-a-list"})  # type: ignore[arg-type]


def test_non_string_entry_raises_type_error() -> None:
    client = _client(httpx.MockTransport(lambda _r: json_response(SAMPLE)))
    with pytest.raises(TypeError, match=r"identifiers\[1\]"):
        client.verify_batch(**{**BASE_KW, "identifiers": ["a@x.com", 42, "c@x.com"]})  # type: ignore[list-item]


# ─────────────────────────────────────────────────────────────────────
# Fail-CLOSED + fail-OPEN + 4xx-always-raises
# ─────────────────────────────────────────────────────────────────────


def test_fail_closed_raises_consent_verify_error_on_5xx() -> None:
    def handler(_r: httpx.Request) -> httpx.Response:
        return problem_response(503, "down", "eek")

    client = _client(httpx.MockTransport(handler))
    with pytest.raises(ConsentVerifyError):
        client.verify_batch(**BASE_KW)


def test_fail_open_returns_envelope_on_5xx() -> None:
    def handler(_r: httpx.Request) -> httpx.Response:
        return problem_response(503, "down", "eek")

    client = _client(httpx.MockTransport(handler), fail_open=True)
    result = client.verify_batch(**BASE_KW)
    assert is_open_failure(result)
    assert result["cause"] == "server_error"  # type: ignore[index]


@pytest.mark.parametrize("status", [422, 413])
def test_4xx_always_raises_even_when_fail_open_true(status: int) -> None:
    def handler(_r: httpx.Request) -> httpx.Response:
        return problem_response(status, "x", "y")

    client = _client(httpx.MockTransport(handler), fail_open=True)
    with pytest.raises(ConsentShieldApiError):
        client.verify_batch(**BASE_KW)
