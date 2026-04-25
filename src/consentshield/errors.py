"""ADR-1006 Phase 2 Sprint 2.1 — error class hierarchy.

Mirrors `@consentshield/node`'s errors module 1:1. Every error
descends from ``ConsentShieldError`` so callers can ``except
ConsentShieldError`` for a uniform catch and branch on the concrete
subclass for behaviour-specific recovery.

All errors carry an optional ``trace_id`` lifted from the response's
``X-CS-Trace-Id`` header (ADR-1014 Sprint 3.2). Server-side log
correlation is one grep away when a partner reports an issue.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

# RFC 7807 problem-document body shape — matches
# ``app/src/lib/api/auth.ts`` ``problemJson(...)`` exactly. Surfaced on
# 4xx/5xx responses.
ProblemJson = Mapping[str, Any]


class ConsentShieldError(Exception):
    """Base class for every SDK failure.

    Catch this if you want to handle any ConsentShield error uniformly
    without distinguishing the cause.
    """

    def __init__(self, message: str, *, trace_id: Optional[str] = None) -> None:
        super().__init__(message)
        self.trace_id = trace_id


class ConsentShieldApiError(ConsentShieldError):
    """The server returned a structured 4xx/5xx with an RFC 7807 body.

    The ``problem`` field carries the parsed
    ``application/problem+json`` payload so callers can branch on
    ``problem['title']`` / ``problem['detail']`` /
    service-specific extensions.
    """

    def __init__(
        self,
        status: int,
        problem: Optional[ProblemJson],
        *,
        trace_id: Optional[str] = None,
    ) -> None:
        # Empty-string detail also falls back to title — RFC 7807
        # doesn't require detail, so an empty string is in the "absent"
        # spirit. Mirrors the Node SDK's behaviour exactly.
        detail: Optional[str] = None
        if problem is not None:
            detail_val = problem.get("detail")
            if isinstance(detail_val, str) and detail_val:
                detail = detail_val
            else:
                title_val = problem.get("title")
                if isinstance(title_val, str) and title_val:
                    detail = title_val
        if not detail:
            detail = f"HTTP {status}"
        super().__init__(
            f"ConsentShield API error: {status} {detail}", trace_id=trace_id
        )
        self.status = status
        self.problem = problem


class ConsentShieldNetworkError(ConsentShieldError):
    """Transport failure — DNS, TCP reset, TLS handshake, etc.

    Anything that ``httpx`` raises that isn't a timeout. Network
    failures are RETRIED by the HTTP helper (up to ``max_retries``)
    before this error surfaces.
    """

    def __init__(
        self,
        message: str,
        *,
        cause: Optional[BaseException] = None,
        trace_id: Optional[str] = None,
    ) -> None:
        super().__init__(
            f"ConsentShield network error: {message}", trace_id=trace_id
        )
        self.cause = cause


class ConsentShieldTimeoutError(ConsentShieldError):
    """The request exceeded ``timeout_ms`` (default 2 000 ms).

    Per the v2 whitepaper §5.4 the SDK does NOT retry timeouts
    (the second attempt would compound user-visible latency past the
    consent-decision budget).
    """

    def __init__(self, timeout_ms: int, *, trace_id: Optional[str] = None) -> None:
        super().__init__(
            f"ConsentShield request exceeded {timeout_ms} ms", trace_id=trace_id
        )
        self.timeout_ms = timeout_ms


class ConsentVerifyError(ConsentShieldError):
    """A ``verify`` call could not be evaluated AND the SDK is in
    fail-CLOSED mode (the default).

    The SDK refuses to default-OPEN under failure unless the caller
    explicitly opts in via ``fail_open=True`` in the constructor. Per
    the v2 whitepaper §5.4, defaulting open on a verify failure is the
    worst DPDP outcome — the customer might silently act on withdrawn
    consent.

    When this error is raised the calling code MUST treat the data
    principal as "consent NOT verified" and refuse the underlying
    operation. If the caller wants to opt in to fail-open behaviour,
    set ``fail_open=True`` and the SDK returns a
    ``{"status": "open_failure", "reason": ...}`` shape instead of
    raising this error (and the override is recorded via the
    ``on_fail_open`` callback).
    """

    def __init__(self, cause: ConsentShieldError) -> None:
        super().__init__(
            f"Consent verification failed (fail-closed): {cause}",
            trace_id=cause.trace_id,
        )
        self.cause = cause


__all__ = [
    "ConsentShieldError",
    "ConsentShieldApiError",
    "ConsentShieldNetworkError",
    "ConsentShieldTimeoutError",
    "ConsentVerifyError",
    "ProblemJson",
]
