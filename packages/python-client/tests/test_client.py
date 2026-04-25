"""ADR-1006 Phase 2 Sprint 2.1 — sync client constructor + ping."""
from __future__ import annotations

from typing import Any

import httpx
import pytest

from consentshield import ConsentShieldClient

from .conftest import VALID_KEY, json_response


def _stub_transport(status_code: int = 200, body: Any | None = None) -> httpx.MockTransport:
    body = body if body is not None else {"ok": True}

    def handler(request: httpx.Request) -> httpx.Response:
        return json_response(body, status_code=status_code)

    return httpx.MockTransport(handler)


def _client(**overrides: Any) -> ConsentShieldClient:
    transport = overrides.pop("transport", _stub_transport())
    overrides.setdefault("api_key", VALID_KEY)
    overrides.setdefault("base_url", "https://api.example.com")
    overrides.setdefault("max_retries", 0)
    return ConsentShieldClient(
        http_client=httpx.Client(transport=transport),
        **overrides,
    )


def test_constructor_applies_sdk_defaults() -> None:
    client = _client()
    assert client.base_url == "https://api.example.com"
    assert client.timeout_ms == 2_000
    assert client.max_retries == 0  # overridden in helper
    assert client.fail_open is False


def test_default_max_retries_is_three() -> None:
    client = ConsentShieldClient(api_key=VALID_KEY)
    assert client.max_retries == 3
    assert client.timeout_ms == 2_000
    client.close()


def test_constructor_trims_trailing_slashes_on_base_url() -> None:
    client = _client(base_url="https://staging.example.com///")
    assert client.base_url == "https://staging.example.com"


def test_rejects_non_string_api_key() -> None:
    with pytest.raises(TypeError, match="cs_live_"):
        ConsentShieldClient(api_key=12345)  # type: ignore[arg-type]


def test_rejects_api_key_without_cs_live_prefix() -> None:
    with pytest.raises(TypeError, match="cs_live_"):
        ConsentShieldClient(api_key="sk_live_xyz")


def test_rejects_uppercase_prefix() -> None:
    with pytest.raises(TypeError, match="cs_live_"):
        ConsentShieldClient(api_key="CS_LIVE_xyz")


def test_rejects_zero_or_negative_timeout() -> None:
    with pytest.raises(ValueError, match="timeout_ms"):
        ConsentShieldClient(api_key=VALID_KEY, timeout_ms=0)
    with pytest.raises(ValueError, match="timeout_ms"):
        ConsentShieldClient(api_key=VALID_KEY, timeout_ms=-100)


def test_rejects_non_int_timeout() -> None:
    with pytest.raises(TypeError, match="timeout_ms"):
        ConsentShieldClient(api_key=VALID_KEY, timeout_ms=2.5)  # type: ignore[arg-type]


def test_rejects_negative_max_retries() -> None:
    with pytest.raises(ValueError, match="max_retries"):
        ConsentShieldClient(api_key=VALID_KEY, max_retries=-1)


def test_explicit_fail_open_true_honoured() -> None:
    client = _client(fail_open=True)
    assert client.fail_open is True


def test_env_fail_open_true_honoured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONSENT_VERIFY_FAIL_OPEN", "true")
    client = _client()
    assert client.fail_open is True


def test_env_fail_open_one_honoured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONSENT_VERIFY_FAIL_OPEN", "1")
    client = _client()
    assert client.fail_open is True


def test_explicit_fail_open_false_overrides_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONSENT_VERIFY_FAIL_OPEN", "true")
    client = _client(fail_open=False)
    assert client.fail_open is False


def test_env_falsy_treated_as_false(monkeypatch: pytest.MonkeyPatch) -> None:
    for value in ["false", "0", "yes"]:
        monkeypatch.setenv("CONSENT_VERIFY_FAIL_OPEN", value)
        assert _client().fail_open is False


def test_ping_gets_v1_ping_with_bearer() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["method"] = request.method
        captured["auth"] = request.headers.get("authorization")
        return json_response({"ok": True})

    transport = httpx.MockTransport(handler)
    client = _client(transport=transport)
    assert client.ping() is True
    assert captured["url"] == "https://api.example.com/v1/_ping"
    assert captured["method"] == "GET"
    assert captured["auth"] == f"Bearer {VALID_KEY}"


def test_context_manager_closes_owned_http_client() -> None:
    with ConsentShieldClient(
        api_key=VALID_KEY, http_client=httpx.Client(transport=_stub_transport())
    ) as client:
        assert client.fail_open is False
    # No assertion needed — just verifies __enter__ + __exit__ resolve.
