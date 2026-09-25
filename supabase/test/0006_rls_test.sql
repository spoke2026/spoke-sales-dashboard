-- 0006_rls_test.sql
-- LOCAL TEST ONLY. Never run this on Supabase.
--
-- Run after local_auth_stub.sql, 0001, 0003, 0004, 0005, 0006,
-- 0005_local_seed.sql, and 0006_local_seed.sql. Exercises every "Database
-- behaviour" and "Denials" criterion in
-- briefs/kpi-scorecard-phase-3a-entry-and-scorecard.md, plus Edward's
-- additional post-0006 audit-regression rows. Every row in the final result
-- must show pass = true.
--
-- Mechanics follow 0005_rls_test.sql exactly: one temp results table, one DO
-- block per case, an inner begin/exception block as the implicit savepoint
-- that reverts `set local role` and `request.jwt.claims` (and rolls back
-- every write the case made) on ANY exception, real or the sentinel ZZ001
-- raised deliberately at the end of a successful case. Every 42501 case also
-- checks SQLERRM for "row-level security". Fixture rows a case does not
-- itself have permission to create are inserted directly under postgres
-- BEFORE any `set local role` in that case.
--
-- Fixed UUIDs from 0005_local_seed.sql and 0006_local_seed.sql:
--   Ed 10000000-...0001 (admin), Mia 10000000-...0002 (manager, reports to
--   Ed), Sam 10000000-...0003 (ZZ Test staff, a peer unrelated to Tia), Nia
--   10000000-...0004 (no login, reports to Mia), Oli 10000000-...0005
--   (reports to Ed, not Mia), Dee 10000000-...0006 (reports to Mia), Arne
--   10000000-...0007 (company_only), Tia 10000000-...0008 (owner, reports to
--   Mia).
--   KPIs 20000000-...0010 M-sum, .../0011 M-ratio, .../0012 M-avg,
--   .../0013 M-latest (all manual, on every one of Tia's scorecards),
--   .../0014 H-auto (hubspot, also on every one of Tia's scorecards),
--   .../0015 M-unused (manual, never assigned to Tia).

-- Supabase sessions run in UTC. This local cluster defaults to Pacific/Auckland,
-- which would hide a UTC slip (a bare now()::date or p_at::date), so pin the
-- session to UTC like Supabase before any case runs (mutation 20).
set time zone 'UTC';

create temp table results (
  name text primary key,
  pass boolean not null,
  detail text
);

-- claims shorthand, inlined at each call site (plpgsql has no macros):
--   Ed:  {"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}
--   Mia: {"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}
--   Sam: {"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}
--   u3 (unlinked): {"sub":"00000000-0000-0000-0000-000000000004","email":"user3@example.test"}
--   Dee: {"sub":"00000000-0000-0000-0000-000000000005","email":"user4@example.test"}
--   Tia: {"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}

-- ══════════════════════════════════════════════════════════════════════════
-- Pure SQL: the 7-day function and the Auckland date function, no role needed
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare v_pass boolean; v_detail text; v_a boolean; v_b boolean; v_c boolean; v_d boolean;
begin
  v_a := public.kpi_owner_entry_open('2026-10-05', '2026-10-12T10:59:59Z');
  v_b := public.kpi_owner_entry_open('2026-10-05', '2026-10-12T11:00:00Z');
  v_c := public.kpi_owner_entry_open('2026-10-06', '2026-10-12T11:00:00Z');
  v_d := public.kpi_owner_entry_open('2026-10-13', '2026-10-12T10:59:59Z');
  v_pass := (v_a = true and v_b = false and v_c = true and v_d = false);
  v_detail := format('23:59:59=%s 00:00:00=%s next-day-00:00=%s future=%s', v_a, v_b, v_c, v_d);
  insert into results (name, pass, detail)
    values ('the 7-day function at the four Auckland instants (D4)', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_a date; v_b date;
begin
  v_a := public.kpi_nz_date('2026-09-26T11:59:59Z');
  v_b := public.kpi_nz_date('2026-09-26T12:00:00Z');
  v_pass := (v_a = '2026-09-26' and v_b = '2026-09-27');
  v_detail := format('11:59:59Z=%s 12:00:00Z=%s', v_a, v_b);
  insert into results (name, pass, detail)
    values ('kpi_nz_date across the Auckland midnight boundary', v_pass, v_detail);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Database behaviour: positive controls, one per role (rule 14)
-- ══════════════════════════════════════════════════════════════════════════

-- Owner Tia: insert today, then update. kpi_actual_daily follows both times.
do $$
declare
  v_pass boolean; v_detail text;
  v_today date := (select public.kpi_nz_date(now()));
  v_actual_count int; v_actual record; v_ins_audit int; v_upd_audit int;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_today, 4);

    update public.kpi_manual_entry
       set value = 9
     where person_id = '10000000-0000-0000-0000-000000000008'
       and kpi_definition_id = '20000000-0000-0000-0000-000000000010'
       and date = v_today;

    select count(*) into v_actual_count
      from public.kpi_actual_daily
     where person_id = '10000000-0000-0000-0000-000000000008'
       and kpi_definition_id = '20000000-0000-0000-0000-000000000010'
       and date = v_today;

    select kpi_version, value, numerator, denominator, source into v_actual
      from public.kpi_actual_daily
     where person_id = '10000000-0000-0000-0000-000000000008'
       and kpi_definition_id = '20000000-0000-0000-0000-000000000010'
       and date = v_today;

    select count(*) into v_ins_audit from public.kpi_audit_log
     where entity = 'kpi_manual_entry' and action = 'insert' and actor_email = 'user5@example.test'
       and (after ->> 'date') = v_today::text;
    select count(*) into v_upd_audit from public.kpi_audit_log
     where entity = 'kpi_manual_entry' and action = 'update' and actor_email = 'user5@example.test'
       and (after ->> 'date') = v_today::text;

    v_pass := (v_actual_count = 1 and v_actual.value = 9 and v_actual.source = 'manual'
               and v_actual.kpi_version = 1 and v_actual.numerator is null and v_actual.denominator is null
               and v_ins_audit >= 1 and v_upd_audit >= 1);
    v_detail := format('actual_count=%s actual=%s ins_audit=%s upd_audit=%s',
                        v_actual_count, v_actual, v_ins_audit, v_upd_audit);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('owner: insert today then update, kpi_actual_daily follows, audited under owner email', v_pass, v_detail);
end $$;

-- Owner: today - 7 succeeds.
do $$
declare
  v_pass boolean; v_detail text;
  v_day date := (select public.kpi_nz_date(now())) - 7;
  v_count int;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_day, 2);

    select count(*) into v_count from public.kpi_manual_entry
     where person_id = '10000000-0000-0000-0000-000000000008' and date = v_day;
    v_pass := (v_count = 1);
    v_detail := format('rows=%s', v_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('owner: an entry for today - 7 succeeds', v_pass, v_detail);
end $$;

-- Line manager Mia: entry for Tia today-30, and for no-login Nia today-1.
do $$
declare
  v_pass boolean; v_detail text;
  v_d1 date := (select public.kpi_nz_date(now())) - 30;
  v_d2 date := (select public.kpi_nz_date(now())) - 1;
  v_a1 int; v_a2 int; v_audit1 int; v_audit2 int;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_d1, 3);
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000010', v_d2, 3);

    select count(*) into v_a1 from public.kpi_actual_daily
     where person_id = '10000000-0000-0000-0000-000000000008' and date = v_d1;
    select count(*) into v_a2 from public.kpi_actual_daily
     where person_id = '10000000-0000-0000-0000-000000000004' and date = v_d2;
    select count(*) into v_audit1 from public.kpi_audit_log
     where entity = 'kpi_manual_entry' and actor_email = 'user1@example.test' and (after ->> 'date') = v_d1::text;
    select count(*) into v_audit2 from public.kpi_audit_log
     where entity = 'kpi_manual_entry' and actor_email = 'user1@example.test' and (after ->> 'date') = v_d2::text;

    v_pass := (v_a1 = 1 and v_a2 = 1 and v_audit1 >= 1 and v_audit2 >= 1);
    v_detail := format('actual_tia=%s actual_nia=%s audit_tia=%s audit_nia=%s', v_a1, v_a2, v_audit1, v_audit2);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('manager: entry for report Tia (today-30) and no-login report Nia (today-1) succeed, audited under manager email', v_pass, v_detail);
end $$;

-- Admin Ed: entry for Tia today-60, and for Oli (reports to Ed) today-2.
do $$
declare
  v_pass boolean; v_detail text;
  v_d1 date := (select public.kpi_nz_date(now())) - 60;
  v_d2 date := (select public.kpi_nz_date(now())) - 2;
  v_a1 int; v_a2 int; v_audit1 int; v_audit2 int;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_d1, 3);
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000010', v_d2, 3);

    select count(*) into v_a1 from public.kpi_actual_daily
     where person_id = '10000000-0000-0000-0000-000000000008' and date = v_d1;
    select count(*) into v_a2 from public.kpi_actual_daily
     where person_id = '10000000-0000-0000-0000-000000000005' and date = v_d2;
    select count(*) into v_audit1 from public.kpi_audit_log
     where entity = 'kpi_manual_entry' and actor_email = 'edward@spoke.nz' and (after ->> 'date') = v_d1::text;
    select count(*) into v_audit2 from public.kpi_audit_log
     where entity = 'kpi_manual_entry' and actor_email = 'edward@spoke.nz' and (after ->> 'date') = v_d2::text;

    v_pass := (v_a1 = 1 and v_a2 = 1 and v_audit1 >= 1 and v_audit2 >= 1);
    v_detail := format('actual_tia=%s actual_oli=%s audit_tia=%s audit_oli=%s', v_a1, v_a2, v_audit1, v_audit2);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('admin: entry for Tia (today-60) and Oli (today-2) succeed, audited under admin email', v_pass, v_detail);
end $$;

-- Upsert: INSERT ... ON CONFLICT DO UPDATE by the owner updates it; the
-- derived actual follows.
do $$
declare
  v_pass boolean; v_detail text;
  v_today date := (select public.kpi_nz_date(now()));
  v_val numeric; v_actual_val numeric;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_today, 4);

    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_today, 11)
      on conflict (person_id, kpi_definition_id, date) do update set value = excluded.value;

    select value into v_val from public.kpi_manual_entry
     where person_id = '10000000-0000-0000-0000-000000000008'
       and kpi_definition_id = '20000000-0000-0000-0000-000000000010' and date = v_today;
    select value into v_actual_val from public.kpi_actual_daily
     where person_id = '10000000-0000-0000-0000-000000000008'
       and kpi_definition_id = '20000000-0000-0000-0000-000000000010' and date = v_today;

    v_pass := (v_val = 11 and v_actual_val = 11);
    v_detail := format('entry=%s actual=%s', v_val, v_actual_val);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('upsert: INSERT .. ON CONFLICT DO UPDATE by the owner updates the entry and the derived actual', v_pass, v_detail);
end $$;

-- Shape normalising: ratio, average, sum.
do $$
declare
  v_pass boolean; v_detail text;
  v_today date := (select public.kpi_nz_date(now()));
  v_r record; v_a record; v_s record;
  v_ra record; v_aa record; v_sa record;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value, numerator, denominator)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000011', v_today, 99, 3, 5);
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000012', v_today, 7);
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value, numerator)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_today, 6, 4);

    select value, numerator, denominator into v_r from public.kpi_manual_entry
     where person_id = '10000000-0000-0000-0000-000000000008' and kpi_definition_id = '20000000-0000-0000-0000-000000000011' and date = v_today;
    select value, numerator, denominator into v_a from public.kpi_manual_entry
     where person_id = '10000000-0000-0000-0000-000000000008' and kpi_definition_id = '20000000-0000-0000-0000-000000000012' and date = v_today;
    select value, numerator, denominator into v_s from public.kpi_manual_entry
     where person_id = '10000000-0000-0000-0000-000000000008' and kpi_definition_id = '20000000-0000-0000-0000-000000000010' and date = v_today;

    select value, numerator, denominator into v_ra from public.kpi_actual_daily
     where person_id = '10000000-0000-0000-0000-000000000008' and kpi_definition_id = '20000000-0000-0000-0000-000000000011' and date = v_today;
    select value, numerator, denominator into v_aa from public.kpi_actual_daily
     where person_id = '10000000-0000-0000-0000-000000000008' and kpi_definition_id = '20000000-0000-0000-0000-000000000012' and date = v_today;
    select value, numerator, denominator into v_sa from public.kpi_actual_daily
     where person_id = '10000000-0000-0000-0000-000000000008' and kpi_definition_id = '20000000-0000-0000-0000-000000000010' and date = v_today;

    v_pass := (v_r.value is null and v_r.numerator = 3 and v_r.denominator = 5
               and v_a.value = 7 and v_a.numerator = 7 and v_a.denominator = 1
               and v_s.value = 6 and v_s.numerator is null and v_s.denominator is null
               and v_ra = v_r and v_aa = v_a and v_sa = v_s);
    v_detail := format('ratio=%s average=%s sum=%s ratio_actual=%s average_actual=%s sum_actual=%s',
                        v_r, v_a, v_s, v_ra, v_aa, v_sa);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('shape normalising: ratio drops value, average copies to numerator/denominator=1, sum drops numerator/denominator', v_pass, v_detail);
end $$;

-- Stamping: entered_by, entered_at, kpi_version are stamped by the guard.
do $$
declare
  v_pass boolean; v_detail text;
  v_today date := (select public.kpi_nz_date(now()));
  v_row record;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value, entered_by, kpi_version)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_today, 5,
              '10000000-0000-0000-0000-000000000002', 99);

    select entered_by, entered_at, kpi_version into v_row from public.kpi_manual_entry
     where person_id = '10000000-0000-0000-0000-000000000008' and kpi_definition_id = '20000000-0000-0000-0000-000000000010' and date = v_today;

    v_pass := (v_row.entered_by = '00000000-0000-0000-0000-000000000006'
               and abs(extract(epoch from (now() - v_row.entered_at))) < 1
               and v_row.kpi_version = 1);
    v_detail := format('entered_by=%s entered_at_delta=%s kpi_version=%s',
                        v_row.entered_by, extract(epoch from (now() - v_row.entered_at)), v_row.kpi_version);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('stamping: entered_by/entered_at/kpi_version are stamped by the guard, not the client', v_pass, v_detail);
end $$;

-- kpi_window_targets: January 21, February 17, March 30; current month 5 not 6.
do $$
declare
  v_pass boolean; v_detail text;
  v_jan numeric; v_feb numeric; v_mar numeric; v_cur numeric;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;

    select value into v_jan from public.kpi_window_targets('10000000-0000-0000-0000-000000000008', '2026-01-01', '2026-03-31')
     where kpi_definition_id = '20000000-0000-0000-0000-000000000010' and month = '2026-01-01';
    select value into v_feb from public.kpi_window_targets('10000000-0000-0000-0000-000000000008', '2026-01-01', '2026-03-31')
     where kpi_definition_id = '20000000-0000-0000-0000-000000000010' and month = '2026-02-01';
    select value into v_mar from public.kpi_window_targets('10000000-0000-0000-0000-000000000008', '2026-01-01', '2026-03-31')
     where kpi_definition_id = '20000000-0000-0000-0000-000000000010' and month = '2026-03-01';
    select value into v_cur from public.kpi_window_targets(
      '10000000-0000-0000-0000-000000000008',
      (select date_trunc('month', public.kpi_nz_date(now())::timestamp))::date,
      public.kpi_nz_date(now()))
     where kpi_definition_id = '20000000-0000-0000-0000-000000000010';

    v_pass := (v_jan = 21 and v_feb = 17 and v_mar = 30 and v_cur = 5);
    v_detail := format('jan=%s feb=%s mar=%s current_month=%s', v_jan, v_feb, v_mar, v_cur);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('kpi_window_targets (D9): January 21, February 17, March 30, current month 5 not the row effective tomorrow (6)', v_pass, v_detail);
end $$;

-- kpi_window_targets: nothing from the draft (previous-quarter) scorecard.
-- The function caps p_end - p_start at 365 days, so this queries just the
-- previous quarter's own date range (well under the cap) rather than the
-- whole calendar, which would return 0 rows regardless of the draft filter
-- and prove nothing (rule 14).
do $$
declare
  v_pass boolean; v_detail text; v_count int;
  v_today date; v_cur_fy smallint; v_cur_quarter smallint;
  v_prev_fy smallint; v_prev_quarter smallint; v_from date; v_to date;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;

    v_today := (select public.kpi_nz_date(now()));
    select fy, quarter into v_cur_fy, v_cur_quarter
      from public.kpi_calendar_day where date = v_today;
    select cd.fy, cd.quarter into v_prev_fy, v_prev_quarter
      from public.kpi_calendar_day cd
     where cd.date = (
       select min(date) - 1 from public.kpi_calendar_day
        where fy = v_cur_fy and quarter = v_cur_quarter
     );
    select min(date), max(date) into v_from, v_to
      from public.kpi_calendar_day
     where fy = v_prev_fy and quarter = v_prev_quarter;

    select count(*) into v_count from public.kpi_window_targets(
      '10000000-0000-0000-0000-000000000008', v_from, v_to);

    v_pass := (v_count = 0);
    v_detail := format('previous quarter %s to %s, rows returned (must be 0, scorecard is draft)=%s', v_from, v_to, v_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('kpi_window_targets: nothing from a draft scorecard (previous quarter, within the 365-day cap)', v_pass, v_detail);
end $$;

-- kpi_entry_cells: only manual KPIs, can_write matches the 7-day/manager rule.
do $$
declare
  v_pass boolean; v_detail text;
  v_today date := (select public.kpi_nz_date(now()));
  v_monday date := date_trunc('week', v_today::timestamp)::date;
  v_sunday date := v_monday + 6;
  v_has_auto boolean; v_tia_ok boolean; v_mia_ok boolean;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;

    select exists (
      select 1 from public.kpi_entry_cells('10000000-0000-0000-0000-000000000008', v_monday, v_sunday)
       where kpi_definition_id = '20000000-0000-0000-0000-000000000014'
    ) into v_has_auto;

    select bool_and(can_write = (date between v_today - 7 and v_today)) into v_tia_ok
      from public.kpi_entry_cells('10000000-0000-0000-0000-000000000008', v_monday, v_sunday);

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);

    select bool_and(can_write = (date <= v_today)) into v_mia_ok
      from public.kpi_entry_cells('10000000-0000-0000-0000-000000000008', v_monday, v_sunday);

    v_pass := (v_has_auto = false and coalesce(v_tia_ok, false) and coalesce(v_mia_ok, false));
    v_detail := format('has_automated=%s tia_can_write_matches_7day=%s mia_can_write_matches_manager_rule=%s',
                        v_has_auto, v_tia_ok, v_mia_ok);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('kpi_entry_cells: only manual KPIs, can_write matches the 7-day rule for the owner and the manager rule for the manager', v_pass, v_detail);
end $$;

-- kpi_entry_people(): Tia={Tia}; Mia={Mia,Sam,Nia,Dee,Tia}; Ed=every active
-- Individual person; unlinked u3={}; Arne never included.
do $$
declare
  v_pass boolean; v_detail text;
  v_tia uuid[]; v_mia uuid[]; v_ed uuid[]; v_u3 uuid[];
  v_expected_tia uuid[] := array['10000000-0000-0000-0000-000000000008'::uuid];
  v_expected_mia uuid[] := array(
    select unnest(array[
      '10000000-0000-0000-0000-000000000002'::uuid,
      '10000000-0000-0000-0000-000000000003'::uuid,
      '10000000-0000-0000-0000-000000000004'::uuid,
      '10000000-0000-0000-0000-000000000006'::uuid,
      '10000000-0000-0000-0000-000000000008'::uuid
    ]) order by 1
  );
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;
    v_tia := array(select x from public.kpi_entry_people() x order by x);

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    v_mia := array(select x from public.kpi_entry_people() x order by x);

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    v_ed := array(select x from public.kpi_entry_people() x order by x);

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000004","email":"user3@example.test"}', true);
    v_u3 := array(select x from public.kpi_entry_people() x order by x);

    v_pass := (
      v_tia = v_expected_tia
      and v_mia = v_expected_mia
      and v_u3 = '{}'
      and '10000000-0000-0000-0000-000000000007' <> all(coalesce(v_ed, '{}'))
      and '10000000-0000-0000-0000-000000000008' = any(v_ed)
      and array_length(v_ed, 1) >= 7
    );
    v_detail := format('tia=%s mia=%s ed=%s u3=%s', v_tia, v_mia, v_ed, v_u3);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('kpi_entry_people: Tia={self}, Mia={self+reports incl. Tia}, Ed=every active individual (never Arne), unlinked={}', v_pass, v_detail);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Denials
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now())) - 8;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_day, 1);
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS017' then v_pass := true; v_detail := 'blocked KS017: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: owner entering today - 8 (past the 7-day window) is KS017', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now())) + 1;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_day, 1);
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS015' then v_pass := true; v_detail := 'blocked KS015: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: owner entering today + 1 is KS015', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now())) + 1;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_day, 1);
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS015' then v_pass := true; v_detail := 'blocked KS015: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: admin entering today + 1 is KS015', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now()));
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;
    -- Sam is a peer: unrelated to Tia, not her manager.
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000010', v_day, 1);
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: owner Tia entering for a peer (Sam) is 42501', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now()));
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;
    -- Oli reports to Ed, not Mia.
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000010', v_day, 1);
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: line manager entering for a non-report (Oli) is 42501', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now()));
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000004","email":"user3@example.test"}', true);
    set local role authenticated;
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_day, 1);
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: unlinked user3 entering for anyone is 42501', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now()));
begin
  begin
    update public.kpi_person set active = false where id = '10000000-0000-0000-0000-000000000006';

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000005","email":"user4@example.test"}', true);
    set local role authenticated;
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000010', v_day, 1);
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501, same shape as unlinked (her login no longer resolves to an active person): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: Dee (seeded active, set inactive as postgres) entering her own is 42501', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now()));
begin
  begin
    update public.kpi_person set active = false where id = '10000000-0000-0000-0000-000000000006';

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000010', v_day, 1);
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS007' then v_pass := true; v_detail := 'blocked KS007 (inactive person): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: Mia entering for Dee after Dee is set inactive is KS007', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now()));
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000010', v_day, 1);
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS007' then v_pass := true; v_detail := 'blocked KS007 (company_only person): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: anyone entering for Arne (company_only) is KS007', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now()));
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000014', v_day, 1);
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS016' then v_pass := true; v_detail := 'blocked KS016 (automated KPI): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: an entry for the automated KPI (H-auto) on Tia''s scorecard is KS016', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now()));
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000015', v_day, 1);
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS016' then v_pass := true; v_detail := 'blocked KS016 (not on the scorecard): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: an entry for a manual KPI not on Tia''s scorecard (M-unused) is KS016', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', '2025-03-31', 1);
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS016' then v_pass := true; v_detail := 'blocked KS016 (before the calendar starts): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: an entry for 2025-03-31 (before the calendar starts) is KS016', v_pass, v_detail);
end $$;

-- UPDATE that changes date, person_id, or kpi_definition_id -> KS011.
do $$
declare
  v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now()));
  c text;
begin
  for c in select unnest(array['date', 'person_id', 'kpi_definition_id']) loop
    begin
      perform set_config('request.jwt.claims',
        '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
      set local role authenticated;

      insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
        values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_day, 1);

      if c = 'date' then
        update public.kpi_manual_entry set date = v_day - 1
         where person_id = '10000000-0000-0000-0000-000000000008'
           and kpi_definition_id = '20000000-0000-0000-0000-000000000010' and date = v_day;
      elsif c = 'person_id' then
        update public.kpi_manual_entry set person_id = '10000000-0000-0000-0000-000000000003'
         where person_id = '10000000-0000-0000-0000-000000000008'
           and kpi_definition_id = '20000000-0000-0000-0000-000000000010' and date = v_day;
      else
        update public.kpi_manual_entry set kpi_definition_id = '20000000-0000-0000-0000-000000000011'
         where person_id = '10000000-0000-0000-0000-000000000008'
           and kpi_definition_id = '20000000-0000-0000-0000-000000000010' and date = v_day;
      end if;

      v_pass := false; v_detail := 'update unexpectedly succeeded';
      raise exception using errcode = 'ZZ001';
    exception
      when sqlstate 'KS011' then v_pass := true; v_detail := 'blocked KS011: ' || sqlerrm;
      when sqlstate 'ZZ001' then null;
      when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
    end;
    insert into results (name, pass, detail)
      values ('denial: an UPDATE that changes ' || c || ' is KS011', v_pass, v_detail);
  end loop;
end $$;

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now()));
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_day, null);
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS011' then v_pass := true; v_detail := 'blocked KS011 (sum, value null): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: a sum entry with value null is KS011', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now()));
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, numerator)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000011', v_day, 3);
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS011' then v_pass := true; v_detail := 'blocked KS011 (ratio, denominator null): ' || sqlerrm;
    when sqlstate '23514' then v_pass := true; v_detail := 'blocked by the table check before the guard (still not written): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: a ratio entry with denominator null is KS011', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now()));
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_day, -1);
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS011' then v_pass := true; v_detail := 'blocked KS011 (negative value): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: a negative value is KS011', v_pass, v_detail);
end $$;

-- DELETE of an entry: owner, manager, admin each affect 0 rows (no delete policy exists).
do $$
declare
  v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now()));
  v_count int; v_who text; v_claims text;
begin
  for v_who, v_claims in
    select * from (values
      ('owner', '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}'),
      ('manager', '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}'),
      ('admin', '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}')
    ) as t(who, claims)
  loop
    begin
      insert into public.kpi_manual_entry (person_id, kpi_definition_id, kpi_version, date, value)
        values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', 1, v_day, 1)
        on conflict (person_id, kpi_definition_id, date) do update set value = 1;

      perform set_config('request.jwt.claims', v_claims, true);
      set local role authenticated;

      delete from public.kpi_manual_entry
       where person_id = '10000000-0000-0000-0000-000000000008'
         and kpi_definition_id = '20000000-0000-0000-0000-000000000010' and date = v_day;
      get diagnostics v_count = row_count;

      v_pass := (v_count = 0);
      v_detail := format('rows deleted=%s', v_count);
      raise exception using errcode = 'ZZ001';
    exception
      when sqlstate 'ZZ001' then null;
      when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
    end;
    insert into results (name, pass, detail)
      values ('denial: DELETE of an entry by the ' || v_who || ' affects 0 rows', v_pass, v_detail);
  end loop;
end $$;

-- Direct writes to kpi_actual_daily.
do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now())) - 40;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;
    insert into public.kpi_actual_daily (person_id, kpi_definition_id, kpi_version, date, value, source)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', 1, v_day, 3, 'manual');
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501 (no matching entry): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: direct INSERT into kpi_actual_daily (source manual, matches no entry) is 42501', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now())) - 41;
begin
  begin
    -- The admin enters on Tia's behalf (any past day) so the fixture isn't
    -- limited by the owner's own 7-day window.
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_day, 9);

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);

    -- The trigger already wrote the identical row with source 'manual'; this
    -- tries to write the SAME shape again directly but tagged 'hubspot'.
    insert into public.kpi_actual_daily (person_id, kpi_definition_id, kpi_version, date, value, source)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', 1, v_day, 9, 'hubspot')
      on conflict (person_id, kpi_definition_id, date) do update set source = 'hubspot';

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501 (source must be manual): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: INSERT copying an existing entry exactly but source hubspot is 42501', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now())) - 42;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_day, 9);

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);

    update public.kpi_actual_daily set value = 40
     where person_id = '10000000-0000-0000-0000-000000000008'
       and kpi_definition_id = '20000000-0000-0000-0000-000000000010' and date = v_day;

    v_pass := false; v_detail := 'update unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501 (value would no longer match the entry): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: UPDATE of Tia''s manual actual to another value is 42501', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now())) - 5; v_count int;
begin
  begin
    -- The seeded hubspot actual for (Tia, M-sum, today - 5).
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;

    update public.kpi_actual_daily set value = 100
     where person_id = '10000000-0000-0000-0000-000000000008'
       and kpi_definition_id = '20000000-0000-0000-0000-000000000010' and date = v_day and source = 'hubspot';
    get diagnostics v_count = row_count;

    v_pass := (v_count = 0);
    v_detail := format('rows updated=%s', v_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501: ' || sqlerrm;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: UPDATE of the seeded hubspot actual affects 0 rows', v_pass, v_detail);
end $$;

-- The WHO check (D2/Roscoe): an unrelated user (Sam) touching only
-- calculated_at on Tia's already-matching manual actual affects 0 rows.
-- Without kpi_is_owner_or_manager in the UPDATE policy's USING clause (the
-- match-only, WHAT-but-no-WHO version Roscoe's review found), this row would
-- be visible to any authenticated user (source = 'manual' alone), and the
-- update would succeed since the seven matched columns are unchanged and
-- calculated_at isn't covered by the match check (mutation 34). With the fix,
-- USING already excludes the row for Sam (not Tia, not her manager), so the
-- UPDATE matches 0 rows -- there is no separate WITH CHECK failure to raise
-- 42501 here, since RLS filters unmatched rows silently on UPDATE.
do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now())) - 43; v_count int;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;
    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_day, 9);

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);

    -- All seven matched columns stay identical; only calculated_at moves.
    update public.kpi_actual_daily set calculated_at = now()
     where person_id = '10000000-0000-0000-0000-000000000008'
       and kpi_definition_id = '20000000-0000-0000-0000-000000000010' and date = v_day;
    get diagnostics v_count = row_count;

    v_pass := (v_count = 0);
    v_detail := format('rows updated=%s (WHO check: Sam is not Tia''s owner or manager)', v_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501: ' || sqlerrm;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: an unrelated user (Sam) touching only calculated_at on Tia''s matching actual affects 0 rows (WHO check, D2)', v_pass, v_detail);
end $$;

-- Sync conflict: a seeded hubspot actual exists for (Tia, M-sum, today - 5).
do $$
declare v_pass boolean; v_detail text; v_day date := (select public.kpi_nz_date(now())) - 5; v_count int;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_manual_entry (person_id, kpi_definition_id, date, value)
      values ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000010', v_day, 7);

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS019' then
      select count(*) into v_count from public.kpi_manual_entry
       where person_id = '10000000-0000-0000-0000-000000000008'
         and kpi_definition_id = '20000000-0000-0000-0000-000000000010' and date = v_day;
      v_pass := (v_count = 0);
      v_detail := format('blocked KS019, entries after=%s: %s', v_count, sqlerrm);
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: an owner entry on a day with an existing automated actual (sync conflict) is KS019, no entry written', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000006","email":"user5@example.test"}', true);
    set local role authenticated;
    insert into public.kpi_audit_log (entity, entity_id, action, actor_id, actor_email)
      values ('kpi_manual_entry', gen_random_uuid()::text, 'insert',
              '00000000-0000-0000-0000-000000000006', 'user5@example.test');
    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('regression: a direct INSERT into kpi_audit_log by the owner is 42501', v_pass, v_detail);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Edward's additional post-0006 audit-regression rows
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare v_pass boolean; v_detail text; v_id uuid; v_count int;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_team (name) values ('ZZ Test 0006 team') returning id into v_id;
    select count(*) into v_count from public.kpi_audit_log
     where entity = 'kpi_team' and entity_id = v_id::text and action = 'insert' and actor_email = 'edward@spoke.nz';

    v_pass := (v_count >= 1);
    v_detail := format('audit_rows=%s', v_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('0006-applied regression: admin kpi_team insert still audits under the admin email', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_count_ins int; v_count_del int;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_company_closure (date, reason) values ('2028-11-11', 'ZZ Test 0006 closure');
    delete from public.kpi_company_closure where date = '2028-11-11';

    select count(*) into v_count_ins from public.kpi_audit_log
     where entity = 'kpi_company_closure' and entity_id = '2028-11-11' and action = 'insert' and actor_email = 'edward@spoke.nz';
    select count(*) into v_count_del from public.kpi_audit_log
     where entity = 'kpi_company_closure' and entity_id = '2028-11-11' and action = 'delete' and actor_email = 'edward@spoke.nz';

    v_pass := (v_count_ins >= 1 and v_count_del >= 1);
    v_detail := format('insert_audit=%s delete_audit=%s', v_count_ins, v_count_del);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('0006-applied regression: admin kpi_company_closure insert+delete still audit under the admin email', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_id uuid := gen_random_uuid(); v_count int;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source)
      values (v_id, 1, 'ZZ Test 0006 proposal', 'desc', 'lead', 'count', 'higher', 'sum', 'working_days', 'manual');

    select count(*) into v_count from public.kpi_audit_log
     where entity = 'kpi_definition' and entity_id = v_id::text and action = 'insert' and actor_email = 'user2@example.test';

    v_pass := (v_count >= 1);
    v_detail := format('audit_rows=%s', v_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('0006-applied regression: non-admin (Sam) kpi_definition proposal still audits under their own email', v_pass, v_detail);
end $$;

-- The 2b scorecard lifecycle, 0006-applied: staff drafts, adds a KPI, sets a
-- target, submits; manager approves; admin exception-edits a locked target
-- with a reason. Each step audits with the right actor_email and reason.
do $$
declare
  v_pass boolean; v_detail text;
  v_sc uuid; v_asg uuid; v_tgt_id uuid;
  v_draft_audit int; v_asg_audit int; v_tgt_audit int; v_submit_audit int; v_approve_audit int;
  v_reason text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000003', 2028, 2) returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;
    insert into public.kpi_target (assignment_id, month, value) values
      (v_asg, '2027-07-01', 5), (v_asg, '2027-08-01', 5), (v_asg, '2027-09-01', 5);
    update public.kpi_scorecard set status = 'submitted' where id = v_sc;

    select count(*) into v_draft_audit from public.kpi_audit_log
     where entity = 'kpi_scorecard' and entity_id = v_sc::text and action = 'insert' and actor_email = 'user2@example.test';
    select count(*) into v_asg_audit from public.kpi_audit_log
     where entity = 'kpi_assignment' and entity_id = v_asg::text and action = 'insert' and actor_email = 'user2@example.test';
    select count(*) into v_tgt_audit from public.kpi_audit_log
     where entity = 'kpi_target' and actor_email = 'user2@example.test'
       and entity_id in (select id::text from public.kpi_target where assignment_id = v_asg);
    select count(*) into v_submit_audit from public.kpi_audit_log
     where entity = 'kpi_scorecard' and entity_id = v_sc::text and action = 'update' and actor_email = 'user2@example.test';

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    update public.kpi_scorecard set status = 'locked', approval_kind = 'standard' where id = v_sc;

    select count(*) into v_approve_audit from public.kpi_audit_log
     where entity = 'kpi_scorecard' and entity_id = v_sc::text and action = 'update' and actor_email = 'user1@example.test';

    -- The exception-edit step targets Tia's already-locked FY26 Q4 scorecard
    -- (seeded in a separate, earlier transaction), not the assignment just
    -- created above: within this one test transaction now() is frozen, so a
    -- second target row for the SAME (assignment, month) created moments ago
    -- would collide on kpi_target's (assignment_id, month, effective_from)
    -- unique constraint (the guard stamps effective_from := now() itself,
    -- Roscoe/D9), which never happens in production, where each save is its
    -- own transaction with its own now().
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    insert into public.kpi_target (assignment_id, month, value, change_reason)
      select a.id, '2026-03-01', 31, 'ZZ Test 0006 exception edit'
        from public.kpi_assignment a
        join public.kpi_scorecard s on s.id = a.scorecard_id
       where s.person_id = '10000000-0000-0000-0000-000000000008'
         and s.fy = 2026 and s.quarter = 4
         and a.kpi_definition_id = '20000000-0000-0000-0000-000000000010'
      returning id into v_tgt_id;

    select reason into v_reason from public.kpi_audit_log
     where entity = 'kpi_target' and entity_id = v_tgt_id::text and action = 'insert';

    v_pass := (v_draft_audit >= 1 and v_asg_audit >= 1 and v_tgt_audit >= 3 and v_submit_audit >= 1
               and v_approve_audit >= 1 and v_reason = 'ZZ Test 0006 exception edit');
    v_detail := format('draft=%s assignment=%s targets=%s submit=%s approve=%s reason=%s',
                        v_draft_audit, v_asg_audit, v_tgt_audit, v_submit_audit, v_approve_audit, v_reason);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('0006-applied regression: the 2b scorecard lifecycle (draft/assign/target/submit/approve/exception-edit) each audits under the right email, reason copied', v_pass, v_detail);
end $$;

select name, pass, detail from results order by pass, name;
