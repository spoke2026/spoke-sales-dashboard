-- local_auth_stub.sql
-- LOCAL TEST STUB. Never run this on Supabase.
--
-- Mirrors just enough of a real Supabase project on a throwaway local Postgres
-- so that supabase/migrations/0001, 0003, and 0004 apply unmodified, and so
-- that denials in supabase/test/0004_rls_test.sql come from RLS, not a missing
-- grant (hubspot-crm-build-rules.md rule 14): roles anon and authenticated,
-- schema auth with auth.users, auth.uid(), auth.jwt(), and default privileges
-- on public mirroring Supabase's grant-everything-to-anon-and-authenticated
-- default. Run this BEFORE 0001, so the default-privileges statement (which
-- only affects objects created after it, by the role that ran it) covers
-- every table 0001/0003/0004 go on to create.
--
-- Run order: local_auth_stub.sql -> 0001 -> 0003 -> 0004 -> ... -> 0004_rls_test.sql
--
-- Safe to run more than once against the SAME already-stubbed database only if
-- schema auth does not already exist in it (the guard below refuses in that
-- case too, by design -- this script is not meant to be re-run without a
-- fresh database). Roles are cluster-wide, not per-database, so role creation
-- below is guarded with an existence check to survive repeated `fresh:<db>`
-- runs against the same local Postgres cluster.

do $$
begin
  if to_regnamespace('auth') is not null then
    raise exception 'LOCAL TEST STUB. Never run this on Supabase.';
  end if;
end $$;

-- ─── Roles ─────────────────────────────────────────────────────────────────
-- Cluster-wide, so guarded against already existing from a prior local run.
-- The superuser running this (postgres) can already SET ROLE to any role
-- without an explicit membership grant, so none is added here.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

-- ─── auth schema ─────────────────────────────────────────────────────────────

create schema auth;

create table auth.users (
  id uuid primary key,
  email text
);

-- nullif(..., '') matters here and would not on Supabase itself: rolling back
-- to a plpgsql EXCEPTION block's implicit savepoint (how 0004_rls_test.sql
-- reverts `set local role` between cases) resets a custom GUC like
-- request.jwt.claims to '' , not to NULL. Without the nullif, coalesce('',
-- '{}') returns '' (coalesce only substitutes for NULL), and ''::jsonb raises
-- 22P02. Confirmed locally (rule 13: verify, don't assume); this does not
-- change the formula's behaviour for a claims value that is genuinely never
-- set, which still falls through to '{}'.
create function auth.uid()
returns uuid
language sql
stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;

-- Mirrors Supabase's default grants: anon and authenticated get full
-- privileges on every table and function created after this point in schema
-- public by the role running this script (postgres), which is exactly the
-- role that runs 0001, 0003, and 0004 below. Without this, a denial in the
-- RLS test could be a missing grant, not an RLS decision (rule 14).
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

-- ─── Minimal public.targets, so 0001 has something to alter ──────────────────

create table public.targets (
  id uuid primary key default gen_random_uuid(),
  month date,
  value numeric
);

-- ─── Seed users: one admin, two non-admins ────────────────────────────────────

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'edward@spoke.nz'),
  ('00000000-0000-0000-0000-000000000002', 'user1@example.test'),
  ('00000000-0000-0000-0000-000000000003', 'user2@example.test');

select 'local auth stub applied' as result;
