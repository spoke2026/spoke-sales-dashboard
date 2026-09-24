-- 0003_kpi_foundations_rollback.sql
-- EMERGENCY USE ONLY.
--
-- This DESTROYS ALL KPI DATA: every person, team, closure, holiday, calendar
-- day and audit row created by or since migration 0003. It is only safe before
-- real data exists.
--
-- It drops only what 0003 created, in reverse dependency order, with no
-- CASCADE. It never touches public.targets or public.is_admin(). One
-- transaction: if anything errors, nothing is dropped.

begin;

-- Triggers
drop trigger kpi_audit_row on public.kpi_company_closure;
drop trigger kpi_audit_row on public.kpi_public_holiday;
drop trigger kpi_audit_row on public.kpi_manual_entry;
drop trigger kpi_audit_row on public.kpi_target;
drop trigger kpi_audit_row on public.kpi_assignment;
drop trigger kpi_audit_row on public.kpi_scorecard;
drop trigger kpi_audit_row on public.kpi_definition;
drop trigger kpi_audit_row on public.kpi_person;
drop trigger kpi_audit_row on public.kpi_team;
drop trigger kpi_calendar_sync on public.kpi_company_closure;
drop trigger kpi_calendar_sync on public.kpi_public_holiday;

-- Tables, dependants first
drop table public.kpi_audit_log;
drop table public.kpi_calendar_day;
drop table public.kpi_company_closure;
drop table public.kpi_public_holiday;
drop table public.kpi_manual_entry;
drop table public.kpi_actual_daily;
drop table public.kpi_target;
drop table public.kpi_assignment;
drop table public.kpi_scorecard;
drop table public.kpi_definition;
drop table public.kpi_person;
drop table public.kpi_team;

-- Functions
drop function public.kpi_audit_row();
drop function public.kpi_calendar_sync();
drop function public.kpi_calendar_recompute();

notify pgrst, 'reload schema';

commit;
