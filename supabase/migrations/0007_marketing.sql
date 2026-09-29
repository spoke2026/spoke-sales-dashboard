-- 0007_marketing.sql
-- Marketing tab: email, social and website numbers.
--
-- Purely additive. Creates five mkt_-prefixed tables:
--   * mkt_email_campaign   one row per Mailchimp campaign. The Mailchimp sync
--                          (service role) writes the Mailchimp columns; the
--                          admin can only update replies and enquiries, which
--                          is enforced by column-level grants below, so a sync
--                          and a hand edit can never touch each other's columns
--   * mkt_social_post      one row per post. platform leaves room for
--                          Instagram and Facebook later
--   * mkt_follower_count   one follower count per platform, account and month
--   * mkt_web_week         one row per week (starting Monday) of website
--                          numbers. source records whether it was typed in or
--                          filled from the Vercel Web Analytics API later
--   * mkt_sync_log         one row per Mailchimp sync attempt, for "Last updated"
--
-- RLS on every table: authenticated users read, only public.is_admin() writes.
-- mkt_sync_log and the Mailchimp columns are written only by the service role
-- (which bypasses RLS), from the sync route.
--
-- It never touches public.targets, public.is_admin() or any kpi_ table. One
-- transaction, no `if not exists`. A second run fails loudly with "already
-- exists" and rolls back. If this script errors, nothing has changed.

begin;

-- 0. Guard: 0001 must already be applied.
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception '0007 needs public.is_admin() from 0001';
  end if;
end $$;

-- ─── 1. Tables ───────────────────────────────────────────────────────────────

create table public.mkt_email_campaign (
  id uuid primary key default gen_random_uuid(),
  mailchimp_id text null unique,
  send_time timestamptz not null,
  campaign_name text not null default '',
  subject_line text not null default '',
  recipients integer not null default 0 check (recipients >= 0),
  unique_opens integer not null default 0 check (unique_opens >= 0),
  open_rate numeric not null default 0 check (open_rate >= 0),
  unique_clicks integer not null default 0 check (unique_clicks >= 0),
  click_rate numeric not null default 0 check (click_rate >= 0),
  click_to_open numeric not null default 0 check (click_to_open >= 0),
  replies integer not null default 0 check (replies >= 0),
  enquiries integer not null default 0 check (enquiries >= 0),
  synced_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.mkt_email_campaign.open_rate is
  'Fraction as Mailchimp reports it (0.374 = 37.4%), based on delivered emails.';
comment on column public.mkt_email_campaign.replies is
  'Typed in by the admin. The Mailchimp sync never writes this column.';
comment on column public.mkt_email_campaign.enquiries is
  'Typed in by the admin. The Mailchimp sync never writes this column.';

create table public.mkt_social_post (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('linkedin', 'instagram', 'facebook')),
  account text not null check (account in ('spoke', 'ed')),
  posted_on date not null,
  topic text not null check (length(btrim(topic)) between 1 and 500),
  likes integer not null default 0 check (likes >= 0),
  comments integer not null default 0 check (comments >= 0),
  url text null check (url is null or url ~* '^https?://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index mkt_social_post_posted_on_idx on public.mkt_social_post (posted_on);

create table public.mkt_follower_count (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('linkedin', 'instagram', 'facebook')),
  account text not null check (account in ('spoke', 'ed')),
  month date not null check (month = date_trunc('month', month::timestamp)::date),
  followers integer not null check (followers >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, account, month)
);

create table public.mkt_web_week (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique check (extract(isodow from week_start) = 1),
  visitors integer not null default 0 check (visitors >= 0),
  page_views integer not null default 0 check (page_views >= 0),
  top_pages jsonb not null default '[]'::jsonb check (jsonb_typeof(top_pages) = 'array'),
  top_referrers jsonb not null default '[]'::jsonb check (jsonb_typeof(top_referrers) = 'array'),
  source text not null default 'manual' check (source in ('manual', 'vercel_api')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.mkt_web_week.top_pages is '[{ "path": "/", "views": 120 }, ...]';
comment on column public.mkt_web_week.top_referrers is '[{ "site": "linkedin.com", "visitors": 12 }, ...]';

create table public.mkt_sync_log (
  id bigint generated always as identity primary key,
  source text not null check (source in ('mailchimp', 'vercel')),
  trigger text not null check (trigger in ('cron', 'button')),
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  ok boolean not null default false,
  campaigns integer null,
  error text null
);
create index mkt_sync_log_source_started_idx on public.mkt_sync_log (source, started_at desc);

-- ─── 2. updated_at trigger ──────────────────────────────────────────────────

create function public.mkt_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.mkt_touch_updated_at() from public, anon;

create trigger mkt_email_campaign_touch before update on public.mkt_email_campaign
  for each row execute function public.mkt_touch_updated_at();
create trigger mkt_social_post_touch before update on public.mkt_social_post
  for each row execute function public.mkt_touch_updated_at();
create trigger mkt_follower_count_touch before update on public.mkt_follower_count
  for each row execute function public.mkt_touch_updated_at();
create trigger mkt_web_week_touch before update on public.mkt_web_week
  for each row execute function public.mkt_touch_updated_at();

-- ─── 3. Grants ──────────────────────────────────────────────────────────────
-- anon gets nothing. authenticated reads everything; writes are narrowed by
-- the grants here and then by the admin-only policies in section 4.

revoke all on public.mkt_email_campaign, public.mkt_social_post,
  public.mkt_follower_count, public.mkt_web_week, public.mkt_sync_log
  from anon, authenticated;

grant select on public.mkt_email_campaign, public.mkt_social_post,
  public.mkt_follower_count, public.mkt_web_week, public.mkt_sync_log
  to authenticated;

-- Campaigns: the admin may change only the two hand-entered columns.
grant update (replies, enquiries) on public.mkt_email_campaign to authenticated;

grant insert, update, delete on public.mkt_social_post, public.mkt_follower_count,
  public.mkt_web_week to authenticated;

grant all on public.mkt_email_campaign, public.mkt_social_post,
  public.mkt_follower_count, public.mkt_web_week, public.mkt_sync_log
  to service_role;

-- ─── 4. RLS ─────────────────────────────────────────────────────────────────

alter table public.mkt_email_campaign enable row level security;
alter table public.mkt_social_post enable row level security;
alter table public.mkt_follower_count enable row level security;
alter table public.mkt_web_week enable row level security;
alter table public.mkt_sync_log enable row level security;

create policy mkt_email_campaign_select on public.mkt_email_campaign
  for select to authenticated using (true);
create policy mkt_email_campaign_update_admin on public.mkt_email_campaign
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy mkt_social_post_select on public.mkt_social_post
  for select to authenticated using (true);
create policy mkt_social_post_insert_admin on public.mkt_social_post
  for insert to authenticated with check (public.is_admin());
create policy mkt_social_post_update_admin on public.mkt_social_post
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy mkt_social_post_delete_admin on public.mkt_social_post
  for delete to authenticated using (public.is_admin());

create policy mkt_follower_count_select on public.mkt_follower_count
  for select to authenticated using (true);
create policy mkt_follower_count_insert_admin on public.mkt_follower_count
  for insert to authenticated with check (public.is_admin());
create policy mkt_follower_count_update_admin on public.mkt_follower_count
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy mkt_follower_count_delete_admin on public.mkt_follower_count
  for delete to authenticated using (public.is_admin());

create policy mkt_web_week_select on public.mkt_web_week
  for select to authenticated using (true);
create policy mkt_web_week_insert_admin on public.mkt_web_week
  for insert to authenticated with check (public.is_admin());
create policy mkt_web_week_update_admin on public.mkt_web_week
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy mkt_web_week_delete_admin on public.mkt_web_week
  for delete to authenticated using (public.is_admin());

create policy mkt_sync_log_select on public.mkt_sync_log
  for select to authenticated using (true);

notify pgrst, 'reload schema';

commit;
