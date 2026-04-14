-- ADR-0008 Sprint 1.2
-- Add origin_verified to consent_events and tracker_observations. Records the
-- authentication mode used by the Cloudflare Worker on intake:
--   'origin-only'   — browser caller, origin in allowed_origins (ADR-0008 default)
--   'hmac-verified' — server-to-server caller, HMAC verified with event_signing_secret
--   'legacy-hmac'   — rows written before ADR-0008 (pre-migration default)

alter table consent_events
  add column if not exists origin_verified text not null default 'legacy-hmac';

alter table tracker_observations
  add column if not exists origin_verified text not null default 'legacy-hmac';

comment on column consent_events.origin_verified is
  'Authentication mode used at Worker intake. See ADR-0008.';
comment on column tracker_observations.origin_verified is
  'Authentication mode used at Worker intake. See ADR-0008.';
