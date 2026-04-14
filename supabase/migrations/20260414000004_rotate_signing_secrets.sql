-- ADR-0008 Sprint 1.4
-- Rotate every web_properties.event_signing_secret. Prior values were shipped
-- into customer browsers via the compiled banner script (ADR-0008 root cause).
-- This migration regenerates each secret and stamps a rotation timestamp.
-- Browser callers no longer use the secret. Server-to-server callers (if any)
-- must fetch the new value before signing.

alter table web_properties
  add column if not exists event_signing_secret_rotated_at timestamptz;

update web_properties
set
  event_signing_secret = encode(extensions.gen_random_bytes(32), 'hex'),
  event_signing_secret_rotated_at = now();

comment on column web_properties.event_signing_secret_rotated_at is
  'Last rotation of event_signing_secret. See ADR-0008 Sprint 1.4.';
