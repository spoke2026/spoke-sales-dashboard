-- 0004_rls_test.sql
-- LOCAL TEST ONLY. Never run this on Supabase.
--
-- Run after supabase/test/local_auth_stub.sql, 0001, 0003, and 0004 have been
-- applied. Exercises every "Database behaviour" success criterion in
-- briefs/kpi-scorecard-phase-2a-library.md. Every row in the final result must
-- show pass = true.
--
-- Mechanics, read this before editing a case:
--   * One temp results table, and one DO block per case.
--   * Each case's inner `begin ... exception ... end;` block is where
--     `set local role authenticated` and `set_config('request.jwt.claims', ...)`
--     happen. Postgres treats that inner block as an implicit savepoint: on
--     ANY exception raised inside it (a real one, or the sentinel SQLSTATE
--     'ZZ001' raised deliberately at the end of a successful case), both the
--     role and the jwt claim setting revert automatically, AND every write the
--     case made rolls back with them. That keeps every case independent of
--     every other case in this one file, without a manual `reset role` and
--     without any cleanup statements.
--   * A case that expects success captures what it needs to know (row counts,
--     audit rows found) into plpgsql variables BEFORE raising the sentinel,
--     because plpgsql variables are not part of the transaction and survive
--     the rollback; the write itself does not survive, which is fine, because
--     the point of the case is proven by the variable, not by the row still
--     being there afterwards.
--   * A case that expects a denial doesn't need the sentinel: the real
--     exception (42501, 23514, KP001/2/3) already rolls back its own writes
--     and reverts role/claims via the same savepoint mechanism.
--   * For every 42501 case, SQLERRM is also checked for "row-level security"
--     so a missing grant (which would raise a different permission error, not
--     42501 from a WITH CHECK failure) can't be mistaken for an RLS denial.
--   * Setup rows owned by "the admin" or "another user" are inserted directly
--     under the postgres role (before any `set local role` in that case),
--     which bypasses RLS as a superuser the same way the Supabase SQL editor's
--     owner role does for 0004_remove_test_rows.sql. This is deliberate: it
--     lets a case set up a fixture it does not itself have permission to
--     create, exactly as the SCRIPT SPEC's cleanup script relies on later.

create temp table results (
  name text primary key,
  pass boolean not null,
  detail text
);

-- ─── Positive control ─────────────────────────────────────────────────────
-- A non-admin inserts a bare proposal (no created_by, no created_by_email,
-- no status, no version) and it succeeds, with exactly one matching audit
-- row. This proves the grants and the audit trigger chain work, so every
-- denial below is down to RLS and not a missing grant (rule 14).

do $$
declare
  v_pass boolean;
  v_detail text;
  v_kpi_id uuid;
  v_audit_count int;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    v_kpi_id := gen_random_uuid();
    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source)
    values
      (v_kpi_id, 1, 'ZZ Test positive control', 'Positive control proposal.',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual');

    select count(*) into v_audit_count
      from public.kpi_audit_log
     where entity = 'kpi_definition'
       and action = 'insert'
       and entity_id = v_kpi_id::text
       and actor_email = 'user1@example.test';

    v_pass := (v_audit_count = 1);
    v_detail := format('matching audit rows=%s', v_audit_count);

    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('non-admin proposal succeeds with matching audit row (positive control)', v_pass, v_detail);
end $$;

-- ─── Non-admin insert denials, 42501 ───────────────────────────────────────

-- status 'published'
do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source, status)
    values
      (gen_random_uuid(), 1, 'ZZ Test published insert', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual', 'published');

    v_pass := false;
    v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      -- Deliberately narrower than the other 42501 cases below: a published
      -- insert can ALSO be caught by kpi_audit_log_insert_proposal's own
      -- exists() clause (it requires d.status = 'proposed' too, since it is
      -- reading the just-inserted row back to confirm the audit row is about
      -- a genuine self-made proposal). Checking only "blocked by 42501,
      -- mentions row-level security" would still read true if
      -- kpi_definition_insert_proposal's OWN status check were removed,
      -- because the row would then pass kpi_definition's WITH CHECK, commit
      -- inside the same statement, and only then get caught by the audit
      -- trigger's insert into kpi_audit_log failing RLS in turn -- rejecting
      -- the whole statement all the same, but for the wrong reason, and
      -- proving nothing about THIS policy (rule 15: the mutation must kill
      -- this row for the stated reason). Pinning the table name in the
      -- message is what makes mutation (8) actually flip this row instead of
      -- leaving it accidentally green.
      v_pass := (sqlerrm ilike '%row-level security%' and sqlerrm ilike '%"kpi_definition"%');
      v_detail := 'blocked 42501: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('non-admin inserts published is rejected', v_pass, v_detail);
end $$;

-- version 2 of their own proposal
do $$
declare v_pass boolean; v_detail text; v_kpi_id uuid;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    v_kpi_id := gen_random_uuid();
    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source)
    values
      (v_kpi_id, 1, 'ZZ Test version 2 attempt', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual');

    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source)
    values
      (v_kpi_id, 2, 'ZZ Test version 2 attempt', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual');

    v_pass := false;
    v_detail := 'insert of version 2 unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('non-admin inserts version 2 of their own proposal is rejected', v_pass, v_detail);
end $$;

-- created_by set to another user
do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source, created_by)
    values
      (gen_random_uuid(), 1, 'ZZ Test wrong created_by', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual',
       '00000000-0000-0000-0000-000000000003');

    v_pass := false;
    v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('non-admin insert with created_by of another user is rejected', v_pass, v_detail);
end $$;

-- created_by_email set to another email
do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source, created_by_email)
    values
      (gen_random_uuid(), 1, 'ZZ Test wrong created_by_email', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual',
       'someone-else@example.test');

    v_pass := false;
    v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('non-admin insert with created_by_email of another user is rejected', v_pass, v_detail);
end $$;

-- ─── Non-admin UPDATE of own proposal's status: 0 rows, no error ──────────

do $$
declare v_pass boolean; v_detail text; v_kpi_id uuid; v_count int;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    v_kpi_id := gen_random_uuid();
    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source)
    values
      (v_kpi_id, 1, 'ZZ Test own status update', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual');

    update public.kpi_definition set status = 'published' where id = v_kpi_id and version = 1;
    get diagnostics v_count = row_count;

    v_pass := (v_count = 0);
    v_detail := format('rows updated=%s', v_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('non-admin update of own proposal status affects 0 rows', v_pass, v_detail);
end $$;

-- ─── Non-admin direct INSERT into kpi_audit_log, denied ───────────────────

-- entity 'kpi_team'
do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_audit_log (entity, entity_id, action, actor_id, actor_email)
    values ('kpi_team', gen_random_uuid()::text, 'insert',
            '00000000-0000-0000-0000-000000000002', 'user1@example.test');

    v_pass := false;
    v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('non-admin audit insert for kpi_team is rejected', v_pass, v_detail);
end $$;

-- entity 'kpi_definition' pointing at a KPI the admin created (forgery)
do $$
declare v_pass boolean; v_detail text; v_admin_kpi_id uuid;
begin
  begin
    -- Setup as postgres (superuser, bypasses RLS): an admin-owned proposal.
    v_admin_kpi_id := gen_random_uuid();
    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source,
       status, created_by, created_by_email)
    values
      (v_admin_kpi_id, 1, 'ZZ Test admin owned', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual',
       'proposed', '00000000-0000-0000-0000-000000000001', 'edward@spoke.nz');

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_audit_log (entity, entity_id, action, actor_id, actor_email)
    values ('kpi_definition', v_admin_kpi_id::text, 'insert',
            '00000000-0000-0000-0000-000000000002', 'user1@example.test');

    v_pass := false;
    v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('forge audit row for admin KPI is rejected', v_pass, v_detail);
end $$;

-- actor_email set to someone else, on the caller's own proposal
do $$
declare v_pass boolean; v_detail text; v_kpi_id uuid;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    v_kpi_id := gen_random_uuid();
    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source)
    values
      (v_kpi_id, 1, 'ZZ Test audit forged actor_email', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual');

    insert into public.kpi_audit_log (entity, entity_id, action, actor_id, actor_email)
    values ('kpi_definition', v_kpi_id::text, 'insert',
            '00000000-0000-0000-0000-000000000002', 'someone-else@example.test');

    v_pass := false;
    v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('non-admin audit insert with someone else''s actor_email is rejected', v_pass, v_detail);
end $$;

-- ─── Guard trigger, as admin ───────────────────────────────────────────────

-- Admin UPDATE of name on the latest version raises KP001.
do $$
declare v_pass boolean; v_detail text; v_kpi_id uuid;
begin
  begin
    v_kpi_id := gen_random_uuid();
    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source)
    values
      (v_kpi_id, 1, 'ZZ Test rename in place', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual');

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    update public.kpi_definition set name = 'ZZ Test renamed' where id = v_kpi_id and version = 1;

    v_pass := false;
    v_detail := 'update unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KP001' then
      v_pass := true;
      v_detail := 'blocked KP001: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('admin rename in place raises KP001', v_pass, v_detail);
end $$;

-- Admin UPDATE of status on a superseded version raises KP002.
do $$
declare v_pass boolean; v_detail text; v_kpi_id uuid;
begin
  begin
    v_kpi_id := gen_random_uuid();
    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source, status)
    values
      (v_kpi_id, 1, 'ZZ Test superseded status update', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual', 'published');
    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source, status)
    values
      (v_kpi_id, 2, 'ZZ Test superseded status update', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual', 'published');

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    update public.kpi_definition set status = 'retired' where id = v_kpi_id and version = 1;

    v_pass := false;
    v_detail := 'update unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KP002' then
      v_pass := true;
      v_detail := 'blocked KP002: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('admin status update on a superseded version raises KP002', v_pass, v_detail);
end $$;

-- Admin INSERT of version 3 when only version 1 exists raises KP003.
do $$
declare v_pass boolean; v_detail text; v_kpi_id uuid;
begin
  begin
    v_kpi_id := gen_random_uuid();
    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source)
    values
      (v_kpi_id, 1, 'ZZ Test skip to version 3', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual');

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source)
    values
      (v_kpi_id, 3, 'ZZ Test skip to version 3', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual');

    v_pass := false;
    v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KP003' then
      v_pass := true;
      v_detail := 'blocked KP003: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('admin insert version 3 without version 2 raises KP003', v_pass, v_detail);
end $$;

-- Admin INSERT of version 2, then UPDATE of its status: both succeed, both audited.
do $$
declare
  v_pass boolean; v_detail text; v_kpi_id uuid;
  v_insert_audit_count int; v_update_audit_count int;
begin
  begin
    v_kpi_id := gen_random_uuid();
    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source, status)
    values
      (v_kpi_id, 1, 'ZZ Test version 2 then status', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual', 'published');

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source, status)
    values
      (v_kpi_id, 2, 'ZZ Test version 2 then status renamed', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual', 'published');

    update public.kpi_definition set status = 'retired' where id = v_kpi_id and version = 2;

    select count(*) into v_insert_audit_count
      from public.kpi_audit_log
     where entity = 'kpi_definition' and action = 'insert'
       and entity_id = v_kpi_id::text and actor_email = 'edward@spoke.nz'
       and (after ->> 'version')::int = 2;

    select count(*) into v_update_audit_count
      from public.kpi_audit_log
     where entity = 'kpi_definition' and action = 'update'
       and entity_id = v_kpi_id::text and actor_email = 'edward@spoke.nz'
       and (after ->> 'version')::int = 2 and (after ->> 'status') = 'retired';

    v_pass := (v_insert_audit_count = 1 and v_update_audit_count = 1);
    v_detail := format('insert audit=%s update audit=%s', v_insert_audit_count, v_update_audit_count);

    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('admin insert version 2 and update its status succeeds with audit rows', v_pass, v_detail);
end $$;

-- ─── CHECK constraints, 23514 ──────────────────────────────────────────────

-- source_mapping is a JSON array, not an object
do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source, source_mapping)
    values
      (gen_random_uuid(), 1, 'ZZ Test bad source mapping', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual', '[1]'::jsonb);

    v_pass := false;
    v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '23514' then
      v_pass := true;
      v_detail := 'blocked 23514: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('non-admin insert with source_mapping array fails 23514', v_pass, v_detail);
end $$;

-- example_target is negative
do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source, example_target)
    values
      (gen_random_uuid(), 1, 'ZZ Test negative target', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual', -1);

    v_pass := false;
    v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '23514' then
      v_pass := true;
      v_detail := 'blocked 23514: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('non-admin insert with negative example_target fails 23514', v_pass, v_detail);
end $$;

-- ─── Regression: kpi_person and kpi_team, unchanged from 0003 ─────────────

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_person (full_name) values ('ZZ Test person');

    v_pass := false;
    v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('non-admin insert into kpi_person is rejected', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_team (name) values ('ZZ Test team non-admin');

    v_pass := false;
    v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('non-admin insert into kpi_team is rejected', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_count int;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_team (name) values ('ZZ Test team admin');
    get diagnostics v_count = row_count;

    v_pass := (v_count = 1);
    v_detail := format('rows inserted=%s', v_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('admin insert into kpi_team succeeds', v_pass, v_detail);
end $$;

select name, pass, detail from results order by pass, name;
