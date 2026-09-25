-- local_postgrest_roles.sql
-- LOCAL TEST ONLY. Never run this on Supabase.
--
-- Creates the `authenticator` login role PostgREST connects as, and grants it
-- membership of `anon` and `authenticated` (already created, cluster-wide, by
-- local_auth_stub.sql). Roles are cluster-wide in this local Postgres, not
-- per-database, so both the role creation and the password set are guarded to
-- survive being run again on the same cluster against a different `fresh:`
-- database, and to not clobber a role another local stack (e2e) already made.
--
-- Run after local_auth_stub.sql, 0001, 0003, 0004, 0005, and the seed, and
-- before starting PostgREST.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login password 'local-authenticator';
  else
    alter role authenticator with password 'local-authenticator';
  end if;
end $$;

grant anon to authenticator;
grant authenticated to authenticator;

select 'local postgrest roles ready' as result;
