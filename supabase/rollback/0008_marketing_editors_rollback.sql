-- 0008_marketing_editors_rollback.sql
-- EMERGENCY USE ONLY. Puts marketing editing back to the admin only, as in
-- 0007, and removes the editor list and public.mkt_can_edit(). No marketing
-- data is lost.
--
-- One transaction, no CASCADE. If anything errors, nothing changes.

begin;

drop policy mkt_email_campaign_update_editor on public.mkt_email_campaign;
create policy mkt_email_campaign_update_admin on public.mkt_email_campaign
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy mkt_social_post_insert_editor on public.mkt_social_post;
drop policy mkt_social_post_update_editor on public.mkt_social_post;
drop policy mkt_social_post_delete_editor on public.mkt_social_post;
create policy mkt_social_post_insert_admin on public.mkt_social_post
  for insert to authenticated with check (public.is_admin());
create policy mkt_social_post_update_admin on public.mkt_social_post
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy mkt_social_post_delete_admin on public.mkt_social_post
  for delete to authenticated using (public.is_admin());

drop policy mkt_follower_count_insert_editor on public.mkt_follower_count;
drop policy mkt_follower_count_update_editor on public.mkt_follower_count;
drop policy mkt_follower_count_delete_editor on public.mkt_follower_count;
create policy mkt_follower_count_insert_admin on public.mkt_follower_count
  for insert to authenticated with check (public.is_admin());
create policy mkt_follower_count_update_admin on public.mkt_follower_count
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy mkt_follower_count_delete_admin on public.mkt_follower_count
  for delete to authenticated using (public.is_admin());

drop policy mkt_web_week_insert_editor on public.mkt_web_week;
drop policy mkt_web_week_update_editor on public.mkt_web_week;
drop policy mkt_web_week_delete_editor on public.mkt_web_week;
create policy mkt_web_week_insert_admin on public.mkt_web_week
  for insert to authenticated with check (public.is_admin());
create policy mkt_web_week_update_admin on public.mkt_web_week
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy mkt_web_week_delete_admin on public.mkt_web_week
  for delete to authenticated using (public.is_admin());

drop function public.mkt_can_edit();
drop table public.mkt_editor;

notify pgrst, 'reload schema';

commit;
