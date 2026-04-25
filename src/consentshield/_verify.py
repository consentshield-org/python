"""ADR-1006 Phase 2 Sprint 2.1 — verify failure-outcome decision.

Encodes the non-negotiable compliance contract from the Node SDK:

- 4xx ALWAYS raises (caller bug / scope / 422 / 404 / 413 — the
  fail-open flag MUST NEVER mask a real validation/scope error).
- timeout / network / 5xx + ``fail_open=False`` (default) raises
  ``ConsentVerifyError`` wrapping the cause.
- timeout / network / 5xx + ``fail_open=True`` returns
  ``OpenFailureEnvelope`` with the right ``cause`` discriminator.

Both ``ConsentShieldClient.verify`` (sync) and
``AsyncConsentShieldClient.verify`` (async) call ``decide_failure_outcome``
to apply the rule uniformly.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Union

from .errors import (
    ConsentShieldApiError,
    ConsentShieldError,
    ConsentShieldNetworkError,
    ConsentShieldTimeoutError,
    ConsentVerifyError,
)
from .types import OpenFailureCause, OpenFailureEnvelope


@dataclass
class _Rethrow:
    error: ConsentShieldError


@dataclass
class _Open:
    envelope: OpenFailureEnvelope


_FailureOutcome = Union[_Rethrow, _Open]


def _normalise(err: BaseException) -> ConsentShieldError:
    if isinstance(err, ConsentShieldError):
        return err
    return ConsentShieldNetworkError(str(err), cause=err)


def decide_failure_outcome(err: BaseException, *, fail_open: bool) -> _FailureOutcome:
    """Map a transport / API failure into either a raise or an
    OpenFailureEnvelope.

    4xx ALWAYS produces a ``_Rethrow`` regardless of ``fail_open``.
    Returning the dataclass (rather than raising / returning here)
    keeps the sync + async verify helpers free to handle the
    callback invocation in their own way (sync function call vs
    awaitable).
    """
    normalised = _normalise(err)

    # 4xx → caller bug or auth/scope/validation issue. Never opens
    # this through this path — the customer would silently miss real
    # errors.
    if (
        isinstance(normalised, ConsentShieldApiError)
        and 400 <= normalised.status < 500
    ):
        return _Rethrow(error=normalised)

    if fail_open:
        cause: OpenFailureCause
        if isinstance(normalised, ConsentShieldTimeoutError):
            cause = "timeout"
        elif isinstance(normalised, ConsentShieldApiError):
            cause = "server_error"
        else:
            cause = "network"

        envelope: OpenFailureEnvelope = {
            "status": "open_failure",
            "reason": str(normalised),
            "cause": cause,
            "trace_id": normalised.trace_id,
        }
        return _Open(envelope=envelope)

    # Fail-closed (the default). Wrap in ConsentVerifyError so callers
    # can ``except ConsentVerifyError`` for the load-bearing class
    # without losing the underlying cause.
    return _Rethrow(error=ConsentVerifyError(normalised))


def is_open_failure(result: object) -> bool:
    """Ergonomic type guard — same shape as the Node SDK's
    ``isOpenFailure(result)``.
    """
    return (
        isinstance(result, dict)
        and result.get("status") == "open_failure"
    )


__all__ = [
    "decide_failure_outcome",
    "is_open_failure",
    "_Rethrow",
    "_Open",
    "_FailureOutcome",
]


def _ignore_unused() -> Optional[OpenFailureCause]:
    return None  # pragma: no cover — keeps the OpenFailureCause import in scope for older mypy
