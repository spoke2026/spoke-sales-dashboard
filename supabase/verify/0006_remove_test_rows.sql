-- 0006_remove_test_rows.sql
-- Run this first, then 0005_remove_test_rows.sql, then 0004, then 0003.
-- Paste into the Supabase SQL editor and run as the SQL editor owner, which
-- bypasses RLS and the D12 guards the same way it bypasses RLS everywhere
-- else.
--
-- Removes every manual actual and manual entry belonging to a person named
-- "ZZ Test ...". Audit rows are kept (the audit log is a record of what
-- happened, not a fixture).
--
-- One transaction. If anything errors, nothing is removed.

begin;

create temp table zz_people as
select p.id
  from public.kpi_person p
 where p.full_name like 'ZZ Test%';

delete from public.kpi_actual_daily d
 where d.source = 'manual'
   and d.person_id in (select id from zz_people);

delete from public.kpi_manual_entry m
 where m.person_id in (select id from zz_people);

commit;

select
  (select count(*) from public.kpi_manual_entry m
    where m.person_id in (select id from zz_people)) as "ZZ Test entries remaining",
  (select count(*) from public.kpi_actual_daily d
    where d.source = 'manual' and d.person_id in (select id from zz_people)
  ) as "ZZ Test manual actuals remaining";
