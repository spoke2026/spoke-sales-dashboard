-- 0005_kpi_scorecards.sql
-- KPI scorecard, Phase 2b: scorecards.
--
-- Adds the scorecard lifecycle (draft -> submitted -> locked, return with a
-- note, standard and board approval), insert-only target versioning, and the
-- role-scoped writes that let staff and line managers work on scorecards:
--   * lifecycle columns on kpi_scorecard, change_reason and created_by_email
--     on kpi_target, three FKs to kpi_person and nine CHECK constraints
--   * thirteen SECURITY INVOKER functions: identity (kpi_my_person_id), scope
--     helpers, the rule table (kpi_scorecard_actions), quarter months, current
--     targets, completeness, KPI removal, and three guard triggers
--   * six role-scoped policies (the 0003 admin policies stay as they are)
--
-- It REPLACES exactly three shipped objects, atomically, and nothing else:
--   * the body of public.kpi_audit_row() (0003), which now opens a
--     transaction-local gate just for its own insert and copies change_reason
--     into kpi_audit_log.reason
--   * policy kpi_audit_log_insert (0003) and policy
--     kpi_audit_log_insert_proposal (0004), replaced by the one gate-checked
--     policy kpi_audit_log_insert_trigger. After this, no client can insert
--     into kpi_audit_log directly, the admin included; only the audit trigger
--     can.
--
-- LIVE PATH: every audited KPI write (people, teams, closures, KPI proposals,
-- publishing, scorecards) goes through the replaced trigger and policy the
-- moment this commits. Re-test one admin write and one non-admin proposal
-- straight after (DEPLOYMENT step 5). If either fails with a 403, run
-- supabase/rollback/0005_kpi_scorecards_rollback.sql.
--
-- It never touches public.targets or public.is_admin(), and adds no SECURITY
-- DEFINER. One transaction, no `if not exists`, no CASCADE. A second run
-- fails loudly with "already exists" and rolls back. If this script errors,
-- nothing has changed.

begin;

-- 0. Guard: 0001, 0003 and 0004 must already be applied.
do $$
begin
  if to_regprocedure('public.is_admin()') is null
     or to_regclass('public.kpi_scorecard') is null
     or to_regprocedure('public.kpi_audit_row()') is null
     or to_regprocedure('public.kpi_definition_guard()') is null then
    raise exception '0005 needs 0001, 0003 and 0004';
  end if;
end $$;

-- ─── 1. Columns ──────────────────────────────────────────────────────────────

alter table public.kpi_scorecard
  add column submitted_at timestamptz null,
  add column submitted_by uuid null,
  add column approval_kind text null,
  add column board_reference text null,
  add column board_meeting_date date null,
  add column returned_at timestamptz null,
  add column returned_by uuid null,
  add column return_note text null;

alter table public.kpi_target
  add column change_reason text null,
  add column created_by_email text null default (auth.jwt() ->> 'email');

comment on column public.kpi_scorecard.approved_by is
  'The person who approved, or who recorded the board''s approval (approval_kind board).';
comment on column public.kpi_target.change_reason is
  'Why a target changed. Required when the scorecard is locked. Copied into kpi_audit_log.reason.';

-- ─── 2. Constraints (validate existing rows, so bad data fails loudly) ───────

alter table public.kpi_scorecard
  add constraint kpi_scorecard_approved_by_fkey
  foreign key (approved_by) references public.kpi_person (id);

alter table public.kpi_scorecard
  add constraint kpi_scorecard_submitted_by_fkey
  foreign key (submitted_by) references public.kpi_person (id);

alter table public.kpi_scorecard
  add constraint kpi_scorecard_returned_by_fkey
  foreign key (returned_by) references public.kpi_person (id);

alter table public.kpi_scorecard
  add constraint kpi_scorecard_approval_kind
  check (approval_kind is null or approval_kind in ('standard', 'board'));

alter table public.kpi_scorecard
  add constraint kpi_scorecard_locked_shape
  check ((status = 'locked') = (approval_kind is not null)
         and (approval_kind is null) = (approved_by is null)
         and (approved_by is null) = (approved_at is null));

alter table public.kpi_scorecard
  add constraint kpi_scorecard_board_shape
  check ((approval_kind is not distinct from 'board')
         = (board_reference is not null and board_meeting_date is not null));

alter table public.kpi_scorecard
  add constraint kpi_scorecard_board_reference_length
  check (board_reference is null or length(btrim(board_reference)) between 1 and 200);

alter table public.kpi_scorecard
  add constraint kpi_scorecard_board_meeting_date_floor
  check (board_meeting_date is null or board_meeting_date >= date '2025-04-01');

alter table public.kpi_scorecard
  add constraint kpi_scorecard_submitted_shape
  check ((status = 'draft') = (submitted_at is null)
         and (submitted_at is null) = (submitted_by is null));

alter table public.kpi_scorecard
  add constraint kpi_scorecard_return_shape
  check ((returned_at is null) = (returned_by is null)
         and (returned_at is null) = (return_note is null)
         and (returned_at is null or status = 'draft'));

alter table public.kpi_scorecard
  add constraint kpi_scorecard_return_note_length
  check (return_note is null or length(btrim(return_note)) between 1 and 500);

alter table public.kpi_target
  add constraint kpi_target_change_reason_length
  check (change_reason is null or length(btrim(change_reason)) between 1 and 500);

-- ─── 3. Identity and scope helpers (SECURITY INVOKER, search_path pinned) ────

-- D1: a login IS a person when the active kpi_person's email equals the JWT
-- email. The only implementation, used by every policy, guard and page.
create function public.kpi_my_person_id()
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select p.id
    from public.kpi_person p
   where p.active
     and p.email = lower(btrim(auth.jwt() ->> 'email'))
$$;

revoke all on function public.kpi_my_person_id() from public, anon;
grant execute on function public.kpi_my_person_id() to authenticated;

-- Owner or direct line manager. A null person (company) and a null me both
-- give false.
create function public.kpi_is_owner_or_manager(p_person_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.id = public.kpi_my_person_id() or p.manager_id = public.kpi_my_person_id()
       from public.kpi_person p
      where p.id = p_person_id),
    false)
$$;

revoke all on function public.kpi_is_owner_or_manager(uuid) from public, anon;
grant execute on function public.kpi_is_owner_or_manager(uuid) to authenticated;

create function public.kpi_can_touch_scorecard(p_scorecard_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select public.kpi_is_owner_or_manager(s.person_id)
       from public.kpi_scorecard s
      where s.id = p_scorecard_id),
    false)
$$;

revoke all on function public.kpi_can_touch_scorecard(uuid) from public, anon;
grant execute on function public.kpi_can_touch_scorecard(uuid) to authenticated;

create function public.kpi_can_touch_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select public.kpi_can_touch_scorecard(a.scorecard_id)
       from public.kpi_assignment a
      where a.id = p_assignment_id),
    false)
$$;

revoke all on function public.kpi_can_touch_assignment(uuid) from public, anon;
grant execute on function public.kpi_can_touch_assignment(uuid) to authenticated;

-- ─── 4. Rule and data functions ──────────────────────────────────────────────

-- THE RULE TABLE. One implementation, read by the guards and by the pages.
-- Array order: edit, submit, return, approve, record_board_approval,
-- exception_edit.
create function public.kpi_scorecard_actions(p_scorecard_id uuid)
returns text[]
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_me uuid;
  v_person_id uuid;
  v_status text;
  v_owner boolean;
  v_manager boolean;
  v_admin boolean;
  v_actions text[] := '{}';
begin
  v_me := public.kpi_my_person_id();
  if v_me is null then
    return '{}';
  end if;

  select s.person_id, s.status into v_person_id, v_status
    from public.kpi_scorecard s
   where s.id = p_scorecard_id;
  if not found then
    return '{}';
  end if;

  v_owner := v_person_id is not null and v_person_id = v_me;
  v_manager := v_person_id is not null and exists (
    select 1 from public.kpi_person p where p.id = v_person_id and p.manager_id = v_me
  );
  v_admin := coalesce(public.is_admin(), false);

  if v_status = 'draft' then
    if v_admin or v_owner or v_manager then
      v_actions := array['edit', 'submit'];
    end if;
  elsif v_status = 'submitted' then
    if v_admin or v_manager then
      v_actions := array['edit', 'return'];
      if v_person_id is not null and not v_owner then
        v_actions := v_actions || 'approve'::text;
      end if;
      if v_admin and (v_person_id is null or v_owner) then
        v_actions := v_actions || 'record_board_approval'::text;
      end if;
    end if;
  elsif v_status = 'locked' then
    if v_admin then
      v_actions := array['exception_edit'];
    end if;
  end if;

  return v_actions;
end;
$$;

revoke all on function public.kpi_scorecard_actions(uuid) from public, anon;
grant execute on function public.kpi_scorecard_actions(uuid) to authenticated;

-- Who may start a scorecard: company -> admin; an active Individual person ->
-- admin, that person, or their line manager; me null -> nobody.
create function public.kpi_can_create_scorecard(p_person_id uuid)
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_me uuid;
  v_person public.kpi_person%rowtype;
begin
  v_me := public.kpi_my_person_id();
  if v_me is null then
    return false;
  end if;
  if p_person_id is null then
    return coalesce(public.is_admin(), false);
  end if;

  select * into v_person from public.kpi_person p where p.id = p_person_id;
  if not found or not v_person.active or v_person.scorecard_type <> 'individual' then
    return false;
  end if;

  return coalesce(public.is_admin(), false)
      or p_person_id = v_me
      or v_person.manager_id is not distinct from v_me;
end;
$$;

revoke all on function public.kpi_can_create_scorecard(uuid) from public, anon;
grant execute on function public.kpi_can_create_scorecard(uuid) to authenticated;

-- D11: the 48 (fy, quarter, month) rows. Pages never select the whole
-- calendar (1,461 rows, over PostgREST's 1,000-row cap).
create function public.kpi_quarter_months()
returns table (fy smallint, quarter smallint, month date)
language sql
stable
set search_path = public, pg_temp
as $$
  select distinct c.fy, c.quarter, c.month
    from public.kpi_calendar_day c
   order by 1, 2, 3
$$;

revoke all on function public.kpi_quarter_months() from public, anon;
grant execute on function public.kpi_quarter_months() to authenticated;

-- D7: the current target for (assignment, month) is the latest effective_from.
create function public.kpi_current_targets(p_scorecard_id uuid)
returns setof public.kpi_target
language sql
stable
set search_path = public, pg_temp
as $$
  select distinct on (t.assignment_id, t.month) t.*
    from public.kpi_target t
    join public.kpi_assignment a on a.id = t.assignment_id
   where a.scorecard_id = p_scorecard_id
   order by t.assignment_id, t.month, t.effective_from desc
$$;

revoke all on function public.kpi_current_targets(uuid) from public, anon;
grant execute on function public.kpi_current_targets(uuid) to authenticated;

-- D9: (assignment x month of the scorecard's quarter) pairs with no target.
create function public.kpi_scorecard_missing_targets(p_scorecard_id uuid)
returns integer
language sql
stable
set search_path = public, pg_temp
as $$
  select count(*)::integer
    from public.kpi_scorecard s
    join public.kpi_assignment a on a.scorecard_id = s.id
    join (select distinct c.fy, c.quarter, c.month from public.kpi_calendar_day c) m
      on m.fy = s.fy and m.quarter = s.quarter
   where s.id = p_scorecard_id
     and not exists (
       select 1 from public.kpi_target t
        where t.assignment_id = a.id and t.month = m.month
     )
$$;

revoke all on function public.kpi_scorecard_missing_targets(uuid) from public, anon;
grant execute on function public.kpi_scorecard_missing_targets(uuid) to authenticated;

-- D7: the only path that deletes kpi_target rows. The transaction-local
-- setting tells kpi_target_guard this delete is part of removing this one
-- assignment; it is reset straight after. RLS filters both deletes for users
-- without rights, so they get 0.
create function public.kpi_remove_assignment(p_assignment_id uuid)
returns integer
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  perform set_config('kpi.removing_assignment', p_assignment_id::text, true);
  delete from public.kpi_target where assignment_id = p_assignment_id;
  delete from public.kpi_assignment where id = p_assignment_id;
  get diagnostics v_count = row_count;
  perform set_config('kpi.removing_assignment', '', true);
  return v_count;
end;
$$;

revoke all on function public.kpi_remove_assignment(uuid) from public, anon;
grant execute on function public.kpi_remove_assignment(uuid) to authenticated;

-- ─── 5. Guards ───────────────────────────────────────────────────────────────
-- D12: each guard applies to the `authenticated` role only, mirroring RLS,
-- which the SQL editor's owner role also bypasses. That lets the cleanup
-- script remove locked test scorecards and lets Edward fix data in an
-- emergency. The audit trigger still records those changes.
-- NOTE for whoever adds a service-role client later (a cron job, say): the
-- check is on the role name, so any role other than `authenticated` skips
-- every guard in this file with nothing to flag it.

create function public.kpi_scorecard_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actions text[];
  v_me uuid;
  v_person public.kpi_person%rowtype;
begin
  if current_user <> 'authenticated' then
    return coalesce(NEW, OLD);
  end if;

  if TG_OP = 'INSERT' then
    if NEW.status is distinct from 'draft' then
      raise exception 'A scorecard starts as a draft' using errcode = 'KS011';
    end if;
    if NEW.person_id is not null then
      select * into v_person from public.kpi_person p where p.id = NEW.person_id;
      if not found or not v_person.active or v_person.scorecard_type <> 'individual' then
        raise exception 'That person does not have an individual scorecard' using errcode = 'KS007';
      end if;
    end if;
    if not exists (
      select 1 from public.kpi_calendar_day c where c.fy = NEW.fy and c.quarter = NEW.quarter
    ) then
      raise exception 'The working-day calendar does not cover that quarter' using errcode = 'KS008';
    end if;
    -- WHO versus WHAT (D3). A BEFORE trigger runs before RLS's WITH CHECK, so
    -- a caller the policies would reject outright (no admin, not the person,
    -- not their line manager) is left to RLS, which rejects with 42501. KS001
    -- is for a caller the policies admit but the rule table doesn't.
    if not public.kpi_can_create_scorecard(NEW.person_id)
       and (coalesce(public.is_admin(), false) or public.kpi_is_owner_or_manager(NEW.person_id)) then
      raise exception 'Not allowed to start this scorecard' using errcode = 'KS001';
    end if;
    NEW.submitted_at := null;
    NEW.submitted_by := null;
    NEW.approval_kind := null;
    NEW.approved_by := null;
    NEW.approved_at := null;
    NEW.board_reference := null;
    NEW.board_meeting_date := null;
    NEW.returned_at := null;
    NEW.returned_by := null;
    NEW.return_note := null;
    return NEW;
  end if;

  -- UPDATE
  if NEW.id is distinct from OLD.id
     or NEW.person_id is distinct from OLD.person_id
     or NEW.fy is distinct from OLD.fy
     or NEW.quarter is distinct from OLD.quarter
     or NEW.created_at is distinct from OLD.created_at then
    raise exception 'A scorecard''s person, quarter and creation time cannot change' using errcode = 'KS011';
  end if;

  v_actions := public.kpi_scorecard_actions(OLD.id);
  v_me := public.kpi_my_person_id();

  if OLD.status = 'draft' and NEW.status = 'submitted' then
    if not ('submit' = any (v_actions)) then
      raise exception 'Not allowed to submit this scorecard now' using errcode = 'KS001';
    end if;
    if not exists (select 1 from public.kpi_assignment a where a.scorecard_id = OLD.id) then
      raise exception 'A scorecard needs at least one KPI' using errcode = 'KS003';
    end if;
    NEW.submitted_at := now();
    NEW.submitted_by := v_me;
    NEW.returned_at := null;
    NEW.returned_by := null;
    NEW.return_note := null;
    NEW.approval_kind := null;
    NEW.approved_by := null;
    NEW.approved_at := null;
    NEW.board_reference := null;
    NEW.board_meeting_date := null;
    return NEW;
  end if;

  if OLD.status = 'submitted' and NEW.status = 'draft' then
    if not ('return' = any (v_actions)) then
      raise exception 'Not allowed to return this scorecard now' using errcode = 'KS001';
    end if;
    if NEW.return_note is null or btrim(NEW.return_note) = '' then
      raise exception 'Returning a scorecard needs a note' using errcode = 'KS012';
    end if;
    NEW.returned_at := now();
    NEW.returned_by := v_me;
    NEW.submitted_at := null;
    NEW.submitted_by := null;
    NEW.approval_kind := null;
    NEW.approved_by := null;
    NEW.approved_at := null;
    NEW.board_reference := null;
    NEW.board_meeting_date := null;
    return NEW;
  end if;

  if OLD.status = 'submitted' and NEW.status = 'locked'
     and NEW.approval_kind is not distinct from 'standard' then
    if not ('approve' = any (v_actions)) then
      if coalesce(public.is_admin(), false) then
        raise exception 'Nobody approves their own scorecard through the standard route' using errcode = 'KS004';
      end if;
      raise exception 'Not allowed to approve this scorecard' using errcode = 'KS001';
    end if;
    if not exists (select 1 from public.kpi_assignment a where a.scorecard_id = OLD.id) then
      raise exception 'A scorecard needs at least one KPI' using errcode = 'KS003';
    end if;
    if public.kpi_scorecard_missing_targets(OLD.id) > 0 then
      raise exception 'Every KPI needs a target for every month before approval' using errcode = 'KS002';
    end if;
    NEW.approved_at := now();
    NEW.approved_by := v_me;
    NEW.board_reference := null;
    NEW.board_meeting_date := null;
    NEW.submitted_at := OLD.submitted_at;
    NEW.submitted_by := OLD.submitted_by;
    NEW.returned_at := null;
    NEW.returned_by := null;
    NEW.return_note := null;
    return NEW;
  end if;

  if OLD.status = 'submitted' and NEW.status = 'locked'
     and NEW.approval_kind is not distinct from 'board' then
    if not ('record_board_approval' = any (v_actions)) then
      if coalesce(public.is_admin(), false) then
        raise exception 'Board approval is only for the company scorecard and the admin''s own' using errcode = 'KS005';
      end if;
      raise exception 'Not allowed to record board approval' using errcode = 'KS001';
    end if;
    if NEW.board_reference is null or btrim(NEW.board_reference) = '' then
      raise exception 'Board approval needs the meeting reference' using errcode = 'KS014';
    end if;
    if NEW.board_meeting_date is null
       or NEW.board_meeting_date > (now() at time zone 'Pacific/Auckland')::date then
      raise exception 'Board approval needs a meeting date that is not in the future' using errcode = 'KS013';
    end if;
    if not exists (select 1 from public.kpi_assignment a where a.scorecard_id = OLD.id) then
      raise exception 'A scorecard needs at least one KPI' using errcode = 'KS003';
    end if;
    if public.kpi_scorecard_missing_targets(OLD.id) > 0 then
      raise exception 'Every KPI needs a target for every month before approval' using errcode = 'KS002';
    end if;
    NEW.approved_at := now();
    NEW.approved_by := v_me;
    NEW.submitted_at := OLD.submitted_at;
    NEW.submitted_by := OLD.submitted_by;
    NEW.returned_at := null;
    NEW.returned_by := null;
    NEW.return_note := null;
    return NEW;
  end if;

  raise exception 'That scorecard change is not allowed' using errcode = 'KS011';
end;
$$;

revoke all on function public.kpi_scorecard_guard() from public, anon;
grant execute on function public.kpi_scorecard_guard() to authenticated;

create function public.kpi_assignment_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' then
    return coalesce(NEW, OLD);
  end if;

  if TG_OP = 'UPDATE' then
    raise exception 'Assignments cannot be changed' using errcode = 'KS011';
  end if;

  if TG_OP = 'DELETE' then
    if not ('edit' = any (public.kpi_scorecard_actions(OLD.scorecard_id))) then
      raise exception 'Not allowed to remove KPIs from this scorecard now' using errcode = 'KS001';
    end if;
    return OLD;
  end if;

  -- INSERT. A caller the policies reject outright is left to RLS (42501), as
  -- in kpi_scorecard_guard.
  if not (coalesce(public.is_admin(), false) or public.kpi_can_touch_scorecard(NEW.scorecard_id)) then
    return NEW;
  end if;
  if not ('edit' = any (public.kpi_scorecard_actions(NEW.scorecard_id))) then
    raise exception 'Not allowed to add KPIs to this scorecard now' using errcode = 'KS001';
  end if;
  if not exists (
    select 1 from public.kpi_definition d
     where d.id = NEW.kpi_definition_id
       and d.version = NEW.kpi_version
       and d.status = 'published'
       and not exists (
         select 1 from public.kpi_definition n
          where n.id = d.id and n.version > d.version
       )
  ) then
    raise exception 'Only the current published version of a KPI can be added' using errcode = 'KS006';
  end if;
  return NEW;
end;
$$;

revoke all on function public.kpi_assignment_guard() from public, anon;
grant execute on function public.kpi_assignment_guard() to authenticated;

create function public.kpi_target_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actions text[];
  v_fy smallint;
  v_quarter smallint;
begin
  if current_user <> 'authenticated' then
    return coalesce(NEW, OLD);
  end if;

  if TG_OP = 'UPDATE' then
    raise exception 'Targets are never updated. Insert a new one instead' using errcode = 'KS011';
  end if;

  if TG_OP = 'DELETE' then
    if current_setting('kpi.removing_assignment', true) is distinct from OLD.assignment_id::text then
      raise exception 'Targets are only removed with their KPI' using errcode = 'KS011';
    end if;
    select public.kpi_scorecard_actions(a.scorecard_id) into v_actions
      from public.kpi_assignment a where a.id = OLD.assignment_id;
    if not ('edit' = any (coalesce(v_actions, '{}'))) then
      raise exception 'Not allowed to remove targets from this scorecard now' using errcode = 'KS001';
    end if;
    return OLD;
  end if;

  -- INSERT. D7 stamping: nobody backdates a target or saves it as someone else.
  NEW.effective_from := now();
  NEW.created_by := auth.uid();
  NEW.created_by_email := auth.jwt() ->> 'email';

  select public.kpi_scorecard_actions(s.id), s.fy, s.quarter into v_actions, v_fy, v_quarter
    from public.kpi_assignment a
    join public.kpi_scorecard s on s.id = a.scorecard_id
   where a.id = NEW.assignment_id;
  v_actions := coalesce(v_actions, '{}');

  -- A caller the policies reject outright is left to RLS (42501), as in
  -- kpi_scorecard_guard.
  if not (coalesce(public.is_admin(), false) or public.kpi_can_touch_assignment(NEW.assignment_id)) then
    return NEW;
  end if;

  if 'edit' = any (v_actions) then
    null;
  elsif 'exception_edit' = any (v_actions) then
    if NEW.change_reason is null or btrim(NEW.change_reason) = '' then
      raise exception 'Changing a locked target needs a reason' using errcode = 'KS010';
    end if;
  else
    raise exception 'Not allowed to set targets on this scorecard now' using errcode = 'KS001';
  end if;

  if not exists (
    select 1 from public.kpi_calendar_day c
     where c.date = NEW.month and c.fy = v_fy and c.quarter = v_quarter
  ) then
    raise exception 'That month is outside the scorecard''s quarter' using errcode = 'KS009';
  end if;

  return NEW;
end;
$$;

revoke all on function public.kpi_target_guard() from public, anon;
grant execute on function public.kpi_target_guard() to authenticated;

create trigger kpi_scorecard_guard
  before insert or update on public.kpi_scorecard
  for each row execute function public.kpi_scorecard_guard();

create trigger kpi_assignment_guard
  before insert or update or delete on public.kpi_assignment
  for each row execute function public.kpi_assignment_guard();

create trigger kpi_target_guard
  before insert or update or delete on public.kpi_target
  for each row execute function public.kpi_target_guard();

-- ─── 6. Audit gate (D6) ──────────────────────────────────────────────────────
-- The audit trigger opens a transaction-local gate just for its own insert and
-- closes it straight after. The one insert policy on kpi_audit_log admits a
-- row only while that gate is open and only with the caller's own identity.
-- A REST or GraphQL client can't set a custom setting (PostgREST sets only its
-- own request.* settings and the role; set_config lives in pg_catalog, which
-- isn't exposed), so direct audit inserts are impossible for every role, the
-- admin included. is_local = true keeps the gate inside one transaction,
-- which matters with pooled connections. The SQL editor owner bypasses RLS as
-- before.

create or replace function public.kpi_audit_row()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform set_config('kpi.audit_writer', 'kpi_audit_row', true);
  insert into public.kpi_audit_log (entity, entity_id, action, before, after, reason)
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
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) ->> 'change_reason' else null end
  );
  perform set_config('kpi.audit_writer', '', true);
  return null;
end;
$$;

-- Belt and braces: Postgres already refuses to call a `returns trigger`
-- function outside trigger firing, so no RPC can run this body. Revoking
-- makes that visible here rather than implicit. Triggers still fire, because
-- EXECUTE is checked when a trigger is created, not when it fires.
revoke all on function public.kpi_audit_row() from public, anon, authenticated;

drop policy kpi_audit_log_insert on public.kpi_audit_log;
drop policy kpi_audit_log_insert_proposal on public.kpi_audit_log;

create policy kpi_audit_log_insert_trigger on public.kpi_audit_log
  for insert to authenticated
  with check (
    current_setting('kpi.audit_writer', true) = 'kpi_audit_row'
    and actor_id is not distinct from auth.uid()
    and actor_email is not distinct from (auth.jwt() ->> 'email')
  );

-- ─── 7. Role-scoped policies (permissive, ORed with the 0003 admin ones) ─────
-- Policies decide WHO can touch a scorecard's rows at all. The guards decide
-- WHAT is allowed in the current state (D3).

create policy kpi_scorecard_insert_scoped on public.kpi_scorecard
  for insert to authenticated
  with check (public.kpi_is_owner_or_manager(person_id));

create policy kpi_scorecard_update_scoped on public.kpi_scorecard
  for update to authenticated
  using (public.kpi_is_owner_or_manager(person_id))
  with check (public.kpi_is_owner_or_manager(person_id));

create policy kpi_assignment_insert_scoped on public.kpi_assignment
  for insert to authenticated
  with check (public.kpi_can_touch_scorecard(scorecard_id));

create policy kpi_assignment_delete_scoped on public.kpi_assignment
  for delete to authenticated
  using (public.is_admin() or public.kpi_can_touch_scorecard(scorecard_id));

create policy kpi_target_insert_scoped on public.kpi_target
  for insert to authenticated
  with check (created_by = auth.uid() and public.kpi_can_touch_assignment(assignment_id));

create policy kpi_target_delete_scoped on public.kpi_target
  for delete to authenticated
  using (public.is_admin() or public.kpi_can_touch_assignment(assignment_id));

-- ─── 8. Reload the PostgREST schema cache ────────────────────────────────────
notify pgrst, 'reload schema';

commit;

select '0005 applied' as result;
