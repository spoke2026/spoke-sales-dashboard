-- 0005_kpi_scorecards_verify.sql
-- Read-only check of migration 0005, and the full current-state authority for
-- 0003's and 0004's structural checks too (D16). Paste into the Supabase SQL
-- editor and run. The first row is "summary"; if it shows pass = true and no
-- other row shows pass = false, the migration is correctly applied. It writes
-- nothing.
--
-- Carries every 0004 verify check except "policy kpi_audit_log_insert_proposal
-- shape" (that policy no longer exists after 0005; it is replaced by
-- kpi_audit_log_insert_trigger, checked separately below). Updates the policy
-- expectations and totals for the six new scoped policies and the replaced
-- audit-log insert policy, and adds the 0005 checks: the scoped and trigger
-- policies' shape, the two dropped policies' absence, the audit gate's prosrc
-- and grants, the thirteen new functions' existence and grants, the
-- SECURITY DEFINER count, the three guard triggers' timing and event bits, the
-- pre-existing audit trigger still present on the three lifecycle tables,
-- kpi_scorecard's and kpi_target's exact column lists, and the three FKs and
-- nine CHECK constraints validated.

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
    ('kpi_scorecard', 1, 2, 2, 0),
    ('kpi_assignment', 1, 2, 1, 1),
    ('kpi_target', 1, 2, 1, 1),
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
expected_kpi_definition_constraints(name) as (
  values
    ('kpi_definition_name_length'), ('kpi_definition_description_length'),
    ('kpi_definition_source_mapping_object'), ('kpi_definition_attribution_object'),
    ('kpi_definition_example_target_non_negative')
),
expected_kpi_scorecard_columns(c) as (
  values
    ('id'), ('person_id'), ('fy'), ('quarter'), ('status'), ('approved_by'), ('approved_at'),
    ('created_at'), ('submitted_at'), ('submitted_by'), ('approval_kind'), ('board_reference'),
    ('board_meeting_date'), ('returned_at'), ('returned_by'), ('return_note')
),
actual_kpi_scorecard_columns as (
  select attname as c
    from pg_attribute
   where attrelid = to_regclass('public.kpi_scorecard')
     and attnum > 0 and not attisdropped
),
expected_kpi_target_columns(c) as (
  values
    ('id'), ('assignment_id'), ('month'), ('value'), ('effective_from'),
    ('created_by'), ('change_reason'), ('created_by_email')
),
actual_kpi_target_columns as (
  select attname as c
    from pg_attribute
   where attrelid = to_regclass('public.kpi_target')
     and attnum > 0 and not attisdropped
),
expected_scorecard_fks(name) as (
  values
    ('kpi_scorecard_approved_by_fkey'),
    ('kpi_scorecard_submitted_by_fkey'),
    ('kpi_scorecard_returned_by_fkey')
),
expected_scorecard_checks(name) as (
  values
    ('kpi_scorecard_approval_kind'),
    ('kpi_scorecard_locked_shape'),
    ('kpi_scorecard_board_shape'),
    ('kpi_scorecard_board_reference_length'),
    ('kpi_scorecard_board_meeting_date_floor'),
    ('kpi_scorecard_submitted_shape'),
    ('kpi_scorecard_return_shape')
),
expected_target_checks(name) as (
  values ('kpi_target_change_reason_length')
),
expected_new_functions(sig) as (
  values
    ('public.kpi_my_person_id()'),
    ('public.kpi_is_owner_or_manager(uuid)'),
    ('public.kpi_can_touch_scorecard(uuid)'),
    ('public.kpi_can_touch_assignment(uuid)'),
    ('public.kpi_scorecard_actions(uuid)'),
    ('public.kpi_can_create_scorecard(uuid)'),
    ('public.kpi_quarter_months()'),
    ('public.kpi_current_targets(uuid)'),
    ('public.kpi_scorecard_missing_targets(uuid)'),
    ('public.kpi_remove_assignment(uuid)'),
    ('public.kpi_scorecard_guard()'),
    ('public.kpi_assignment_guard()'),
    ('public.kpi_target_guard()')
),
expected_scoped_policies(name, table_name, cmd) as (
  values
    ('kpi_scorecard_insert_scoped', 'kpi_scorecard', 'INSERT'),
    ('kpi_scorecard_update_scoped', 'kpi_scorecard', 'UPDATE'),
    ('kpi_assignment_insert_scoped', 'kpi_assignment', 'INSERT'),
    ('kpi_assignment_delete_scoped', 'kpi_assignment', 'DELETE'),
    ('kpi_target_insert_scoped', 'kpi_target', 'INSERT'),
    ('kpi_target_delete_scoped', 'kpi_target', 'DELETE'),
    ('kpi_audit_log_insert_trigger', 'kpi_audit_log', 'INSERT')
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
  from (values ('kpi_definition_insert_proposal')) as e(expected_name)
  left join pg_policies pol
    on pol.schemaname = 'public' and pol.policyname = e.expected_name
),
checks(check_name, expected, actual, pass) as (
  -- ── 0003/0004 structural checks, current-state (D16) ───────────────────

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
         '12, 14, 11, 3',
         format('%s, %s, %s, %s',
                coalesce(sum(sel), 0), coalesce(sum(ins), 0), coalesce(sum(upd), 0), coalesce(sum(del), 0)),
         coalesce(sum(sel), 0) = 12 and coalesce(sum(ins), 0) = 14
           and coalesce(sum(upd), 0) = 11 and coalesce(sum(del), 0) = 3
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
    from expected_kpi_definition_constraints ec
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
           (t.tgtype::int & 2) = 2
           and (t.tgtype::int & 1) = 1
           and (t.tgtype::int & 4) = 4
           and (t.tgtype::int & 16) = 16,
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

  -- ── 0005 checks ──────────────────────────────────────────────────────────

  union all
  select 'policy ' || esp.name || ' shape',
         format('cmd=%s roles={authenticated} permissive', esp.cmd),
         coalesce(
           format('cmd=%s roles=%s %s', pol.cmd, pol.roles::text,
                  case when pol.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end),
           'missing'
         ),
         coalesce(
           pol.cmd = esp.cmd
           and pol.roles = array['authenticated']::name[]
           and pol.permissive = 'PERMISSIVE',
           false
         )
    from expected_scoped_policies esp
    left join pg_policies pol
      on pol.schemaname = 'public' and pol.tablename = esp.table_name and pol.policyname = esp.name

  union all
  select 'policy kpi_audit_log_insert does not exist',
         'missing',
         case when exists (
           select 1 from pg_policies where schemaname = 'public' and policyname = 'kpi_audit_log_insert'
         ) then 'exists' else 'missing' end,
         not exists (
           select 1 from pg_policies where schemaname = 'public' and policyname = 'kpi_audit_log_insert'
         )

  union all
  select 'policy kpi_audit_log_insert_proposal does not exist',
         'missing',
         case when exists (
           select 1 from pg_policies where schemaname = 'public' and policyname = 'kpi_audit_log_insert_proposal'
         ) then 'exists' else 'missing' end,
         not exists (
           select 1 from pg_policies where schemaname = 'public' and policyname = 'kpi_audit_log_insert_proposal'
         )

  union all
  select 'policy kpi_audit_log_insert_trigger with_check mentions kpi.audit_writer',
         'contains kpi.audit_writer',
         coalesce(
           case when pol.qual is null and pol.with_check ilike '%kpi.audit_writer%'
                then 'contains kpi.audit_writer' else coalesce(pol.with_check, 'missing') end,
           'missing'
         ),
         coalesce(pol.with_check ilike '%kpi.audit_writer%', false)
    from pg_policies pol
   where pol.schemaname = 'public' and pol.policyname = 'kpi_audit_log_insert_trigger'

  union all
  select 'function public.kpi_audit_row() prosrc mentions kpi.audit_writer and change_reason',
         'contains both',
         coalesce(
           format('audit_writer=%s change_reason=%s',
                  p.prosrc ilike '%kpi.audit_writer%', p.prosrc ilike '%change_reason%'),
           'missing'
         ),
         coalesce(p.prosrc ilike '%kpi.audit_writer%' and p.prosrc ilike '%change_reason%', false)
    from pg_proc p
   where p.oid = to_regprocedure('public.kpi_audit_row()')

  union all
  select 'function public.kpi_audit_row() is security invoker',
         'exists, invoker',
         coalesce(case when p.prosecdef then 'exists, SECURITY DEFINER' else 'exists, invoker' end, 'missing'),
         coalesce(p.prosecdef = false, false)
    from pg_proc p
   where p.oid = to_regprocedure('public.kpi_audit_row()')

  union all
  select 'authenticated cannot execute public.kpi_audit_row()',
         'false',
         has_function_privilege('authenticated', 'public.kpi_audit_row()', 'execute')::text,
         not has_function_privilege('authenticated', 'public.kpi_audit_row()', 'execute')

  union all
  select 'function ' || ef.sig || ' exists, invoker, granted correctly',
         'exists, invoker, anon=false, authenticated=true',
         coalesce(
           format('%s, anon=%s, authenticated=%s',
                  case when p.prosecdef then 'SECURITY DEFINER' else 'invoker' end,
                  has_function_privilege('anon', ef.sig, 'execute'),
                  has_function_privilege('authenticated', ef.sig, 'execute')),
           'missing'
         ),
         coalesce(
           p.prosecdef = false
           and not has_function_privilege('anon', ef.sig, 'execute')
           and has_function_privilege('authenticated', ef.sig, 'execute'),
           false
         )
    from expected_new_functions ef
    left join pg_proc p on p.oid = to_regprocedure(ef.sig)

  union all
  select 'no public kpi_% function is SECURITY DEFINER',
         '0',
         count(*)::text,
         count(*) = 0
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'kpi\_%' and p.prosecdef = true

  union all
  select 'trigger kpi_scorecard_guard is BEFORE, FOR EACH ROW, INSERT and UPDATE (no DELETE)',
         'before row, insert+update, no delete',
         coalesce(
           format('%s row, insert=%s update=%s delete=%s',
                  case when (t.tgtype::int & 2) = 2 then 'before' else 'not-before' end,
                  (t.tgtype::int & 4) = 4, (t.tgtype::int & 16) = 16, (t.tgtype::int & 8) = 8),
           'missing'
         ),
         coalesce(
           (t.tgtype::int & 2) = 2 and (t.tgtype::int & 1) = 1
           and (t.tgtype::int & 4) = 4 and (t.tgtype::int & 16) = 16
           and (t.tgtype::int & 8) = 0,
           false
         )
    from pg_trigger t
   where t.tgrelid = to_regclass('public.kpi_scorecard') and t.tgname = 'kpi_scorecard_guard'

  union all
  select 'trigger kpi_assignment_guard is BEFORE, FOR EACH ROW, INSERT, UPDATE and DELETE',
         'before row, insert+update+delete',
         coalesce(
           format('%s row, insert=%s update=%s delete=%s',
                  case when (t.tgtype::int & 2) = 2 then 'before' else 'not-before' end,
                  (t.tgtype::int & 4) = 4, (t.tgtype::int & 16) = 16, (t.tgtype::int & 8) = 8),
           'missing'
         ),
         coalesce(
           (t.tgtype::int & 2) = 2 and (t.tgtype::int & 1) = 1
           and (t.tgtype::int & 4) = 4 and (t.tgtype::int & 16) = 16
           and (t.tgtype::int & 8) = 8,
           false
         )
    from pg_trigger t
   where t.tgrelid = to_regclass('public.kpi_assignment') and t.tgname = 'kpi_assignment_guard'

  union all
  select 'trigger kpi_target_guard is BEFORE, FOR EACH ROW, INSERT, UPDATE and DELETE',
         'before row, insert+update+delete',
         coalesce(
           format('%s row, insert=%s update=%s delete=%s',
                  case when (t.tgtype::int & 2) = 2 then 'before' else 'not-before' end,
                  (t.tgtype::int & 4) = 4, (t.tgtype::int & 16) = 16, (t.tgtype::int & 8) = 8),
           'missing'
         ),
         coalesce(
           (t.tgtype::int & 2) = 2 and (t.tgtype::int & 1) = 1
           and (t.tgtype::int & 4) = 4 and (t.tgtype::int & 16) = 16
           and (t.tgtype::int & 8) = 8,
           false
         )
    from pg_trigger t
   where t.tgrelid = to_regclass('public.kpi_target') and t.tgname = 'kpi_target_guard'

  union all
  select 'trigger kpi_audit_row still exists on ' || tt.t,
         'exists',
         case when exists (
           select 1 from pg_trigger t
            where t.tgrelid = to_regclass('public.' || tt.t) and t.tgname = 'kpi_audit_row'
         ) then 'exists' else 'missing' end,
         exists (
           select 1 from pg_trigger t
            where t.tgrelid = to_regclass('public.' || tt.t) and t.tgname = 'kpi_audit_row'
         )
    from (values ('kpi_scorecard'), ('kpi_assignment'), ('kpi_target')) as tt(t)

  union all
  select 'kpi_scorecard has exactly its 16 expected columns',
         '16 columns, no more, no less',
         format('%s expected-and-present, %s unexpected, %s missing',
                (select count(*) from expected_kpi_scorecard_columns e
                  join actual_kpi_scorecard_columns a on a.c = e.c),
                (select count(*) from actual_kpi_scorecard_columns a
                  where not exists (select 1 from expected_kpi_scorecard_columns e where e.c = a.c)),
                (select count(*) from expected_kpi_scorecard_columns e
                  where not exists (select 1 from actual_kpi_scorecard_columns a where a.c = e.c))),
         (select count(*) from expected_kpi_scorecard_columns) = 16
           and not exists (
             select 1 from actual_kpi_scorecard_columns a
              where not exists (select 1 from expected_kpi_scorecard_columns e where e.c = a.c)
           )
           and not exists (
             select 1 from expected_kpi_scorecard_columns e
              where not exists (select 1 from actual_kpi_scorecard_columns a where a.c = e.c)
           )

  union all
  select 'kpi_target has exactly its 8 expected columns',
         '8 columns, no more, no less',
         format('%s expected-and-present, %s unexpected, %s missing',
                (select count(*) from expected_kpi_target_columns e
                  join actual_kpi_target_columns a on a.c = e.c),
                (select count(*) from actual_kpi_target_columns a
                  where not exists (select 1 from expected_kpi_target_columns e where e.c = a.c)),
                (select count(*) from expected_kpi_target_columns e
                  where not exists (select 1 from actual_kpi_target_columns a where a.c = e.c))),
         (select count(*) from expected_kpi_target_columns) = 8
           and not exists (
             select 1 from actual_kpi_target_columns a
              where not exists (select 1 from expected_kpi_target_columns e where e.c = a.c)
           )
           and not exists (
             select 1 from expected_kpi_target_columns e
              where not exists (select 1 from actual_kpi_target_columns a where a.c = e.c)
           )

  union all
  select 'FK ' || efk.name || ' exists, references kpi_person, validated',
         'exists, references kpi_person, validated',
         coalesce(
           format('%s, references %s, %s',
                  case when con.contype = 'f' then 'exists' else 'wrong type' end,
                  (select relname from pg_class where oid = con.confrelid),
                  case when con.convalidated then 'validated' else 'NOT validated' end),
           'missing'
         ),
         coalesce(
           con.contype = 'f'
           and (select relname from pg_class where oid = con.confrelid) = 'kpi_person'
           and con.convalidated,
           false
         )
    from expected_scorecard_fks efk
    left join pg_constraint con
      on con.conname = efk.name and con.conrelid = to_regclass('public.kpi_scorecard')

  union all
  select 'CHECK ' || esc.name || ' exists and is validated',
         'exists, validated',
         coalesce(case when con.convalidated then 'exists, validated' else 'exists, NOT validated' end, 'missing'),
         coalesce(con.convalidated, false)
    from expected_scorecard_checks esc
    left join pg_constraint con
      on con.conname = esc.name and con.conrelid = to_regclass('public.kpi_scorecard')

  union all
  select 'CHECK ' || etc.name || ' exists and is validated',
         'exists, validated',
         coalesce(case when con.convalidated then 'exists, validated' else 'exists, NOT validated' end, 'missing'),
         coalesce(con.convalidated, false)
    from expected_target_checks etc
    left join pg_constraint con
      on con.conname = etc.name and con.conrelid = to_regclass('public.kpi_target')

  -- The audit gate (D6) assumes no client can set kpi.audit_writer. PostgREST
  -- exposes every public function a signed-in user may execute, so any OTHER
  -- such function that calls set_config would be a way in. This reads the live
  -- project rather than trusting that only this repo's functions exist (rule 13).
  union all
  select 'no other public function callable by users calls set_config',
         '0',
         coalesce(string_agg(p.oid::regprocedure::text, ', '), '0'),
         count(*) = 0
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc ilike '%set_config%'
     and p.oid not in (to_regprocedure('public.kpi_audit_row()'),
                       to_regprocedure('public.kpi_remove_assignment(uuid)'))
     and (has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'))
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
