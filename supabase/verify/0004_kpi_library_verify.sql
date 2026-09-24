-- 0004_kpi_library_verify.sql
-- Read-only check of migration 0004, and the full current-state authority for
-- 0003's structural checks too (D16). Paste into the Supabase SQL editor and
-- run. The first row is "summary"; if it shows pass = true and no other row
-- shows pass = false, the migration is correctly applied. It writes nothing.
--
-- Carries every 0003 structural check except "kpi_company_closure rows"
-- (that one is expected to go false the moment real closures exist, and 0004
-- doesn't touch kpi_company_closure, so it isn't 0004's business to re-assert
-- a row count here). Updates the kpi_definition/kpi_audit_log policy
-- expectations and totals for the two new 0004 policies, and adds the 0004
-- checks: the two proposal policies' shape, kpi_definition's exact column
-- list, the five constraints validated, the guard trigger's timing and event
-- bits, its function's SECURITY INVOKER, the pre-existing audit trigger still
-- present, and a defensive count of current KPIs whose name would fail the
-- new name-length rule.

with
kpi_tables(t) as (
  values ('kpi_team'), ('kpi_person'), ('kpi_definition'), ('kpi_scorecard'),
         ('kpi_assignment'), ('kpi_target'), ('kpi_actual_daily'), ('kpi_manual_entry'),
         ('kpi_public_holiday'), ('kpi_company_closure'), ('kpi_calendar_day'), ('kpi_audit_log')
),
expected_policies(t, sel, ins, upd, del) as (
  values
    ('kpi_team', 1, 1, 1, 0),
    ('kpi_person', 1, 1, 1, 0),
    ('kpi_definition', 1, 2, 1, 0),
    ('kpi_scorecard', 1, 1, 1, 0),
    ('kpi_assignment', 1, 1, 1, 0),
    ('kpi_target', 1, 1, 1, 0),
    ('kpi_actual_daily', 1, 1, 1, 0),
    ('kpi_manual_entry', 1, 1, 1, 0),
    ('kpi_public_holiday', 1, 0, 0, 0),
    ('kpi_company_closure', 1, 1, 1, 1),
    ('kpi_calendar_day', 1, 0, 1, 0),
    ('kpi_audit_log', 1, 2, 0, 0)
),
actual_policies as (
  select tablename as t,
         count(*) filter (where cmd = 'SELECT') as sel,
         count(*) filter (where cmd = 'INSERT') as ins,
         count(*) filter (where cmd = 'UPDATE') as upd,
         count(*) filter (where cmd = 'DELETE') as del,
         count(*) filter (where cmd = 'ALL') as all_cmd
    from pg_policies
   where schemaname = 'public' and tablename like 'kpi\_%'
   group by tablename
),
named_days(d, name) as (
  values
    ('2026-07-10'::date, 'Matariki'),
    ('2026-04-27'::date, 'ANZAC Day (observed)'),
    ('2026-12-28'::date, 'Boxing Day (observed)'),
    ('2027-01-04'::date, 'Day after New Year''s Day (observed)'),
    ('2027-02-08'::date, 'Waitangi Day (observed)'),
    ('2027-12-27'::date, 'Christmas Day (observed)'),
    ('2027-12-28'::date, 'Boxing Day (observed)'),
    ('2028-01-03'::date, 'New Year''s Day (observed)'),
    ('2028-01-04'::date, 'Day after New Year''s Day (observed)')
),
fy_checks(d, fy, quarter) as (
  values
    ('2026-03-31'::date, 2026, 4),
    ('2026-04-01'::date, 2027, 1),
    ('2026-09-24'::date, 2027, 2),
    ('2026-10-01'::date, 2027, 3),
    ('2027-01-15'::date, 2027, 4)
),
month_checks(m, n) as (
  values ('2026-07-01'::date, 22), ('2026-08-01'::date, 21), ('2026-09-01'::date, 22)
),
fn_checks(sig) as (
  values ('public.kpi_calendar_recompute()'), ('public.kpi_calendar_sync()'), ('public.kpi_audit_row()')
),
expected_kpi_definition_columns(c) as (
  values
    ('id'), ('version'), ('name'), ('description'), ('kpi_type'), ('unit'), ('direction'),
    ('aggregation'), ('phasing'), ('source'), ('source_mapping'), ('attribution'), ('status'),
    ('example_target'), ('created_by'), ('created_at'), ('created_by_email')
),
actual_kpi_definition_columns as (
  select attname as c
    from pg_attribute
   where attrelid = to_regclass('public.kpi_definition')
     and attnum > 0 and not attisdropped
),
expected_constraints(name) as (
  values
    ('kpi_definition_name_length'), ('kpi_definition_description_length'),
    ('kpi_definition_source_mapping_object'), ('kpi_definition_attribution_object'),
    ('kpi_definition_example_target_non_negative')
),
proposal_policy_checks(check_name, expected, actual, pass) as (
  select
    'policy ' || e.expected_name || ' shape',
    'cmd=INSERT roles={authenticated} permissive',
    coalesce(
      format('cmd=%s roles=%s %s', pol.cmd, pol.roles::text,
             case when pol.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end),
      'missing'
    ),
    coalesce(
      pol.cmd = 'INSERT'
      and pol.roles = array['authenticated']::name[]
      and pol.permissive = 'PERMISSIVE',
      false
    )
  from (values ('kpi_definition_insert_proposal'), ('kpi_audit_log_insert_proposal')) as e(expected_name)
  left join pg_policies pol
    on pol.schemaname = 'public' and pol.policyname = e.expected_name
),
checks(check_name, expected, actual, pass) as (
  -- ── 0003 structural checks, current-state (D16) ────────────────────────
  select 'table ' || k.t || ' exists with RLS',
         'exists, rls on',
         coalesce(case when c.relrowsecurity then 'exists, rls on' else 'exists, rls OFF' end, 'missing'),
         coalesce(c.relrowsecurity, false)
    from kpi_tables k
    left join pg_class c on c.oid = to_regclass('public.' || k.t)

  union all
  select 'table ' || k.t || ' has no anon privileges',
         'none',
         case when to_regclass('public.' || k.t) is null then 'missing'
              when has_table_privilege('anon', 'public.' || k.t, 'select,insert,update,delete') then 'granted'
              else 'none' end,
         to_regclass('public.' || k.t) is not null
           and not has_table_privilege('anon', 'public.' || k.t, 'select,insert,update,delete')
    from kpi_tables k

  union all
  select 'policies on ' || e.t,
         format('select=%s insert=%s update=%s delete=%s all=0', e.sel, e.ins, e.upd, e.del),
         format('select=%s insert=%s update=%s delete=%s all=%s',
                coalesce(a.sel, 0), coalesce(a.ins, 0), coalesce(a.upd, 0), coalesce(a.del, 0), coalesce(a.all_cmd, 0)),
         coalesce(a.sel, 0) = e.sel and coalesce(a.ins, 0) = e.ins and coalesce(a.upd, 0) = e.upd
           and coalesce(a.del, 0) = e.del and coalesce(a.all_cmd, 0) = 0
    from expected_policies e
    left join actual_policies a on a.t = e.t

  union all
  select 'policy totals (select, insert, update, delete)',
         '12, 12, 10, 1',
         format('%s, %s, %s, %s',
                coalesce(sum(sel), 0), coalesce(sum(ins), 0), coalesce(sum(upd), 0), coalesce(sum(del), 0)),
         coalesce(sum(sel), 0) = 12 and coalesce(sum(ins), 0) = 12
           and coalesce(sum(upd), 0) = 10 and coalesce(sum(del), 0) = 1
    from actual_policies

  union all
  select 'kpi_calendar_day rows', '1461', count(*)::text, count(*) = 1461 from public.kpi_calendar_day
  union all
  select 'kpi_calendar_day first date', '2025-04-01', min(date)::text, min(date) = '2025-04-01' from public.kpi_calendar_day
  union all
  select 'kpi_calendar_day last date', '2029-03-31', max(date)::text, max(date) = '2029-03-31' from public.kpi_calendar_day
  union all
  select 'kpi_public_holiday rows', '45', count(*)::text, count(*) = 45 from public.kpi_public_holiday

  union all
  select 'working days in ' || to_char(mc.m, 'FMMonth YYYY'),
         mc.n::text,
         count(cd.date)::text,
         count(cd.date) = mc.n
    from month_checks mc
    left join public.kpi_calendar_day cd on cd.month = mc.m and cd.is_working_day = true
   group by mc.m, mc.n

  union all
  select 'holiday ' || nd.d::text,
         'non-working, ' || nd.name,
         coalesce(case when cd.is_working_day then 'working' else 'non-working' end || ', ' || coalesce(cd.holiday_name, 'no name'), 'missing'),
         coalesce(cd.is_working_day = false and cd.holiday_name = nd.name, false)
    from named_days nd
    left join public.kpi_calendar_day cd on cd.date = nd.d

  union all
  select 'working day 2026-09-24',
         'working',
         coalesce(case when cd.is_working_day then 'working' else 'non-working' end, 'missing'),
         coalesce(cd.is_working_day = true and cd.holiday_name is null, false)
    from (values ('2026-09-24'::date)) as v(d)
    left join public.kpi_calendar_day cd on cd.date = v.d

  union all
  select 'fy and quarter ' || f.d::text,
         format('fy %s Q%s', f.fy, f.quarter),
         coalesce(format('fy %s Q%s', cd.fy, cd.quarter), 'missing'),
         coalesce(cd.fy = f.fy and cd.quarter = f.quarter, false)
    from fy_checks f
    left join public.kpi_calendar_day cd on cd.date = f.d

  union all
  select 'function public.is_admin() exists', 'exists',
         case when to_regprocedure('public.is_admin()') is null then 'missing' else 'exists' end,
         to_regprocedure('public.is_admin()') is not null
  union all
  select 'function ' || fc.sig || ' is security invoker',
         'exists, invoker',
         coalesce(case when p.prosecdef then 'exists, SECURITY DEFINER' else 'exists, invoker' end, 'missing'),
         coalesce(p.prosecdef = false, false)
    from fn_checks fc
    left join pg_proc p on p.oid = to_regprocedure(fc.sig)

  -- ── 0004 checks ─────────────────────────────────────────────────────────

  union all
  select check_name, expected, actual, pass from proposal_policy_checks

  union all
  select 'kpi_definition has exactly the 17 expected columns',
         '17 columns, no more, no less',
         format('%s expected-and-present, %s unexpected, %s missing',
                (select count(*) from expected_kpi_definition_columns e
                  join actual_kpi_definition_columns a on a.c = e.c),
                (select count(*) from actual_kpi_definition_columns a
                  where not exists (select 1 from expected_kpi_definition_columns e where e.c = a.c)),
                (select count(*) from expected_kpi_definition_columns e
                  where not exists (select 1 from actual_kpi_definition_columns a where a.c = e.c))),
         (select count(*) from expected_kpi_definition_columns) = 17
           and not exists (
             select 1 from actual_kpi_definition_columns a
              where not exists (select 1 from expected_kpi_definition_columns e where e.c = a.c)
           )
           and not exists (
             select 1 from expected_kpi_definition_columns e
              where not exists (select 1 from actual_kpi_definition_columns a where a.c = e.c)
           )

  union all
  select 'constraint ' || ec.name || ' exists and is validated',
         'exists, validated',
         coalesce(case when con.convalidated then 'exists, validated' else 'exists, NOT validated' end, 'missing'),
         coalesce(con.convalidated, false)
    from expected_constraints ec
    left join pg_constraint con
      on con.conname = ec.name and con.conrelid = to_regclass('public.kpi_definition')

  union all
  select 'trigger kpi_definition_guard is BEFORE, FOR EACH ROW, INSERT and UPDATE',
         'before row, insert+update',
         coalesce(
           format('%s row, %s%s',
                  case when (t.tgtype::int & 2) = 2 then 'before' else 'not-before' end,
                  case when (t.tgtype::int & 4) = 4 then 'insert' else '' end,
                  case when (t.tgtype::int & 16) = 16 then '+update' else '' end),
           'missing'
         ),
         coalesce(
           (t.tgtype::int & 2) = 2   -- BEFORE
           and (t.tgtype::int & 1) = 1  -- FOR EACH ROW
           and (t.tgtype::int & 4) = 4  -- INSERT
           and (t.tgtype::int & 16) = 16, -- UPDATE
           false
         )
    from pg_trigger t
   where t.tgrelid = to_regclass('public.kpi_definition')
     and t.tgname = 'kpi_definition_guard'

  union all
  select 'function public.kpi_definition_guard() is security invoker',
         'exists, invoker',
         coalesce(case when p.prosecdef then 'exists, SECURITY DEFINER' else 'exists, invoker' end, 'missing'),
         coalesce(p.prosecdef = false, false)
    from (select to_regprocedure('public.kpi_definition_guard()') as oid) x
    left join pg_proc p on p.oid = x.oid

  union all
  select 'trigger kpi_audit_row still exists on kpi_definition',
         'exists',
         case when exists (
           select 1 from pg_trigger t
            where t.tgrelid = to_regclass('public.kpi_definition') and t.tgname = 'kpi_audit_row'
         ) then 'exists' else 'missing' end,
         exists (
           select 1 from pg_trigger t
            where t.tgrelid = to_regclass('public.kpi_definition') and t.tgname = 'kpi_audit_row'
         )

  union all
  select 'current KPIs whose latest version fails the name rule',
         '0',
         count(*)::text,
         count(*) = 0
    from (
      select distinct on (d.id) d.id, d.name
        from public.kpi_definition d
       order by d.id, d.version desc
    ) latest
   where length(btrim(latest.name)) < 1 or length(btrim(latest.name)) > 120
),
with_summary as (
  select 'summary' as check_name,
         'all checks pass' as expected,
         format('%s of %s checks pass', count(*) filter (where pass), count(*)) as actual,
         bool_and(pass) as pass
    from checks
  union all
  select check_name, expected, actual, pass from checks
)
select check_name, expected, actual, pass
  from with_summary
 order by
   case when check_name = 'summary' then 0 when not pass then 1 else 2 end,
   check_name;
