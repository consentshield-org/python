"""ADR-1006 Phase 2 Sprint 2.1 — sync ``ConsentShieldClient``.

Mirror of ``@consentshield/node``'s ``ConsentShieldClient`` for sync
Python callers (Django views, Flask handlers, scripts).
"""

from __future__ import annotations

import logging
import sys
from typing import (
    Any,
    Awaitable,
    Callable,
    Iterator,
    List,
    Literal,
    Optional,
    Union,
    cast,
)

import httpx

from . import _builders as B
from ._config import resolve_config
from ._http import HttpClient, HttpRequest
from ._verify import _Open, decide_failure_outcome
from .errors import ConsentShieldError
from .types import (
    ArtefactDetail,
    ArtefactListEnvelope,
    ArtefactListItem,
    AuditLogEnvelope,
    AuditLogItem,
    DeletionReceiptRow,
    DeletionReceiptsEnvelope,
    DeletionTriggerEnvelope,
    EventListEnvelope,
    EventListItem,
    OpenFailureEnvelope,
    RecordEnvelope,
    RevokeEnvelope,
    RightsRequestCreatedEnvelope,
    RightsRequestItem,
    RightsRequestListEnvelope,
    VerifyBatchEnvelope,
    VerifyBatchOutcome,
    VerifyEnvelope,
    VerifyOutcome,
)

_log = logging.getLogger("consentshield")

VerifyMethod = Literal["verify", "verify_batch"]

# Sync callback may also accept an async callable for parity with the
# async client; we just don't await it on the sync path (fire-and-
# forget if the caller mixes them).
FailOpenCallback = Callable[
    [OpenFailureEnvelope, dict],  # type: ignore[type-arg]
    Union[None, Awaitable[None]],
]


def _default_fail_open_callback(
    envelope: OpenFailureEnvelope, ctx: dict[str, Any]
) -> None:
    # Default sink: stderr-bound structured warning so the override
    # always surfaces. Production callers wire to Sentry / structured
    # logger / a custom /v1/audit POST.
    _log.warning(
        "[consentshield] fail-open verify override "
        "method=%s cause=%s reason=%s trace_id=%s",
        ctx.get("method"),
        envelope.get("cause"),
        envelope.get("reason"),
        envelope.get("trace_id"),
    )


def _invoke_fail_open(
    callback: Optional[FailOpenCallback],
    envelope: OpenFailureEnvelope,
    method: VerifyMethod,
) -> None:
    if callback is None:
        return
    try:
        result = callback(envelope, {"method": method})
        if result is not None and hasattr(result, "__await__"):
            # Caller passed an async callable on the sync client.
            # Don't try to run an event loop here — that would block
            # the caller in unpredictable ways. Tell them once.
            print(
                "[consentshield] on_fail_open returned an awaitable on the "
                "sync client; the result was discarded. Pass a sync "
                "callable, or use AsyncConsentShieldClient.",
                file=sys.stderr,
            )
    except Exception as err:  # noqa: BLE001 — must never break the verify call site
        print(
            f"[consentshield] on_fail_open callback threw for {method}: {err}",
            file=sys.stderr,
        )


class ConsentShieldClient:
    """Sync client for the ConsentShield v1 API.

    Constructor mirrors ``@consentshield/node``'s ``ConsentShieldClient``
    1:1 — same defaults, same compliance posture, same env override.

    Example::

        from consentshield import ConsentShieldClient

        client = ConsentShieldClient(api_key=os.environ["CS_API_KEY"])
        client.ping()  # → True; raises on any failure

    Use as a context manager to ensure the underlying ``httpx.Client``
    is closed::

        with ConsentShieldClient(api_key=...) as client:
            client.verify(...)
    """

    def __init__(
        self,
        *,
        api_key: str,
        base_url: Optional[str] = None,
        timeout_ms: Optional[int] = None,
        max_retries: Optional[int] = None,
        fail_open: Optional[bool] = None,
        on_fail_open: Optional[FailOpenCallback] = None,
        http_client: Optional[httpx.Client] = None,
    ) -> None:
        cfg = resolve_config(
            api_key=api_key,
            base_url=base_url,
            timeout_ms=timeout_ms,
            max_retries=max_retries,
            fail_open=fail_open,
        )
        self.api_key = cfg.api_key
        self.base_url = cfg.base_url
        self.timeout_ms = cfg.timeout_ms
        self.max_retries = cfg.max_retries
        self.fail_open = cfg.fail_open
        self.on_fail_open: FailOpenCallback = (
            on_fail_open if on_fail_open is not None else _default_fail_open_callback
        )
        self._http = HttpClient(
            base_url=self.base_url,
            api_key=self.api_key,
            timeout_ms=self.timeout_ms,
            max_retries=self.max_retries,
            client=http_client,
        )

    # ──────────────────────────────────────────────────────────────
    # Lifecycle
    # ──────────────────────────────────────────────────────────────

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "ConsentShieldClient":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    # ──────────────────────────────────────────────────────────────
    # Health
    # ──────────────────────────────────────────────────────────────

    def ping(self) -> bool:
        """GET /v1/_ping. Returns True on 200; raises otherwise."""
        self._http.request(HttpRequest(method="GET", path="/_ping"))
        return True

    # ──────────────────────────────────────────────────────────────
    # Verify (compliance-load-bearing)
    # ──────────────────────────────────────────────────────────────

    def verify(
        self,
        *,
        property_id: str,
        data_principal_identifier: str,
        identifier_type: str,
        purpose_code: str,
        trace_id: Optional[str] = None,
    ) -> VerifyOutcome:
        req = B.build_verify_request(
            property_id=property_id,
            data_principal_identifier=data_principal_identifier,
            identifier_type=identifier_type,
            purpose_code=purpose_code,
            trace_id=trace_id,
        )
        try:
            return cast(VerifyEnvelope, self._http.request(req).body)
        except ConsentShieldError as err:
            outcome = decide_failure_outcome(err, fail_open=self.fail_open)
            if isinstance(outcome, _Open):
                _invoke_fail_open(self.on_fail_open, outcome.envelope, "verify")
                return outcome.envelope
            raise outcome.error from err

    def verify_batch(
        self,
        *,
        property_id: str,
        identifier_type: str,
        purpose_code: str,
        identifiers: List[str],
        trace_id: Optional[str] = None,
    ) -> VerifyBatchOutcome:
        req = B.build_verify_batch_request(
            property_id=property_id,
            identifier_type=identifier_type,
            purpose_code=purpose_code,
            identifiers=identifiers,
            trace_id=trace_id,
        )
        try:
            return cast(VerifyBatchEnvelope, self._http.request(req).body)
        except ConsentShieldError as err:
            outcome = decide_failure_outcome(err, fail_open=self.fail_open)
            if isinstance(outcome, _Open):
                _invoke_fail_open(self.on_fail_open, outcome.envelope, "verify_batch")
                return outcome.envelope
            raise outcome.error from err

    # ──────────────────────────────────────────────────────────────
    # Record + revoke
    # ──────────────────────────────────────────────────────────────

    def record_consent(
        self,
        *,
        property_id: str,
        data_principal_identifier: str,
        identifier_type: str,
        purpose_definition_ids: List[str],
        captured_at: str,
        rejected_purpose_definition_ids: Optional[List[str]] = None,
        client_request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> RecordEnvelope:
        req = B.build_record_consent_request(
            property_id=property_id,
            data_principal_identifier=data_principal_identifier,
            identifier_type=identifier_type,
            purpose_definition_ids=purpose_definition_ids,
            captured_at=captured_at,
            rejected_purpose_definition_ids=rejected_purpose_definition_ids,
            client_request_id=client_request_id,
            trace_id=trace_id,
        )
        return cast(RecordEnvelope, self._http.request(req).body)

    def revoke_artefact(
        self,
        artefact_id: str,
        *,
        reason_code: str,
        actor_type: str,
        reason_notes: Optional[str] = None,
        actor_ref: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> RevokeEnvelope:
        req = B.build_revoke_artefact_request(
            artefact_id=artefact_id,
            reason_code=reason_code,
            actor_type=actor_type,
            reason_notes=reason_notes,
            actor_ref=actor_ref,
            trace_id=trace_id,
        )
        return cast(RevokeEnvelope, self._http.request(req).body)

    # ──────────────────────────────────────────────────────────────
    # Artefact CRUD + iteration
    # ──────────────────────────────────────────────────────────────

    def list_artefacts(
        self,
        **kwargs: Any,
    ) -> ArtefactListEnvelope:
        req = B.build_list_artefacts_request(**kwargs)
        return cast(ArtefactListEnvelope, self._http.request(req).body)

    def iterate_artefacts(self, **kwargs: Any) -> Iterator[ArtefactListItem]:
        cursor = kwargs.pop("cursor", None)
        while True:
            page = self.list_artefacts(cursor=cursor, **kwargs)
            for item in page["items"]:
                yield item
            cursor = page.get("next_cursor")
            if not cursor:
                return

    def get_artefact(
        self, artefact_id: str, *, trace_id: Optional[str] = None
    ) -> Optional[ArtefactDetail]:
        req = B.build_get_artefact_request(artefact_id=artefact_id, trace_id=trace_id)
        body = self._http.request(req).body
        return cast(Optional[ArtefactDetail], body)

    # ──────────────────────────────────────────────────────────────
    # Events
    # ──────────────────────────────────────────────────────────────

    def list_events(self, **kwargs: Any) -> EventListEnvelope:
        req = B.build_list_events_request(**kwargs)
        return cast(EventListEnvelope, self._http.request(req).body)

    def iterate_events(self, **kwargs: Any) -> Iterator[EventListItem]:
        cursor = kwargs.pop("cursor", None)
        while True:
            page = self.list_events(cursor=cursor, **kwargs)
            for item in page["items"]:
                yield item
            cursor = page.get("next_cursor")
            if not cursor:
                return

    # ──────────────────────────────────────────────────────────────
    # Deletion
    # ──────────────────────────────────────────────────────────────

    def trigger_deletion(self, **kwargs: Any) -> DeletionTriggerEnvelope:
        req = B.build_trigger_deletion_request(**kwargs)
        return cast(DeletionTriggerEnvelope, self._http.request(req).body)

    def list_deletion_receipts(self, **kwargs: Any) -> DeletionReceiptsEnvelope:
        req = B.build_list_deletion_receipts_request(**kwargs)
        return cast(DeletionReceiptsEnvelope, self._http.request(req).body)

    def iterate_deletion_receipts(self, **kwargs: Any) -> Iterator[DeletionReceiptRow]:
        cursor = kwargs.pop("cursor", None)
        while True:
            page = self.list_deletion_receipts(cursor=cursor, **kwargs)
            for item in page["items"]:
                yield item
            cursor = page.get("next_cursor")
            if not cursor:
                return

    # ──────────────────────────────────────────────────────────────
    # Rights
    # ──────────────────────────────────────────────────────────────

    def create_rights_request(self, **kwargs: Any) -> RightsRequestCreatedEnvelope:
        req = B.build_create_rights_request_request(**kwargs)
        return cast(RightsRequestCreatedEnvelope, self._http.request(req).body)

    def list_rights_requests(self, **kwargs: Any) -> RightsRequestListEnvelope:
        req = B.build_list_rights_requests_request(**kwargs)
        return cast(RightsRequestListEnvelope, self._http.request(req).body)

    def iterate_rights_requests(self, **kwargs: Any) -> Iterator[RightsRequestItem]:
        cursor = kwargs.pop("cursor", None)
        while True:
            page = self.list_rights_requests(cursor=cursor, **kwargs)
            for item in page["items"]:
                yield item
            cursor = page.get("next_cursor")
            if not cursor:
                return

    # ──────────────────────────────────────────────────────────────
    # Audit
    # ──────────────────────────────────────────────────────────────

    def list_audit_log(self, **kwargs: Any) -> AuditLogEnvelope:
        req = B.build_list_audit_log_request(**kwargs)
        return cast(AuditLogEnvelope, self._http.request(req).body)

    def iterate_audit_log(self, **kwargs: Any) -> Iterator[AuditLogItem]:
        cursor = kwargs.pop("cursor", None)
        while True:
            page = self.list_audit_log(cursor=cursor, **kwargs)
            for item in page["items"]:
                yield item
            cursor = page.get("next_cursor")
            if not cursor:
                return


__all__ = [
    "ConsentShieldClient",
    "FailOpenCallback",
]
