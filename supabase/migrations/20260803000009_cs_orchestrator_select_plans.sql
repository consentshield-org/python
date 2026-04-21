-- ADR-0058 follow-up — grant cs_orchestrator SELECT on public.plans.
--
-- Onboarding Step 5 → /api/orgs/:orgId/properties → rpc_plan_limit_check
-- (SECURITY DEFINER owned by cs_orchestrator) reads max_web_properties_per_org
-- from public.plans. cs_orchestrator already has SELECT on every other table
-- the function touches (accounts, organisations, org_memberships, web_properties,
-- integration_connectors); plans was the outlier — presumably because public.plans
-- landed in migration 20260428000002 (ADR-0044 RBAC rewrite) after the bulk of
-- cs_orchestrator's grants were set up.
--
-- plans is reference data (plan_code tiers + caps); no sensitive fields. SELECT
-- grant is appropriate.

grant select on public.plans to cs_orchestrator;
