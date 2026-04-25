# FastAPI demo. Run with:
#
#   pip install consentshield 'fastapi[standard]'
#   CS_API_KEY=cs_live_... CS_PROPERTY_ID=PROP_UUID uvicorn app:app --port 4040
#
#   curl -X POST http://localhost:4040/api/marketing/send \
#        -H 'Content-Type: application/json' \
#        -d '{"email":"user@example.com","subject":"Hello"}'

from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import Depends, FastAPI

from consentshield import AsyncConsentShieldClient
from consent_dependency import consent_dependency


api_key = os.environ.get("CS_API_KEY")
property_id = os.environ.get("CS_PROPERTY_ID")
if not api_key or not property_id:
    print("CS_API_KEY and CS_PROPERTY_ID env vars are required", file=sys.stderr)
    sys.exit(1)


client = AsyncConsentShieldClient(api_key=api_key)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    try:
        yield
    finally:
        await client.aclose()


app = FastAPI(lifespan=lifespan)


verify_marketing = consent_dependency(
    client,
    property_id=property_id,
    purpose_code="marketing",
    identifier_type="email",
    extract_identifier=lambda _req, body: body.get("email"),
)


@app.post("/api/marketing/send")
async def send_marketing(body: dict, verify: dict = Depends(verify_marketing)) -> dict:
    return {
        "sent": True,
        "recipient": body.get("email"),
        "evaluated_at": verify.get("evaluated_at"),
    }
