"""ADR-1006 Phase 2 Sprint 2.1 — async ``AsyncConsentShieldClient``.

Mirror of ``ConsentShieldClient`` (sync) for async Python callers
(FastAPI, async-Django, Starlette, Quart). 100% method parity; the
only difference is every method returns ``Awaitable[T]`` and the
async cursor iterators are ``AsyncIterator[T]``.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import sys
from typing import (
    Any,
    AsyncIterator,
    Awaitable,
    Callable,
    List,
    Literal,
    Optional,
    Union,
    cast,
)

import httpx

from . import _builders as B
from ._config import resolve_config
from ._http import AsyncHttpClient, HttpRequest
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

# Async callback may also accept a sync function — we detect coroutine
# returns and schedule them, otherwise call inline.
AsyncFailOpenCallback = Callable[
    [OpenFailureEnvelope, dict],  # type: ignore[type-arg]
    Union[None, Awaitable[None]],
]


def _default_async_fail_open_callback(
    envelope: OpenFailureEnvelope, ctx: dict[str, Any]
) -> None:
    _log.warning(
        "[consentshield] fail-open verify override "
        "method=%s cause=%s reason=%s trace_id=%s",
        ctx.get("method"),
        envelope.get("cause"),
        envelope.get("reason"),
        envelope.get("trace_id"),
    )


def _invoke_fail_open(
    callback: Optional[AsyncFailOpenCallback],
    envelope: OpenFailureEnvelope,
    method: VerifyMethod,
) -> None:
    """Async-side callback invoker. Coroutine returns are scheduled
    on the running event loop fire-and-forget; the verify call
    returns immediately. Sync throws + async rejections both swallowed
    with a stderr log, never breaking the verify call site.
    """
    if callback is None:
        return
    try:
        result = callback(envelope, {"method": method})
    except Exception as err:  # noqa: BLE001
        print(
            f"[consentshield] on_fail_open callback threw for {method}: {err}",
            file=sys.stderr,
        )
        return

    if result is None:
        return

    if inspect.isawaitable(result):
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # Outside an event loop — drive to completion synchronously.
            try:
                asyncio.run(_await_and_log(result, method))
            except Exception as err:  # noqa: BLE001
                print(
                    f"[consentshield] on_fail_open callback rejected for {method}: {err}",
                    file=sys.stderr,
                )
            return

        async def _drive() -> None:
            try:
                await result
            except Exception as err:  # noqa: BLE001
                print(
                    f"[consentshield] on_fail_open callback rejected for {method}: {err}",
                    file=sys.stderr,
                )

        loop.create_task(_drive())


async def _await_and_log(awaitable: Awaitable[None], method: VerifyMethod) -> None:
    try:
        await awaitable
    except Exception as err:  # noqa: BLE001
        print(
            f"[consentshield] on_fail_open callback rejected for {method}: {err}",
            file=sys.stderr,
        )


class AsyncConsentShieldClient:
    """Async client for the ConsentShield v1 API.

    Use as ``async with AsyncConsentShieldClient(...) as client``, or
    call ``await client.aclose()`` in your shutdown hook.

    Example::

        from consentshield import AsyncConsentShieldClient

        async with AsyncConsentShieldClient(api_key=...) as client:
            await client.ping()
            verdict = await client.verify(
                property_id=..., data_principal_identifier=...,
                identifier_type='email', purpose_code='marketing',
            )
    """

    def __init__(
        self,
        *,
        api_key: str,
        base_url: Optional[str] = None,
        timeout_ms: Optional[int] = None,
        max_retries: Optional[int] = None,
        fail_open: Optional[bool] = None,
        on_fail_open: Optional[AsyncFailOpenCallback] = None,
        http_client: Optional[httpx.AsyncClient] = None,
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
        self.on_fail_open: AsyncFailOpenCallback = (
            on_fail_open if on_fail_open is not None else _default_async_fail_open_callback
        )
        self._http = AsyncHttpClient(
            base_url=self.base_url,
            api_key=self.api_key,
            timeout_ms=self.timeout_ms,
            max_retries=self.max_retries,
            client=http_client,
        )

    # ──────────────────────────────────────────────────────────────
    # Lifecycle
    # ──────────────────────────────────────────────────────────────

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "AsyncConsentShieldClient":
        return self

    async def __aexit__(self, *_args: object) -> None:
        await self.aclose()

    # ──────────────────────────────────────────────────────────────
    # Health
    # ──────────────────────────────────────────────────────────────

    async def ping(self) -> bool:
        await self._http.request(HttpRequest(method="GET", path="/_ping"))
        return True

    # ──────────────────────────────────────────────────────────────
    # Verify (compliance-load-bearing)
    # ──────────────────────────────────────────────────────────────

    async def verify(
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
            resp = await self._http.request(req)
            return cast(VerifyEnvelope, resp.body)
        except ConsentShieldError as err:
            outcome = decide_failure_outcome(err, fail_open=self.fail_open)
            if isinstance(outcome, _Open):
                _invoke_fail_open(self.on_fail_open, outcome.envelope, "verify")
                return outcome.envelope
            raise outcome.error from err

    async def verify_batch(
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
            resp = await self._http.request(req)
            return cast(VerifyBatchEnvelope, resp.body)
        except ConsentShieldError as err:
            outcome = decide_failure_outcome(err, fail_open=self.fail_open)
            if isinstance(outcome, _Open):
                _invoke_fail_open(self.on_fail_open, outcome.envelope, "verify_batch")
                return outcome.envelope
            raise outcome.error from err

    # ──────────────────────────────────────────────────────────────
    # Record + revoke
    # ──────────────────────────────────────────────────────────────

    async def record_consent(
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
        resp = await self._http.request(req)
        return cast(RecordEnvelope, resp.body)

    async def revoke_artefact(
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
        resp = await self._http.request(req)
        return cast(RevokeEnvelope, resp.body)

    # ──────────────────────────────────────────────────────────────
    # Artefact CRUD + iteration
    # ──────────────────────────────────────────────────────────────

    async def list_artefacts(self, **kwargs: Any) -> ArtefactListEnvelope:
        req = B.build_list_artefacts_request(**kwargs)
        resp = await self._http.request(req)
        return cast(ArtefactListEnvelope, resp.body)

    async def iterate_artefacts(
        self, **kwargs: Any
    ) -> AsyncIterator[ArtefactListItem]:
        cursor = kwargs.pop("cursor", None)
        while True:
            page = await self.list_artefacts(cursor=cursor, **kwargs)
            for item in page["items"]:
                yield item
            cursor = page.get("next_cursor")
            if not cursor:
                return

    async def get_artefact(
        self, artefact_id: str, *, trace_id: Optional[str] = None
    ) -> Optional[ArtefactDetail]:
        req = B.build_get_artefact_request(
            artefact_id=artefact_id, trace_id=trace_id
        )
        resp = await self._http.request(req)
        return cast(Optional[ArtefactDetail], resp.body)

    # ──────────────────────────────────────────────────────────────
    # Events
    # ──────────────────────────────────────────────────────────────

    async def list_events(self, **kwargs: Any) -> EventListEnvelope:
        req = B.build_list_events_request(**kwargs)
        resp = await self._http.request(req)
        return cast(EventListEnvelope, resp.body)

    async def iterate_events(
        self, **kwargs: Any
    ) -> AsyncIterator[EventListItem]:
        cursor = kwargs.pop("cursor", None)
        while True:
            page = await self.list_events(cursor=cursor, **kwargs)
            for item in page["items"]:
                yield item
            cursor = page.get("next_cursor")
            if not cursor:
                return

    # ──────────────────────────────────────────────────────────────
    # Deletion
    # ──────────────────────────────────────────────────────────────

    async def trigger_deletion(self, **kwargs: Any) -> DeletionTriggerEnvelope:
        req = B.build_trigger_deletion_request(**kwargs)
        resp = await self._http.request(req)
        return cast(DeletionTriggerEnvelope, resp.body)

    async def list_deletion_receipts(
        self, **kwargs: Any
    ) -> DeletionReceiptsEnvelope:
        req = B.build_list_deletion_receipts_request(**kwargs)
        resp = await self._http.request(req)
        return cast(DeletionReceiptsEnvelope, resp.body)

    async def iterate_deletion_receipts(
        self, **kwargs: Any
    ) -> AsyncIterator[DeletionReceiptRow]:
        cursor = kwargs.pop("cursor", None)
        while True:
            page = await self.list_deletion_receipts(cursor=cursor, **kwargs)
            for item in page["items"]:
                yield item
            cursor = page.get("next_cursor")
            if not cursor:
                return

    # ──────────────────────────────────────────────────────────────
    # Rights
    # ──────────────────────────────────────────────────────────────

    async def create_rights_request(
        self, **kwargs: Any
    ) -> RightsRequestCreatedEnvelope:
        req = B.build_create_rights_request_request(**kwargs)
        resp = await self._http.request(req)
        return cast(RightsRequestCreatedEnvelope, resp.body)

    async def list_rights_requests(
        self, **kwargs: Any
    ) -> RightsRequestListEnvelope:
        req = B.build_list_rights_requests_request(**kwargs)
        resp = await self._http.request(req)
        return cast(RightsRequestListEnvelope, resp.body)

    async def iterate_rights_requests(
        self, **kwargs: Any
    ) -> AsyncIterator[RightsRequestItem]:
        cursor = kwargs.pop("cursor", None)
        while True:
            page = await self.list_rights_requests(cursor=cursor, **kwargs)
            for item in page["items"]:
                yield item
            cursor = page.get("next_cursor")
            if not cursor:
                return

    # ──────────────────────────────────────────────────────────────
    # Audit
    # ──────────────────────────────────────────────────────────────

    async def list_audit_log(self, **kwargs: Any) -> AuditLogEnvelope:
        req = B.build_list_audit_log_request(**kwargs)
        resp = await self._http.request(req)
        return cast(AuditLogEnvelope, resp.body)

    async def iterate_audit_log(
        self, **kwargs: Any
    ) -> AsyncIterator[AuditLogItem]:
        cursor = kwargs.pop("cursor", None)
        while True:
            page = await self.list_audit_log(cursor=cursor, **kwargs)
            for item in page["items"]:
                yield item
            cursor = page.get("next_cursor")
            if not cursor:
                return


__all__ = [
    "AsyncConsentShieldClient",
    "AsyncFailOpenCallback",
]
