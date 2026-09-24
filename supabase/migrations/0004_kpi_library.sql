-- 0004_kpi_library.sql
-- KPI scorecard, Phase 2a: the KPI library.
--
-- Purely additive to 0003. It adds:
--   * kpi_definition.created_by_email (display only, from the saver's JWT)
--   * five CHECK constraints on kpi_definition (they validate existing rows,
--     so this fails loudly if any existing row breaks one)
--   * public.kpi_definition_guard(), a BEFORE INSERT OR UPDATE trigger that
--     makes versioning a database rule: an existing row may only change its
--     status (KP001), only on its KPI's latest version (KP002), and a new
--     version must follow an existing previous version (KP003)
--   * two narrow insert policies so any signed-in user can propose a brand-new
--     KPI attributed to themselves, and the invoker-rights audit trigger can
--     record that proposal
--
-- It never drops or replaces any 0001 to 0003 object, never touches
-- public.targets or public.is_admin(), and adds no SECURITY DEFINER.
--
-- One transaction, no `if not exists`. A second run fails loudly with
-- "already exists" and rolls back. If this script errors, nothing has changed.

begin;

-- 0. Guard: 0001 and 0003 must already be applied.
do $$
begin
  if to_regprocedure('public.is_admin()') is null
     or to_regclass('public.kpi_definition') is null
     or to_regprocedure('public.kpi_audit_row()') is null then
    raise exception '0004 needs 0001 and 0003';
  end if;
end $$;

-- ─── 1. Column ───────────────────────────────────────────────────────────────

alter table public.kpi_definition
  add column created_by_email text null default (auth.jwt() ->> 'email');

comment on column public.kpi_definition.created_by_email is
  'Email from the JWT of whoever saved this version. Display only. Not an authority.';

-- ─── 2. Constraints ──────────────────────────────────────────────────────────
-- The 8000 limit on source_mapping is deliberately looser than the API's
-- 4,000-character input cap, because Postgres re-serialises jsonb with spaces.

alter table public.kpi_definition
  add constraint kpi_definition_name_length
  check (length(btrim(name)) between 1 and 120);

alter table public.kpi_definition
  add constraint kpi_definition_description_length
  check (length(btrim(description)) between 1 and 1000);

alter table public.kpi_definition
  add constraint kpi_definition_source_mapping_object
  check (source_mapping is null
         or (jsonb_typeof(source_mapping) = 'object' and length(source_mapping::text) <= 8000));

alter table public.kpi_definition
  add constraint kpi_definition_attribution_object
  check (attribution is null
         or (jsonb_typeof(attribution) = 'object' and length(attribution::text) <= 1000));

alter table public.kpi_definition
  add constraint kpi_definition_example_target_non_negative
  check (example_target is null or example_target >= 0);

-- ─── 3. Guard trigger (SECURITY INVOKER, search_path pinned) ─────────────────

create function public.kpi_definition_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.version > 1 and not exists (
      select 1 from public.kpi_definition d
       where d.id = NEW.id and d.version = NEW.version - 1
    ) then
      raise exception 'kpi_definition % version % has no previous version', NEW.id, NEW.version
        using errcode = 'KP003';
    end if;
    return NEW;
  end if;

  if (to_jsonb(NEW) - 'status') is distinct from (to_jsonb(OLD) - 'status') then
    raise exception 'kpi_definition rows are immutable except status'
      using errcode = 'KP001';
  end if;

  if exists (
    select 1 from public.kpi_definition d
     where d.id = OLD.id and d.version > OLD.version
  ) then
    raise exception 'only the latest kpi_definition version can change status'
      using errcode = 'KP002';
  end if;

  return NEW;
end;
$$;

revoke all on function public.kpi_definition_guard() from public, anon;
grant execute on function public.kpi_definition_guard() to authenticated;

create trigger kpi_definition_guard
  before insert or update on public.kpi_definition
  for each row execute function public.kpi_definition_guard();

-- ─── 4. Proposal policies ────────────────────────────────────────────────────
-- Permissive policies are ORed, so the admin's 0003 insert policies are
-- unchanged. A non-admin can only create a brand-new proposal attributed to
-- themselves, and the audit trigger (which runs as the caller) can only record
-- that proposal. Update and delete stay admin-only.

create policy kpi_definition_insert_proposal on public.kpi_definition
  for insert to authenticated
  with check (
    status = 'proposed'
    and version = 1
    and created_by = auth.uid()
    and created_by_email = (auth.jwt() ->> 'email')
  );

create policy kpi_audit_log_insert_proposal on public.kpi_audit_log
  for insert to authenticated
  with check (
    entity = 'kpi_definition'
    and action = 'insert'
    and before is null
    and reason is null
    and actor_id = auth.uid()
    and actor_email = (auth.jwt() ->> 'email')
    and exists (
      select 1 from public.kpi_definition d
       where d.id::text = entity_id
         and d.version = 1
         and d.status = 'proposed'
         and d.created_by = auth.uid()
    )
  );

-- ─── 5. Reload the PostgREST schema cache ────────────────────────────────────
notify pgrst, 'reload schema';

commit;

select '0004 applied' as result;
