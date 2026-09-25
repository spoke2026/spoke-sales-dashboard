-- 0006_kpi_entry_rollback.sql
-- EMERGENCY USE ONLY. Removes the manual entry rules and the actual sync.
-- Entries and actuals already saved stay. Run this BEFORE the 0005 rollback,
-- never after.
--
-- One transaction, no CASCADE. If anything errors, nothing is dropped.

begin;

drop trigger kpi_manual_entry_guard on public.kpi_manual_entry;
drop trigger kpi_manual_entry_sync on public.kpi_manual_entry;

drop policy kpi_manual_entry_insert_scoped on public.kpi_manual_entry;
drop policy kpi_manual_entry_update_scoped on public.kpi_manual_entry;
drop policy kpi_actual_daily_insert_manual on public.kpi_actual_daily;
drop policy kpi_actual_daily_update_manual on public.kpi_actual_daily;

drop function public.kpi_manual_entry_sync();
drop function public.kpi_manual_entry_guard();
drop function public.kpi_window_targets(uuid, date, date);
drop function public.kpi_actual_matches_entry(uuid, uuid, integer, date, numeric, numeric, numeric);
drop function public.kpi_entry_people();
drop function public.kpi_entry_kpi_version(uuid, uuid, date);
drop function public.kpi_entry_cells(uuid, date, date);
drop function public.kpi_can_write_entry(uuid, date);
drop function public.kpi_may_enter_for(uuid);
drop function public.kpi_owner_entry_open(date, timestamptz);
drop function public.kpi_nz_date(timestamptz);

notify pgrst, 'reload schema';

commit;

select '0006 rolled back' as result;
