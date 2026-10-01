-- 0008_marketing_editors.sql
-- Lets named people edit the Marketing tab without making them admins.
--
-- Adds:
--   * public.mkt_editor          the list of marketing editors, by email.
--                                Seeded with sage@spoke.nz. Not readable from
--                                the app; only mkt_can_edit() looks at it
--   * public.mkt_can_edit()      true for the admin (public.is_admin()) or any
--                                signed-in user whose email is on the list
--   * replaces the admin-only write policies on the four mkt_ data tables
--     with mkt_can_edit() versions
--
-- public.is_admin(), public.targets and every kpi_ table are untouched, so
-- marketing editors get no say over targets or KPIs.
--
-- To add someone later, run in the SQL editor:
--   insert into public.mkt_editor (email) values ('name@spoke.nz');
-- To remove them:
--   delete from public.mkt_editor where email = 'name@spoke.nz';
--
-- One transaction. If this script errors, nothing has changed.
-- Rollback: supabase/rollback/0008_marketing_editors_rollback.sql

begin;

-- 0. Guard: 0001 and 0007 must already be applied.
do $$
begin
  if to_regprocedure('public.is_admin()') is null
     or to_regclass('public.mkt_social_post') is null then
    raise exception '0008 needs 0001 and 0007';
  end if;
end $$;

-- ─── 1. The editor list ─────────────────────────────────────────────────────

create table public.mkt_editor (
  email text primary key check (email = lower(btrim(email)) and email like '%@%'),
  added_at timestamptz not null default now()
);

-- Locked down completely: no grants and no policies for anon or
-- authenticated. Only the SECURITY DEFINER function below reads it.
alter table public.mkt_editor enable row level security;
revoke all on public.mkt_editor from anon, authenticated;
grant all on public.mkt_editor to service_role;

insert into public.mkt_editor (email) values ('sage@spoke.nz');

-- ─── 2. Who may edit marketing data ─────────────────────────────────────────
-- SECURITY DEFINER so it can read auth.users and mkt_editor; search_path
-- pinned as a privilege-escalation guard, as for public.is_admin().

create function public.mkt_can_edit()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin() or exists (
    select 1
    from auth.users u
    join public.mkt_editor e on e.email = lower(u.email)
    where u.id = auth.uid()
  )
$$;

revoke all on function public.mkt_can_edit() from public, anon;
grant execute on function public.mkt_can_edit() to authenticated;

-- ─── 3. Write policies: admin-only → marketing editors ─────────────────────

drop policy mkt_email_campaign_update_admin on public.mkt_email_campaign;
create policy mkt_email_campaign_update_editor on public.mkt_email_campaign
  for update to authenticated using (public.mkt_can_edit()) with check (public.mkt_can_edit());

drop policy mkt_social_post_insert_admin on public.mkt_social_post;
drop policy mkt_social_post_update_admin on public.mkt_social_post;
drop policy mkt_social_post_delete_admin on public.mkt_social_post;
create policy mkt_social_post_insert_editor on public.mkt_social_post
  for insert to authenticated with check (public.mkt_can_edit());
create policy mkt_social_post_update_editor on public.mkt_social_post
  for update to authenticated using (public.mkt_can_edit()) with check (public.mkt_can_edit());
create policy mkt_social_post_delete_editor on public.mkt_social_post
  for delete to authenticated using (public.mkt_can_edit());

drop policy mkt_follower_count_insert_admin on public.mkt_follower_count;
drop policy mkt_follower_count_update_admin on public.mkt_follower_count;
drop policy mkt_follower_count_delete_admin on public.mkt_follower_count;
create policy mkt_follower_count_insert_editor on public.mkt_follower_count
  for insert to authenticated with check (public.mkt_can_edit());
create policy mkt_follower_count_update_editor on public.mkt_follower_count
  for update to authenticated using (public.mkt_can_edit()) with check (public.mkt_can_edit());
create policy mkt_follower_count_delete_editor on public.mkt_follower_count
  for delete to authenticated using (public.mkt_can_edit());

drop policy mkt_web_week_insert_admin on public.mkt_web_week;
drop policy mkt_web_week_update_admin on public.mkt_web_week;
drop policy mkt_web_week_delete_admin on public.mkt_web_week;
create policy mkt_web_week_insert_editor on public.mkt_web_week
  for insert to authenticated with check (public.mkt_can_edit());
create policy mkt_web_week_update_editor on public.mkt_web_week
  for update to authenticated using (public.mkt_can_edit()) with check (public.mkt_can_edit());
create policy mkt_web_week_delete_editor on public.mkt_web_week
  for delete to authenticated using (public.mkt_can_edit());

notify pgrst, 'reload schema';

commit;
