-- 0003_kpi_foundations.sql
-- KPI scorecard, Phase 0 + 1: foundations.
--
-- Purely additive. Creates twelve kpi_-prefixed tables, seeds NZ national public
-- holidays for FY26 to FY29 (1 Apr 2025 to 31 Mar 2029), generates the
-- working-day calendar, adds audit and calendar triggers, and locks every table
-- down with RLS: authenticated users read, only public.is_admin() writes.
--
-- It never creates or replaces public.is_admin() and never touches
-- public.targets. Every KPI table name starts with kpi_ so nothing can be
-- confused with the live targets table.
--
-- One transaction, plain `create table` (no `if not exists`). A second run
-- fails loudly with "already exists" and rolls back, so schema drift is never
-- hidden. If this script errors, nothing has changed.

begin;

-- 0. Guard: 0001 must already be applied.
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception '0003 needs public.is_admin() from 0001';
  end if;
end $$;

-- ─── 1. Tables ───────────────────────────────────────────────────────────────

create table public.kpi_team (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  parent_team_id uuid null references public.kpi_team (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint kpi_team_parent_not_self check (parent_team_id is distinct from id)
);
create unique index kpi_team_name_key on public.kpi_team (lower(name));

create table public.kpi_person (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  email text null check (email is null or email = lower(btrim(email))),
  role_admin boolean not null default false,
  role_manager boolean not null default false,
  is_contractor boolean not null default false,
  scorecard_type text not null default 'individual'
    check (scorecard_type in ('individual', 'company_only')),
  primary_team_id uuid null references public.kpi_team (id),
  manager_id uuid null references public.kpi_person (id),
  hubspot_owner_id text null,
  xero_ref text null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint kpi_person_manager_not_self check (manager_id is distinct from id)
);
create unique index kpi_person_email_key on public.kpi_person (email) where email is not null;
comment on column public.kpi_person.role_admin is
  'Phase 2 input. Not read by any policy or code in Phase 0/1; public.is_admin() is the only admin authority.';
comment on column public.kpi_person.role_manager is
  'Phase 2 input. Not read by any policy or code in Phase 0/1; public.is_admin() is the only admin authority.';

create table public.kpi_definition (
  id uuid not null default gen_random_uuid(),
  version integer not null default 1 check (version >= 1),
  name text not null,
  description text not null,
  kpi_type text not null check (kpi_type in ('lead', 'lag')),
  unit text not null check (unit in ('count', 'currency', 'percent', 'hours', 'days', 'multiple')),
  direction text not null check (direction in ('higher', 'lower')),
  aggregation text not null check (aggregation in ('sum', 'average', 'ratio', 'latest')),
  phasing text not null default 'working_days' check (phasing in ('working_days', 'calendar_days')),
  source text not null check (source in ('hubspot', 'xero', 'forecast', 'manual')),
  source_mapping jsonb null,
  attribution jsonb null,
  status text not null default 'proposed' check (status in ('proposed', 'published', 'retired')),
  example_target numeric null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (id, version)
);

create table public.kpi_scorecard (
  id uuid primary key default gen_random_uuid(),
  person_id uuid null references public.kpi_person (id),
  fy smallint not null check (fy between 2020 and 2100),
  quarter smallint not null check (quarter between 1 and 4),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'locked')),
  approved_by uuid null,
  approved_at timestamptz null,
  created_at timestamptz not null default now()
);
create unique index kpi_scorecard_person_quarter_key
  on public.kpi_scorecard (person_id, fy, quarter) where person_id is not null;
create unique index kpi_scorecard_company_quarter_key
  on public.kpi_scorecard (fy, quarter) where person_id is null;

create table public.kpi_assignment (
  id uuid primary key default gen_random_uuid(),
  scorecard_id uuid not null references public.kpi_scorecard (id),
  kpi_definition_id uuid not null,
  kpi_version integer not null,
  sort_order integer not null default 0,
  foreign key (kpi_definition_id, kpi_version) references public.kpi_definition (id, version),
  unique (scorecard_id, kpi_definition_id)
);

create table public.kpi_target (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.kpi_assignment (id),
  month date not null check (month = date_trunc('month', month::timestamp)::date),
  value numeric not null check (value >= 0),
  effective_from timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (assignment_id, month, effective_from)
);
comment on column public.kpi_target.value is 'Ratio KPIs store fractions (33% = 0.33).';

create table public.kpi_actual_daily (
  person_id uuid not null references public.kpi_person (id),
  kpi_definition_id uuid not null,
  kpi_version integer not null,
  date date not null,
  value numeric null,
  numerator numeric null,
  denominator numeric null check (denominator is null or denominator >= 0),
  source text not null check (source in ('hubspot', 'xero', 'forecast', 'manual')),
  calculated_at timestamptz not null default now(),
  primary key (person_id, kpi_definition_id, date),
  foreign key (kpi_definition_id, kpi_version) references public.kpi_definition (id, version),
  check (value is not null or (numerator is not null and denominator is not null))
);

create table public.kpi_manual_entry (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.kpi_person (id),
  kpi_definition_id uuid not null,
  kpi_version integer not null,
  date date not null,
  value numeric null,
  numerator numeric null,
  denominator numeric null check (denominator is null or denominator >= 0),
  entered_by uuid default auth.uid(),
  entered_at timestamptz not null default now(),
  foreign key (kpi_definition_id, kpi_version) references public.kpi_definition (id, version),
  unique (person_id, kpi_definition_id, date),
  check (value is not null or (numerator is not null and denominator is not null))
);

create table public.kpi_public_holiday (
  date date primary key,
  name text not null
);

create table public.kpi_company_closure (
  date date primary key,
  reason text not null check (length(btrim(reason)) between 1 and 120),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.kpi_calendar_day (
  date date primary key,
  is_working_day boolean not null,
  fy smallint not null,
  quarter smallint not null check (quarter between 1 and 4),
  month date not null,
  holiday_name text null
);
create index kpi_calendar_day_month_idx on public.kpi_calendar_day (month);

create table public.kpi_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid null default auth.uid(),
  actor_email text null default (auth.jwt() ->> 'email'),
  entity text not null,
  entity_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  before jsonb null,
  after jsonb null,
  reason text null,
  at timestamptz not null default now()
);
create index kpi_audit_log_entity_at_idx on public.kpi_audit_log (entity, at desc);

-- ─── 2. Functions (all SECURITY INVOKER, search_path pinned) ─────────────────

-- The ONLY implementation of the working-day rule: Mon to Fri, not a public
-- holiday, not a company closure. Only rows whose value would change are
-- updated. Invoker rights: a non-admin calling it updates nothing under RLS.
create function public.kpi_calendar_recompute()
returns void
language sql
set search_path = public, pg_temp
as $$
  update public.kpi_calendar_day c
     set is_working_day = n.is_working_day,
         holiday_name = n.holiday_name
    from (
      select d.date,
             (extract(isodow from d.date) < 6
               and h.date is null
               and cc.date is null) as is_working_day,
             coalesce(h.name, cc.reason) as holiday_name
        from public.kpi_calendar_day d
        left join public.kpi_public_holiday h on h.date = d.date
        left join public.kpi_company_closure cc on cc.date = d.date
    ) n
   where n.date = c.date
     and (c.is_working_day is distinct from n.is_working_day
          or c.holiday_name is distinct from n.holiday_name);
$$;

revoke all on function public.kpi_calendar_recompute() from public, anon;
grant execute on function public.kpi_calendar_recompute() to authenticated;

create function public.kpi_calendar_sync()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform public.kpi_calendar_recompute();
  return null;
end;
$$;

create function public.kpi_audit_row()
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

-- ─── 3. Seed: 45 NZ national public holidays, FY26 to FY29 ───────────────────
-- Observed weekday only for a Mondayised holiday. Checked against
-- employment.govt.nz (2025 to 2027) and the Te Kāhui o Matariki Public Holiday
-- Act 2022 schedule. Easter Monday 2029 (2 Apr 2029) is outside the range.

insert into public.kpi_public_holiday (date, name) values
  -- FY26
  ('2025-04-18', 'Good Friday'),
  ('2025-04-21', 'Easter Monday'),
  ('2025-04-25', 'ANZAC Day'),
  ('2025-06-02', 'King''s Birthday'),
  ('2025-06-20', 'Matariki'),
  ('2025-10-27', 'Labour Day'),
  ('2025-12-25', 'Christmas Day'),
  ('2025-12-26', 'Boxing Day'),
  ('2026-01-01', 'New Year''s Day'),
  ('2026-01-02', 'Day after New Year''s Day'),
  ('2026-02-06', 'Waitangi Day'),
  -- FY27
  ('2026-04-03', 'Good Friday'),
  ('2026-04-06', 'Easter Monday'),
  ('2026-04-27', 'ANZAC Day (observed)'),
  ('2026-06-01', 'King''s Birthday'),
  ('2026-07-10', 'Matariki'),
  ('2026-10-26', 'Labour Day'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-28', 'Boxing Day (observed)'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-01-04', 'Day after New Year''s Day (observed)'),
  ('2027-02-08', 'Waitangi Day (observed)'),
  ('2027-03-26', 'Good Friday'),
  ('2027-03-29', 'Easter Monday'),
  -- FY28
  ('2027-04-26', 'ANZAC Day (observed)'),
  ('2027-06-07', 'King''s Birthday'),
  ('2027-06-25', 'Matariki'),
  ('2027-10-25', 'Labour Day'),
  ('2027-12-27', 'Christmas Day (observed)'),
  ('2027-12-28', 'Boxing Day (observed)'),
  ('2028-01-03', 'New Year''s Day (observed)'),
  ('2028-01-04', 'Day after New Year''s Day (observed)'),
  ('2028-02-07', 'Waitangi Day (observed)'),
  -- FY29
  ('2028-04-14', 'Good Friday'),
  ('2028-04-17', 'Easter Monday'),
  ('2028-04-25', 'ANZAC Day'),
  ('2028-06-05', 'King''s Birthday'),
  ('2028-07-14', 'Matariki'),
  ('2028-10-23', 'Labour Day'),
  ('2028-12-25', 'Christmas Day'),
  ('2028-12-26', 'Boxing Day'),
  ('2029-01-01', 'New Year''s Day'),
  ('2029-01-02', 'Day after New Year''s Day'),
  ('2029-02-06', 'Waitangi Day'),
  ('2029-03-30', 'Good Friday');

-- ─── 4. Calendar: every date from 2025-04-01 to 2029-03-31 ───────────────────
-- FY is stored as its ending year (fy 2027 = 1 Apr 2026 to 31 Mar 2027).
-- Quarters: Q1 Apr to Jun, Q2 Jul to Sep, Q3 Oct to Dec, Q4 Jan to Mar.

insert into public.kpi_calendar_day (date, is_working_day, fy, quarter, month, holiday_name)
select
  g::date,
  false,
  (extract(year from g)::int + case when extract(month from g) >= 4 then 1 else 0 end)::smallint,
  (case
     when extract(month from g) between 4 and 6 then 1
     when extract(month from g) between 7 and 9 then 2
     when extract(month from g) between 10 and 12 then 3
     else 4
   end)::smallint,
  date_trunc('month', g)::date,
  null
from generate_series('2025-04-01'::timestamp, '2029-03-31'::timestamp, interval '1 day') as g;

select public.kpi_calendar_recompute();

-- ─── 5. Triggers (after the seed, so the seed writes no audit noise) ─────────

create trigger kpi_calendar_sync
  after insert or update or delete on public.kpi_public_holiday
  for each statement execute function public.kpi_calendar_sync();

create trigger kpi_calendar_sync
  after insert or update or delete on public.kpi_company_closure
  for each statement execute function public.kpi_calendar_sync();

create trigger kpi_audit_row after insert or update or delete on public.kpi_team
  for each row execute function public.kpi_audit_row();
create trigger kpi_audit_row after insert or update or delete on public.kpi_person
  for each row execute function public.kpi_audit_row();
create trigger kpi_audit_row after insert or update or delete on public.kpi_definition
  for each row execute function public.kpi_audit_row();
create trigger kpi_audit_row after insert or update or delete on public.kpi_scorecard
  for each row execute function public.kpi_audit_row();
create trigger kpi_audit_row after insert or update or delete on public.kpi_assignment
  for each row execute function public.kpi_audit_row();
create trigger kpi_audit_row after insert or update or delete on public.kpi_target
  for each row execute function public.kpi_audit_row();
create trigger kpi_audit_row after insert or update or delete on public.kpi_manual_entry
  for each row execute function public.kpi_audit_row();
create trigger kpi_audit_row after insert or update or delete on public.kpi_public_holiday
  for each row execute function public.kpi_audit_row();
create trigger kpi_audit_row after insert or update or delete on public.kpi_company_closure
  for each row execute function public.kpi_audit_row();

-- ─── 6. RLS ──────────────────────────────────────────────────────────────────
-- Every table: RLS on, nothing for anon. Every policy is `to authenticated`.
-- The audit and calendar triggers run with the admin's rights, which is why
-- the admin needs insert on kpi_audit_log and update on kpi_calendar_day.
-- Without those two policies every admin write fails.

alter table public.kpi_team enable row level security;
alter table public.kpi_person enable row level security;
alter table public.kpi_definition enable row level security;
alter table public.kpi_scorecard enable row level security;
alter table public.kpi_assignment enable row level security;
alter table public.kpi_target enable row level security;
alter table public.kpi_actual_daily enable row level security;
alter table public.kpi_manual_entry enable row level security;
alter table public.kpi_public_holiday enable row level security;
alter table public.kpi_company_closure enable row level security;
alter table public.kpi_calendar_day enable row level security;
alter table public.kpi_audit_log enable row level security;

revoke all on public.kpi_team from anon;
revoke all on public.kpi_person from anon;
revoke all on public.kpi_definition from anon;
revoke all on public.kpi_scorecard from anon;
revoke all on public.kpi_assignment from anon;
revoke all on public.kpi_target from anon;
revoke all on public.kpi_actual_daily from anon;
revoke all on public.kpi_manual_entry from anon;
revoke all on public.kpi_public_holiday from anon;
revoke all on public.kpi_company_closure from anon;
revoke all on public.kpi_calendar_day from anon;
revoke all on public.kpi_audit_log from anon;

-- select: all 12 tables
create policy kpi_team_select on public.kpi_team for select to authenticated using (true);
create policy kpi_person_select on public.kpi_person for select to authenticated using (true);
create policy kpi_definition_select on public.kpi_definition for select to authenticated using (true);
create policy kpi_scorecard_select on public.kpi_scorecard for select to authenticated using (true);
create policy kpi_assignment_select on public.kpi_assignment for select to authenticated using (true);
create policy kpi_target_select on public.kpi_target for select to authenticated using (true);
create policy kpi_actual_daily_select on public.kpi_actual_daily for select to authenticated using (true);
create policy kpi_manual_entry_select on public.kpi_manual_entry for select to authenticated using (true);
create policy kpi_public_holiday_select on public.kpi_public_holiday for select to authenticated using (true);
create policy kpi_company_closure_select on public.kpi_company_closure for select to authenticated using (true);
create policy kpi_calendar_day_select on public.kpi_calendar_day for select to authenticated using (true);
create policy kpi_audit_log_select on public.kpi_audit_log for select to authenticated using (true);

-- insert: 10 tables (not kpi_public_holiday, not kpi_calendar_day)
create policy kpi_team_insert on public.kpi_team for insert to authenticated with check (public.is_admin());
create policy kpi_person_insert on public.kpi_person for insert to authenticated with check (public.is_admin());
create policy kpi_definition_insert on public.kpi_definition for insert to authenticated with check (public.is_admin());
create policy kpi_scorecard_insert on public.kpi_scorecard for insert to authenticated with check (public.is_admin());
create policy kpi_assignment_insert on public.kpi_assignment for insert to authenticated with check (public.is_admin());
create policy kpi_target_insert on public.kpi_target for insert to authenticated with check (public.is_admin());
create policy kpi_actual_daily_insert on public.kpi_actual_daily for insert to authenticated with check (public.is_admin());
create policy kpi_manual_entry_insert on public.kpi_manual_entry for insert to authenticated with check (public.is_admin());
create policy kpi_company_closure_insert on public.kpi_company_closure for insert to authenticated with check (public.is_admin());
create policy kpi_audit_log_insert on public.kpi_audit_log for insert to authenticated with check (public.is_admin());

-- update: 10 tables (not kpi_public_holiday, not kpi_audit_log)
create policy kpi_team_update on public.kpi_team for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy kpi_person_update on public.kpi_person for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy kpi_definition_update on public.kpi_definition for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy kpi_scorecard_update on public.kpi_scorecard for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy kpi_assignment_update on public.kpi_assignment for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy kpi_target_update on public.kpi_target for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy kpi_actual_daily_update on public.kpi_actual_daily for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy kpi_manual_entry_update on public.kpi_manual_entry for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy kpi_company_closure_update on public.kpi_company_closure for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy kpi_calendar_day_update on public.kpi_calendar_day for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- delete: kpi_company_closure only
create policy kpi_company_closure_delete on public.kpi_company_closure for delete to authenticated
  using (public.is_admin());

-- ─── 7. Reload the PostgREST schema cache ────────────────────────────────────
notify pgrst, 'reload schema';

commit;
