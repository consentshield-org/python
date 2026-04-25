"""ADR-1006 Phase 2 Sprint 2.1 — error class hierarchy."""
from __future__ import annotations

import pytest

from consentshield import (
    ConsentShieldApiError,
    ConsentShieldError,
    ConsentShieldNetworkError,
    ConsentShieldTimeoutError,
    ConsentVerifyError,
)


def test_subclasses_are_consentshield_errors() -> None:
    api = ConsentShieldApiError(500, None)
    net = ConsentShieldNetworkError("econnreset")
    tmo = ConsentShieldTimeoutError(2000)
    vfy = ConsentVerifyError(net)

    assert isinstance(api, ConsentShieldError)
    assert isinstance(net, ConsentShieldError)
    assert isinstance(tmo, ConsentShieldError)
    assert isinstance(vfy, ConsentShieldError)
    # Native Exception too — for global handlers, Sentry, etc.
    assert isinstance(api, Exception)


def test_api_error_message_includes_status_and_detail() -> None:
    err = ConsentShieldApiError(
        403,
        {"type": "t", "title": "Forbidden", "status": 403, "detail": "no scope"},
    )
    assert "403" in str(err)
    assert "no scope" in str(err)


def test_api_error_message_falls_back_to_title_when_detail_empty_or_absent() -> None:
    empty = ConsentShieldApiError(
        401,
        {"type": "t", "title": "Unauthorized", "status": 401, "detail": ""},
    )
    assert "Unauthorized" in str(empty)
    assert "401" in str(empty)

    undef = ConsentShieldApiError(
        401, {"type": "t", "title": "Unauthorized", "status": 401}
    )
    assert "Unauthorized" in str(undef)


def test_api_error_falls_back_to_http_status_when_problem_none() -> None:
    err = ConsentShieldApiError(500, None)
    assert "HTTP 500" in str(err)


def test_trace_id_propagates_to_each_subclass() -> None:
    assert ConsentShieldApiError(500, None, trace_id="t-1").trace_id == "t-1"
    assert ConsentShieldNetworkError("x", trace_id="t-2").trace_id == "t-2"
    assert ConsentShieldTimeoutError(2000, trace_id="t-3").trace_id == "t-3"


def test_consent_verify_error_carries_cause_and_propagates_trace_id() -> None:
    inner = ConsentShieldNetworkError("econnreset", trace_id="t-deep")
    wrap = ConsentVerifyError(inner)
    assert wrap.cause is inner
    assert wrap.trace_id == "t-deep"
    assert "econnreset" in str(wrap)


def test_raises_can_be_caught_uniformly() -> None:
    with pytest.raises(ConsentShieldError):
        raise ConsentShieldApiError(404, None)
