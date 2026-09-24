-- 0004_kpi_library_rollback.sql
-- EMERGENCY USE ONLY. Removes the proposal policies, the guard, the
-- constraints, and the created_by_email column (proposer emails are lost).
-- KPI rows stay. Run this BEFORE the 0003 rollback, never after -- dropping
-- kpi_definition first would drop the guard trigger and its policies with
-- it, but not the function public.kpi_definition_guard(), which would then
-- be left behind with nothing to drop it.
--
-- One transaction, no CASCADE. If anything errors, nothing is dropped.

begin;

drop policy kpi_audit_log_insert_proposal on public.kpi_audit_log;
drop policy kpi_definition_insert_proposal on public.kpi_definition;

drop trigger kpi_definition_guard on public.kpi_definition;
drop function public.kpi_definition_guard();

alter table public.kpi_definition drop constraint kpi_definition_example_target_non_negative;
alter table public.kpi_definition drop constraint kpi_definition_attribution_object;
alter table public.kpi_definition drop constraint kpi_definition_source_mapping_object;
alter table public.kpi_definition drop constraint kpi_definition_description_length;
alter table public.kpi_definition drop constraint kpi_definition_name_length;

alter table public.kpi_definition drop column created_by_email;

notify pgrst, 'reload schema';

commit;

select '0004 rolled back' as result;
