"""Shared pytest fixtures + helpers."""
from __future__ import annotations

import json as _json
from typing import Any, Mapping, Optional

import httpx
import pytest

VALID_KEY = "cs_live_abc123def456"
PROPERTY_ID = "11111111-1111-1111-1111-111111111111"


def json_response(
    body: Any, *, status_code: int = 200, trace_id: Optional[str] = None
) -> httpx.Response:
    """Build an httpx.Response with a JSON body — including JSON ``null``.

    httpx's ``json=None`` keyword argument skips serialisation entirely
    (treats it as "no body"). For our tests we need the literal JSON
    null body, so we always serialise via ``content=`` ourselves.
    """
    headers: dict[str, str] = {"content-type": "application/json"}
    if trace_id is not None:
        headers["X-CS-Trace-Id"] = trace_id
    return httpx.Response(
        status_code=status_code,
        content=_json.dumps(body).encode("utf-8"),
        headers=headers,
    )


def problem_response(
    status_code: int,
    title: str,
    detail: str,
    *,
    trace_id: Optional[str] = None,
) -> httpx.Response:
    body: Mapping[str, Any] = {
        "type": "x",
        "title": title,
        "status": status_code,
        "detail": detail,
    }
    headers: dict[str, str] = {"content-type": "application/problem+json"}
    if trace_id is not None:
        headers["X-CS-Trace-Id"] = trace_id
    return httpx.Response(status_code=status_code, json=body, headers=headers)


@pytest.fixture
def valid_key() -> str:
    return VALID_KEY


@pytest.fixture
def property_id() -> str:
    return PROPERTY_ID
