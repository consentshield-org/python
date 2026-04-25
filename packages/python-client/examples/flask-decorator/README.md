# Flask `@consent_required` example

Decorator that verifies consent before the view runs.

## How it works

`@consent_required(client, ...)` wraps a Flask view. Per request:

1. Pulls the data-principal identifier via the caller-supplied
   `get_identifier()` callable (typically a lambda that reads the
   request body / query / form).
2. Calls `client.verify(...)` with the configured property + purpose.
3. Branches:

| Outcome | HTTP response | Notes |
|---|---|---|
| `status: granted` | view runs as normal | response carries `X-CS-Evaluated-At` |
| `status: revoked` / `expired` / `never_consented` | **451** | with the verify envelope in the body |
| `is_open_failure(result)` (fail-OPEN override) | view runs | response carries `X-CS-Override: <cause>:<reason>` |
| `ConsentVerifyError` (fail-CLOSED default) | **503** | NEVER default-grants |
| `ConsentShieldApiError` (4xx) | **502** | with the original status surfaced |

## Run

```sh
pip install consentshield flask

CS_API_KEY=cs_live_xxx CS_PROPERTY_ID=PROP_UUID python app.py

curl -X POST http://localhost:4040/api/marketing/send \
     -H 'Content-Type: application/json' \
     -d '{"email":"user@example.com","subject":"Hello"}'
```

## Why fail-CLOSED → 503

See the Django example's README — the rationale is identical. The
SDK's default protects the data principal whenever ConsentShield is
unreachable; opt into fail-OPEN explicitly per call site if the
business case requires it.
