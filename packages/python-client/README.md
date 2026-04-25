# `consentshield` (Python)

Official Python client for the [ConsentShield](https://consentshield.in)
DPDP compliance API. Fail-closed by default. 2-second per-request
timeout. Trace-id correlated. **Sync + async parity** — pick the
client matching your framework.

## Installation

```sh
pip install consentshield
# or
uv pip install consentshield
# or
poetry add consentshield
```

Requires Python 3.9 or newer. Built on `httpx`.

## Quickstart

### Sync (Django, Flask, scripts)

```python
from consentshield import ConsentShieldClient

with ConsentShieldClient(api_key=os.environ["CS_API_KEY"]) as client:
    client.ping()  # → True; raises on any failure

    result = client.verify(
        property_id="PROP_UUID",
        data_principal_identifier="user@example.com",
        identifier_type="email",
        purpose_code="marketing",
    )
    if result["status"] == "granted":
        ...  # proceed
```

### Async (FastAPI, async-Django, Starlette)

```python
from consentshield import AsyncConsentShieldClient

async with AsyncConsentShieldClient(api_key=os.environ["CS_API_KEY"]) as client:
    await client.ping()
    result = await client.verify(
        property_id="PROP_UUID",
        data_principal_identifier="user@example.com",
        identifier_type="email",
        purpose_code="marketing",
    )
```

## Methods (parity with `@consentshield/node`)

### Consent

| Method | Route | Notes |
|---|---|---|
| `client.verify(...)` | `GET /v1/consent/verify` | Single-identifier check. Fail-closed by default. |
| `client.verify_batch(...)` | `POST /v1/consent/verify/batch` | ≤ 10 000 identifiers per call (client-side cap matches the server). |
| `client.record_consent(...)` | `POST /v1/consent/record` | Idempotency-keyed via `client_request_id`. |
| `client.revoke_artefact(id, ...)` | `POST /v1/consent/artefacts/{id}/revoke` | URL-encoded path. 409 on terminal-state. |

### Listing + cursor iteration

| Method | Route | Iterator helper |
|---|---|---|
| `client.list_artefacts(...)` | `GET /v1/consent/artefacts` | `client.iterate_artefacts(...)` |
| `client.get_artefact(id)` | `GET /v1/consent/artefacts/{id}` | — |
| `client.list_events(...)` | `GET /v1/consent/events` | `client.iterate_events(...)` |
| `client.list_deletion_receipts(...)` | `GET /v1/deletion/receipts` | `client.iterate_deletion_receipts(...)` |
| `client.list_rights_requests(...)` | `GET /v1/rights/requests` | `client.iterate_rights_requests(...)` |
| `client.list_audit_log(...)` | `GET /v1/audit` | `client.iterate_audit_log(...)` |

Sync iterators are regular generators; async iterators are
`AsyncIterator[T]`.

### Deletion + rights

| Method | Route | Notes |
|---|---|---|
| `client.trigger_deletion(...)` | `POST /v1/deletion/trigger` | `purpose_codes` REQUIRED when `reason='consent_revoked'`. |
| `client.create_rights_request(...)` | `POST /v1/rights/requests` | `identity_verified_by` required (DPB-facing audit trail). |

## Compliance posture

Strict by default — encodes the
[v2 whitepaper §5.4](https://consentshield.in/docs/api-design/timeouts)
position that an unverifiable consent decision MUST default-CLOSED,
never default-open.

| Default | Value | Rationale |
|---|---|---|
| `timeout_ms` | 2 000 | Consent-decision budget; SDK raises rather than block your hot path. |
| `max_retries` | 3 | Exponential backoff (100/400/1600 ms) on 5xx + transport. **Never** on 4xx, **never** on timeouts. |
| `fail_open` | `False` | Failed `verify` raises `ConsentVerifyError`. Set `True` (or `CONSENT_VERIFY_FAIL_OPEN=true`) to opt into fail-open with audit-trail recording. |
| `on_fail_open` | structured `logging.warning` | Production wiring — pass a custom callable. |

### Fail-open behaviour table for `verify` / `verify_batch`

| Outcome | Default (`fail_open=False`) | Opt-in (`fail_open=True`) |
|---|---|---|
| 200 | returns `VerifyEnvelope` | returns `VerifyEnvelope` |
| timeout / network / 5xx | raises `ConsentVerifyError` | returns `OpenFailureEnvelope`; `on_fail_open` fires |
| 4xx | raises `ConsentShieldApiError` | raises `ConsentShieldApiError` (NEVER opens) |

The 4xx-always-raises rule is non-negotiable.

## Error model

All errors descend from `ConsentShieldError`:

| Class | When |
|---|---|
| `ConsentShieldApiError` | Server returned a 4xx/5xx with an RFC 7807 problem document. `status` + `problem` fields exposed. |
| `ConsentShieldNetworkError` | Transport failure. Retried before surfacing. |
| `ConsentShieldTimeoutError` | Request exceeded `timeout_ms`. Never retried. |
| `ConsentVerifyError` | A `verify` call could not be evaluated AND `fail_open` is False (the default). Carries the underlying cause. |

Every error carries `trace_id` lifted from the response's
`X-CS-Trace-Id` header (per [ADR-1014 Sprint 3.2](https://consentshield.in/docs/test-verification))
so server-side log correlation is one grep away when you report an issue.

## License

(c) 2026 Sudhindra Anegondhi <a.d.sudhindra@gmail.com>. See `LICENSE.md`.
