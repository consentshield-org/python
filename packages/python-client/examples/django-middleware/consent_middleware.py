# ADR-1006 Phase 2 Sprint 2.2 — Django consent middleware example.
#
# Refuses inbound requests with HTTP 451 ("Unavailable For Legal Reasons")
# when the data principal has not actively granted consent for the
# purpose. Honours the SDK's fail-CLOSED default — a 5xx / network /
# timeout from ConsentShield results in a 503 from your service, NOT
# a silent default-grant.
#
# Usage in settings.py:
#
#   MIDDLEWARE = [
#       ...
#       "examples.django_middleware.consent_middleware.ConsentMiddleware",
#   ]
#
#   CONSENTSHIELD = {
#       "API_KEY": os.environ["CS_API_KEY"],
#       "PROPERTY_ID": os.environ["CS_PROPERTY_ID"],
#       "ROUTES": [
#           {
#               "path_prefix": "/api/marketing/send",
#               "purpose_code": "marketing",
#               "identifier_type": "email",
#               "identifier_field": "email",  # POST body / query / header
#           },
#       ],
#   }

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from django.conf import settings
from django.http import HttpRequest, HttpResponse, JsonResponse

from consentshield import (
    ConsentShieldApiError,
    ConsentShieldClient,
    ConsentVerifyError,
    is_open_failure,
)


def _get_identifier(request: HttpRequest, field: str) -> Optional[str]:
    """Look in JSON body / form / query / header (in that order)."""
    body_json: Dict[str, Any] = {}
    if request.content_type == "application/json" and request.body:
        try:
            import json

            body_json = json.loads(request.body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            body_json = {}

    candidates: List[Optional[str]] = [
        body_json.get(field) if isinstance(body_json, dict) else None,
        request.POST.get(field),
        request.GET.get(field),
        request.headers.get(f"X-CS-{field.replace('_', '-')}"),
    ]
    for value in candidates:
        if isinstance(value, str) and value:
            return value
    return None


class ConsentMiddleware:
    """Django middleware that gates routes on ConsentShield verify."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response
        cfg = getattr(settings, "CONSENTSHIELD", {})
        self.client = ConsentShieldClient(api_key=cfg["API_KEY"])
        self.property_id: str = cfg["PROPERTY_ID"]
        self.routes: List[Dict[str, str]] = cfg.get("ROUTES", [])

    def __call__(self, request: HttpRequest) -> HttpResponse:
        route = self._match_route(request.path)
        if route is None:
            return self.get_response(request)

        identifier = _get_identifier(request, route["identifier_field"])
        if not identifier:
            return JsonResponse(
                {"error": "missing_identifier", "field": route["identifier_field"]},
                status=400,
            )

        trace_id = request.headers.get("X-Trace-Id") or None

        try:
            result = self.client.verify(
                property_id=self.property_id,
                data_principal_identifier=identifier,
                identifier_type=route["identifier_type"],
                purpose_code=route["purpose_code"],
                trace_id=trace_id,
            )
        except ConsentVerifyError as err:
            response = JsonResponse(
                {
                    "error": "consent_verification_unavailable",
                    "trace_id": err.trace_id,
                },
                status=503,
            )
            if err.trace_id:
                response["X-CS-Trace-Id"] = err.trace_id
            return response
        except ConsentShieldApiError as err:
            response = JsonResponse(
                {
                    "error": "consent_check_failed",
                    "status": err.status,
                    "trace_id": err.trace_id,
                },
                status=502,
            )
            if err.trace_id:
                response["X-CS-Trace-Id"] = err.trace_id
            return response

        if is_open_failure(result):
            response = self.get_response(request)
            response["X-CS-Override"] = f"{result['cause']}:{result['reason']}"
            if result.get("trace_id"):
                response["X-CS-Trace-Id"] = result["trace_id"]
            return response

        if result["status"] != "granted":
            return JsonResponse(
                {
                    "error": "consent_not_granted",
                    "status": result["status"],
                    "property_id": result["property_id"],
                    "purpose_code": result["purpose_code"],
                    "evaluated_at": result["evaluated_at"],
                },
                status=451,
            )

        response = self.get_response(request)
        # `evaluated_at` is the strongest correlator we have for the
        # downstream send to thread back to the verify call.
        response["X-CS-Evaluated-At"] = result["evaluated_at"]
        return response

    def _match_route(self, path: str) -> Optional[Dict[str, str]]:
        for route in self.routes:
            if path.startswith(route["path_prefix"]):
                return route
        return None
