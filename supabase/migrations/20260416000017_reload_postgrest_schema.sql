-- ADR-0027 Sprint 1.1 follow-up — nudge PostgREST to reload its schema cache.
--
-- The preceding migration (20260416000016) changed the `pgrst.db_schemas`
-- role setting and NOTIFY'd `reload config`. That reloads PostgREST's
-- config but not its schema cache; the cache reload is a separate notify
-- channel message (`reload schema`). Without this, requests against
-- admin.* still return "could not find the table in the schema cache".
--
-- Both notifications are idempotent.

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
