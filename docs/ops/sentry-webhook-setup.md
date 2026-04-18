# Sentry → ConsentShield webhook setup

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

Shipping alongside **ADR-0049 Phase 2**. This runbook configures a Sentry Internal Integration in each ConsentShield Sentry project so error-level events POST to our webhook endpoint and appear in the Admin Security → Sentry escalations tab.

## Prerequisites

- Sentry org: `consentshield` (or whatever `NEXT_PUBLIC_SENTRY_ORG` on the admin project is set to).
- Projects: `consentshield-app`, `consentshield-admin`.
- Admin Vercel deploy URL (production preview URL also works for a round-trip smoke).

## 1. Generate a webhook secret

```bash
openssl rand -hex 32
```

Store the output as `SENTRY_WEBHOOK_SECRET`:

- **Vercel (customer app project)** — the route handler lives in the `app/` Next.js project. Add `SENTRY_WEBHOOK_SECRET` to the Production environment for that Vercel project.
- **`.env.local`** — paste the same value so local dev + tests can verify the HMAC.

## 2. Create the Sentry Internal Integration

In the Sentry org settings → **Developer Settings → Internal Integrations → New Internal Integration**:

| Field | Value |
|---|---|
| Name | ConsentShield Webhook |
| Webhook URL | `https://app.consentshield.in/api/webhooks/sentry` |
| Verify SSL | ✓ |
| Client Secret | paste the secret from step 1 |

Under **Permissions** tick:
- `Event`: Read
- `Issue & Event`: Read

Under **Webhooks** tick:
- `issue`
- `error`

Save. Sentry generates a Client Secret — use that same value (or, if you prefer, replace the generated one with your step-1 secret via the API; matching the `.env` value is what matters).

## 3. Subscribe each project

From **Settings → [Project] → Alerts → Internal Integrations** on both `consentshield-app` and `consentshield-admin`, add the ConsentShield Webhook integration and enable the `event.alert` / `issue` hooks.

## 4. Round-trip smoke

Force an error in local dev:

```ts
// Anywhere in a server action or route handler
throw new Error('ADR-0049 webhook smoke test')
```

Within ~1 minute:

1. Sentry ingests the event.
2. The internal integration POSTs the webhook to `/api/webhooks/sentry`.
3. The route verifies HMAC → upserts into `public.sentry_events` on the `sentry_id` key.
4. The Admin Security → Sentry tab auto-refreshes every 30s and picks the row up.

If nothing shows up:

```bash
# Tail Vercel logs for the webhook route
vercel logs <deployment-url> --follow
# Look for '[sentry-webhook] upsert failed' or HMAC failures
```

## 5. What this ADR does NOT cover

- Inline resolve/assign (still happens in Sentry proper).
- Historical backfill — only events received after the integration is wired land in `sentry_events`.
- Info/debug severity — filtered at the webhook route; add when operator need emerges.
