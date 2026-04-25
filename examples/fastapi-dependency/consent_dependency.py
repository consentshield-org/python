# ADR-1006 Phase 2 Sprint 2.2 — FastAPI Depends(...) consent gate.
#
# Uses ``AsyncConsentShieldClient`` natively so the verify request runs
# on FastAPI's event loop without thread-pool overhead. Refuses with
# HTTP 451 on non-granted; HTTP 503 on fail-CLOSED. Returns the verify
# envelope to the path operation so handlers can correlate via
# ``evaluated_at`` / ``trace_id`` if needed.
#
#   from fastapi import Depends, FastAPI
#   from consentshield import AsyncConsentShieldClient
#   from consent_dependency import consent_dependency
#
#   client = AsyncConsentShieldClient(api_key=os.environ["CS_API_KEY"])
#
#   verify_marketing = consent_dependency(
#       client,
#       property_id=os.environ["CS_PROPERTY_ID"],
#       purpose_code="marketing",
#       identifier_type="email",
#       extract_identifier=lambda req, body: body.get("email"),
#   )
#
#   @app.post("/api/marketing/send")
#   async def send(body: dict, verify=Depends(verify_marketing)):
#       return {"sent": True, "recipient": body["email"], "trace_id": verify.get("trace_id")}

from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, Optional, Union

from fastapi import HTTPException, Request, Response, status

from consentshield import (
    AsyncConsentShieldClient,
    ConsentShieldApiError,
    ConsentVerifyError,
    VerifyOutcome,
    is_open_failure,
)


IdentifierExtractor = Callable[
    [Request, Dict[str, Any]],
    Union[Optional[str], Awaitable[Optional[str]]],
]


def consent_dependency(
    client: AsyncConsentShieldClient,
    *,
    property_id: str,
    purpose_code: str,
    identifier_type: str,
    extract_identifier: IdentifierExtractor,
) -> Callable[..., Awaitable[VerifyOutcome]]:
    """Return an async FastAPI dependency that gates a path operation
    on a successful ConsentShield ``verify``.

    The returned callable accepts ``request: Request`` and
    ``response: Response`` (FastAPI auto-injects both) and resolves to
    the verify envelope on success, allowing the handler to read
    ``evaluated_at`` / ``trace_id`` for downstream correlation.
    """

    async def dependency(request: Request, response: Response) -> VerifyOutcome:
        # Body parsing — FastAPI's parsed-body lives on `request._json` only
        # after the model dependency resolves, so we re-parse here. Cheap
        # because Starlette caches the raw body.
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        identifier = extract_identifier(request, body)
        if hasattr(identifier, "__await__"):
            identifier = await identifier  # type: ignore[misc]

        if not identifier or not isinstance(identifier, str):
            raise HTTPException(status_code=400, detail="missing_identifier")

        trace_id = request.headers.get("x-trace-id")

        try:
            result = await client.verify(
                property_id=property_id,
                data_principal_identifier=identifier,
                identifier_type=identifier_type,
                purpose_code=purpose_code,
                trace_id=trace_id,
            )
        except ConsentVerifyError as err:
            if err.trace_id:
                response.headers["X-CS-Trace-Id"] = err.trace_id
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "error": "consent_verification_unavailable",
                    "trace_id": err.trace_id,
                },
            ) from err
        except ConsentShieldApiError as err:
            if err.trace_id:
                response.headers["X-CS-Trace-Id"] = err.trace_id
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={
                    "error": "consent_check_failed",
                    "status": err.status,
                    "trace_id": err.trace_id,
                },
            ) from err

        if is_open_failure(result):
            response.headers["X-CS-Override"] = (
                f"{result['cause']}:{result['reason']}"
            )
            if result.get("trace_id"):
                response.headers["X-CS-Trace-Id"] = result["trace_id"]
            return result

        if result["status"] != "granted":
            raise HTTPException(
                status_code=451,
                detail={
                    "error": "consent_not_granted",
                    "status": result["status"],
                    "property_id": result["property_id"],
                    "purpose_code": result["purpose_code"],
                    "evaluated_at": result["evaluated_at"],
                },
            )

        response.headers["X-CS-Evaluated-At"] = result["evaluated_at"]
        return result

    return dependency
