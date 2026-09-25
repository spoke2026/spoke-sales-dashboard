-- 0005_rls_test.sql
-- LOCAL TEST ONLY. Never run this on Supabase.
--
-- Run after local_auth_stub.sql, 0001, 0003, 0004, 0005, and
-- 0005_local_seed.sql have been applied. Exercises every "Database
-- behaviour", "Denials", and THE RULE TABLE criterion in
-- briefs/kpi-scorecard-phase-2b-scorecards.md. Every row in the final result
-- must show pass = true.
--
-- Mechanics follow 0004_rls_test.sql exactly: one temp results table, one DO
-- block per case, an inner begin/exception block as the implicit savepoint
-- that reverts `set local role` and `request.jwt.claims` (and rolls back
-- every write the case made) on ANY exception, real or the sentinel ZZ001
-- raised deliberately at the end of a successful case. A case that expects
-- success captures what it needs into plpgsql variables before the sentinel,
-- because those survive the rollback even though the rows don't. A case that
-- expects a denial needs no sentinel: the real exception already unwinds it.
-- Every 42501 case also checks SQLERRM for "row-level security", so a missing
-- grant can't be mistaken for an RLS decision. Fixture rows a case does not
-- itself have permission to create are inserted directly under postgres
-- BEFORE any `set local role` in that case (bypasses RLS as superuser, and
-- since current_user isn't `authenticated`, the D12 guards too -- which is
-- exactly what a locked or submitted fixture needs).
--
-- Fixed UUIDs from 0005_local_seed.sql:
--   Ed 10000000-...0001 (admin), Mia 10000000-...0002 (manager, reports to Ed),
--   Sam 10000000-...0003 (staff, reports to Mia), Nia 10000000-...0004 (no
--   login, reports to Mia), Oli 10000000-...0005 (other, reports to Ed), Dee
--   10000000-...0006 (deactivated case, reports to Mia), Arne 10000000-...0007
--   (company_only).
--   KPIs 20000000-...0001/2 (lead, published), .../3/4/5 (lag/lag/percent,
--   published), .../6 (company, published), .../7 (retired), .../8
--   (proposed), .../9 v1+v2 (versioned, both published).
--   Seed scorecard 30000000-...0001: Sam's draft with one assignment
--   (40000000-...0001, kpi .../1).

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
--   Dee/u4: {"sub":"00000000-0000-0000-0000-000000000005","email":"user4@example.test"}

-- ══════════════════════════════════════════════════════════════════════════
-- Database behaviour: positive controls (rule 14)
-- ══════════════════════════════════════════════════════════════════════════

-- Admin: company scorecard, full board-approval flow.
do $$
declare
  v_pass boolean; v_detail text;
  v_sc uuid; v_asg uuid;
  v_status text; v_kind text; v_approved_by uuid;
  v_audit_count int;
  v_yesterday date := ((now() at time zone 'Pacific/Auckland')::date - 1);
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_scorecard (person_id, fy, quarter)
      values (null, 2029, 4) returning id into v_sc;

    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000006', 1) returning id into v_asg;

    insert into public.kpi_target (assignment_id, month, value) values
      (v_asg, '2029-01-01', 10), (v_asg, '2029-02-01', 20), (v_asg, '2029-03-01', 30);

    update public.kpi_scorecard set status = 'submitted' where id = v_sc;

    update public.kpi_scorecard
       set status = 'locked', approval_kind = 'board',
           board_reference = 'ZZ Test board minutes', board_meeting_date = v_yesterday
     where id = v_sc;

    select status, approval_kind, approved_by into v_status, v_kind, v_approved_by
      from public.kpi_scorecard where id = v_sc;

    select count(*) into v_audit_count
      from public.kpi_audit_log
     where entity = 'kpi_scorecard' and entity_id = v_sc::text
       and actor_email = 'edward@spoke.nz';

    v_pass := (v_status = 'locked' and v_kind = 'board'
               and v_approved_by = '10000000-0000-0000-0000-000000000001'
               and v_audit_count >= 3);
    v_detail := format('status=%s kind=%s approved_by=%s audit_rows=%s',
                        v_status, v_kind, v_approved_by, v_audit_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('admin: company scorecard board-approval flow succeeds end to end', v_pass, v_detail);
end $$;

-- Line manager: draft for a no-login direct report, submit, return, resubmit, approve.
do $$
declare
  v_pass boolean; v_detail text;
  v_sc uuid; v_asg uuid;
  v_status text; v_kind text; v_approved_by uuid; v_submitted_by uuid;
  v_returned_at timestamptz; v_returned_by uuid; v_return_note text;
  v_audit_count int;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000004', 2029, 4) returning id into v_sc;

    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;

    insert into public.kpi_target (assignment_id, month, value) values
      (v_asg, '2029-01-01', 1), (v_asg, '2029-02-01', 2), (v_asg, '2029-03-01', 3);

    update public.kpi_scorecard set status = 'submitted' where id = v_sc;
    update public.kpi_scorecard
       set status = 'draft', return_note = 'ZZ Test please redo January'
     where id = v_sc;
    update public.kpi_scorecard set status = 'submitted' where id = v_sc;
    update public.kpi_scorecard set status = 'locked', approval_kind = 'standard' where id = v_sc;

    select status, approval_kind, approved_by, submitted_by,
           returned_at, returned_by, return_note
      into v_status, v_kind, v_approved_by, v_submitted_by,
           v_returned_at, v_returned_by, v_return_note
      from public.kpi_scorecard where id = v_sc;

    select count(*) into v_audit_count
      from public.kpi_audit_log
     where entity = 'kpi_scorecard' and entity_id = v_sc::text
       and actor_email = 'user1@example.test';

    v_pass := (v_status = 'locked' and v_kind = 'standard'
               and v_approved_by = '10000000-0000-0000-0000-000000000002'
               and v_submitted_by = '10000000-0000-0000-0000-000000000002'
               and v_returned_at is null and v_returned_by is null and v_return_note is null
               and v_audit_count >= 4);
    v_detail := format('status=%s kind=%s approved_by=%s submitted_by=%s return_fields_null=%s audit_rows=%s',
                        v_status, v_kind, v_approved_by, v_submitted_by,
                        (v_returned_at is null and v_returned_by is null and v_return_note is null),
                        v_audit_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('manager: draft, submit, return, resubmit, approve for a no-login report succeeds', v_pass, v_detail);
end $$;

-- Staff with a login: own draft, two KPIs, a 0 target, submit.
do $$
declare
  v_pass boolean; v_detail text;
  v_sc uuid; v_asg1 uuid; v_asg2 uuid;
  v_status text; v_audit_count int;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    -- Sam already has a seeded scorecard at fy2029 quarter4, so this fixture
    -- uses quarter1 (Apr-Jun 2028) instead, to avoid a 23505 collision.
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000003', 2029, 1) returning id into v_sc;

    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000002', 1) returning id into v_asg1;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000003', 1) returning id into v_asg2;

    insert into public.kpi_target (assignment_id, month, value) values
      (v_asg1, '2028-04-01', 0), (v_asg1, '2028-05-01', 5), (v_asg1, '2028-06-01', 5),
      (v_asg2, '2028-04-01', 5), (v_asg2, '2028-05-01', 5), (v_asg2, '2028-06-01', 5);

    update public.kpi_scorecard set status = 'submitted' where id = v_sc;

    select status into v_status from public.kpi_scorecard where id = v_sc;
    select count(*) into v_audit_count
      from public.kpi_audit_log
     where entity_id = v_sc::text and actor_email = 'user2@example.test'
        or (entity = 'kpi_target' and actor_email = 'user2@example.test'
            and entity_id in (select id::text from public.kpi_target where assignment_id in (v_asg1, v_asg2)));

    v_pass := (v_status = 'submitted' and v_audit_count >= 1);
    v_detail := format('status=%s audit_rows=%s', v_status, v_audit_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('staff: own draft with a 0 target submits, audited under their email', v_pass, v_detail);
end $$;

-- Unlinked user: reads work, kpi_scorecard_actions() is '{}' for the seeded scorecard.
do $$
declare
  v_pass boolean; v_detail text;
  v_sc_count int; v_asg_count int; v_tgt_count int; v_actions text[];
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000004","email":"user3@example.test"}', true);
    set local role authenticated;

    select count(*) into v_sc_count from public.kpi_scorecard;
    select count(*) into v_asg_count from public.kpi_assignment;
    select count(*) into v_tgt_count from public.kpi_target;
    select public.kpi_scorecard_actions('30000000-0000-0000-0000-000000000001') into v_actions;

    v_pass := (v_sc_count >= 1 and v_asg_count >= 1 and v_actions = '{}');
    v_detail := format('scorecards=%s assignments=%s targets=%s actions=%s',
                        v_sc_count, v_asg_count, v_tgt_count, v_actions);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then
      v_pass := false;
      v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('unlinked user reads seeded rows, kpi_scorecard_actions is {} for the seeded scorecard', v_pass, v_detail);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- THE RULE TABLE: one fixture per distinct cell, all reachable results proved
-- ══════════════════════════════════════════════════════════════════════════

-- individual, draft: admin, manager, and owner all get {edit,submit}; anyone
-- else gets none.
do $$
declare v_pass boolean; v_detail text; v_sc uuid;
        v_ed text[]; v_mia text[]; v_sam text[]; v_dee text[];
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3) returning id into v_sc;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;
    select public.kpi_scorecard_actions(v_sc) into v_ed;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    select public.kpi_scorecard_actions(v_sc) into v_mia;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    select public.kpi_scorecard_actions(v_sc) into v_sam;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000005","email":"user4@example.test"}', true);
    select public.kpi_scorecard_actions(v_sc) into v_dee;

    v_pass := (v_ed = array['edit', 'submit'] and v_mia = array['edit', 'submit']
               and v_sam = array['edit', 'submit'] and v_dee = '{}');
    v_detail := format('admin=%s manager=%s owner=%s anyone_else=%s', v_ed, v_mia, v_sam, v_dee);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('rule table: individual draft (admin/manager/owner=edit+submit, anyone else=none)', v_pass, v_detail);
end $$;

-- individual, submitted, not the admin's own: admin-not-owner and manager both
-- get {edit,return,approve}; owner and anyone else get none.
do $$
declare v_pass boolean; v_detail text; v_sc uuid;
        v_ed text[]; v_mia text[]; v_sam text[]; v_dee text[];
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter, status, submitted_at, submitted_by)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3, 'submitted', now(),
              '10000000-0000-0000-0000-000000000003')
      returning id into v_sc;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;
    select public.kpi_scorecard_actions(v_sc) into v_ed;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    select public.kpi_scorecard_actions(v_sc) into v_mia;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    select public.kpi_scorecard_actions(v_sc) into v_sam;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000005","email":"user4@example.test"}', true);
    select public.kpi_scorecard_actions(v_sc) into v_dee;

    v_pass := (v_ed = array['edit', 'return', 'approve'] and v_mia = array['edit', 'return', 'approve']
               and v_sam = '{}' and v_dee = '{}');
    v_detail := format('admin_not_owner=%s manager=%s owner=%s anyone_else=%s', v_ed, v_mia, v_sam, v_dee);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('rule table: individual submitted, not admin''s own (admin/manager=edit+return+approve, owner/anyone=none)', v_pass, v_detail);
end $$;

-- individual, submitted, the admin's own: {edit,return,record_board_approval}.
do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_ed text[];
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter, status, submitted_at, submitted_by)
      values ('10000000-0000-0000-0000-000000000001', 2029, 3, 'submitted', now(),
              '10000000-0000-0000-0000-000000000001')
      returning id into v_sc;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;
    select public.kpi_scorecard_actions(v_sc) into v_ed;

    v_pass := (v_ed = array['edit', 'return', 'record_board_approval']);
    v_detail := format('admin_own=%s', v_ed);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('rule table: individual submitted, admin''s own (edit+return+record_board_approval)', v_pass, v_detail);
end $$;

-- individual, locked: admin (owner or not) gets {exception_edit}; manager and
-- owner get none.
do $$
declare v_pass boolean; v_detail text; v_sc_sam uuid; v_sc_ed uuid;
        v_ed_on_sam text[]; v_mia text[]; v_sam text[]; v_ed_on_own text[];
begin
  begin
    insert into public.kpi_scorecard
      (person_id, fy, quarter, status, submitted_at, submitted_by,
       approval_kind, approved_by, approved_at)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3, 'locked', now(),
              '10000000-0000-0000-0000-000000000002', 'standard',
              '10000000-0000-0000-0000-000000000002', now())
      returning id into v_sc_sam;

    insert into public.kpi_scorecard
      (person_id, fy, quarter, status, submitted_at, submitted_by,
       approval_kind, approved_by, approved_at)
      values ('10000000-0000-0000-0000-000000000001', 2029, 3, 'locked', now(),
              '10000000-0000-0000-0000-000000000001', 'standard',
              '10000000-0000-0000-0000-000000000001', now())
      returning id into v_sc_ed;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;
    select public.kpi_scorecard_actions(v_sc_sam) into v_ed_on_sam;
    select public.kpi_scorecard_actions(v_sc_ed) into v_ed_on_own;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    select public.kpi_scorecard_actions(v_sc_sam) into v_mia;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    select public.kpi_scorecard_actions(v_sc_sam) into v_sam;

    v_pass := (v_ed_on_sam = array['exception_edit'] and v_ed_on_own = array['exception_edit']
               and v_mia = '{}' and v_sam = '{}');
    v_detail := format('admin_not_owner=%s admin_own=%s manager=%s owner=%s',
                        v_ed_on_sam, v_ed_on_own, v_mia, v_sam);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('rule table: individual locked (admin=exception_edit regardless of ownership, manager/owner=none)', v_pass, v_detail);
end $$;

-- company, draft / submitted / locked: admin only, {edit,submit} /
-- {edit,return,record_board_approval} / {exception_edit}.
do $$
declare v_pass boolean; v_detail text;
        v_sc_draft uuid; v_sc_sub uuid; v_sc_locked uuid;
        v_draft text[]; v_sub text[]; v_locked text[];
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values (null, 2029, 2) returning id into v_sc_draft;
    insert into public.kpi_scorecard (person_id, fy, quarter, status, submitted_at, submitted_by)
      values (null, 2029, 1, 'submitted', now(), '10000000-0000-0000-0000-000000000001')
      returning id into v_sc_sub;
    insert into public.kpi_scorecard
      (person_id, fy, quarter, status, submitted_at, submitted_by,
       approval_kind, approved_by, approved_at, board_reference, board_meeting_date)
      values (null, 2028, 4, 'locked', now(), '10000000-0000-0000-0000-000000000001',
              'board', '10000000-0000-0000-0000-000000000001', now(),
              'ZZ Test board minutes', (now() at time zone 'Pacific/Auckland')::date - 1)
      returning id into v_sc_locked;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;
    select public.kpi_scorecard_actions(v_sc_draft) into v_draft;
    select public.kpi_scorecard_actions(v_sc_sub) into v_sub;
    select public.kpi_scorecard_actions(v_sc_locked) into v_locked;

    v_pass := (v_draft = array['edit', 'submit']
               and v_sub = array['edit', 'return', 'record_board_approval']
               and v_locked = array['exception_edit']);
    v_detail := format('draft=%s submitted=%s locked=%s', v_draft, v_sub, v_locked);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('rule table: company draft/submitted/locked, admin only', v_pass, v_detail);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Denials: staff
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare v_pass boolean; v_detail text; v_sc uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter, status, submitted_at, submitted_by,
                                       approval_kind, approved_at, approved_by)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3, 'submitted', now(),
              '10000000-0000-0000-0000-000000000003', null, null, null)
      returning id into v_sc;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    update public.kpi_scorecard set status = 'locked', approval_kind = 'standard' where id = v_sc;

    v_pass := false; v_detail := 'update unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS001' then v_pass := true; v_detail := 'blocked KS001: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: staff approving own submitted scorecard is KS001', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter, status, submitted_at, submitted_by)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3, 'submitted', now(),
              '10000000-0000-0000-0000-000000000003')
      returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_target (assignment_id, month, value) values (v_asg, '2029-01-01', 5);

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS001' then v_pass := true; v_detail := 'blocked KS001: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: staff inserting a target on own submitted scorecard is KS001', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000005', 2029, 2);

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
    values ('denial: staff creating a scorecard for another person is 42501', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_count int;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000005', 2029, 2) returning id into v_sc;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    update public.kpi_scorecard set status = 'submitted' where id = v_sc;
    get diagnostics v_count = row_count;

    v_pass := (v_count = 0);
    v_detail := format('rows updated=%s', v_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: staff updating another person''s scorecard affects 0 rows', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000005', 2029, 2) returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_target (assignment_id, month, value) values (v_asg, '2029-01-01', 5);

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
    values ('denial: staff inserting a target on a scorecard they don''t own is 42501', v_pass, v_detail);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Denials: line manager
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    -- Oli reports to Ed, not Mia.
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000005', 2029, 2);

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
    values ('denial: manager creating a scorecard for a non-report is 42501', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_count int;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000005', 2029, 2) returning id into v_sc;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    update public.kpi_scorecard set status = 'submitted' where id = v_sc;
    get diagnostics v_count = row_count;

    v_pass := (v_count = 0);
    v_detail := format('rows updated=%s', v_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: manager editing/approving a scorecard for a non-report affects 0 rows', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter, status, submitted_at, submitted_by)
      values ('10000000-0000-0000-0000-000000000002', 2029, 3, 'submitted', now(),
              '10000000-0000-0000-0000-000000000002')
      returning id into v_sc;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    update public.kpi_scorecard set status = 'locked', approval_kind = 'standard' where id = v_sc;

    v_pass := false; v_detail := 'update unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS001' then v_pass := true; v_detail := 'blocked KS001: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: manager approving their own scorecard is KS001', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid;
begin
  begin
    insert into public.kpi_scorecard
      (person_id, fy, quarter, status, submitted_at, submitted_by,
       approval_kind, approved_by, approved_at)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3, 'locked', now(),
              '10000000-0000-0000-0000-000000000002', 'standard',
              '10000000-0000-0000-0000-000000000002', now())
      returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_target (assignment_id, month, value, change_reason)
      values (v_asg, '2029-01-01', 5, null);

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS001' then
      -- Only the admin gets exception_edit on a locked scorecard (THE RULE
      -- TABLE); a non-admin line manager has no action at all on a locked
      -- report's scorecard, so this falls to the guard's final "else KS001",
      -- never reaching the change_reason check that would raise KS010.
      v_pass := true; v_detail := 'blocked KS001 (no action on a locked scorecard): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: manager (non-admin) inserting a target on a locked report''s scorecard is KS001', v_pass, v_detail);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Denials: admin
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare v_pass boolean; v_detail text; v_sc uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter, status, submitted_at, submitted_by)
      values ('10000000-0000-0000-0000-000000000001', 2029, 3, 'submitted', now(),
              '10000000-0000-0000-0000-000000000001')
      returning id into v_sc;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    update public.kpi_scorecard set status = 'locked', approval_kind = 'standard' where id = v_sc;

    v_pass := false; v_detail := 'update unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS004' then v_pass := true; v_detail := 'blocked KS004: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: admin manager-approving (standard) their own scorecard is KS004', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid;
        v_yesterday date := ((now() at time zone 'Pacific/Auckland')::date - 1);
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter, status, submitted_at, submitted_by)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3, 'submitted', now(),
              '10000000-0000-0000-0000-000000000003')
      returning id into v_sc;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    update public.kpi_scorecard
       set status = 'locked', approval_kind = 'board',
           board_reference = 'ZZ Test board minutes', board_meeting_date = v_yesterday
     where id = v_sc;

    v_pass := false; v_detail := 'update unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS005' then v_pass := true; v_detail := 'blocked KS005: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: admin recording board approval on another person''s scorecard is KS005', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid;
begin
  begin
    insert into public.kpi_scorecard
      (person_id, fy, quarter, status, submitted_at, submitted_by,
       approval_kind, approved_by, approved_at)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3, 'locked', now(),
              '10000000-0000-0000-0000-000000000002', 'standard',
              '10000000-0000-0000-0000-000000000002', now())
      returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_target (assignment_id, month, value, change_reason)
      values (v_asg, '2029-01-01', 5, '  ');

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS010' then v_pass := true; v_detail := 'blocked KS010 (blank reason): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: admin exception-editing a locked scorecard with a blank change_reason is KS010', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid; v_tgt_id uuid; v_reason text;
begin
  begin
    -- Sam already has a seeded scorecard at fy2029 quarter4, so this fixture
    -- uses quarter1 (Apr-Jun 2028) instead, to avoid a 23505 collision.
    insert into public.kpi_scorecard
      (person_id, fy, quarter, status, submitted_at, submitted_by,
       approval_kind, approved_by, approved_at)
      values ('10000000-0000-0000-0000-000000000003', 2029, 1, 'locked', now(),
              '10000000-0000-0000-0000-000000000002', 'standard',
              '10000000-0000-0000-0000-000000000002', now())
      returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_target (assignment_id, month, value, change_reason)
      values (v_asg, '2028-04-01', 5, 'ZZ Test board asked for a lower target')
      returning id into v_tgt_id;

    select reason into v_reason
      from public.kpi_audit_log
     where entity = 'kpi_target' and entity_id = v_tgt_id::text and action = 'insert';

    v_pass := (v_reason = 'ZZ Test board asked for a lower target');
    v_detail := 'reason=' || coalesce(v_reason, 'NULL');
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('admin exception-edit with a real reason succeeds, audit row carries the reason', v_pass, v_detail);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Denials: unlinked and deactivated
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000004","email":"user3@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000004', 2029, 2);

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
    values ('denial: unlinked user creating any scorecard is 42501', v_pass, v_detail);
end $$;

-- Two parts. First, creating a scorecard while deactivated (same shape as the
-- unlinked case: person_id is someone else, so RLS denies via
-- kpi_is_owner_or_manager regardless of activity -- this alone would NOT
-- distinguish "the active check matters" from "Dee is simply unrelated to
-- Nia", so it is not the deciding case, only the parallel one the criteria
-- names). Second, the deciding case (rule 15: constructed so dropping
-- `p.active` from kpi_my_person_id() would make it pass differently): Dee
-- gets her OWN draft scorecard while still active (fixture, as postgres, so
-- the INSERT guard's target-person-active check never runs), is THEN
-- deactivated, and tries to submit her OWN scorecard -- an UPDATE, which the
-- guard never re-checks the target person's activity on. With `p.active` in
-- place, kpi_my_person_id() is null for her, so kpi_is_owner_or_manager(Dee)
-- is false, and the update-scoped RLS policy matches 0 rows. Drop the check
-- and she would resolve to her own id and the update would succeed instead.
do $$
declare v_pass boolean; v_detail text;
begin
  begin
    update public.kpi_person set active = false where id = '10000000-0000-0000-0000-000000000006';

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000005","email":"user4@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000004', 2029, 2);

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501, same shape as unlinked: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: a deactivated person creating a scorecard for someone else is 42501, same shape as unlinked', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_count int;
begin
  begin
    -- Fixture: Dee still active at this point (seed default), owns a draft.
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000006', 2029, 2) returning id into v_sc;

    -- Now deactivate her, as postgres (mirrors the live "set inactive" step).
    update public.kpi_person set active = false where id = '10000000-0000-0000-0000-000000000006';

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000005","email":"user4@example.test"}', true);
    set local role authenticated;

    -- An UPDATE, not an INSERT: the guard's own target-person-active check
    -- (which only runs on INSERT) can't be the reason this is blocked. Only
    -- kpi_my_person_id()'s `p.active` filter decides it.
    update public.kpi_scorecard set status = 'submitted' where id = v_sc;
    get diagnostics v_count = row_count;

    v_pass := (v_count = 0);
    v_detail := format('rows updated=%s (deactivation revokes rights on her own draft, same as being unlinked)', v_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: a deactivated person''s login loses rights over their own already-existing draft', v_pass, v_detail);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Denials: assignment guard (KPI eligibility, KS006)
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare v_pass boolean; v_detail text; v_sc uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3) returning id into v_sc;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000007', 1);

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS006' then v_pass := true; v_detail := 'blocked KS006 (retired): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: adding a retired KPI is KS006', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3) returning id into v_sc;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000008', 1);

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS006' then v_pass := true; v_detail := 'blocked KS006 (proposed): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: adding a proposed KPI is KS006', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3) returning id into v_sc;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    -- version 1 of a KPI whose latest published version is 2.
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000009', 1);

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS006' then v_pass := true; v_detail := 'blocked KS006 (superseded version): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: adding version 1 of a KPI whose latest is version 2 is KS006', v_pass, v_detail);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Denials: scorecard creation guard (KS007, KS008, 23505)
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000007', 2029, 2);

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS007' then v_pass := true; v_detail := 'blocked KS007 (company_only person): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: creating a scorecard for a company_only person is KS007', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    update public.kpi_person set active = false where id = '10000000-0000-0000-0000-000000000005';

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000005', 2029, 2);

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS007' then v_pass := true; v_detail := 'blocked KS007 (inactive person): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: creating a scorecard for an inactive person is KS007', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000005', 2031, 1);

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS008' then v_pass := true; v_detail := 'blocked KS008 (quarter not covered): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: creating a scorecard for fy 2031 quarter 1 is KS008 (calendar does not cover it)', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000005', 2029, 2);
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000005', 2029, 2);

    v_pass := false; v_detail := 'second insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '23505' then v_pass := true; v_detail := 'blocked 23505 (duplicate): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: a second scorecard for the same person and quarter is 23505', v_pass, v_detail);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Denials: target guard (KS009, immutability KS011)
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3) returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    -- Scorecard is FY29 Q4 (Jan-Mar 2029); April is outside the quarter.
    insert into public.kpi_target (assignment_id, month, value) values (v_asg, '2029-04-01', 5);

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS009' then v_pass := true; v_detail := 'blocked KS009: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: a target for a month outside the scorecard''s quarter is KS009', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid; v_tgt uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000001', 2029, 3) returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;
    insert into public.kpi_target (assignment_id, month, value) values (v_asg, '2029-01-01', 5)
      returning id into v_tgt;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    update public.kpi_target set value = 6 where id = v_tgt;

    v_pass := false; v_detail := 'update unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS011' then v_pass := true; v_detail := 'blocked KS011 (target update): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: any UPDATE of a kpi_target row by the admin is KS011', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000001', 2029, 3) returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    update public.kpi_assignment set sort_order = 9 where id = v_asg;

    v_pass := false; v_detail := 'update unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS011' then v_pass := true; v_detail := 'blocked KS011 (assignment update): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: any UPDATE of a kpi_assignment row by the admin is KS011', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid; v_tgt uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000001', 2029, 3) returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;
    insert into public.kpi_target (assignment_id, month, value) values (v_asg, '2029-01-01', 5)
      returning id into v_tgt;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    -- Direct delete, not through kpi_remove_assignment: kpi.removing_assignment
    -- is unset, so this must be rejected regardless of admin rights.
    delete from public.kpi_target where id = v_tgt;

    v_pass := false; v_detail := 'delete unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS011' then v_pass := true; v_detail := 'blocked KS011 (direct target delete): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: a direct DELETE of a kpi_target row by the admin, outside kpi_remove_assignment, is KS011', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter, status, submitted_at, submitted_by)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3, 'submitted', now(),
              '10000000-0000-0000-0000-000000000003')
      returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;
    insert into public.kpi_target (assignment_id, month, value) values
      (v_asg, '2029-01-01', 5), (v_asg, '2029-02-01', 5);
      -- 2029-03-01 deliberately missing

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    update public.kpi_scorecard set status = 'locked', approval_kind = 'standard' where id = v_sc;

    v_pass := false; v_detail := 'update unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS002' then v_pass := true; v_detail := 'blocked KS002 (missing target): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: approving with one (assignment, month) missing a target is KS002', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3) returning id into v_sc;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    update public.kpi_scorecard set status = 'submitted' where id = v_sc;

    v_pass := false; v_detail := 'submit unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS003' then v_pass := true; v_detail := 'blocked KS003 (submit, no KPIs): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: submitting with no KPIs is KS003', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid;
begin
  begin
    -- Built directly as submitted, bypassing the submit transition, so it
    -- reaches the approve transition with zero assignments.
    insert into public.kpi_scorecard (person_id, fy, quarter, status, submitted_at, submitted_by)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3, 'submitted', now(),
              '10000000-0000-0000-0000-000000000003')
      returning id into v_sc;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    update public.kpi_scorecard set status = 'locked', approval_kind = 'standard' where id = v_sc;

    v_pass := false; v_detail := 'approve unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS003' then v_pass := true; v_detail := 'blocked KS003 (approve, no KPIs): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: approving with no KPIs is KS003', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter, status, submitted_at, submitted_by)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3, 'submitted', now(),
              '10000000-0000-0000-0000-000000000003')
      returning id into v_sc;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    update public.kpi_scorecard set status = 'draft', return_note = null where id = v_sc;

    v_pass := false; v_detail := 'return unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS012' then v_pass := true; v_detail := 'blocked KS012: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: returning with return_note null is KS012', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter, status, submitted_at, submitted_by)
      values (null, 2029, 3, 'submitted', now(), '10000000-0000-0000-0000-000000000001')
      returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000006', 1) returning id into v_asg;
    insert into public.kpi_target (assignment_id, month, value) values
      (v_asg, '2029-01-01', 5), (v_asg, '2029-02-01', 5), (v_asg, '2029-03-01', 5);

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    update public.kpi_scorecard
       set status = 'locked', approval_kind = 'board', board_meeting_date = null,
           board_reference = null
     where id = v_sc;

    v_pass := false; v_detail := 'board approval unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS014' then v_pass := true; v_detail := 'blocked KS014 (board_reference null): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: board approval with board_reference null is KS014', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid;
        v_tomorrow date := ((now() at time zone 'Pacific/Auckland')::date + 1);
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter, status, submitted_at, submitted_by)
      values (null, 2029, 3, 'submitted', now(), '10000000-0000-0000-0000-000000000001')
      returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000006', 1) returning id into v_asg;
    insert into public.kpi_target (assignment_id, month, value) values
      (v_asg, '2029-01-01', 5), (v_asg, '2029-02-01', 5), (v_asg, '2029-03-01', 5);

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    update public.kpi_scorecard
       set status = 'locked', approval_kind = 'board', board_meeting_date = v_tomorrow,
           board_reference = 'ZZ Test board minutes'
     where id = v_sc;

    v_pass := false; v_detail := 'board approval unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS013' then v_pass := true; v_detail := 'blocked KS013 (tomorrow''s date): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: board approval with tomorrow''s NZ date is KS013', v_pass, v_detail);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- D7 stamping and D13 lifecycle-column assignment
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid; v_tgt uuid;
        v_effective_from timestamptz; v_created_by uuid;
begin
  begin
    -- Sam already has a seeded scorecard at fy2029 quarter4, so this fixture
    -- uses quarter1 (Apr-Jun 2028) instead, to avoid a 23505 collision.
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000003', 2029, 1) returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    -- The insert lies about effective_from and created_by. Both are stamped
    -- by the guard, which runs BEFORE RLS's WITH CHECK on created_by.
    insert into public.kpi_target (assignment_id, month, value, effective_from, created_by)
      values (v_asg, '2028-04-01', 5, '2020-01-01', '00000000-0000-0000-0000-000000000001')
      returning id into v_tgt;

    select effective_from, created_by into v_effective_from, v_created_by
      from public.kpi_target where id = v_tgt;

    v_pass := (v_effective_from > now() - interval '1 second' and v_effective_from <= now()
               and v_created_by = '00000000-0000-0000-0000-000000000003');
    v_detail := format('effective_from=%s (within 1s of now=%s) created_by=%s',
                        v_effective_from, now(), v_created_by);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('D7: a staff insert claiming a past effective_from and another user''s id is stamped honestly', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3) returning id into v_sc;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    update public.kpi_scorecard set person_id = '10000000-0000-0000-0000-000000000005' where id = v_sc;

    v_pass := false; v_detail := 'update unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS011' then v_pass := true; v_detail := 'blocked KS011 (person_id change): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: an UPDATE that changes person_id is KS011', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_scorecard (person_id, fy, quarter, status)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3, 'locked');

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS011' then v_pass := true; v_detail := 'blocked KS011 (insert with status locked): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: an INSERT with status ''locked'' is KS011', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid;
        v_kind text; v_approved_by uuid;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3) returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1);

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    update public.kpi_scorecard
       set status = 'submitted', approval_kind = 'board',
           approved_by = '10000000-0000-0000-0000-000000000003'
     where id = v_sc;

    select approval_kind, approved_by into v_kind, v_approved_by
      from public.kpi_scorecard where id = v_sc;

    v_pass := (v_kind is null and v_approved_by is null);
    v_detail := format('approval_kind=%s approved_by=%s (guard assigns lifecycle columns, D13)',
                        coalesce(v_kind, 'NULL'), coalesce(v_approved_by::text, 'NULL'));
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('D13: a staff submit that also sets approval_kind/approved_by is stored with both null', v_pass, v_detail);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Audit gate (D6)
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_audit_log (entity, entity_id, action, actor_id, actor_email)
      values ('kpi_scorecard', gen_random_uuid()::text, 'insert',
              '00000000-0000-0000-0000-000000000001', 'edward@spoke.nz');

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
    values ('audit gate: direct INSERT into kpi_audit_log is rejected 42501 for the admin', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_audit_log (entity, entity_id, action, actor_id, actor_email)
      values ('kpi_scorecard', gen_random_uuid()::text, 'insert',
              '00000000-0000-0000-0000-000000000002', 'user1@example.test');

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
    values ('audit gate: direct INSERT into kpi_audit_log is rejected 42501 for the manager', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_audit_log (entity, entity_id, action, actor_id, actor_email)
      values ('kpi_scorecard', gen_random_uuid()::text, 'insert',
              '00000000-0000-0000-0000-000000000003', 'user2@example.test');

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
    values ('audit gate: direct INSERT into kpi_audit_log is rejected 42501 for the staff', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000004","email":"user3@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_audit_log (entity, entity_id, action, actor_id, actor_email)
      values ('kpi_scorecard', gen_random_uuid()::text, 'insert',
              '00000000-0000-0000-0000-000000000004', 'user3@example.test');

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
    values ('audit gate: direct INSERT into kpi_audit_log is rejected 42501 for the unlinked user', v_pass, v_detail);
end $$;

-- The one-transaction reset case: a staff target insert (which writes its own
-- audit row through the gate) followed, in the SAME subblock/transaction, by
-- a direct audit insert -- the second must be rejected, proving the gate is
-- reset right after the trigger's own insert, not left open for the rest of
-- the transaction.
do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid;
begin
  begin
    -- Sam already has a seeded scorecard at fy2029 quarter4, so this fixture
    -- uses quarter1 (Apr-Jun 2028) instead, to avoid a 23505 collision.
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000003', 2029, 1) returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_target (assignment_id, month, value) values (v_asg, '2028-04-01', 5);

    -- Same transaction, straight after: the gate must already be reset.
    insert into public.kpi_audit_log (entity, entity_id, action, actor_id, actor_email)
      values ('kpi_target', gen_random_uuid()::text, 'insert',
              '00000000-0000-0000-0000-000000000003', 'user2@example.test');

    v_pass := false; v_detail := 'second (direct) insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '42501' then
      v_pass := (sqlerrm ilike '%row-level security%');
      v_detail := 'blocked 42501, gate reset after the trigger''s own insert: ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('audit gate: the one-transaction reset blocks a direct insert right after an audited write', v_pass, v_detail);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- kpi_remove_assignment()
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_pass boolean; v_detail text; v_sc uuid; v_asg uuid; v_tgt1 uuid; v_tgt2 uuid;
  v_removed int; v_asg_count int; v_tgt_count int; v_audit_del_count int;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3) returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;
    insert into public.kpi_target (assignment_id, month, value) values (v_asg, '2029-01-01', 5)
      returning id into v_tgt1;
    insert into public.kpi_target (assignment_id, month, value) values (v_asg, '2029-02-01', 5)
      returning id into v_tgt2;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
    set local role authenticated;

    select public.kpi_remove_assignment(v_asg) into v_removed;
    select count(*) into v_asg_count from public.kpi_assignment where id = v_asg;
    select count(*) into v_tgt_count from public.kpi_target where assignment_id = v_asg;
    select count(*) into v_audit_del_count
      from public.kpi_audit_log
     where action = 'delete' and entity_id in (v_tgt1::text, v_tgt2::text, v_asg::text);

    v_pass := (v_removed = 1 and v_asg_count = 0 and v_tgt_count = 0 and v_audit_del_count = 3);
    v_detail := format('removed=%s assignments_left=%s targets_left=%s delete_audit_rows=%s',
                        v_removed, v_asg_count, v_tgt_count, v_audit_del_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('kpi_remove_assignment on a draft deletes the assignment and its targets, returns 1, audits each delete', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid; v_removed int; v_tgt_count int;
begin
  begin
    insert into public.kpi_scorecard
      (person_id, fy, quarter, status, submitted_at, submitted_by,
       approval_kind, approved_by, approved_at)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3, 'locked', now(),
              '10000000-0000-0000-0000-000000000002', 'standard',
              '10000000-0000-0000-0000-000000000002', now())
      returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;
    insert into public.kpi_target (assignment_id, month, value) values (v_asg, '2029-01-01', 5);

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    begin
      perform public.kpi_remove_assignment(v_asg);
      v_pass := false; v_detail := 'call unexpectedly succeeded';
    exception
      when sqlstate 'KS001' then
        select count(*) into v_tgt_count from public.kpi_target where assignment_id = v_asg;
        v_pass := (v_tgt_count = 1);
        v_detail := 'blocked KS001, targets untouched: ' || sqlerrm;
    end;

    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('kpi_remove_assignment on a locked scorecard is KS001 and deletes nothing', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid; v_removed int; v_asg_count int;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter)
      values ('10000000-0000-0000-0000-000000000005', 2029, 3) returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;

    -- Oli's manager is Ed, not Mia: Mia has no rights over this scorecard.
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    select public.kpi_remove_assignment(v_asg) into v_removed;
    select count(*) into v_asg_count from public.kpi_assignment where id = v_asg;

    v_pass := (v_removed = 0 and v_asg_count = 1);
    v_detail := format('removed=%s assignment_still_there=%s', v_removed, v_asg_count = 1);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('kpi_remove_assignment called by a user with no rights returns 0 and deletes nothing', v_pass, v_detail);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Regression: the 2a positive control and its guardrails still hold
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare v_pass boolean; v_detail text; v_kpi_id uuid; v_audit_count int;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    v_kpi_id := gen_random_uuid();
    insert into public.kpi_definition
      (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source)
    values
      (v_kpi_id, 1, 'ZZ Test 2b regression proposal', 'desc',
       'lead', 'count', 'higher', 'sum', 'working_days', 'manual');

    select count(*) into v_audit_count
      from public.kpi_audit_log
     where entity = 'kpi_definition' and action = 'insert'
       and entity_id = v_kpi_id::text and actor_email = 'user1@example.test';

    v_pass := (v_audit_count = 1);
    v_detail := format('matching audit rows=%s', v_audit_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('regression: a non-admin KPI proposal still succeeds with one audit row', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_person (full_name) values ('ZZ Test regression person');

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
    values ('regression: a non-admin insert into kpi_person is still rejected 42501', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"user1@example.test"}', true);
    set local role authenticated;

    insert into public.kpi_team (name) values ('ZZ Test 2b regression team non-admin');

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
    values ('regression: a non-admin insert into kpi_team is still rejected 42501', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text; v_team_id uuid; v_audit_count int;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_team (name) values ('ZZ Test 2b regression team admin') returning id into v_team_id;

    select count(*) into v_audit_count
      from public.kpi_audit_log
     where entity = 'kpi_team' and action = 'insert'
       and entity_id = v_team_id::text and actor_email = 'edward@spoke.nz';

    v_pass := (v_audit_count = 1);
    v_detail := format('matching audit rows=%s', v_audit_count);
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('regression: an admin insert into kpi_team still succeeds with an audit row', v_pass, v_detail);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- FK checks (as postgres, where the guard's role check skips the guard)
-- ══════════════════════════════════════════════════════════════════════════

-- Each fixture below is otherwise CHECK-constraint-consistent (locked_shape /
-- submitted_shape / return_shape all satisfied with real values), so the
-- FK is the only constraint left to fail -- 23503, not 23514 (rule 15: the
-- naive "just set the *_by column" fixture would hit the wrong constraint
-- first and prove nothing about the FK at all).

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    insert into public.kpi_scorecard
      (person_id, fy, quarter, status, submitted_at, submitted_by,
       approval_kind, approved_by, approved_at)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3, 'locked', now(),
              '10000000-0000-0000-0000-000000000003', 'standard', gen_random_uuid(), now());

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '23503' then v_pass := true; v_detail := 'blocked 23503 (approved_by): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('FK: approved_by rejects a uuid that isn''t a kpi_person id with 23503', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    insert into public.kpi_scorecard (person_id, fy, quarter, status, submitted_at, submitted_by)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3, 'submitted', now(), gen_random_uuid());

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '23503' then v_pass := true; v_detail := 'blocked 23503 (submitted_by): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('FK: submitted_by rejects a uuid that isn''t a kpi_person id with 23503', v_pass, v_detail);
end $$;

do $$
declare v_pass boolean; v_detail text;
begin
  begin
    insert into public.kpi_scorecard
      (person_id, fy, quarter, status, returned_at, returned_by, return_note)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3, 'draft', now(),
              gen_random_uuid(), 'ZZ Test FK check');

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate '23503' then v_pass := true; v_detail := 'blocked 23503 (returned_by): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('FK: returned_by rejects a uuid that isn''t a kpi_person id with 23503', v_pass, v_detail);
end $$;

-- ─── Rule table, one row per persona x state cell ─────────────────────────
-- Every cell of THE RULE TABLE as its own named row, so a single wrong cell
-- names itself. Fixtures are inserted as postgres (guards skip, D12) with
-- valid lifecycle columns. Actors: Ed = admin (…001), Mia = line manager
-- (…002, manages Sam), Sam = owner (…003). "Anyone else" on an individual
-- scorecard is Sam acting on Oli's (Oli reports to Ed); on the company
-- scorecard the line-manager column is Mia and anyone else is Sam.
do $$
declare
  c record;
  v_sc uuid;
  v_actions text[];
  v_pass boolean;
  v_detail text;
begin
  for c in
    select * from (values
      ('individual draft, admin not owner',     '10000000-0000-0000-0000-000000000005'::uuid, 'draft',     '00000000-0000-0000-0000-000000000001', 'edward@spoke.nz',    '{edit,submit}'::text[]),
      ('individual draft, admin own',           '10000000-0000-0000-0000-000000000001'::uuid, 'draft',     '00000000-0000-0000-0000-000000000001', 'edward@spoke.nz',    '{edit,submit}'::text[]),
      ('individual draft, line manager',        '10000000-0000-0000-0000-000000000003'::uuid, 'draft',     '00000000-0000-0000-0000-000000000002', 'user1@example.test', '{edit,submit}'::text[]),
      ('individual draft, owner',               '10000000-0000-0000-0000-000000000003'::uuid, 'draft',     '00000000-0000-0000-0000-000000000003', 'user2@example.test', '{edit,submit}'::text[]),
      ('individual draft, anyone else',         '10000000-0000-0000-0000-000000000005'::uuid, 'draft',     '00000000-0000-0000-0000-000000000003', 'user2@example.test', '{}'::text[]),
      ('individual submitted, admin not owner', '10000000-0000-0000-0000-000000000005'::uuid, 'submitted', '00000000-0000-0000-0000-000000000001', 'edward@spoke.nz',    '{edit,return,approve}'::text[]),
      ('individual submitted, admin own',       '10000000-0000-0000-0000-000000000001'::uuid, 'submitted', '00000000-0000-0000-0000-000000000001', 'edward@spoke.nz',    '{edit,return,record_board_approval}'::text[]),
      ('individual submitted, line manager',    '10000000-0000-0000-0000-000000000003'::uuid, 'submitted', '00000000-0000-0000-0000-000000000002', 'user1@example.test', '{edit,return,approve}'::text[]),
      ('individual submitted, owner',           '10000000-0000-0000-0000-000000000003'::uuid, 'submitted', '00000000-0000-0000-0000-000000000003', 'user2@example.test', '{}'::text[]),
      ('individual submitted, anyone else',     '10000000-0000-0000-0000-000000000005'::uuid, 'submitted', '00000000-0000-0000-0000-000000000003', 'user2@example.test', '{}'::text[]),
      ('individual locked, admin not owner',    '10000000-0000-0000-0000-000000000005'::uuid, 'locked',    '00000000-0000-0000-0000-000000000001', 'edward@spoke.nz',    '{exception_edit}'::text[]),
      ('individual locked, admin own',          '10000000-0000-0000-0000-000000000001'::uuid, 'locked',    '00000000-0000-0000-0000-000000000001', 'edward@spoke.nz',    '{exception_edit}'::text[]),
      ('individual locked, line manager',       '10000000-0000-0000-0000-000000000003'::uuid, 'locked',    '00000000-0000-0000-0000-000000000002', 'user1@example.test', '{}'::text[]),
      ('individual locked, owner',              '10000000-0000-0000-0000-000000000003'::uuid, 'locked',    '00000000-0000-0000-0000-000000000003', 'user2@example.test', '{}'::text[]),
      ('individual locked, anyone else',        '10000000-0000-0000-0000-000000000005'::uuid, 'locked',    '00000000-0000-0000-0000-000000000003', 'user2@example.test', '{}'::text[]),
      ('company draft, admin',                  null::uuid, 'draft',     '00000000-0000-0000-0000-000000000001', 'edward@spoke.nz',    '{edit,submit}'::text[]),
      ('company draft, line manager',           null::uuid, 'draft',     '00000000-0000-0000-0000-000000000002', 'user1@example.test', '{}'::text[]),
      ('company draft, anyone else',            null::uuid, 'draft',     '00000000-0000-0000-0000-000000000003', 'user2@example.test', '{}'::text[]),
      ('company submitted, admin',              null::uuid, 'submitted', '00000000-0000-0000-0000-000000000001', 'edward@spoke.nz',    '{edit,return,record_board_approval}'::text[]),
      ('company submitted, line manager',       null::uuid, 'submitted', '00000000-0000-0000-0000-000000000002', 'user1@example.test', '{}'::text[]),
      ('company submitted, anyone else',        null::uuid, 'submitted', '00000000-0000-0000-0000-000000000003', 'user2@example.test', '{}'::text[]),
      ('company locked, admin',                 null::uuid, 'locked',    '00000000-0000-0000-0000-000000000001', 'edward@spoke.nz',    '{exception_edit}'::text[]),
      ('company locked, line manager',          null::uuid, 'locked',    '00000000-0000-0000-0000-000000000002', 'user1@example.test', '{}'::text[]),
      ('company locked, anyone else',           null::uuid, 'locked',    '00000000-0000-0000-0000-000000000003', 'user2@example.test', '{}'::text[])
    ) as t(label, person_id, status, sub, email, expected)
  loop
    begin
      insert into public.kpi_scorecard
        (person_id, fy, quarter, status, submitted_at, submitted_by,
         approval_kind, approved_by, approved_at, board_reference, board_meeting_date)
      values (
        c.person_id, 2028, 1, c.status,
        case when c.status = 'draft' then null else now() end,
        case when c.status = 'draft' then null else '10000000-0000-0000-0000-000000000001'::uuid end,
        case when c.status = 'locked' then (case when c.person_id is null then 'board' else 'standard' end) end,
        case when c.status = 'locked' then '10000000-0000-0000-0000-000000000001'::uuid end,
        case when c.status = 'locked' then now() end,
        case when c.status = 'locked' and c.person_id is null then 'ZZ Test board minutes' end,
        case when c.status = 'locked' and c.person_id is null then date '2026-01-15' end)
      returning id into v_sc;

      perform set_config('request.jwt.claims', json_build_object('sub', c.sub, 'email', c.email)::text, true);
      set local role authenticated;
      select public.kpi_scorecard_actions(v_sc) into v_actions;

      v_pass := v_actions = c.expected;
      v_detail := format('expected=%s actual=%s', c.expected, v_actions);
      raise exception using errcode = 'ZZ001';
    exception
      when sqlstate 'ZZ001' then null;
      when others then v_pass := false; v_detail := 'unexpected ' || sqlstate || ': ' || sqlerrm;
    end;
    insert into results (name, pass, detail) values ('rule table cell: ' || c.label, v_pass, v_detail);
  end loop;
end $$;

-- KS011 for fy and quarter changes (person_id is covered above).
do $$
declare c record; v_sc uuid; v_pass boolean; v_detail text;
begin
  for c in select * from (values ('fy', 'fy = 2028'), ('quarter', 'quarter = 1')) as t(col, set_clause) loop
    begin
      insert into public.kpi_scorecard (person_id, fy, quarter)
        values ('10000000-0000-0000-0000-000000000003', 2029, 3) returning id into v_sc;
      perform set_config('request.jwt.claims',
        '{"sub":"00000000-0000-0000-0000-000000000003","email":"user2@example.test"}', true);
      set local role authenticated;
      execute format('update public.kpi_scorecard set %s where id = %L', c.set_clause, v_sc);
      v_pass := false; v_detail := 'update unexpectedly succeeded';
      raise exception using errcode = 'ZZ001';
    exception
      when sqlstate 'KS011' then v_pass := true; v_detail := 'blocked KS011 (' || c.col || ' change): ' || sqlerrm;
      when sqlstate 'ZZ001' then null;
      when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
    end;
    insert into results (name, pass, detail)
      values ('denial: an UPDATE that changes ' || c.col || ' is KS011', v_pass, v_detail);
  end loop;
end $$;

-- KS010 with change_reason null (the blank case is covered above).
do $$
declare v_pass boolean; v_detail text; v_sc uuid; v_asg uuid;
begin
  begin
    insert into public.kpi_scorecard
      (person_id, fy, quarter, status, submitted_at, submitted_by,
       approval_kind, approved_by, approved_at)
      values ('10000000-0000-0000-0000-000000000003', 2029, 3, 'locked', now(),
              '10000000-0000-0000-0000-000000000002', 'standard',
              '10000000-0000-0000-0000-000000000002', now())
      returning id into v_sc;
    insert into public.kpi_assignment (scorecard_id, kpi_definition_id, kpi_version)
      values (v_sc, '20000000-0000-0000-0000-000000000001', 1) returning id into v_asg;

    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"edward@spoke.nz"}', true);
    set local role authenticated;

    insert into public.kpi_target (assignment_id, month, value, change_reason)
      values (v_asg, '2029-01-01', 5, null);

    v_pass := false; v_detail := 'insert unexpectedly succeeded';
    raise exception using errcode = 'ZZ001';
  exception
    when sqlstate 'KS010' then v_pass := true; v_detail := 'blocked KS010 (null reason): ' || sqlerrm;
    when sqlstate 'ZZ001' then null;
    when others then v_pass := false; v_detail := 'wrong error ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into results (name, pass, detail)
    values ('denial: admin exception-editing a locked scorecard with change_reason null is KS010', v_pass, v_detail);
end $$;

select name, pass, detail from results order by pass, name;
