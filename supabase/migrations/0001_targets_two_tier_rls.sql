-- 0001_targets_two_tier_rls.sql
-- Two-tier RLS for public.targets:
--   * every authenticated user may SELECT (read the dashboard's targets)
--   * only the admin (edward@spoke.nz) may INSERT/UPDATE/DELETE
--
-- Admin identity is a single source of truth: the SECURITY DEFINER
-- public.is_admin() function, which both RLS (below) and the app
-- (supabase.rpc('is_admin')) read. There is no ADMIN_EMAIL env literal.
--
-- Wrapped in ONE transaction so a mid-script failure cannot leave RLS enabled
-- with no working policies (which would lock everyone, including Edward, out of
-- writes). If it fails, nothing changes; fix and re-run. Idempotent.

begin;

-- is_admin(): true only for edward@spoke.nz. SECURITY DEFINER so it can read
-- auth.users; search_path pinned to public, pg_temp as a privilege-escalation
-- guard; STABLE; execute revoked from public/anon and granted to authenticated.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and lower(u.email) = 'edward@spoke.nz'
  )
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Enable RLS on the targets table.
alter table public.targets enable row level security;

-- Drop EVERY existing policy on public.targets before creating the new ones, so
-- the pre-existing anon-write hole is closed regardless of prior policy names.
-- Scoped strictly to schemaname='public' AND tablename='targets'.
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'targets'
  loop
    execute format('drop policy if exists %I on public.targets', pol.policyname);
  end loop;
end $$;

-- Two-tier policies.
create policy targets_select_authenticated
  on public.targets
  for select
  to authenticated
  using (true);

create policy targets_insert_admin
  on public.targets
  for insert
  to authenticated
  with check (public.is_admin());

create policy targets_update_admin
  on public.targets
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy targets_delete_admin
  on public.targets
  for delete
  to authenticated
  using (public.is_admin());

commit;
