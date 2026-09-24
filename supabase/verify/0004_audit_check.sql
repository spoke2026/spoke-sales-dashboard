-- 0004_audit_check.sql
-- Read-only. Paste into the Supabase SQL editor and run. Shows the 30 most
-- recent kpi_definition audit rows: who did what, to which version, and what
-- status it left behind. Writes nothing.

select at, actor_email, action, entity_id, after->>'version' as version,
       after->>'name' as name, coalesce(after->>'status', before->>'status') as status
  from public.kpi_audit_log
 where entity = 'kpi_definition'
 order by at desc
 limit 30;
