-- ═══════════════════════════════════════════════════════════════
-- Sales dashboard — add the missing sales_budget column to targets
--
-- The admin "Edit monthly targets" panel writes a monthly sales budget
-- to public.targets (row rep = 'team', column sales_budget). That column
-- was never created in the live database, so every save failed with
-- PostgREST error PGRST204 "Could not find the 'sales_budget' column".
--
-- This adds the column and gives the KPI columns a default of 0 so the
-- team-budget row can be inserted without supplying calls/visits/pipeline.
-- Idempotent and non-destructive: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

alter table public.targets add column if not exists sales_budget bigint;

-- The team-budget row only sets sales_budget, so the KPI columns need a
-- default (in case they are NOT NULL) for the insert path to succeed.
alter table public.targets alter column calls    set default 0;
alter table public.targets alter column visits   set default 0;
alter table public.targets alter column pipeline set default 0;

-- Force PostgREST to pick up the new column immediately.
notify pgrst, 'reload schema';
