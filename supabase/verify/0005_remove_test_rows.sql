-- 0005_remove_test_rows.sql
-- Run this FIRST, then 0004_remove_test_rows.sql, then 0003_remove_test_rows.sql
-- (FK order). Paste into the Supabase SQL editor and run as the SQL editor
-- owner, which bypasses RLS and the D12 guards the same way it bypasses RLS
-- everywhere else, so this can remove locked test scorecards.
--
-- Removes every test scorecard (D17): one whose person is named "ZZ Test ..."
-- or, having no person (company), one in fy 2029 quarter 4 with no assignment
-- to a non-"ZZ Test %" KPI. Deletes its kpi_target rows, then its
-- kpi_assignment rows, then the scorecard itself. Audit rows are kept (the
-- audit log is a record of what happened, not a fixture).
--
-- One transaction. If anything errors, nothing is removed.

begin;

create temp table zz_scorecards as
select s.id
  from public.kpi_scorecard s
  left join public.kpi_person p on p.id = s.person_id
 where (p.id is not null and p.full_name like 'ZZ Test%')
    or (
      s.person_id is null
      and s.fy = 2029 and s.quarter = 4
      and not exists (
        select 1
          from public.kpi_assignment a
          join public.kpi_definition d
            on d.id = a.kpi_definition_id and d.version = a.kpi_version
         where a.scorecard_id = s.id
           and d.name not like 'ZZ Test%'
      )
    );

delete from public.kpi_target t
 where t.assignment_id in (
   select a.id from public.kpi_assignment a
    where a.scorecard_id in (select id from zz_scorecards)
 );

delete from public.kpi_assignment a
 where a.scorecard_id in (select id from zz_scorecards);

delete from public.kpi_scorecard s
 where s.id in (select id from zz_scorecards);

commit;

select
  (select count(*) from public.kpi_scorecard s
    left join public.kpi_person p on p.id = s.person_id
   where (p.id is not null and p.full_name like 'ZZ Test%')
      or (s.person_id is null and s.fy = 2029 and s.quarter = 4)
  ) as "ZZ Test scorecards remaining",
  (select count(*)
     from public.kpi_assignment a
     join public.kpi_definition d
       on d.id = a.kpi_definition_id and d.version = a.kpi_version
    where d.name like 'ZZ Test%'
  ) as "Assignments still using ZZ Test KPIs";
