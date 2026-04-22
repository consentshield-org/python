-- Per 2026-04-22 session decisions during ADR-1005 Phase 6 setup:
--
-- 1. PagerDuty *own-ops-paging* account: deferred. Operator chose to
--    replace PagerDuty-for-us with a WhatsApp Business Cloud API
--    integration later (already-in-pocket messaging channel; no
--    separate app install required). The PagerDuty customer-facing
--    ADAPTER still ships in Sprint 6.2/6.3 because BFSI enterprises
--    often have existing PagerDuty contracts; skipping the adapter
--    would shortchange the product.
--
-- 2. New WhatsApp Business API row added — tracks the replacement
--    for own-ops-paging. Non-trivial onboarding: Meta Business Manager
--    verification + approved utility-message templates.
--
-- 3. Teams live-test deferred — operator is on Microsoft Teams Free
--    (Communities-only, no Workflows / Power Automate). Adapter code
--    ships with unit tests against a mock server; live test waits
--    until we have an M365 Business tenant or a first customer provides
--    their own Teams webhook URL.
--
-- 4. Discord live-test deferred — no workspace provisioned. Adapter
--    code is cheap (same webhook JSON shape as Slack), ships with unit
--    tests only.

-- 1. Defer the "Provision PagerDuty account" row.
update admin.ops_readiness_flags
   set status           = 'deferred',
       resolution_notes = 'Deferred 2026-04-22. Operator chose '
                          'WhatsApp Business Cloud API as the '
                          'replacement for own-ops-paging (cheaper, '
                          'already on phone, delivery receipts). '
                          'See new row for WhatsApp integration. '
                          'Customer-facing PagerDuty ADAPTER still '
                          'ships in ADR-1005 Sprint 6.2/6.3.',
       resolved_at      = now()
 where source_adr = 'ADR-1005 Sprint 3.2'
   and status in ('pending', 'in_progress');

-- 2-4. Add the three new rows. Idempotent on source_adr.
insert into admin.ops_readiness_flags (
  title, description, source_adr, blocker_type, severity, status, owner
)
select * from (values
  (
    'Own-ops paging — WhatsApp Business Cloud API integration',
    'Replaces PagerDuty for internal SEV1/SEV2 paging of the founder + '
    'future contractor rota. Requires: (a) Meta Business Manager '
    'account + verified business profile (ConsentShield legal entity); '
    '(b) WhatsApp Business Cloud API onboarding + phone number '
    '(founder WhatsApp number or a new one); (c) Approved utility-'
    'message templates (Meta pre-approval for transactional alerts); '
    '(d) Webhook endpoint for delivery receipts + replies. Rough cost '
    'INR 0.30-0.80 per utility message. Non-trivial onboarding (first-'
    'time Meta Business Manager + template approval takes days). Not '
    'blocking — admin.ops_readiness_flags already gives the operator '
    'a visible surface for all pending alerts today.',
    'WhatsApp for ops paging (replaces PagerDuty)',
    'infra',
    'medium',
    'pending',
    'Sudhindra (procurement + Meta onboarding)'
  ),
  (
    'Teams webhook — live integration test against M365 Business tenant',
    'Adapter code ships with unit tests against a mock HTTP server '
    '(Sprint 6.2 deliverable). Live test blocked because operator is '
    'on Microsoft Teams Free (Communities-only product; no Workflows '
    'app, no Power Automate, no channel webhooks). Two paths forward: '
    '(a) provision M365 Business Basic (~INR 190/user/month) for '
    'internal dev tenant, OR (b) wait for a first customer to provide '
    'their own Teams webhook URL as part of onboarding. Option (b) is '
    'free but blocks the live-test signal until then.',
    'ADR-1005 Phase 6 Sprint 6.2 (Teams live test)',
    'infra',
    'low',
    'pending',
    'Sudhindra'
  ),
  (
    'Discord webhook — live integration test against a real workspace',
    'Adapter code ships with unit tests only (Sprint 6.2 deliverable; '
    'Discord webhook JSON is identical in shape to Slack''s, so the '
    'code is cheap). Live test is deferred — no Discord workspace '
    'provisioned and Discord is not on the BFSI GTM critical path. '
    'Worth revisiting when a dev-community GTM push begins (e.g. '
    'open-source consumers who want Discord alerts).',
    'ADR-1005 Phase 6 Sprint 6.2 (Discord live test)',
    'infra',
    'low',
    'pending',
    'Sudhindra (when convenient)'
  )
) as v(title, description, source_adr, blocker_type, severity, status, owner)
where not exists (
  select 1 from admin.ops_readiness_flags f
   where f.source_adr = v.source_adr
);
