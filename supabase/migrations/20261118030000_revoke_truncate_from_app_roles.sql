-- Synced from live (applied by the reviewer as 20261117182546
-- revoke_truncate_from_app_roles). Kept here so the repo matches the
-- database and a later migration can't silently undo it.
--
-- TRUNCATE was granted to anon on 33 public tables and to authenticated on
-- 36, left over from Supabase's default `grant all` on the public schema.
-- Row-level security does NOT apply to TRUNCATE, so unlike DELETE it is not
-- held back by any policy — the table would empty regardless.
--
-- Not reachable at the time: PostgREST exposes no TRUNCATE verb, and no
-- function anon or authenticated may execute contains a TRUNCATE or builds
-- dynamic SQL. Removed anyway: a privilege with no use and no policy behind
-- it. The newer tables (referral_*, ad_*) already had it revoked.
--
-- service_role keeps TRUNCATE: it is the trusted server-side key used by the
-- edge functions, never shipped to a client.

revoke truncate on all tables in schema public from anon, authenticated;

-- And for tables added later, so this cannot drift back.
alter default privileges in schema public revoke truncate on tables from anon, authenticated;
