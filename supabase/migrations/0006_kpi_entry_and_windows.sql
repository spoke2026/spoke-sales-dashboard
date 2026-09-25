-- 0006_kpi_entry_and_windows.sql
-- KPI scorecard, Phase 3a: manual entry and window targets.
--
-- Purely additive. Adds:
--   * eleven SECURITY INVOKER functions: the Auckland date (kpi_nz_date), the
--     owner's 7-day window (kpi_owner_entry_open), who may enter for whom
--     (kpi_may_enter_for), the date rule for this caller (kpi_can_write_entry),
--     which KPIs take an entry on which day (kpi_entry_cells,
--     kpi_entry_kpi_version), the people the caller may enter for
--     (kpi_entry_people), the actual-matches-entry check
--     (kpi_actual_matches_entry), the targets that applied at the time
--     (kpi_window_targets), and two trigger functions
--   * two triggers on kpi_manual_entry: a BEFORE guard that decides WHAT may
--     be entered and stamps who and when, and an AFTER sync that keeps an
--     identical kpi_actual_daily row (source 'manual') for every entry
--   * four role-scoped policies, two on kpi_manual_entry and two on
--     kpi_actual_daily (the 0003 admin policies stay as they are)
--   * a backfill of kpi_actual_daily from kpi_manual_entry (expected 0 rows)
--
-- It replaces and drops nothing. No deployed code path reads or writes
-- kpi_manual_entry or kpi_actual_daily yet, so it changes no live code path.
--
-- It never touches public.targets or public.is_admin(), adds no SECURITY
-- DEFINER, and calls no set_config. One transaction, no `if not exists`, no
-- CASCADE. A second run fails loudly with "already exists" and rolls back. If
-- this script errors, nothing has changed.

begin;

-- 0. Guard: 0001, 0003, 0004 and 0005 must already be applied.
do $$
begin
  if to_regprocedure('public.is_admin()') is null
     or to_regclass('public.kpi_manual_entry') is null
     or to_regprocedure('public.kpi_my_person_id()') is null
     or to_regprocedure('public.kpi_is_owner_or_manager(uuid)') is null
     or to_regprocedure('public.kpi_target_guard()') is null then
    raise exception '0006 needs 0001, 0003, 0004 and 0005';
  end if;
end $$;

-- ─── 1. Date and permission helpers (SECURITY INVOKER, search_path pinned) ───

-- D4: every date boundary is the Auckland calendar date.
create function public.kpi_nz_date(p_at timestamptz)
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select (p_at at time zone 'Pacific/Auckland')::date
$$;

revoke all on function public.kpi_nz_date(timestamptz) from public, anon;
grant execute on function public.kpi_nz_date(timestamptz) to authenticated;

-- D4: the owner may write a day on that day and the 7 days after it.
create function public.kpi_owner_entry_open(p_date date, p_at timestamptz)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select p_date between public.kpi_nz_date(p_at) - 7 and public.kpi_nz_date(p_at)
$$;

revoke all on function public.kpi_owner_entry_open(date, timestamptz) from public, anon;
grant execute on function public.kpi_owner_entry_open(date, timestamptz) to authenticated;

-- D3: who may enter for whom. A linked caller, an active Individual person,
-- and the caller is the admin, that person, or their line manager.
create function public.kpi_may_enter_for(p_person_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select public.kpi_my_person_id() is not null
        and p.active
        and p.scorecard_type = 'individual'
        and (coalesce(public.is_admin(), false)
             or p.id = public.kpi_my_person_id()
             or p.manager_id = public.kpi_my_person_id())
       from public.kpi_person p
      where p.id = p_person_id),
    false)
$$;

revoke all on function public.kpi_may_enter_for(uuid) from public, anon;
grant execute on function public.kpi_may_enter_for(uuid) to authenticated;

-- D3 and D4: the date rule for this caller. Nobody writes a future day. The
-- admin and the person's line manager may write any past day; the owner only
-- inside their 7 days.
create function public.kpi_can_write_entry(p_person_id uuid, p_date date)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select public.kpi_may_enter_for(p_person_id)
     and p_date <= public.kpi_nz_date(now())
     and (coalesce(public.is_admin(), false)
          or exists (
            select 1 from public.kpi_person p
             where p.id = p_person_id and p.manager_id = public.kpi_my_person_id()
          )
          or public.kpi_owner_entry_open(p_date, now()))
$$;

revoke all on function public.kpi_can_write_entry(uuid, date) from public, anon;
grant execute on function public.kpi_can_write_entry(uuid, date) to authenticated;

-- D5: a (person, KPI, date) cell exists when the person has a scorecard, in
-- any status, for the date's quarter, carrying that KPI, and the pinned
-- version's source is 'manual'. At most 31 days per call.
create function public.kpi_entry_cells(p_person_id uuid, p_from date, p_to date)
returns table (
  date date,
  is_working_day boolean,
  kpi_definition_id uuid,
  kpi_version integer,
  scorecard_id uuid,
  scorecard_status text,
  can_write boolean
)
language sql
stable
set search_path = public, pg_temp
as $$
  select c.date, c.is_working_day, a.kpi_definition_id, a.kpi_version, s.id, s.status,
         public.kpi_can_write_entry(p_person_id, c.date)
    from public.kpi_calendar_day c
    join public.kpi_scorecard s
      on s.person_id = p_person_id and s.fy = c.fy and s.quarter = c.quarter
    join public.kpi_assignment a on a.scorecard_id = s.id
    join public.kpi_definition d on d.id = a.kpi_definition_id and d.version = a.kpi_version
   where d.source = 'manual'
     and c.date between p_from and p_to
     and p_to - p_from between 0 and 30
   order by c.date, a.sort_order, a.kpi_definition_id
$$;

revoke all on function public.kpi_entry_cells(uuid, date, date) from public, anon;
grant execute on function public.kpi_entry_cells(uuid, date, date) to authenticated;

-- D5: the pinned version for one cell, or null when there is no cell.
create function public.kpi_entry_kpi_version(p_person_id uuid, p_kpi_id uuid, p_date date)
returns integer
language sql
stable
set search_path = public, pg_temp
as $$
  select e.kpi_version
    from public.kpi_entry_cells(p_person_id, p_date, p_date) e
   where e.kpi_definition_id = p_kpi_id
$$;

revoke all on function public.kpi_entry_kpi_version(uuid, uuid, date) from public, anon;
grant execute on function public.kpi_entry_kpi_version(uuid, uuid, date) to authenticated;

-- D3: the people the caller may enter actuals for.
create function public.kpi_entry_people()
returns setof uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select p.id
    from public.kpi_person p
   where public.kpi_may_enter_for(p.id)
   order by p.full_name
$$;

revoke all on function public.kpi_entry_people() from public, anon;
grant execute on function public.kpi_entry_people() to authenticated;

-- D2: true only when a manual entry holds exactly these seven values. The
-- kpi_actual_daily policies use it so a client can only ever write a copy of
-- a guarded entry.
create function public.kpi_actual_matches_entry(
  p_person_id uuid,
  p_kpi_id uuid,
  p_version integer,
  p_date date,
  p_value numeric,
  p_numerator numeric,
  p_denominator numeric
)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.kpi_manual_entry m
     where m.person_id = p_person_id
       and m.kpi_definition_id = p_kpi_id
       and m.kpi_version = p_version
       and m.date = p_date
       and m.value is not distinct from p_value
       and m.numerator is not distinct from p_numerator
       and m.denominator is not distinct from p_denominator
  )
$$;

revoke all on function public.kpi_actual_matches_entry(uuid, uuid, integer, date, numeric, numeric, numeric) from public, anon;
grant execute on function public.kpi_actual_matches_entry(uuid, uuid, integer, date, numeric, numeric, numeric) to authenticated;

-- ─── 2. Targets that applied at the time (D9) ────────────────────────────────
-- For a locked scorecard's assignment and month, the target is the row with
-- the latest effective_from at or before greatest(approved_at, least(now(),
-- the instant the month ends in Auckland)). So the approved targets cover the
-- whole quarter, an exception edit applies while its month is still running,
-- and once a month has ended its target never changes. Only locked scorecards
-- supply targets. At most 366 days per call.
create function public.kpi_window_targets(p_person_id uuid, p_start date, p_end date)
returns table (
  fy smallint,
  quarter smallint,
  scorecard_id uuid,
  assignment_id uuid,
  kpi_definition_id uuid,
  kpi_version integer,
  sort_order integer,
  month date,
  value numeric
)
language sql
stable
set search_path = public, pg_temp
as $$
  select s.fy, s.quarter, s.id, a.id, a.kpi_definition_id, a.kpi_version, a.sort_order, m.month, t.value
    from public.kpi_scorecard s
    join public.kpi_assignment a on a.scorecard_id = s.id
    join (select distinct c.fy, c.quarter, c.month
            from public.kpi_calendar_day c
           where c.date between date_trunc('month', p_start)::date and p_end) m
      on m.fy = s.fy and m.quarter = s.quarter
    join lateral (
      select t.value
        from public.kpi_target t
       where t.assignment_id = a.id
         and t.month = m.month
         and t.effective_from <= greatest(
               s.approved_at,
               least(now(), ((m.month + interval '1 month')::date)::timestamp at time zone 'Pacific/Auckland'))
       order by t.effective_from desc
       limit 1
    ) t on true
   where s.person_id = p_person_id
     and s.status = 'locked'
     and p_start <= p_end
     and p_end - p_start <= 365
   order by m.month, a.sort_order, a.kpi_definition_id
$$;

revoke all on function public.kpi_window_targets(uuid, date, date) from public, anon;
grant execute on function public.kpi_window_targets(uuid, date, date) to authenticated;

-- ─── 3. Guard and sync triggers ──────────────────────────────────────────────
-- D12: the guard applies to the `authenticated` role only, mirroring RLS,
-- which the SQL editor's owner role also bypasses. That lets the cleanup
-- script remove test entries and lets Edward fix data in an emergency. The
-- audit trigger still records those changes.
-- NOTE for whoever adds a service-role client later (a cron job, say): the
-- check is on the role name, so any role other than `authenticated` skips
-- this guard with nothing to flag it.

create function public.kpi_manual_entry_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_person public.kpi_person%rowtype;
  v_version integer;
  v_aggregation text;
begin
  if current_user <> 'authenticated' then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if NEW.id is distinct from OLD.id
       or NEW.person_id is distinct from OLD.person_id
       or NEW.kpi_definition_id is distinct from OLD.kpi_definition_id
       or NEW.date is distinct from OLD.date then
      raise exception 'An entry''s person, KPI and date cannot change' using errcode = 'KS011';
    end if;
  end if;

  -- WHO versus WHAT (D3). A BEFORE trigger runs before RLS's WITH CHECK, so a
  -- caller the policies would reject outright (not the admin, not the person,
  -- not their line manager) is left to RLS, which rejects with 42501.
  if not (coalesce(public.is_admin(), false) or public.kpi_is_owner_or_manager(NEW.person_id)) then
    return NEW;
  end if;

  select * into v_person from public.kpi_person p where p.id = NEW.person_id;
  if not found or not v_person.active or v_person.scorecard_type <> 'individual' then
    raise exception 'That person does not have an individual scorecard' using errcode = 'KS007';
  end if;

  if public.kpi_my_person_id() is null then
    raise exception 'Not allowed to enter actuals' using errcode = 'KS001';
  end if;

  if NEW.date > public.kpi_nz_date(now()) then
    raise exception 'Actuals cannot be entered for a future day' using errcode = 'KS015';
  end if;

  v_version := public.kpi_entry_kpi_version(NEW.person_id, NEW.kpi_definition_id, NEW.date);
  if v_version is null then
    raise exception 'That KPI takes no manual entry for that person on that day' using errcode = 'KS016';
  end if;

  if not public.kpi_can_write_entry(NEW.person_id, NEW.date) then
    raise exception 'The owner''s 7 days for that day have passed' using errcode = 'KS017';
  end if;

  select d.aggregation into v_aggregation
    from public.kpi_definition d
   where d.id = NEW.kpi_definition_id and d.version = v_version;

  -- D6: the entry's shape comes from the pinned version's aggregation.
  if v_aggregation = 'ratio' then
    if NEW.numerator is null or NEW.denominator is null
       or NEW.numerator < 0 or NEW.denominator < 0 then
      raise exception 'A ratio entry needs two numbers of 0 or more' using errcode = 'KS011';
    end if;
    NEW.value := null;
  else
    if NEW.value is null or NEW.value < 0 then
      raise exception 'An entry needs a number of 0 or more' using errcode = 'KS011';
    end if;
    if v_aggregation = 'average' then
      NEW.numerator := NEW.value;
      NEW.denominator := 1;
    else
      NEW.numerator := null;
      NEW.denominator := null;
    end if;
  end if;

  NEW.kpi_version := v_version;
  NEW.entered_by := auth.uid();
  NEW.entered_at := now();
  return NEW;
end;
$$;

revoke all on function public.kpi_manual_entry_guard() from public, anon;
grant execute on function public.kpi_manual_entry_guard() to authenticated;

-- D1: every manual entry has an identical kpi_actual_daily row with source
-- 'manual'. No role check, so the invariant holds for every role. It never
-- overwrites an automated actual: that raises KS019 instead.
create function public.kpi_manual_entry_sync()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  insert into public.kpi_actual_daily
    (person_id, kpi_definition_id, kpi_version, date, value, numerator, denominator, source, calculated_at)
  values
    (NEW.person_id, NEW.kpi_definition_id, NEW.kpi_version, NEW.date, NEW.value, NEW.numerator,
     NEW.denominator, 'manual', now())
  on conflict (person_id, kpi_definition_id, date) do update
    set kpi_version = excluded.kpi_version,
        value = excluded.value,
        numerator = excluded.numerator,
        denominator = excluded.denominator,
        calculated_at = excluded.calculated_at
    where public.kpi_actual_daily.source = 'manual';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'An automated actual already exists for that day' using errcode = 'KS019';
  end if;
  return null;
end;
$$;

revoke all on function public.kpi_manual_entry_sync() from public, anon;
grant execute on function public.kpi_manual_entry_sync() to authenticated;

create trigger kpi_manual_entry_guard
  before insert or update on public.kpi_manual_entry
  for each row execute function public.kpi_manual_entry_guard();

create trigger kpi_manual_entry_sync
  after insert or update on public.kpi_manual_entry
  for each row execute function public.kpi_manual_entry_sync();

-- ─── 4. Role-scoped policies (permissive, ORed with the 0003 admin ones) ─────
-- Policies decide WHO (owner or direct line manager; the admin through 0003's
-- is_admin() policies). The guard decides WHAT (D3). The kpi_actual_daily
-- policies admit only an exact copy of a guarded manual entry for a person
-- the caller may act for (D2), so the sync trigger can run with the caller's
-- rights and no client can forge or overwrite an actual.

create policy kpi_manual_entry_insert_scoped on public.kpi_manual_entry
  for insert to authenticated
  with check (public.kpi_is_owner_or_manager(person_id));

create policy kpi_manual_entry_update_scoped on public.kpi_manual_entry
  for update to authenticated
  using (public.kpi_is_owner_or_manager(person_id))
  with check (public.kpi_is_owner_or_manager(person_id));

create policy kpi_actual_daily_insert_manual on public.kpi_actual_daily
  for insert to authenticated
  with check (
    source = 'manual'
    and public.kpi_is_owner_or_manager(person_id)
    and public.kpi_actual_matches_entry(person_id, kpi_definition_id, kpi_version, date, value, numerator, denominator)
  );

create policy kpi_actual_daily_update_manual on public.kpi_actual_daily
  for update to authenticated
  using (source = 'manual' and public.kpi_is_owner_or_manager(person_id))
  with check (
    source = 'manual'
    and public.kpi_is_owner_or_manager(person_id)
    and public.kpi_actual_matches_entry(person_id, kpi_definition_id, kpi_version, date, value, numerator, denominator)
  );

-- ─── 5. Backfill (expected to insert 0 rows) ─────────────────────────────────
-- Keeps the invariant true if anyone wrote entries by SQL before this.

insert into public.kpi_actual_daily
  (person_id, kpi_definition_id, kpi_version, date, value, numerator, denominator, source, calculated_at)
select m.person_id, m.kpi_definition_id, m.kpi_version, m.date, m.value, m.numerator, m.denominator,
       'manual', now()
  from public.kpi_manual_entry m
on conflict (person_id, kpi_definition_id, date) do nothing;

-- ─── 6. Reload the PostgREST schema cache ────────────────────────────────────
notify pgrst, 'reload schema';

commit;

select '0006 applied' as result;
