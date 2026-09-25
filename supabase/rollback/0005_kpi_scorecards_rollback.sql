-- 0005_kpi_scorecards_rollback.sql
-- EMERGENCY USE ONLY. Removes scorecard lifecycle details (who submitted,
-- returned, or approved, notes, board details, and target reasons are lost;
-- statuses, KPIs, and targets stay). Run this BEFORE the 0004 rollback, never
-- after -- the 0004 rollback drops policy kpi_audit_log_insert_proposal,
-- which only exists again after this script restores it.
--
-- One transaction, no CASCADE. If anything errors, nothing is dropped.

begin;

-- ─── Scoped policies ─────────────────────────────────────────────────────────

drop policy kpi_scorecard_insert_scoped on public.kpi_scorecard;
drop policy kpi_scorecard_update_scoped on public.kpi_scorecard;
drop policy kpi_assignment_insert_scoped on public.kpi_assignment;
drop policy kpi_assignment_delete_scoped on public.kpi_assignment;
drop policy kpi_target_insert_scoped on public.kpi_target;
drop policy kpi_target_delete_scoped on public.kpi_target;

-- ─── Audit gate: restore the exact 0003/0004 objects ───────────────────────

drop policy kpi_audit_log_insert_trigger on public.kpi_audit_log;

create policy kpi_audit_log_insert on public.kpi_audit_log
  for insert to authenticated with check (public.is_admin());

create policy kpi_audit_log_insert_proposal on public.kpi_audit_log
  for insert to authenticated
  with check (
    entity = 'kpi_definition'
    and action = 'insert'
    and before is null
    and reason is null
    and actor_id = auth.uid()
    and actor_email = (auth.jwt() ->> 'email')
    and exists (
      select 1 from public.kpi_definition d
       where d.id::text = entity_id
         and d.version = 1
         and d.status = 'proposed'
         and d.created_by = auth.uid()
    )
  );

create or replace function public.kpi_audit_row()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into public.kpi_audit_log (entity, entity_id, action, before, after)
  values (
    TG_TABLE_NAME,
    coalesce(
      to_jsonb(NEW) ->> 'id',
      to_jsonb(NEW) ->> 'date',
      to_jsonb(OLD) ->> 'id',
      to_jsonb(OLD) ->> 'date'
    ),
    lower(TG_OP),
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end
  );
  return null;
end;
$$;

-- ─── Guards ──────────────────────────────────────────────────────────────────

drop trigger kpi_scorecard_guard on public.kpi_scorecard;
drop trigger kpi_assignment_guard on public.kpi_assignment;
drop trigger kpi_target_guard on public.kpi_target;

drop function public.kpi_scorecard_guard();
drop function public.kpi_assignment_guard();
drop function public.kpi_target_guard();

-- ─── Other ten functions ─────────────────────────────────────────────────────

drop function public.kpi_remove_assignment(uuid);
drop function public.kpi_scorecard_missing_targets(uuid);
drop function public.kpi_current_targets(uuid);
drop function public.kpi_quarter_months();
drop function public.kpi_can_create_scorecard(uuid);
drop function public.kpi_scorecard_actions(uuid);
drop function public.kpi_can_touch_assignment(uuid);
drop function public.kpi_can_touch_scorecard(uuid);
drop function public.kpi_is_owner_or_manager(uuid);
drop function public.kpi_my_person_id();

-- ─── Constraints ─────────────────────────────────────────────────────────────

alter table public.kpi_target drop constraint kpi_target_change_reason_length;

alter table public.kpi_scorecard drop constraint kpi_scorecard_return_note_length;
alter table public.kpi_scorecard drop constraint kpi_scorecard_return_shape;
alter table public.kpi_scorecard drop constraint kpi_scorecard_submitted_shape;
alter table public.kpi_scorecard drop constraint kpi_scorecard_board_meeting_date_floor;
alter table public.kpi_scorecard drop constraint kpi_scorecard_board_reference_length;
alter table public.kpi_scorecard drop constraint kpi_scorecard_board_shape;
alter table public.kpi_scorecard drop constraint kpi_scorecard_locked_shape;
alter table public.kpi_scorecard drop constraint kpi_scorecard_approval_kind;

alter table public.kpi_scorecard drop constraint kpi_scorecard_returned_by_fkey;
alter table public.kpi_scorecard drop constraint kpi_scorecard_submitted_by_fkey;
alter table public.kpi_scorecard drop constraint kpi_scorecard_approved_by_fkey;

-- ─── Columns ─────────────────────────────────────────────────────────────────

alter table public.kpi_target
  drop column created_by_email,
  drop column change_reason;

alter table public.kpi_scorecard
  drop column return_note,
  drop column returned_by,
  drop column returned_at,
  drop column board_meeting_date,
  drop column board_reference,
  drop column approval_kind,
  drop column submitted_by,
  drop column submitted_at;

notify pgrst, 'reload schema';

commit;

select '0005 rolled back' as result;
