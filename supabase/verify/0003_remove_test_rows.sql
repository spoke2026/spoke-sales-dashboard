-- 0003_remove_test_rows.sql
-- Removes the "ZZ Test " rows created while testing the KPI admin screen on the
-- Vercel preview (preview and production share one database). One transaction.
-- It touches nothing else. The audit rows these deletes produce are kept.

begin;

delete from public.kpi_company_closure
 where reason like 'ZZ Test %';

update public.kpi_person p
   set manager_id = null
  from public.kpi_person m
 where p.manager_id = m.id
   and m.full_name like 'ZZ Test %';

delete from public.kpi_person
 where full_name like 'ZZ Test %';

update public.kpi_person p
   set primary_team_id = null
  from public.kpi_team t
 where p.primary_team_id = t.id
   and t.name like 'ZZ Test %';

delete from public.kpi_team
 where name like 'ZZ Test %';

commit;
