-- 0006_audit_check.sql
-- Read-only. Paste into the Supabase SQL editor and run. Shows the 40 most
-- recent rows in public.kpi_audit_log, with the manual-entry fields (person,
-- date, value, numerator, denominator) alongside the existing lifecycle
-- fields, so a single glance covers both. Serves DEPLOYMENT step 5 (the live
-- save check straight after 0006) and the go-live flow (step 11c). Writes
-- nothing.

select at,
       actor_email,
       entity,
       action,
       entity_id,
       reason,
       coalesce(after, before) ->> 'person_id' as person_id,
       coalesce(after, before) ->> 'date' as date,
       before ->> 'value' as before_value,
       after ->> 'value' as value,
       after ->> 'numerator' as numerator,
       after ->> 'denominator' as denominator,
       after ->> 'status' as status,
       after ->> 'month' as month
  from public.kpi_audit_log
 order by at desc
 limit 40;
