-- 0005_audit_check.sql
-- Read-only. Paste into the Supabase SQL editor and run. Shows the 40 most
-- recent rows in public.kpi_audit_log, covering every KPI entity (people,
-- teams, closures, KPI proposals and publishing, scorecards, assignments,
-- targets). It serves both DEPLOYMENT step 5 (a live admin closure add/remove
-- and a non-admin proposal, straight after 0005) and the go-live flow (step
-- 11c). Writes nothing.

select at,
       actor_email,
       entity,
       action,
       entity_id,
       reason,
       after ->> 'status' as status,
       after ->> 'approval_kind' as approval_kind,
       after ->> 'return_note' as return_note,
       after ->> 'board_reference' as board_reference,
       after ->> 'month' as month,
       after ->> 'value' as target_value
  from public.kpi_audit_log
 order by at desc
 limit 40;
