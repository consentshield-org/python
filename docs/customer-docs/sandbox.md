# Sandbox

(c) 2026 Sudhindra Anegondhi — ConsentShield customer documentation.

A sandbox org lets you exercise the ConsentShield API end-to-end &mdash; banner delivery, consent recording, rights flows, deletion connectors, exports &mdash; without affecting your production data, plan limits, or billing. It sits inside your one ConsentShield account alongside your production orgs (Stripe / Razorpay test-mode pattern).

## Who this is for

- **Backend engineers** writing integration tests against the v1 API.
- **Compliance / legal teams** rehearsing a rights-request workflow before signing off on production rollout.
- **Procurement evaluators** running a clinic's full onboarding playbook end-to-end before signing the contract.

## Quick reference

| Property | Production org | Sandbox org |
|---|---|---|
| Org id | UUID | UUID (no special prefix) |
| Suffix on org name | none | ` (sandbox)` appended automatically |
| API key prefix | `cs_live_*` | `cs_test_*` |
| Forced rate tier | per plan | `sandbox` (100 req/hr) |
| Plan-gating on creation | yes | bypassed |
| Billing | per plan | none |
| Counts toward `accounts.max_organisations` | yes | no |
| Cross-customer benchmarks include it | yes | no (filtered by `depa_compliance_metrics_prod` view) |
| Audit-export `manifest.json.sandbox` | `false` | `true` |
| Test-data principal generator | not available | `POST /api/v1/sandbox/test-principals` |
| Dashboard banner | not shown | purple "Sandbox" band on every screen |

## What stays the same

Everything else. The same RPCs, RLS policies, sectoral templates, deletion connectors, banner builder, audit-export endpoint, scoring, and rights-request flows run identically against a sandbox org. The only differences are the cosmetic + safety properties listed above.

## Provisioning a sandbox org

You must be the **account owner** of your ConsentShield account &mdash; org-level admins can't provision sandboxes (the RPC raises 42501 / `not_an_account_owner`). If you're not the owner, ask whoever signed your contract; they're the owner.

### Via the dashboard

1. Sign in as the account owner.
2. Sidebar → **Sandbox**.
3. Enter a name (we suffix `(sandbox)` automatically unless you already did).
4. Optionally pick a sectoral template:
   - **None** — empty sandbox; you can apply a template later.
   - **BFSI Starter** — 12 DPDP-aligned NBFC / bank / broker purposes; works on a fresh sandbox (mode-agnostic).
   - **Healthcare Starter** — 7 DISHA / ABDM-aligned purposes. **Will fail with `P0004`** because Healthcare Starter requires `storage_mode=zero_storage` and a fresh sandbox starts in `standard`. Ask your admin to flip the new sandbox's storage mode first (same dance as the production healthcare onboarding flow), then re-apply.
5. Click **Provision sandbox org**.
6. The page lists the new org and shows its UUID.

### Via SQL (operator path)

```sql
-- Authenticated as the account_owner; the RPC trusts current_uid().
select public.rpc_provision_sandbox_org('My sandbox', null);
-- → {ok:true, org_id: <uuid>, account_id: <uuid>, sandbox: true,
--    template_applied: null, storage_mode: 'standard'}
```

## Switching between prod and sandbox orgs

Once you have a sandbox org, the customer-app session can be on either one. Use the org switcher (top-right; behaviour identical to switching between two production orgs in a multi-org account). The sidebar layout, panels, and URLs are the same; the **purple "Sandbox" band** at the top of every screen is the visual reminder of which mode you're in.

## Minting a sandbox API key

After switching the session to a sandbox org:

1. Sidebar → **Settings → API keys**.
2. Click **New API key**.
3. Pick scopes (you can request `*` since sandbox is the safety boundary).
4. Submit.

The plaintext returned is one-time. It will start with `cs_test_` (NOT `cs_live_`) and `rate_tier` will read `sandbox` regardless of which tier you picked &mdash; the database forces both at issuance.

```bash
# Use exactly like a live key, against the same v1 surface:
export CS_KEY=cs_test_xxxxxxxxxxxxxxxx
curl -H "Authorization: Bearer $CS_KEY" https://app.consentshield.in/api/v1/_ping
# → 200 {"ok": true, "org_id": "<sandbox-org-uuid>", "scopes": [...], ...}
```

## Generating test principals

For repeatable end-to-end tests you usually want a stable, well-shaped data-principal identifier &mdash; no real email, no real phone. ConsentShield gives you a per-sandbox-org monotonic counter:

```bash
curl -X POST -H "Authorization: Bearer $CS_KEY" \
  https://app.consentshield.in/api/v1/sandbox/test-principals
# → 200 {"identifier": "cs_test_principal_000001", "seq": 1}
```

The counter is per-sandbox-org. Two sandbox orgs each get their own `_000001` first. Each call increments. Use the returned identifier as the data-principal subject in subsequent `/v1/consent/record`, `/v1/rights/requests`, etc. calls.

The endpoint:

- **Refuses** non-sandbox-tier API keys with `403 Forbidden` &mdash; tells you to mint a `cs_test_*` key first.
- **Refuses** non-sandbox orgs at the database layer (errcode 42501) &mdash; defense-in-depth in case the rate-tier check is ever amended.
- Has no scope requirement &mdash; sandbox is intended to be permissive within its rate cap.

## Exports from a sandbox org

When you call `POST /api/orgs/{orgId}/audit-export` against a sandbox org, the resulting ZIP's `manifest.json` carries `"sandbox": true` next to `"format_version"` / `"org_id"` / `"generated_at"`. Auditors and downstream pipelines should treat sandbox manifests as test data and route them away from production audit lakes. Production auditors should reject any manifest where `sandbox === true` is present (or absent &mdash; older formats predating Sprint 5.1 R2 don't carry the field at all, so a missing field maps to legacy/prod).

## Compliance score

Your sandbox org's per-org compliance score still computes (the nightly cron processes all orgs); you'll see it in the dashboard score gauge as you would for a production org &mdash; useful for verifying the consent flow is materially correct.

What the sandbox org does **not** do is contribute to **cross-customer aggregates**. ConsentShield's admin / benchmark surfaces (when they ship) read from the `public.depa_compliance_metrics_prod` view, which structurally filters out sandbox orgs. So your sandbox traffic can't accidentally pollute industry medians, percentile rankings, or "your compliance is in the top X%" cards.

## Cleanup

Delete a sandbox org via:

1. Switch session to the sandbox org.
2. Sidebar → **Settings → Organisation → Delete**.

Or, for operator-side cleanup (e.g. after CI runs):

```sql
-- As an admin / cs_orchestrator. ON DELETE CASCADE handles
-- org_memberships, web_properties, api_keys, etc.
delete from public.organisations where id = '<sandbox-org-uuid>' and sandbox = true;
```

The `sandbox = true` predicate is a safety belt &mdash; protects you from accidentally deleting a production org by ID typo.

## What's next (deferred)

A "promote sandbox to production" path is on the V2 backlog (origin: ADR-1003 §V2 Backlog). For v1, plan to spin up a fresh production org and re-apply your tested wiring &mdash; sectoral templates, connectors, banners are all customer-config rather than per-org runtime data, so the migration is a manual but cheap walk.

## Troubleshooting

### "not_an_account_owner" when provisioning

You need the account-tier `account_owner` role (ADR-0044). Ask whoever holds the account-billing relationship.

### "P0004 — template healthcare_starter requires storage_mode=zero_storage"

A fresh sandbox is in `standard` mode. Have an admin flip the new sandbox to `zero_storage` (same `admin.set_organisation_storage_mode` RPC the production path uses), then re-apply the template.

### "sandbox rate_tier requires a sandbox org"

You called `rpc_api_key_create` with `rate_tier='sandbox'` against a production org. The server-side rule is: `cs_test_*` and `rate_tier='sandbox'` only ever issue against `sandbox=true` orgs. Switch the session to your sandbox org first, then mint.

### "Test-principal generator is sandbox-only"

You're hitting `POST /api/v1/sandbox/test-principals` with a `cs_live_*` key (or no key). Mint a `cs_test_*` key against your sandbox org and retry.

## Reference

- ADR-1003 Sprint 5.1 — sandbox org provisioning + test-principal generator.
- Migration `20260804000059_adr1003_s51_sandbox_orgs.sql` — `organisations.sandbox` column + `rpc_provision_sandbox_org` + amended `rpc_api_key_create`.
- Migration `20260804000060_adr1003_s51_sandbox_test_principals.sql` — counter table + `rpc_sandbox_next_test_principal` + `depa_compliance_metrics_prod` view.
- Customer-app surfaces: `/dashboard/sandbox` (provisioning) + sidebar entry + purple banner on every sandbox-org page.
- API surface: `POST /api/v1/sandbox/test-principals` + `manifest.json.sandbox` on `audit-export`.
