"""ADR-1006 Phase 2 Sprint 2.1 — HTTP transport behaviour.

Targets the compliance-load-bearing rules:

  - 2-second default timeout fires + raises ConsentShieldTimeoutError
  - exponential-backoff retry on 5xx (kicks in 100ms / 400ms / 1600ms)
  - no retry on 4xx (failure surfaces immediately)
  - no retry on timeout (latency budget would compound)
  - Bearer header + Content-Type + JSON body marshalling
  - trace_id from response header lifted onto the response + errors
  - query-string composition skips None values
"""
from __future__ import annotations

from typing import Any

import httpx
import pytest

from consentshield import (
    ConsentShieldApiError,
    ConsentShieldNetworkError,
    ConsentShieldTimeoutError,
)
from consentshield._http import HttpClient, HttpRequest

from .conftest import VALID_KEY, json_response, problem_response

BASE = "https://api.example.com"


def _make(transport: httpx.MockTransport, *, max_retries: int = 0) -> HttpClient:
    return HttpClient(
        base_url=BASE,
        api_key=VALID_KEY,
        timeout_ms=2_000,
        max_retries=max_retries,
        client=httpx.Client(transport=transport),
        sleep=lambda _seconds: None,
    )


def test_get_uses_v1_prefix_bearer_and_accept() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["method"] = request.method
        captured["headers"] = dict(request.headers)
        return json_response({"items": []})

    http = _make(httpx.MockTransport(handler))
    res = http.request(HttpRequest(method="GET", path="/properties"))
    assert res.status == 200
    assert res.body == {"items": []}
    assert captured["url"] == "https://api.example.com/v1/properties"
    assert captured["method"] == "GET"
    assert captured["headers"]["authorization"] == f"Bearer {VALID_KEY}"
    assert captured["headers"]["accept"] == "application/json"
    assert "content-type" not in captured["headers"]  # no body → no content-type


def test_post_sets_content_type_and_marshals_json() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        captured["body"] = request.content
        return json_response({"ok": True}, status_code=201)

    http = _make(httpx.MockTransport(handler))
    http.request(HttpRequest(method="POST", path="/consent/record", body={"x": 1}))
    assert captured["headers"]["content-type"] == "application/json"
    # Assert via JSON parse rather than byte equality so the test isn't
    # coupled to httpx's serialiser-style choices (with/without spaces).
    import json as _json

    assert _json.loads(captured["body"]) == {"x": 1}


def test_lifts_trace_id_from_response_onto_result() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return json_response({"ok": True}, trace_id="trace-abc-123")

    http = _make(httpx.MockTransport(handler))
    res = http.request(HttpRequest(method="GET", path="/_ping"))
    assert res.trace_id == "trace-abc-123"


def test_forwards_caller_supplied_trace_id_on_request() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["trace"] = request.headers.get("x-cs-trace-id")
        return json_response({})

    http = _make(httpx.MockTransport(handler))
    http.request(HttpRequest(method="GET", path="/_ping", trace_id="caller-trace"))
    assert captured["trace"] == "caller-trace"


def test_query_skips_none_values() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return json_response({})

    http = _make(httpx.MockTransport(handler))
    http.request(
        HttpRequest(
            method="GET",
            path="/audit",
            query={"since": "2026-01-01", "limit": 50, "cursor": None, "include": None, "archived": False},
        )
    )
    # cursor + include omitted; archived=False included.
    url = captured["url"]
    assert "since=2026-01-01" in url
    assert "limit=50" in url
    assert "archived=False" in url
    assert "cursor=" not in url
    assert "include=" not in url


def test_returns_none_body_on_204() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=204)

    http = _make(httpx.MockTransport(handler))
    res = http.request(HttpRequest(method="DELETE", path="/x"))
    assert res.status == 204
    assert res.body is None


def test_timeout_raises_consent_shield_timeout_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("read timeout")

    http = _make(httpx.MockTransport(handler), max_retries=5)
    with pytest.raises(ConsentShieldTimeoutError):
        http.request(HttpRequest(method="GET", path="/_ping"))


def test_timeout_never_retries() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise httpx.ReadTimeout("timeout")

    http = _make(httpx.MockTransport(handler), max_retries=5)
    with pytest.raises(ConsentShieldTimeoutError):
        http.request(HttpRequest(method="GET", path="/_ping"))
    assert calls == 1


def test_retries_on_503_then_succeeds() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls < 3:
            return json_response({}, status_code=503)
        return json_response({"ok": True})

    http = _make(httpx.MockTransport(handler), max_retries=3)
    res = http.request(HttpRequest(method="GET", path="/_ping"))
    assert res.body == {"ok": True}
    assert calls == 3


def test_retry_exhaustion_raises_api_error_with_trace_id() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return problem_response(503, "Service Unavailable", "down", trace_id="t-fail")

    http = _make(httpx.MockTransport(handler), max_retries=2)
    with pytest.raises(ConsentShieldApiError) as ex:
        http.request(HttpRequest(method="GET", path="/_ping"))
    assert ex.value.status == 503
    assert ex.value.trace_id == "t-fail"


def test_transport_error_retried_then_surfaces_network_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("dns failed")

    http = _make(httpx.MockTransport(handler), max_retries=2)
    with pytest.raises(ConsentShieldNetworkError):
        http.request(HttpRequest(method="GET", path="/_ping"))


@pytest.mark.parametrize("status", [400, 401, 403, 404, 410, 422])
def test_4xx_never_retries(status: int) -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return problem_response(status, "Bad", f"code-{status}")

    http = _make(httpx.MockTransport(handler), max_retries=5)
    with pytest.raises(ConsentShieldApiError):
        http.request(HttpRequest(method="GET", path="/_ping"))
    assert calls == 1


def test_problem_json_parsed_onto_error_problem_field() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return problem_response(
            403, "Forbidden", "no scope: read", trace_id="t-403"
        )

    http = _make(httpx.MockTransport(handler))
    with pytest.raises(ConsentShieldApiError) as ex:
        http.request(HttpRequest(method="GET", path="/_ping"))
    assert ex.value.problem is not None
    assert ex.value.problem["title"] == "Forbidden"
    assert ex.value.problem["detail"] == "no scope: read"
    assert ex.value.trace_id == "t-403"


def test_non_json_error_body_tolerated() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code=500, text="plain text error"
        )

    http = _make(httpx.MockTransport(handler))
    with pytest.raises(ConsentShieldApiError) as ex:
        http.request(HttpRequest(method="GET", path="/_ping"))
    assert ex.value.problem is None
