-- 0003_kpi_foundations_verify.sql
-- Read-only check of migration 0003. Paste into the Supabase SQL editor and run.
-- Every row must show pass = true. It writes nothing.
--
-- Note: "kpi_company_closure rows" expects 0 at go-live. Once real closures are
-- added it shows that count and reads false; that row alone is then expected.
--
-- Superseded by 0004_kpi_library_verify.sql once 0004 is applied. After 0004 the rows 'policies on kpi_definition', 'policies on kpi_audit_log' and 'policy totals' read false by design. Do not change policies to make them pass.

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
    ('kpi_definition', 1, 1, 1, 0),
    ('kpi_scorecard', 1, 1, 1, 0),
    ('kpi_assignment', 1, 1, 1, 0),
    ('kpi_target', 1, 1, 1, 0),
    ('kpi_actual_daily', 1, 1, 1, 0),
    ('kpi_manual_entry', 1, 1, 1, 0),
    ('kpi_public_holiday', 1, 0, 0, 0),
    ('kpi_company_closure', 1, 1, 1, 1),
    ('kpi_calendar_day', 1, 0, 1, 0),
    ('kpi_audit_log', 1, 1, 0, 0)
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
checks(check_name, expected, actual, pass) as (
  -- Tables exist with RLS on
  select 'table ' || k.t || ' exists with RLS',
         'exists, rls on',
         coalesce(case when c.relrowsecurity then 'exists, rls on' else 'exists, rls OFF' end, 'missing'),
         coalesce(c.relrowsecurity, false)
    from kpi_tables k
    left join pg_class c on c.oid = to_regclass('public.' || k.t)

  union all
  -- anon has no table privileges
  select 'table ' || k.t || ' has no anon privileges',
         'none',
         case when to_regclass('public.' || k.t) is null then 'missing'
              when has_table_privilege('anon', 'public.' || k.t, 'select,insert,update,delete') then 'granted'
              else 'none' end,
         to_regclass('public.' || k.t) is not null
           and not has_table_privilege('anon', 'public.' || k.t, 'select,insert,update,delete')
    from kpi_tables k

  union all
  -- Policies per table
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
         '12, 10, 10, 1',
         format('%s, %s, %s, %s',
                coalesce(sum(sel), 0), coalesce(sum(ins), 0), coalesce(sum(upd), 0), coalesce(sum(del), 0)),
         coalesce(sum(sel), 0) = 12 and coalesce(sum(ins), 0) = 10
           and coalesce(sum(upd), 0) = 10 and coalesce(sum(del), 0) = 1
    from actual_policies

  union all
  -- Calendar shape
  select 'kpi_calendar_day rows', '1461', count(*)::text, count(*) = 1461 from public.kpi_calendar_day
  union all
  select 'kpi_calendar_day first date', '2025-04-01', min(date)::text, min(date) = '2025-04-01' from public.kpi_calendar_day
  union all
  select 'kpi_calendar_day last date', '2029-03-31', max(date)::text, max(date) = '2029-03-31' from public.kpi_calendar_day
  union all
  select 'kpi_public_holiday rows', '45', count(*)::text, count(*) = 45 from public.kpi_public_holiday
  union all
  select 'kpi_company_closure rows', '0 at go-live', count(*)::text, count(*) = 0 from public.kpi_company_closure

  union all
  -- Working days per month
  select 'working days in ' || to_char(mc.m, 'FMMonth YYYY'),
         mc.n::text,
         count(cd.date)::text,
         count(cd.date) = mc.n
    from month_checks mc
    left join public.kpi_calendar_day cd on cd.month = mc.m and cd.is_working_day = true
   group by mc.m, mc.n

  union all
  -- Named holidays are non-working with their name
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
  -- FY and quarter spot checks
  select 'fy and quarter ' || f.d::text,
         format('fy %s Q%s', f.fy, f.quarter),
         coalesce(format('fy %s Q%s', cd.fy, cd.quarter), 'missing'),
         coalesce(cd.fy = f.fy and cd.quarter = f.quarter, false)
    from fy_checks f
    left join public.kpi_calendar_day cd on cd.date = f.d

  union all
  -- Functions
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
)
select check_name, expected, actual, pass
  from checks
 order by check_name;

-- Audit trail. Select the query below (without the leading --) and run it
-- separately to see the 20 most recent KPI changes.
--
-- select at, actor_email, entity, action, entity_id
--   from public.kpi_audit_log
--  order by at desc
--  limit 20;
