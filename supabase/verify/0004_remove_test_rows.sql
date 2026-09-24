-- 0004_remove_test_rows.sql
-- Paste into the Supabase SQL editor and run. Removes every version of any
-- KPI that ever had a name starting with "ZZ Test " (Edward's and Cole's test
-- proposals). Audit rows are kept, so the removal itself stays visible in
-- 0004_audit_check.sql. Runs as the SQL editor's owner role, so RLS and the
-- insert/update guard don't apply to the delete -- the guard has no DELETE
-- clause to begin with, but is skipped either way since the audit trigger
-- fires as the caller for the delete, not as whoever proposed the row.
--
-- The last line is the count of ZZ Test KPIs remaining. It must read 0.

begin;

delete from public.kpi_definition
 where id in (
   select id from public.kpi_definition where name like 'ZZ Test %'
 );

commit;

select count(*) as "ZZ Test KPIs remaining"
  from public.kpi_definition
 where name like 'ZZ Test %';
