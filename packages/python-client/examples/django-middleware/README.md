# Django consent-middleware example

Django middleware that verifies consent on configured routes before the
view runs.

## How it works

`ConsentMiddleware` reads `settings.CONSENTSHIELD` for the API key, the
property id, and a list of `ROUTES` declarations. For every inbound
request it:

1. Matches the request path against `path_prefix`. No match → request
   passes through unchanged.
2. Pulls the data-principal identifier off the request (JSON body →
   form → query string → `X-CS-<field>` header, in that order).
3. Calls `client.verify(...)` against the route's purpose.
4. Branches:

| Outcome | HTTP response | Notes |
|---|---|---|
| `status: granted` | view runs as normal | response carries `X-CS-Evaluated-At` |
| `status: revoked` / `expired` / `never_consented` | **451 Unavailable For Legal Reasons** | with the verify envelope in the body |
| `is_open_failure(result)` (fail-OPEN override) | view runs | response carries `X-CS-Override: <cause>:<reason>` |
| `ConsentVerifyError` (fail-CLOSED default) | **503 Service Unavailable** | NEVER default-grants |
| `ConsentShieldApiError` (4xx) | **502 Bad Gateway** | with the original status surfaced |

## Run

```sh
pip install consentshield django

CS_API_KEY=cs_live_xxx CS_PROPERTY_ID=PROP_UUID \
    DJANGO_SETTINGS_MODULE=examples.django_middleware.settings_demo \
    python -m django runserver 0.0.0.0:8000

curl -X POST http://localhost:8000/api/marketing/send \
     -H 'Content-Type: application/json' \
     -d '{"email":"user@example.com","subject":"Hello"}'
```

## Why fail-CLOSED → 503 (not 200)

Defaulting to "send the email anyway" when ConsentShield is briefly
unreachable is the worst DPDP outcome — you might mail a user whose
consent was withdrawn 30 seconds ago. The SDK's fail-CLOSED default
forces the question: do you treat ConsentShield as a hard dependency
(503 → caller retries) or do you opt into fail-open (`fail_open=True`
+ wire `on_fail_open` to your audit sink)? Either is defensible; the
default is the safe one.
