-- 0007_marketing_rollback.sql
-- EMERGENCY USE ONLY. Drops the five mkt_ tables and their trigger function.
-- Every marketing row is lost, including hand-entered replies, enquiries,
-- posts, follower counts and website weeks. Export them first if they matter.
--
-- One transaction, no CASCADE. If anything errors, nothing is dropped.

begin;

drop table public.mkt_sync_log;
drop table public.mkt_web_week;
drop table public.mkt_follower_count;
drop table public.mkt_social_post;
drop table public.mkt_email_campaign;

drop function public.mkt_touch_updated_at();

notify pgrst, 'reload schema';

commit;
