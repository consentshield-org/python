-- Migration: pgcrypto RPC helpers for per-org encryption
-- The derived key is computed server-side (Node.js) and passed in.
-- We never store the derived key — only the org_id + encryption_salt are in the DB.

create or replace function encrypt_secret(plaintext text, derived_key text)
returns bytea
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return extensions.pgp_sym_encrypt(plaintext, derived_key);
end;
$$;

create or replace function decrypt_secret(ciphertext bytea, derived_key text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return extensions.pgp_sym_decrypt(ciphertext, derived_key);
end;
$$;

-- Only the service role can call these (migrations and Edge Functions using cs_orchestrator/cs_delivery)
revoke all on function encrypt_secret(text, text) from public;
revoke all on function decrypt_secret(bytea, text) from public;
grant execute on function encrypt_secret(text, text) to service_role;
grant execute on function decrypt_secret(bytea, text) to service_role;
