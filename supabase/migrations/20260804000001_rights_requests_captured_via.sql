-- ADR-1005 Sprint 5.1 — additive columns on rights_requests for API-created
-- requests.
--
-- `captured_via` distinguishes portal-initiated submissions (Turnstile + OTP
-- gate) from API-key-initiated submissions (ADR-1009 Bearer + identity
-- attestation). Default is 'portal' so existing rows + the existing
-- rpc_rights_request_create continue to work unchanged.
--
-- `created_by_api_key_id` lets audit queries attribute every API-created
-- request to the specific key that created it, even after rotation.
-- Nullable and ON DELETE SET NULL so the column never blocks key deletion.

alter table public.rights_requests
  add column if not exists captured_via text not null default 'portal',
  add column if not exists created_by_api_key_id uuid
    references public.api_keys(id) on delete set null;

alter table public.rights_requests
  drop constraint if exists rights_requests_captured_via_check;

alter table public.rights_requests
  add constraint rights_requests_captured_via_check
  check (captured_via in (
    'portal',      -- public portal form (Turnstile + OTP)
    'api',         -- POST /v1/rights/requests (API-key attestation)
    'kiosk',       -- branch kiosk (operator-initiated)
    'branch',      -- branch officer (operator-initiated)
    'call_center', -- call-centre agent (operator-initiated)
    'mobile_app',  -- native mobile app (API key)
    'email',       -- off-channel email received + operator-entered
    'other'        -- escape hatch
  ));

create index if not exists idx_rights_requests_captured_via
  on public.rights_requests (org_id, captured_via, created_at desc);

create index if not exists idx_rights_requests_created_by_key
  on public.rights_requests (created_by_api_key_id)
  where created_by_api_key_id is not null;

comment on column public.rights_requests.captured_via is
  'ADR-1005 Sprint 5.1 — origin of the request. portal | api | kiosk | '
  'branch | call_center | mobile_app | email | other. Default portal '
  'preserves existing rpc_rights_request_create behaviour.';

comment on column public.rights_requests.created_by_api_key_id is
  'ADR-1005 Sprint 5.1 — which api_keys row created this request when '
  'captured_via=api. ON DELETE SET NULL so key deletion does not break '
  'the audit chain.';
