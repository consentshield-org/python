-- Migration 001: Extensions
-- ConsentShield schema setup — run first

create extension if not exists "pgcrypto";     -- Encryption for sensitive fields
create extension if not exists "uuid-ossp";     -- UUID generation (backup for gen_random_uuid)

-- Note: pg_cron must be enabled via Supabase dashboard (Database → Extensions)
-- It cannot be created via migration on hosted Supabase.
