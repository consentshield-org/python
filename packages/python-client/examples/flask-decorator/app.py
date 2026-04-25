# Flask demo wiring the @consent_required decorator on /api/marketing/send.
#
#   pip install consentshield flask
#   CS_API_KEY=cs_live_... CS_PROPERTY_ID=PROP_UUID python app.py
#
#   curl -X POST http://localhost:4040/api/marketing/send \
#        -H 'Content-Type: application/json' \
#        -d '{"email":"user@example.com","subject":"Hello"}'

from __future__ import annotations

import os
import sys

from flask import Flask, jsonify, request

from consentshield import ConsentShieldClient
from consent_required import consent_required


api_key = os.environ.get("CS_API_KEY")
property_id = os.environ.get("CS_PROPERTY_ID")
if not api_key or not property_id:
    print("CS_API_KEY and CS_PROPERTY_ID env vars are required", file=sys.stderr)
    sys.exit(1)


app = Flask(__name__)
client = ConsentShieldClient(api_key=api_key)


@app.post("/api/marketing/send")
@consent_required(
    client,
    property_id=property_id,
    purpose_code="marketing",
    identifier_type="email",
    get_identifier=lambda: (request.get_json(silent=True) or {}).get("email"),
)
def send_marketing() -> object:
    body = request.get_json(silent=True) or {}
    return jsonify(sent=True, recipient=body.get("email"))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "4040")))
