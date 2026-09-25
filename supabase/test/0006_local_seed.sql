-- 0006_local_seed.sql
-- LOCAL TEST ONLY. Never run this on Supabase.
--
-- Run after 0005_local_seed.sql and 0006 have been applied. Adds one more
-- auth user (Tia, ...006 user5@example.test) alongside the 0005 seed's five,
-- an owner person (Tia, manager Mia), six KPIs (four manual aggregations, one
-- automated, one manual KPI never assigned to Tia), and the scorecards and
-- targets LOCAL TEST SPEC needs: Tia has a scorecard for every quarter the
-- calendar covers, draft except FY26 Q4 (fixed-date target versions, D9's
-- three-way divergence) and the current locked quarter (relative-to-now()
-- target versions, so the fixture works on any run date); the previous
-- quarter (still draft) carries a target row that must never surface through
-- kpi_window_targets; Nia, Oli, and Dee each get a current- and
-- previous-quarter scorecard carrying M-sum so entries can be written for
-- them; and a seeded hubspot kpi_actual_daily row sets up the KS019 sync
-- conflict. Runs as postgres (bypasses RLS and, since current_user is not
-- `authenticated`, the D12 guards too).
--
-- Fixed UUIDs, building on 0005_local_seed.sql's:
--   Ed 10000000-...0001, Mia 10000000-...0002 (manager), Sam 10000000-...0003
--   (peer, unrelated to Tia), Nia 10000000-...0004 (no login, reports to Mia),
--   Oli 10000000-...0005 (reports to Ed), Dee 10000000-...0006 (reports to
--   Mia), Arne 10000000-...0007 (company_only).
--   New: Tia 10000000-...0008 (owner, reports to Mia, user5@example.test).
--   KPIs 20000000-...0010 M-sum (manual/sum/higher/count),
--   .../0011 M-ratio (manual/ratio/higher/percent),
--   .../0012 M-avg (manual/average/lower/hours),
--   .../0013 M-latest (manual/latest/higher/count),
--   .../0014 H-auto (hubspot/sum/higher/count), .../0015 M-unused (manual,
--   never assigned to Tia).

do $$
begin
  if not exists (select 1 from auth.users where email = 'user2@example.test') then
    raise exception 'LOCAL TEST ONLY. Never run this on Supabase. (run 0005_local_seed.sql first)';
  end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000006', 'user5@example.test');

insert into public.kpi_person (id, full_name, email, manager_id, scorecard_type, active)
values
  ('10000000-0000-0000-0000-000000000008', 'ZZ Test Tia', 'user5@example.test',
     '10000000-0000-0000-0000-000000000002', 'individual', true);

insert into public.kpi_definition
  (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source, status)
values
  ('20000000-0000-0000-0000-000000000010', 1, 'ZZ Test M-sum', 'desc',
     'lead', 'count', 'higher', 'sum', 'working_days', 'manual', 'published'),
  ('20000000-0000-0000-0000-000000000011', 1, 'ZZ Test M-ratio', 'desc',
     'lag', 'percent', 'higher', 'ratio', 'working_days', 'manual', 'published'),
  ('20000000-0000-0000-0000-000000000012', 1, 'ZZ Test M-avg', 'desc',
     'lead', 'hours', 'lower', 'average', 'working_days', 'manual', 'published'),
  ('20000000-0000-0000-0000-000000000013', 1, 'ZZ Test M-latest', 'desc',
     'lag', 'count', 'higher', 'latest', 'working_days', 'manual', 'published'),
  ('20000000-0000-0000-0000-000000000014', 1, 'ZZ Test H-auto', 'desc',
     'lag', 'count', 'higher', 'sum', 'working_days', 'hubspot', 'published'),
  ('20000000-0000-0000-0000-000000000015', 1, 'ZZ Test M-unused', 'desc',
     'lead', 'count', 'higher', 'sum', 'working_days', 'manual', 'published');

-- ─── Tia: a scorecard for every quarter the calendar covers ────────────────
-- (the calendar spans exactly FY26 Q1 to FY29 Q4), draft by default.

insert into public.kpi_scorecard (person_id, fy, quarter, status)
select '10000000-0000-0000-0000-000000000008', q.fy, q.quarter, 'draft'
  from (select distinct fy, quarter from public.kpi_calendar_day) q;

insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version, sort_order)
select s.id, k.id, 1, k.sort_order
  from public.kpi_scorecard s
  cross join (values
    ('20000000-0000-0000-0000-000000000010'::uuid, 0),
    ('20000000-0000-0000-0000-000000000011'::uuid, 1),
    ('20000000-0000-0000-0000-000000000012'::uuid, 2),
    ('20000000-0000-0000-0000-000000000013'::uuid, 3),
    ('20000000-0000-0000-0000-000000000014'::uuid, 4)
  ) as k(id, sort_order)
 where s.person_id = '10000000-0000-0000-0000-000000000008';

-- ─── Context: today, the current locked quarter, the previous quarter ─────

create temp table zz006_ctx as
select (select public.kpi_nz_date(now())) as today,
       cd.fy as cur_fy, cd.quarter as cur_quarter, cd.month as cur_month
  from public.kpi_calendar_day cd
 where cd.date = (select public.kpi_nz_date(now()));

alter table zz006_ctx add column prev_fy smallint;
alter table zz006_ctx add column prev_quarter smallint;

update zz006_ctx c
   set prev_fy = pcd.fy, prev_quarter = pcd.quarter
  from public.kpi_calendar_day pcd
 where pcd.date = (
   select min(cd2.date) - 1
     from public.kpi_calendar_day cd2
    where cd2.fy = c.cur_fy and cd2.quarter = c.cur_quarter
 );

-- ─── FY26 Q4: locked, D9's three-way target divergence on M-sum ───────────

update public.kpi_scorecard
   set status = 'locked', approval_kind = 'standard',
       approved_by = '10000000-0000-0000-0000-000000000001',
       approved_at = ('2026-02-15 10:00:00'::timestamp at time zone 'Pacific/Auckland'),
       submitted_at = ('2026-02-14 09:00:00'::timestamp at time zone 'Pacific/Auckland'),
       submitted_by = '10000000-0000-0000-0000-000000000008'
 where person_id = '10000000-0000-0000-0000-000000000008' and fy = 2026 and quarter = 4;

insert into public.kpi_target (assignment_id, month, value, effective_from)
select a.id, v.month, v.value, (v.eff::timestamp at time zone 'Pacific/Auckland')
  from public.kpi_assignment a
  join public.kpi_scorecard s on s.id = a.scorecard_id
  cross join (values
    ('2026-01-01'::date, 99, '2026-01-03 00:00:00'),
    ('2026-01-01'::date, 20, '2026-01-05 00:00:00'),
    ('2026-01-01'::date, 21, '2026-02-10 00:00:00'),
    ('2026-01-01'::date, 25, '2026-02-20 00:00:00'),
    ('2026-02-01'::date, 19, '2026-01-05 00:00:00'),
    ('2026-02-01'::date, 17, '2026-02-20 00:00:00'),
    ('2026-03-01'::date, 22, '2026-01-05 00:00:00'),
    ('2026-03-01'::date, 30, '2026-03-10 00:00:00'),
    ('2026-03-01'::date, 40, '2026-04-10 00:00:00')
  ) as v(month, value, eff)
 where s.person_id = '10000000-0000-0000-0000-000000000008'
   and s.fy = 2026 and s.quarter = 4
   and a.kpi_definition_id = '20000000-0000-0000-0000-000000000010';

insert into public.kpi_target (assignment_id, month, value, effective_from)
select a.id, m.month, 20, ('2026-01-01 00:00:00'::timestamp at time zone 'Pacific/Auckland')
  from public.kpi_assignment a
  join public.kpi_scorecard s on s.id = a.scorecard_id
  cross join (values ('2026-01-01'::date), ('2026-02-01'::date), ('2026-03-01'::date)) as m(month)
 where s.person_id = '10000000-0000-0000-0000-000000000008'
   and s.fy = 2026 and s.quarter = 4
   and a.kpi_definition_id in ('20000000-0000-0000-0000-000000000011',
                               '20000000-0000-0000-0000-000000000012',
                               '20000000-0000-0000-0000-000000000013',
                               '20000000-0000-0000-0000-000000000014');

-- ─── The current locked quarter: M-sum's current month has two versions ───
-- (now() - 1 day -> 5, now() + 1 day -> 6, so kpi_window_targets must resolve
-- 5, not the row effective tomorrow), every other month/KPI a single target.

update public.kpi_scorecard s
   set status = 'locked', approval_kind = 'standard',
       approved_by = '10000000-0000-0000-0000-000000000001',
       approved_at = now() - interval '30 days',
       submitted_at = now() - interval '31 days',
       submitted_by = '10000000-0000-0000-0000-000000000008'
  from zz006_ctx c
 where s.person_id = '10000000-0000-0000-0000-000000000008'
   and s.fy = c.cur_fy and s.quarter = c.cur_quarter;

insert into public.kpi_target (assignment_id, month, value, effective_from)
select a.id, c.cur_month, v.value, v.eff
  from public.kpi_assignment a
  join public.kpi_scorecard s on s.id = a.scorecard_id
  join zz006_ctx c on true
  cross join (values (5, now() - interval '1 day'), (6, now() + interval '1 day')) as v(value, eff)
 where s.person_id = '10000000-0000-0000-0000-000000000008'
   and s.fy = c.cur_fy and s.quarter = c.cur_quarter
   and a.kpi_definition_id = '20000000-0000-0000-0000-000000000010';

insert into public.kpi_target (assignment_id, month, value, effective_from)
select a.id, qm.month, 20, now() - interval '40 days'
  from public.kpi_assignment a
  join public.kpi_scorecard s on s.id = a.scorecard_id
  join zz006_ctx c on true
  join (select distinct fy, quarter, month from public.kpi_calendar_day) qm
    on qm.fy = c.cur_fy and qm.quarter = c.cur_quarter and qm.month <> c.cur_month
 where s.person_id = '10000000-0000-0000-0000-000000000008'
   and s.fy = c.cur_fy and s.quarter = c.cur_quarter
   and a.kpi_definition_id = '20000000-0000-0000-0000-000000000010';

insert into public.kpi_target (assignment_id, month, value, effective_from)
select a.id, qm.month, 20, now() - interval '40 days'
  from public.kpi_assignment a
  join public.kpi_scorecard s on s.id = a.scorecard_id
  join zz006_ctx c on true
  join (select distinct fy, quarter, month from public.kpi_calendar_day) qm
    on qm.fy = c.cur_fy and qm.quarter = c.cur_quarter
 where s.person_id = '10000000-0000-0000-0000-000000000008'
   and s.fy = c.cur_fy and s.quarter = c.cur_quarter
   and a.kpi_definition_id in ('20000000-0000-0000-0000-000000000011',
                               '20000000-0000-0000-0000-000000000012',
                               '20000000-0000-0000-0000-000000000013',
                               '20000000-0000-0000-0000-000000000014');

-- ─── The previous quarter (draft): a target row that must never surface ───
-- effective_from is the start of the month it targets, so D9's cutoff
-- (month end, or approval) would admit it. Only the status = 'locked' filter
-- keeps it out, which is what mutation (26) must prove (rule 15).

insert into public.kpi_target (assignment_id, month, value, effective_from)
select a.id, qm.month, 999, qm.month::timestamp at time zone 'Pacific/Auckland'
  from public.kpi_assignment a
  join public.kpi_scorecard s on s.id = a.scorecard_id
  join zz006_ctx c on true
  join (select fy, quarter, min(month) as month
          from public.kpi_calendar_day group by fy, quarter) qm
    on qm.fy = c.prev_fy and qm.quarter = c.prev_quarter
 where s.person_id = '10000000-0000-0000-0000-000000000008'
   and s.fy = c.prev_fy and s.quarter = c.prev_quarter
   and a.kpi_definition_id = '20000000-0000-0000-0000-000000000010';

-- ─── Nia, Oli, and Dee: current- and previous-quarter M-sum scorecards ────

insert into public.kpi_scorecard (person_id, fy, quarter, status)
select p.id, c.fy, c.quarter, 'draft'
  from (values
    ('10000000-0000-0000-0000-000000000004'::uuid),
    ('10000000-0000-0000-0000-000000000005'::uuid),
    ('10000000-0000-0000-0000-000000000006'::uuid)
  ) as p(id)
  cross join (
    select cur_fy as fy, cur_quarter as quarter from zz006_ctx
    union all
    select prev_fy, prev_quarter from zz006_ctx
  ) as c;

insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version, sort_order)
select s.id, '20000000-0000-0000-0000-000000000010', 1, 0
  from public.kpi_scorecard s
 where s.person_id in ('10000000-0000-0000-0000-000000000004',
                        '10000000-0000-0000-0000-000000000005',
                        '10000000-0000-0000-0000-000000000006');

-- ─── The sync-conflict fixture: a hubspot actual on M-sum, today − 5 ──────

insert into public.kpi_actual_daily
  (person_id, kpi_definition_id, kpi_version, date, value, numerator, denominator, source, calculated_at)
select '10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', 1,
       c.today - 5, 42, null, null, 'hubspot', now()
  from zz006_ctx c;

drop table zz006_ctx;

select '0006 local seed applied' as result;
