-- 0005_local_seed.sql
-- LOCAL TEST ONLY. Never run this on Supabase.
--
-- Run after local_auth_stub.sql, 0001, 0003, 0004, and 0005. Adds two more
-- auth users (unlinked, and the deactivation case) alongside the stub's three,
-- then seeds people and KPIs, as postgres (bypasses RLS and, since current_user
-- is not `authenticated`, the D12 guards too -- which is exactly what a fixture
-- needs: a pre-existing draft scorecard with no lifecycle history).
--
-- Fixed UUIDs throughout, so supabase/test/0005_rls_test.sql and
-- supabase/test/0005_rest_test.mjs can reference fixtures directly without a
-- lookup query.

do $$
begin
  if not exists (select 1 from auth.users where email = 'user2@example.test') then
    raise exception 'LOCAL TEST ONLY. Never run this on Supabase. (run local_auth_stub.sql first)';
  end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000004', 'user3@example.test'),
  ('00000000-0000-0000-0000-000000000005', 'user4@example.test');

-- ─── People ──────────────────────────────────────────────────────────────────
-- Ed = admin (edward@spoke.nz, no manager). Mia = line manager, reports to Ed.
-- Sam = staff with a login, reports to Mia. Nia = no login, reports to Mia.
-- Oli = "other", reports to Ed (used as a person neither Mia nor Sam may
-- touch). Dee = seeded active, deactivated mid-test by a case that needs it.
-- Arne = company_only (never gets an individual scorecard).

insert into public.kpi_person
  (id, full_name, email, manager_id, scorecard_type, active)
values
  ('10000000-0000-0000-0000-000000000001', 'Ed', 'edward@spoke.nz', null, 'individual', true),
  ('10000000-0000-0000-0000-000000000002', 'ZZ Test manager', 'user1@example.test',
     '10000000-0000-0000-0000-000000000001', 'individual', true),
  ('10000000-0000-0000-0000-000000000003', 'ZZ Test staff', 'user2@example.test',
     '10000000-0000-0000-0000-000000000002', 'individual', true),
  ('10000000-0000-0000-0000-000000000004', 'ZZ Test no login', null,
     '10000000-0000-0000-0000-000000000002', 'individual', true),
  ('10000000-0000-0000-0000-000000000005', 'ZZ Test other', null,
     '10000000-0000-0000-0000-000000000001', 'individual', true),
  ('10000000-0000-0000-0000-000000000006', 'ZZ Test deactivated', 'user4@example.test',
     '10000000-0000-0000-0000-000000000002', 'individual', true),
  ('10000000-0000-0000-0000-000000000007', 'ZZ Test company only', null,
     null, 'company_only', true);

-- ─── KPIs ────────────────────────────────────────────────────────────────────

insert into public.kpi_definition
  (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source, status)
values
  ('20000000-0000-0000-0000-000000000001', 1, 'ZZ Test lead A', 'desc',
     'lead', 'count', 'higher', 'sum', 'working_days', 'manual', 'published'),
  ('20000000-0000-0000-0000-000000000002', 1, 'ZZ Test lead B', 'desc',
     'lead', 'count', 'higher', 'sum', 'working_days', 'manual', 'published'),
  ('20000000-0000-0000-0000-000000000003', 1, 'ZZ Test lag A', 'desc',
     'lag', 'count', 'higher', 'sum', 'working_days', 'manual', 'published'),
  ('20000000-0000-0000-0000-000000000004', 1, 'ZZ Test lag B', 'desc',
     'lag', 'currency', 'higher', 'sum', 'working_days', 'manual', 'published'),
  ('20000000-0000-0000-0000-000000000005', 1, 'ZZ Test percent', 'desc',
     'lag', 'percent', 'higher', 'ratio', 'working_days', 'manual', 'published'),
  ('20000000-0000-0000-0000-000000000007', 1, 'ZZ Test retired', 'desc',
     'lead', 'count', 'higher', 'sum', 'working_days', 'manual', 'retired'),
  ('20000000-0000-0000-0000-000000000008', 1, 'ZZ Test proposed', 'desc',
     'lead', 'count', 'higher', 'sum', 'working_days', 'manual', 'proposed'),
  ('20000000-0000-0000-0000-000000000009', 1, 'ZZ Test versioned', 'desc',
     'lead', 'count', 'higher', 'sum', 'working_days', 'manual', 'published');

insert into public.kpi_definition
  (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source, status, attribution)
values
  ('20000000-0000-0000-0000-000000000006', 1, 'ZZ Test company KPI', 'desc',
     'lag', 'count', 'higher', 'sum', 'working_days', 'manual', 'published', '{"method":"company"}'::jsonb);

insert into public.kpi_definition
  (id, version, name, description, kpi_type, unit, direction, aggregation, phasing, source, status)
values
  ('20000000-0000-0000-0000-000000000009', 2, 'ZZ Test versioned', 'desc',
     'lead', 'count', 'higher', 'sum', 'working_days', 'manual', 'published');

-- ─── Fixture scorecard: Sam's draft, one KPI, no targets ───────────────────
-- For the read and REST checks (unlinked SELECT, kpi_scorecard_actions '{}').

insert into public.kpi_scorecard (id, person_id, fy, quarter, status)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 2029, 4, 'draft');

insert into public.kpi_assignment (id, scorecard_id, kpi_definition_id, kpi_version, sort_order)
values ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001', 1, 0);

select '0005 local seed applied' as result;
