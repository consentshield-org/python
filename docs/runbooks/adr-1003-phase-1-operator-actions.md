# ADR-1003 Phase 1 — operator actions

One-shot operator checklist after migrations 50–57 land. Follow steps in order.

**2026-04-25 execution status**

| Step | State | Notes |
|---|---|---|
| 1 — Vault seed (+ cs_delivery password rotation) | ✅ Done | Ran one consolidated block in SQL editor |
| 2 — Worker wrangler secrets | ✅ Done | `WORKER_BRIDGE_SECRET` + `ZERO_STORAGE_BRIDGE_URL` |
| 3 — Vercel env vars (production + preview + development) | ✅ Done | `WORKER_BRIDGE_SECRET` × 3 + `SUPABASE_CS_DELIVERY_DATABASE_URL` × 3 |
| 4 — Mirror into `app/.env.local` | ✅ Done | |
| 5a — Storage-mode KV sync | ⏳ | Requires admin SQL-editor action |
| 5b — Mode A invariant | ⏳ | Requires live banner flow on a zero_storage org |
| 5c — Mode B invariant | ⏳ | Requires live api_key POST to `/v1/consent/record` |
| 5d — Hot-row TTL refresh | ⏳ | Run the single `select public.refresh_zero_storage_index_hot_rows();` in SQL editor |
| 5e — Integration suite | ✅ Done | 5/5 PASS locally (Mode A 1.3 + Mode B 1.4) after migration 57 published `get_storage_mode` as SECURITY DEFINER |

## 1. Vault seed + cs_delivery password rotation (Supabase SQL editor)

Run as `postgres`/service-role in the Supabase SQL editor (Project → SQL).
The block is idempotent for the Vault section; the `alter role` can be re-run
safely but **will rotate the password each time** — only run once per rotation
cycle, and keep the password recorded for the DSN.

```sql
-- (1) ADR-1019 Sprint 1.1 carry-over: rotate cs_delivery password from placeholder
-- (Pick a fresh 32-byte hex per rotation; example below is the 2026-04-25 value —
--  replace at each subsequent rotation.)
alter role cs_delivery with password '<32-byte-hex>';

-- (2) Vault seed for ADR-1003 (storage_mode KV sync) + ADR-1019 (delivery dispatch)
-- Bearer reuses cs_provision_storage_secret (already seeded by ADR-1025).

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cs_storage_mode_sync_url') then
    perform vault.create_secret(
      'https://app.consentshield.in/api/internal/storage-mode-sync',
      'cs_storage_mode_sync_url',
      'POST endpoint for KV storage_mode propagation (ADR-1003 Sprint 1.1)'
    );
  end if;

  if not exists (select 1 from vault.secrets where name = 'cs_deliver_events_url') then
    perform vault.create_secret(
      'https://app.consentshield.in/api/internal/deliver-consent-events',
      'cs_deliver_events_url',
      'POST endpoint for delivery dispatch (ADR-1019 Sprint 3.1)'
    );
  end if;
end $$;

-- Confirmation
select name, description
  from vault.secrets
 where name in ('cs_storage_mode_sync_url',
                'cs_deliver_events_url',
                'cs_provision_storage_secret')
 order by name;
```

Expected: three rows.

## 2. Worker secrets (wrangler)

```bash
cd worker
# 32-byte hex; the Worker AND Vercel must hold the same value.
SECRET=$(openssl rand -hex 32)

# Worker side
echo -n "$SECRET" | wrangler secret put WORKER_BRIDGE_SECRET
echo -n "https://app.consentshield.in/api/internal/zero-storage-event" | \
  wrangler secret put ZERO_STORAGE_BRIDGE_URL
```

Hold `$SECRET` in a scratch buffer for step 3 — same byte-identical value.

## 3. Vercel env (customer app)

```bash
cd app

# Vercel UI: Project Settings → Environment Variables
# OR via CLI:
echo -n "$SECRET" | vercel env add WORKER_BRIDGE_SECRET production
echo -n "$SECRET" | vercel env add WORKER_BRIDGE_SECRET preview
echo -n "$SECRET" | vercel env add WORKER_BRIDGE_SECRET development

# SUPABASE_CS_DELIVERY_DATABASE_URL — copy from .env.local where it was
# seeded in ADR-1019 Sprint 1.1 (cs_delivery role through Supavisor pooler).
SUPABASE_CS_DELIVERY_DATABASE_URL=$(grep '^SUPABASE_CS_DELIVERY_DATABASE_URL=' .env.local | cut -d= -f2-)
echo -n "$SUPABASE_CS_DELIVERY_DATABASE_URL" | vercel env add SUPABASE_CS_DELIVERY_DATABASE_URL production
echo -n "$SUPABASE_CS_DELIVERY_DATABASE_URL" | vercel env add SUPABASE_CS_DELIVERY_DATABASE_URL preview
```

Re-deploy customer app after env writes (`vercel --prod` or push to main).

## 4. Mirror secret in `app/.env.local`

```bash
cd app
# Append (or update) the same WORKER_BRIDGE_SECRET so local dev matches prod.
echo "WORKER_BRIDGE_SECRET=$SECRET" >> .env.local
```

## 5. Smoke tests

After steps 1–4 are live:

### 5a. Storage-mode KV sync

```sql
-- In Supabase SQL editor — flip a test org to insulated, then back.
select admin.set_organisation_storage_mode(
  '<test-org-uuid>'::uuid,
  'insulated'::storage_mode,
  'smoke-test'
);
-- Watch app logs for the /api/internal/storage-mode-sync hit (≤60s).
-- KV key cs:org:<org_id>:storage_mode should now read "insulated".
```

Flip back to `standard` once verified.

### 5b. Mode A invariant (Worker path)

Post a banner accept event from a test property bound to a `zero_storage` org.
Expect:
- Customer R2 bucket holds the new object.
- `consent_artefact_index` has one new row with `identifier_hash` populated.
- All five buffer tables (`consent_events`, `tracker_observations`, `audit_log`,
  `processing_log`, `delivery_buffer`) have **zero** rows for that org.

### 5c. Mode B invariant (POST /v1/consent/record)

```bash
# With a real api_key bound to the zero_storage org:
curl -sS -X POST https://app.consentshield.in/api/v1/consent/record \
  -H "Authorization: Bearer cs_<key>" \
  -H "Content-Type: application/json" \
  -d '{
    "org_id": "<org-uuid>",
    "property_id": "<property-uuid>",
    "captured_at": "2026-04-25T08:00:00Z",
    "client_request_id": "smoke-modeB-001",
    "identifier": {"type": "email", "value": "smoke@example.test"},
    "purposes_accepted": ["analytics"],
    "purposes_rejected": []
  }'
```

Expect:
- `event_id` returned with `zs-` prefix.
- `consent_artefact_index` row with populated `identifier_hash` + `identifier_type='email'`.
- Replay with same `client_request_id` → identical `event_id`, no duplicate index row.
- All five buffer tables empty for that org.

### 5d. Hot-row TTL refresh

```sql
-- Ad-hoc invocation:
select public.refresh_zero_storage_index_hot_rows();

-- OR wait for the :15 cron tick after a verify-batch call.
-- Confirm last_verified_at advanced and expires_at extended.
```

### 5e. Integration suite (must show 5 tests, not 3)

```bash
cd app
CS_API_DSN="$SUPABASE_CS_API_DATABASE_URL" \
CS_ORCH_DSN="$SUPABASE_CS_ORCHESTRATOR_DATABASE_URL" \
MASTER_KEY="<MASTER_ENCRYPTION_KEY from .env.local>" \
bun run test tests/integration/zero-storage-invariant.test.ts --reporter=verbose
```

Expect output to include the Mode B describe block actually running.
If you see only 3 tests, one of `CS_API_DSN`, `CS_ORCH_DSN`, or `MASTER_KEY`
is missing — the suite silently skips. (See gotcha in `session-handoff-terminal-a.md`.)

---

## Rollback

If any step fails irrecoverably, the revert path is per-step:

| Step | Revert |
|---|---|
| 1 (Vault) | `delete from vault.secrets where name in ('cs_storage_mode_sync_url','cs_deliver_events_url')` |
| 2 (Worker) | `wrangler secret delete WORKER_BRIDGE_SECRET` etc. |
| 3 (Vercel) | `vercel env rm WORKER_BRIDGE_SECRET production` etc. |

Migrations 50–55 are forward-only — do not roll those back without an explicit
schema-rescue ADR.
