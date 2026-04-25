# ADR-1006 Phase 2 Sprint 2.2 — Flask `@consent_required` decorator.
#
# Drop-in equivalent of the Express `consentRequired` middleware. Wrap
# any view that should not run unless ConsentShield reports `granted`
# for the data principal on the configured purpose.
#
#   from flask import Flask, request
#   from consentshield import ConsentShieldClient
#   from consent_required import consent_required
#
#   app = Flask(__name__)
#   client = ConsentShieldClient(api_key=os.environ["CS_API_KEY"])
#
#   @app.post("/api/marketing/send")
#   @consent_required(
#       client,
#       property_id=os.environ["CS_PROPERTY_ID"],
#       purpose_code="marketing",
#       identifier_type="email",
#       get_identifier=lambda: request.get_json(silent=True, force=True).get("email"),
#   )
#   def send_marketing():
#       body = request.get_json()
#       return {"sent": True, "recipient": body["email"]}

from __future__ import annotations

from functools import wraps
from typing import Any, Callable, Optional

from flask import jsonify, make_response, request

from consentshield import (
    ConsentShieldApiError,
    ConsentShieldClient,
    ConsentVerifyError,
    is_open_failure,
)


def consent_required(
    client: ConsentShieldClient,
    *,
    property_id: str,
    purpose_code: str,
    identifier_type: str,
    get_identifier: Callable[[], Optional[str]],
    get_trace_id: Optional[Callable[[], Optional[str]]] = None,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Return a Flask view decorator that gates on ConsentShield verify."""

    def decorator(view: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(view)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            identifier = get_identifier()
            if not identifier:
                return jsonify(error="missing_identifier"), 400

            trace_id = (
                get_trace_id() if get_trace_id else request.headers.get("X-Trace-Id")
            )

            try:
                result = client.verify(
                    property_id=property_id,
                    data_principal_identifier=identifier,
                    identifier_type=identifier_type,
                    purpose_code=purpose_code,
                    trace_id=trace_id,
                )
            except ConsentVerifyError as err:
                response = make_response(
                    jsonify(
                        error="consent_verification_unavailable",
                        trace_id=err.trace_id,
                    ),
                    503,
                )
                if err.trace_id:
                    response.headers["X-CS-Trace-Id"] = err.trace_id
                return response
            except ConsentShieldApiError as err:
                response = make_response(
                    jsonify(
                        error="consent_check_failed",
                        status=err.status,
                        trace_id=err.trace_id,
                    ),
                    502,
                )
                if err.trace_id:
                    response.headers["X-CS-Trace-Id"] = err.trace_id
                return response

            if is_open_failure(result):
                response = make_response(view(*args, **kwargs))
                response.headers["X-CS-Override"] = (
                    f"{result['cause']}:{result['reason']}"
                )
                if result.get("trace_id"):
                    response.headers["X-CS-Trace-Id"] = result["trace_id"]
                return response

            if result["status"] != "granted":
                return (
                    jsonify(
                        error="consent_not_granted",
                        status=result["status"],
                        property_id=result["property_id"],
                        purpose_code=result["purpose_code"],
                        evaluated_at=result["evaluated_at"],
                    ),
                    451,
                )

            response = make_response(view(*args, **kwargs))
            response.headers["X-CS-Evaluated-At"] = result["evaluated_at"]
            return response

        return wrapper

    return decorator
