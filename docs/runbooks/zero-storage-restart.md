# Runbook — zero_storage durability + restart posture

ADR-1003 Sprint 1.3.

## What this is

How a `zero_storage` org survives a ConsentShield restart, an outage of the Next.js bridge, or a transient `consent_artefact_index` write failure — and what the operator does in each case.

## Mental model

For Standard / Insulated orgs, durability lives in our database — `consent_events` is the buffer of record, the delivery pipeline drains it to customer storage, and a stuck row triggers `pipeline_stuck_buffers` alarms.

For `zero_storage` orgs we have **no buffer of record on our side**. The chain is:

1. **Cloudflare Worker** receives a `POST /v1/events` from the customer's banner.
2. Worker checks the org's `storage_mode` via the bundled KV key `storage_modes:v1` (refreshed every minute by `storage-mode-kv-sync` pg_cron and per-change by the AFTER UPDATE trigger).
3. If `zero_storage`, the Worker `ctx.waitUntil(postToBridge(...))` and returns 202 to the banner immediately — no inline R2 PUT, no Hyperdrive INSERT.
4. The Next.js **bridge route** `POST /api/internal/zero-storage-event` receives the canonical payload, decrypts the per-org credentials from `export_configurations`, and PUTs the JSON to the customer's R2 bucket at `<prefix>zero_storage/<kind>/<YYYY>/<MM>/<DD>/<event_fingerprint>.json`.
5. After a successful PUT, the bridge **best-effort** INSERTs one row per accepted purpose into `consent_artefact_index` (24h TTL, deterministic `artefact_id = "zs-<fingerprint>-<purpose_code>"`, ON CONFLICT DO NOTHING). Failure here is swallowed.

The R2 PUT is the load-bearing guarantee. The index seed is a **read cache** for `/v1/consent/verify`; missing it does not lose data.

## Failure modes + the operator response

### A) Worker returns 202, then the bridge call fails (network, 5xx, R2 rejects)

**What happens.** The customer's banner already got 202. `ctx.waitUntil` retries are not built in — the failure is logged to `worker_errors` (visible on the admin Pipeline Ops panel) with `endpoint='/v1/events'` and `upstream_error` prefixed `zero_storage_bridge_*`. **The event is lost** unless the customer's banner posts the same event again (they often do — purpose changes are sticky in browser storage).

**Operator response.**
- Watch `worker_errors` for `zero_storage_bridge_` prefixes. A single one is uninteresting; a sustained spike for one org indicates either (a) the customer's R2 credentials have expired, (b) the bridge URL is unreachable, or (c) `WORKER_BRIDGE_SECRET` is mismatched between Worker and Vercel.
- Run `select count(*), min(created_at), max(created_at) from public.worker_errors where org_id = '<id>' and upstream_error like 'zero_storage_bridge_%'` to scope the window.
- For a credential expiry: ask the customer to rotate, then re-verify via `/dashboard/settings/storage` (Sprint 2.1; for now, this is a manual update of `export_configurations.write_credential_enc` + flip `is_verified` after a manual probe).
- For a secret mismatch: confirm `wrangler secret list | grep WORKER_BRIDGE_SECRET` matches `vercel env pull` output. Rotate via `wrangler secret put` + `vercel env add` (in that order — Worker tolerates the missing secret by falling back to the standard INSERT path; Vercel rejecting good Worker requests would be silent loss).

### B) Bridge accepts but `consent_artefact_index` INSERT fails

**What happens.** Sprint 1.3's INSERT path is wrapped in try/catch with ON CONFLICT DO NOTHING. Failure → R2 PUT still completed; `BridgeResult.indexed = 0`, `indexError` populated; status to caller is still `202`. The event IS in the customer's bucket; only the validity-cache row is missing.

**Symptom.** A `/v1/consent/verify` call within the next 24h for that purpose returns `not_found` instead of `active`.

**Operator response.**
- This is the **soft** failure mode and does NOT lose data. Sprint 3.1 (deferred) will add the refresh-from-R2 path — until then, the verify-side gap is documented in customer-facing docs.
- For an in-flight outage: check `worker_errors` for `zero_storage_bridge_*` (not the trigger here; this is a DB-side failure surfaced inside the bridge route). For now the only signal is the route's own log line — `[zero-storage-bridge] index INSERT failed: <error>`. Tail Vercel function logs.

### C) ConsentShield restart while `ctx.waitUntil` is in flight

**What happens.** `ctx.waitUntil` extends the Worker's invocation past the `Response` return; Cloudflare guarantees up to 30 seconds of post-response work. A Worker restart drops in-flight `ctx.waitUntil` work — the R2 PUT is silently aborted.

**Operator response.**
- This is **silent loss** unless the customer retries. There is no buffer table to drain.
- Mitigation we accept today: this is rare (restarts happen on deploy, and the deploy script runs during low-traffic windows), and customer banners typically re-post on consent state change.
- Sprint 3.2 will measure the loss rate under a 100K-event load test; if it crosses a threshold, we'll add Cloudflare Queues (which DO survive restarts) between the Worker and the bridge.

### D) `storage_modes:v1` KV is stale; mode flipped from `standard` to `zero_storage` in the last second

**What happens.** Worker still sees `standard`, runs the regular Hyperdrive INSERT into `consent_events`. The mode flip's invariant is now broken for the few-second window between the UPDATE trigger firing and the KV sync completing.

**Operator response.**
- After flipping a customer's mode, run `select * from public.consent_events where org_id = '<id>' and created_at > now() - interval '5 minutes'` to confirm zero rows. If any: delete them via service role (`delete from public.consent_events where org_id = '<id>' and created_at > '<flip_time>'`) and document in the customer's audit log.
- The `storage-mode-kv-sync` pg_cron runs every minute as a safety net; the per-change trigger should beat it. If you see sustained drift (KV mode != DB mode), check Vercel logs for `/api/internal/storage-mode-sync` 5xx responses.
- Defensive guard: the bridge's first action is a re-read of `organisations.storage_mode` from the DB. So even if a customer banner posts directly to a stale-Worker-routed bridge call, the bridge refuses with `mode_not_zero_storage` rather than write-through.

### E) Customer's R2 bucket is full / DELETE / credentials rotated under us

**What happens.** PUT returns 4xx → `BridgeResult.outcome = 'upload_failed'` → 502 to the Worker. Worker logs to `worker_errors`. Event lost.

**Operator response.**
- A `403` from R2 → credentials are stale; ask the customer to rotate. While stale, every event for that org is lost — this is the customer's data, and they own the consequence.
- A `507` (insufficient storage) → customer needs to clean up their bucket. Same loss profile.
- Consider auto-flipping the org back to `standard` after N consecutive failures (Sprint 3.1 candidate; deferred).

## Reactivation after a long outage

If the bridge / Vercel customer-app project was down for hours and the Worker was logging `zero_storage_bridge_*` failures the whole time:

1. **Don't** retroactively replay anything. The customer's R2 has a hole; ConsentShield doesn't have the data to fill it.
2. Communicate the outage window to the customer in a Trust Centre note (`/dashboard/trust-centre`).
3. Confirm fresh events are landing: `select * from public.worker_errors where org_id = '<id>' and created_at > now() - interval '5 minutes' and upstream_error like 'zero_storage_bridge_%'` should return zero rows.
4. Spot-check the customer's R2 bucket has objects with timestamps after the outage end — `aws s3 ls s3://<bucket>/<prefix>zero_storage/consent_event/$(date -u +%Y/%m/%d)/ | head -5`.

## Verify cache refresh (Sprint 3.1)

Zero-storage rows in `consent_artefact_index` land with a 24h TTL (`expires_at = bridge_put_time + 24h`). Without intervention they expire silently after a day, and `/v1/consent/verify` returns `never_consented` for any identifier tied to an expired row.

The Sprint 3.1 hot-row refresh keeps actively-queried rows alive. The mechanism:

1. `rpc_consent_verify` / `rpc_consent_verify_batch` stamps `consent_artefact_index.last_verified_at = now()` on every `granted` hit.
2. `refresh-zero-storage-index` pg_cron runs hourly (at `:15`) and extends `expires_at = now() + 24h` on rows where `last_verified_at > now() - 1h` AND `expires_at < now() + 1h`.

Consequence: a row that gets verified at least once an hour effectively stays in cache forever. A row that stops being queried expires 24h after the last verify hit.

### What we deliberately do NOT do

The original ADR-1003 Sprint 3.1 proposal called for "refresh path: on read, if entry stale, fetch from customer storage and repopulate". That was amended at implementation time because it is incompatible with Sprint 2.1's scope-down invariant: ConsentShield's BYOK credential has `PutObject` only, not `GetObject` / `ListBucket` / `DeleteObject`. We deliberately cannot read from the customer's bucket — that is the structural audit-immutability guarantee. Any auto-refresh would require either relaxing the invariant (unacceptable) or adding a customer-side Worker that re-signs GETs on our behalf (deferred design decision).

### Operator response when a zero_storage verify returns unexpected `never_consented`

This is NOT necessarily a data-loss signal. Three possible causes:

1. **The identifier was never consented.** Verify returning `never_consented` is the correct answer. Check the customer's R2 bucket for any object mentioning that identifier; if none, the consent event genuinely never happened.
2. **The row expired 24h after the last verify hit and the customer hasn't replayed.** Check `last_verified_at` vs `expires_at` trajectory via the customer's R2 audit objects. If the event exists in R2 but the row is gone from the index, this is expected Sprint 3.1 behaviour.
3. **The event is in flight — the bridge hasn't finished uploading yet.** Check `worker_errors` for `zero_storage_bridge_*` prefixes in the last few minutes.

For cause (2), the customer rehydrates by replaying the canonical consent record through `/v1/consent/record` (Mode B). The replay inserts a fresh row into `consent_artefact_index` via the regular Mode B path and resumes normal verify semantics.

### Metrics to watch

```sql
-- How many zero-storage rows did the last cron run refresh?
select public.refresh_zero_storage_index_hot_rows();
-- → { ok: true, refreshed_count: N, ran_at: ... }

-- Cron health (active rows + last run).
select jobname, schedule, active from cron.job where jobname = 'refresh-zero-storage-index';

-- Hot row count per zero-storage org (useful for dashboard).
select o.id, o.name, count(*) as hot_rows
  from public.organisations o
  join public.consent_artefact_index cai on cai.org_id = o.id
 where coalesce(o.storage_mode, 'standard') = 'zero_storage'
   and cai.validity_state = 'active'
   and cai.last_verified_at > now() - interval '1 hour'
 group by o.id, o.name
 order by hot_rows desc;
```

A zero-storage org with zero hot rows after several days of operation either (a) is not receiving verify traffic (legitimate, e.g., write-only onboarding), or (b) has a misconfigured API client. No alerting threshold is enforced — the signal is too noisy to automate on.

## What this runbook does NOT cover

- Initial `zero_storage` provisioning. See ADR-1003 Sprint 2.1 (shipped) for the scope-down probe; Sprint 2.2 (shipped) for the customer-facing BYOS docs.
- Automatic refresh-from-R2 of expired rows. Deliberately not shipped — see "Verify cache refresh" above.
- Cross-region failover. See ADR-1003 Sprint 3.2 (planned).
