-- Retro-fit to migration 010 (scoped_roles). PostgreSQL 16 separated the
-- traditional "GRANT role" grant into three options: admin, inherit, set.
-- Only `set` allows `SET ROLE` / `ALTER ... OWNER TO`. Migration 010 used
-- the pre-16 syntax which defaulted to admin=t, inherit=f, set=f — that
-- breaks every subsequent migration that tries to set cs_orchestrator or
-- cs_delivery as a function owner (see psql "must be able to SET ROLE"
-- error).
--
-- This migration re-grants with `with set true` so postgres can transfer
-- ownership to the scoped roles. It also grants CREATE on schema public to
-- cs_orchestrator and cs_delivery (PG 15+ revoked that by default; without
-- it the function-owner transfer fails with "permission denied for schema
-- public").

grant cs_worker       to postgres with set true;
grant cs_delivery     to postgres with set true;
grant cs_orchestrator to postgres with set true;

grant create on schema public to cs_orchestrator, cs_delivery;
