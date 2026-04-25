"""ADR-1006 Phase 2 Sprint 2.1 — on_fail_open callback wiring (sync)."""
from __future__ import annotations

import logging
from typing import Any

import httpx
import pytest

from consentshield import ConsentShieldClient, is_open_failure

from .conftest import VALID_KEY, problem_response

BASE = "https://api.example.com"
PROPERTY_ID = "11111111-1111-1111-1111-111111111111"

VERIFY_KW: dict[str, Any] = {
    "property_id": PROPERTY_ID,
    "data_principal_identifier": "user@example.com",
    "identifier_type": "email",
    "purpose_code": "marketing",
}


def _client(transport: httpx.MockTransport, *, fail_open: bool, on_fail_open: Any = None) -> ConsentShieldClient:
    return ConsentShieldClient(
        api_key=VALID_KEY,
        base_url=BASE,
        max_retries=0,
        fail_open=fail_open,
        on_fail_open=on_fail_open,
        http_client=httpx.Client(transport=transport),
    )


def test_callback_fires_once_on_verify_fail_open() -> None:
    calls: list[tuple[Any, dict[str, Any]]] = []

    def callback(envelope, ctx):  # type: ignore[no-untyped-def]
        calls.append((envelope, ctx))

    def handler(_r: httpx.Request) -> httpx.Response:
        return problem_response(503, "down", "eek", trace_id="trace-cb")

    client = _client(
        httpx.MockTransport(handler), fail_open=True, on_fail_open=callback
    )
    result = client.verify(**VERIFY_KW)
    assert is_open_failure(result)
    assert len(calls) == 1
    envelope, ctx = calls[0]
    assert envelope["status"] == "open_failure"
    assert envelope["cause"] == "server_error"
    assert envelope["trace_id"] == "trace-cb"
    assert ctx["method"] == "verify"


def test_callback_fires_once_on_verify_batch_fail_open() -> None:
    calls: list[tuple[Any, dict[str, Any]]] = []

    def callback(envelope, ctx):  # type: ignore[no-untyped-def]
        calls.append((envelope, ctx))

    def handler(_r: httpx.Request) -> httpx.Response:
        return problem_response(503, "down", "eek")

    client = _client(
        httpx.MockTransport(handler), fail_open=True, on_fail_open=callback
    )
    client.verify_batch(
        property_id=PROPERTY_ID,
        identifier_type="email",
        purpose_code="marketing",
        identifiers=["a@x.com"],
    )
    assert len(calls) == 1
    assert calls[0][1]["method"] == "verify_batch"


def test_callback_does_not_fire_on_success() -> None:
    calls: list[Any] = []

    def callback(envelope, ctx):  # type: ignore[no-untyped-def]
        calls.append((envelope, ctx))

    sample = {
        "property_id": PROPERTY_ID,
        "identifier_type": "email",
        "purpose_code": "marketing",
        "status": "granted",
        "active_artefact_id": "a1",
        "revoked_at": None,
        "revocation_record_id": None,
        "expires_at": None,
        "evaluated_at": "2026-04-25T10:00:00Z",
    }

    def handler(_r: httpx.Request) -> httpx.Response:
        from .conftest import json_response

        return json_response(sample)

    client = _client(httpx.MockTransport(handler), fail_open=True, on_fail_open=callback)
    client.verify(**VERIFY_KW)
    assert calls == []


def test_callback_does_not_fire_when_fail_open_false() -> None:
    calls: list[Any] = []

    def callback(envelope, ctx):  # type: ignore[no-untyped-def]
        calls.append((envelope, ctx))

    def handler(_r: httpx.Request) -> httpx.Response:
        return problem_response(503, "down", "eek")

    client = _client(httpx.MockTransport(handler), fail_open=False, on_fail_open=callback)
    with pytest.raises(Exception):
        client.verify(**VERIFY_KW)
    assert calls == []


def test_callback_does_not_fire_on_4xx() -> None:
    calls: list[Any] = []

    def callback(envelope, ctx):  # type: ignore[no-untyped-def]
        calls.append((envelope, ctx))

    def handler(_r: httpx.Request) -> httpx.Response:
        return problem_response(403, "Forbidden", "no scope")

    client = _client(httpx.MockTransport(handler), fail_open=True, on_fail_open=callback)
    with pytest.raises(Exception):
        client.verify(**VERIFY_KW)
    assert calls == []


def test_synchronous_throw_in_callback_does_not_break_call_site(capsys: pytest.CaptureFixture[str]) -> None:
    def callback(_envelope, _ctx):  # type: ignore[no-untyped-def]
        raise RuntimeError("audit sink down")

    def handler(_r: httpx.Request) -> httpx.Response:
        return problem_response(503, "down", "eek")

    client = _client(httpx.MockTransport(handler), fail_open=True, on_fail_open=callback)
    result = client.verify(**VERIFY_KW)
    assert is_open_failure(result)
    err_out = capsys.readouterr().err
    assert "on_fail_open callback threw" in err_out


def test_default_callback_logs_a_warning(caplog: pytest.LogCaptureFixture) -> None:
    def handler(_r: httpx.Request) -> httpx.Response:
        return problem_response(503, "down", "eek")

    client = _client(httpx.MockTransport(handler), fail_open=True)
    with caplog.at_level(logging.WARNING, logger="consentshield"):
        client.verify(**VERIFY_KW)
    assert any(
        "fail-open verify override" in rec.message and "verify" in rec.message
        for rec in caplog.records
    )
