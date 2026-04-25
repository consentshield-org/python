"""ADR-1006 Phase 2 Sprint 2.1 — shared constructor validation +
defaults. Used by both ``ConsentShieldClient`` (sync) and
``AsyncConsentShieldClient`` (async) so the validation logic stays in
one place.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

API_KEY_PREFIX = "cs_live_"
DEFAULT_BASE_URL = "https://app.consentshield.in"
DEFAULT_TIMEOUT_MS = 2_000
DEFAULT_MAX_RETRIES = 3
ENV_FAIL_OPEN = "CONSENT_VERIFY_FAIL_OPEN"


@dataclass(frozen=True)
class ResolvedConfig:
    """Output of ``resolve_config(...)``. Each field is the SDK's
    final, validated value — exposed as ``client.<field>`` for tests
    and runtime introspection.
    """

    api_key: str
    base_url: str
    timeout_ms: int
    max_retries: int
    fail_open: bool


def _read_env_fail_open() -> bool:
    raw = os.environ.get(ENV_FAIL_OPEN)
    return raw == "true" or raw == "1"


def resolve_config(
    *,
    api_key: object,
    base_url: object = None,
    timeout_ms: object = None,
    max_retries: object = None,
    fail_open: object = None,
) -> ResolvedConfig:
    """Validate constructor inputs + apply defaults.

    Raises:
        TypeError: invalid type for any field.
        ValueError: out-of-range numeric value (timeout_ms <= 0,
            max_retries < 0, etc.).
    """
    if not isinstance(api_key, str) or not api_key.startswith(API_KEY_PREFIX):
        raise TypeError(
            "consentshield: api_key must be a string starting with "
            '"cs_live_". Issue keys via the admin console; never '
            "hard-code keys in source."
        )

    resolved_base_url: str
    if base_url is None:
        resolved_base_url = DEFAULT_BASE_URL
    elif isinstance(base_url, str):
        resolved_base_url = base_url.rstrip("/")
    else:
        raise TypeError("consentshield: base_url must be a string when provided")

    resolved_timeout_ms: int
    if timeout_ms is None:
        resolved_timeout_ms = DEFAULT_TIMEOUT_MS
    elif isinstance(timeout_ms, bool) or not isinstance(timeout_ms, int):
        # bool is a subclass of int — reject explicitly.
        raise TypeError("consentshield: timeout_ms must be a positive int")
    elif timeout_ms <= 0:
        raise ValueError("consentshield: timeout_ms must be > 0")
    else:
        resolved_timeout_ms = timeout_ms

    resolved_max_retries: int
    if max_retries is None:
        resolved_max_retries = DEFAULT_MAX_RETRIES
    elif isinstance(max_retries, bool) or not isinstance(max_retries, int):
        raise TypeError("consentshield: max_retries must be a non-negative int")
    elif max_retries < 0:
        raise ValueError("consentshield: max_retries must be >= 0")
    else:
        resolved_max_retries = max_retries

    resolved_fail_open: bool
    if fail_open is None:
        resolved_fail_open = _read_env_fail_open()
    elif isinstance(fail_open, bool):
        resolved_fail_open = fail_open
    else:
        raise TypeError("consentshield: fail_open must be a bool when provided")

    return ResolvedConfig(
        api_key=api_key,
        base_url=resolved_base_url,
        timeout_ms=resolved_timeout_ms,
        max_retries=resolved_max_retries,
        fail_open=resolved_fail_open,
    )


__all__ = [
    "ResolvedConfig",
    "resolve_config",
    "API_KEY_PREFIX",
    "DEFAULT_BASE_URL",
    "DEFAULT_TIMEOUT_MS",
    "DEFAULT_MAX_RETRIES",
    "ENV_FAIL_OPEN",
]
