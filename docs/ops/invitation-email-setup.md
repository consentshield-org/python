# Runbook — Invitation email + marketing endpoint setup

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Applies to:** ADR-0044 Phase 2.5 (invitation email dispatch) +
Phase 2.6 (HMAC-gated marketing endpoint).

**Consequence of skipping this:** Until these are set, invite
creation still works (the row is written, the operator/customer can
copy the accept URL manually), but **no email will leave the system**.
The dispatcher stamps `email_last_error='RESEND_API_KEY not configured'`
or equivalent on each invite; the pg_cron safety-net will keep
retrying until configured or the 5-attempt cap is hit. The marketing
endpoint returns 500 `INVITES_MARKETING_SECRET not configured` to
every caller.

---

## 1. One-time setup

### 1.1 Resend account + verified sender

Only needed if Resend isn't already wired for rights-request email
(`sendOtpEmail`, `sendComplianceNotification`). Check `.env.local` —
if `RESEND_API_KEY` + `RESEND_FROM` are already set, you're done with
this step.

If not:

1. Sign in at https://resend.com
2. Add + verify `consentshield.in` as a sending domain (SPF + DKIM
   records per Resend's wizard — see `reference_email_deliverability`
   memory for the exact DNS values).
3. Create an API key with "Send access" scope.

### 1.2 Vercel env vars (app project, Production + Preview)

All three endpoints live in the customer `app/` project. Set via
`vercel env add <name> production` (or the dashboard), or the Vercel
CLI inside `app/`.

| Env var | Purpose | Value source |
|---------|---------|--------------|
| `RESEND_API_KEY` | Outbound email | Resend dashboard |
| `RESEND_FROM` | Sender address | `noreply@consentshield.in` |
| `INVITATION_DISPATCH_SECRET` | Bearer token the DB trigger sends to `/api/internal/invitation-dispatch` | Generate 32-byte random hex: `openssl rand -hex 32` |
| `INVITES_MARKETING_SECRET` | HMAC shared secret for `/api/internal/invites` | Generate 32-byte random hex: `openssl rand -hex 32` |
| `SUPABASE_CS_ORCHESTRATOR_DATABASE_URL` | Direct-Postgres Supavisor URL for `cs_orchestrator` LOGIN role (ADR-1013) — replaces the pre-ADR-1013 `CS_ORCHESTRATOR_ROLE_KEY` JWT | Supabase Dashboard → Project Settings → Database → Connection pooling → Transaction mode, substituting `cs_orchestrator.<project-ref>` as the user |
| `NEXT_PUBLIC_APP_URL` | Used by both routes to build the `/signup?invite=…` accept URL sent in email | Set to the Production app origin, e.g. `https://app.consentshield.in` |

Verification — the two bearer-authed routes should 401 without a
header, not 500:

```bash
curl -i https://<app-url>/api/internal/invitation-dispatch \
  -X POST -d '{}' -H 'Content-Type: application/json'
# → 401 unauthorized

curl -i https://<app-url>/api/internal/invites \
  -X POST -d '{}' -H 'Content-Type: application/json'
# → 401 missing_headers
```

A 500 response means one of the env vars is unset.

### 1.3 Vault secrets (SQL, one-time)

The Postgres trigger + pg_cron safety-net read URL + bearer from
Supabase Vault. `ALTER DATABASE … SET` is forbidden on hosted
Supabase; Vault is the correct mechanism (see
`reference_supabase_platform_gotchas`).

Run this SQL once against the live dev project via Supabase SQL
editor or `bunx supabase db push` with a throwaway migration (the
Vault call is idempotent on `name`):

```sql
-- Dispatcher URL — public app origin + the route path.
select vault.create_secret(
  'https://<app-origin>/api/internal/invitation-dispatch',
  'cs_invitation_dispatch_url'
);

-- Same value as the INVITATION_DISPATCH_SECRET env var.
select vault.create_secret(
  '<32-byte hex from §1.2>',
  'cs_invitation_dispatch_secret'
);
```

(If the secret already exists, `vault.create_secret` raises
`duplicate_object`. Use
`select vault.update_secret(id, '<new-value>')` instead — look up
`id` via `select id from vault.secrets where name = '<name>'`.)

The `cs_orchestrator_key` Vault secret is already created by a prior
ADR (`20260414000009_cron_vault_secret.sql` setup). Don't touch it
unless you're rotating the `cs_orchestrator` role key.

---

## 2. Smoke tests after setup

### 2.1 Customer-side invite → email

1. Sign in at `/login` as an `account_owner`.
2. Visit `/dashboard/settings/members`.
3. Invite a throwaway email you control — use a `+tag` addressing scheme (`you+test@gmail.com`).
4. Observe: (a) the success card shows the accept URL; (b) the email arrives in <60s.
5. Click the accept URL in the email, complete OTP, land in `/dashboard` as the invited user.

If step 4 fails, look at `email_last_error`:

```sql
select id, invited_email, role, email_dispatched_at,
       email_dispatch_attempts, email_last_error, created_at
  from public.invitations
 where invited_email = '<your test email>'
 order by created_at desc
 limit 3;
```

Expected columns post-dispatch: `email_dispatched_at` non-null,
`email_dispatch_attempts = 1`, `email_last_error` null.

### 2.2 Operator-side invite

1. Sign in at `admin.<app-origin>/login` as `is_admin=true`.
2. Visit `/orgs/new-invite`.
3. Invite a throwaway email for a new account.
4. Observe the same pattern as §2.1.

### 2.3 Marketing endpoint

The marketing site doesn't exist yet, so this is a manual curl. Sign
a request offline with the shared secret:

```bash
SECRET=<INVITES_MARKETING_SECRET>
BODY='{"email":"curltest@example.in","plan_code":"trial_starter","default_org_name":"CurlCo"}'
TS=$(date +%s)
SIG=$(printf '%s' "${BODY}:${TS}" | openssl dgst -sha256 -hmac "$SECRET" -r | awk '{print $1}')

curl -i https://<app-origin>/api/internal/invites \
  -X POST \
  -H 'Content-Type: application/json' \
  -H "x-cs-timestamp: $TS" \
  -H "x-cs-signature: $SIG" \
  -d "$BODY"
```

Expected: 201 with `{invitation_id, accept_url, expires_at}`. The
invite row will have `role='account_owner'`, `account_id=null`,
`org_id=null`, `plan_code='trial_starter'`.

Replay the exact same request within 5 minutes → 409
`pending_invite_already_exists`. Tamper with a byte of the body and
re-sign → still works (signature matches the new body). Tamper
without re-signing → 401 `bad_signature`. Wait 6 minutes and retry
→ 408 `stale`.

### 2.4 pg_cron safety-net

If the dispatcher is intermittently down, pg_cron will re-post the
next tick. Verify it's scheduled:

```sql
select jobname, schedule, command
  from cron.job
 where jobname = 'invitation-dispatch-retry';
-- expect: schedule '*/5 * * * *'
```

Recent runs:

```sql
select j.jobname, jrd.status, substring(jrd.return_message from 1 for 120) as msg
  from cron.job_run_details jrd
  join cron.job j using (jobid)
 where j.jobname = 'invitation-dispatch-retry'
 order by jrd.start_time desc
 limit 10;
-- expect: 'succeeded' with no return_message (pg_net fires-and-forgets)
```

---

## 3. Rotating secrets

- **Dispatch bearer** — rotate `INVITATION_DISPATCH_SECRET` (Vercel) and `cs_invitation_dispatch_secret` (Vault) simultaneously. Both must hold the same value. In-flight requests from the trigger/cron using the old value may 401 until both sides are aligned — a partial window of under a minute is fine.
- **Marketing HMAC** — rotate `INVITES_MARKETING_SECRET`. Coordinate with the marketing site operator so they swap their signing secret at the same time. Old signatures will 401 `bad_signature`.
- **Resend API key** — rotate in Resend dashboard, update `RESEND_API_KEY` in Vercel. No DB-side change.
- **cs_orchestrator role key** — out of scope here. See the scoped-role ADR runbook.

---

## 4. Troubleshooting

| Symptom | Likely cause | Check |
|---------|--------------|-------|
| Invites create, email never arrives | `RESEND_API_KEY` missing or invalid | `select email_last_error from public.invitations order by created_at desc limit 5` |
| Email arrives but accept URL 404s | `NEXT_PUBLIC_APP_URL` points at the wrong origin | Open the URL — the path should be `/signup?invite=<48-hex>` |
| Dispatcher route 401 from pg_net | `INVITATION_DISPATCH_SECRET` ≠ `cs_invitation_dispatch_secret` Vault value | `select decrypted_secret from vault.decrypted_secrets where name = 'cs_invitation_dispatch_secret'` and compare |
| `email_dispatch_attempts` climbing, `email_last_error` mentions "fetch failed" | Dispatcher URL in Vault unreachable (project paused? Preview URL instead of Production?) | `select decrypted_secret from vault.decrypted_secrets where name = 'cs_invitation_dispatch_url'` |
| Marketing curl returns 408 stale immediately | System clock skew > 5 min between signer + server | `date -u` on both sides |
| Marketing curl returns 409 on first attempt | Same email already has a pending, unrevoked invite | `select * from public.invitations where lower(invited_email) = lower('<x>') and accepted_at is null and revoked_at is null` |
