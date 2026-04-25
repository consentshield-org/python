# FastAPI consent-dependency example

FastAPI dependency built on `AsyncConsentShieldClient`. Verify runs
on the event loop natively — no thread pool, no sync bridge.

## How it works

`consent_dependency(client, ...)` returns an async dependency you wire
into a path operation with `Depends(...)`. Per request:

1. Reads the JSON body and pulls the data-principal identifier via
   the caller-supplied `extract_identifier(request, body)`.
2. `await`s `client.verify(...)` against the configured property +
   purpose.
3. Branches:

| Outcome | HTTP response | Notes |
|---|---|---|
| `status: granted` | path operation runs; verify envelope is the dependency value | response carries `X-CS-Evaluated-At` |
| `status: revoked` / `expired` / `never_consented` | **HTTPException(451)** | with the verify envelope as `detail` |
| `is_open_failure(result)` (fail-OPEN override) | path operation runs | response carries `X-CS-Override: <cause>:<reason>` |
| `ConsentVerifyError` (fail-CLOSED default) | **HTTPException(503)** | NEVER default-grants |
| `ConsentShieldApiError` (4xx) | **HTTPException(502)** | with the original status surfaced |

The dependency returns the verify envelope to the path operation, so
handlers can read `evaluated_at` / `trace_id` for downstream
correlation:

```python
@app.post("/api/marketing/send")
async def send_marketing(body: dict, verify=Depends(verify_marketing)):
    return {"sent": True, "evaluated_at": verify.get("evaluated_at")}
```

## Run

```sh
pip install consentshield 'fastapi[standard]'

CS_API_KEY=cs_live_xxx CS_PROPERTY_ID=PROP_UUID uvicorn app:app --port 4040

curl -X POST http://localhost:4040/api/marketing/send \
     -H 'Content-Type: application/json' \
     -d '{"email":"user@example.com","subject":"Hello"}'
```

## Lifespan close

The demo uses FastAPI's `lifespan` context to call
`await client.aclose()` on shutdown. This closes the underlying
`httpx.AsyncClient`'s connection pool cleanly. Skip it and you'll
see `RuntimeWarning: coroutine ... was never awaited` warnings on
process exit.

## Why fail-CLOSED → 503

See the Django example's README — the rationale is identical. The
SDK's default protects the data principal whenever ConsentShield is
unreachable; opt into fail-OPEN explicitly per call site if the
business case requires it.
