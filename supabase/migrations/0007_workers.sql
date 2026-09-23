-- ============================================================================
-- 0007_workers.sql — worker and per-person limits, adjustable from /admin
--
-- Both used to be fixed: MAX_CONCURRENT_RUNS from the environment, and one run
-- per person hardcoded. They live on the same singleton row as the shared caps
-- because they answer the same question — how much of the shared capacity any
-- one moment, or any one person, may take.
--
-- Ceilings are deliberate. Every worker is a Claude Code subprocess alongside
-- Next.js in a single container, so memory, not budget, is what gives out
-- first: roughly 300-400 MB each.
-- ============================================================================

alter table public.app_budget
  add column if not exists max_concurrent_runs integer not null default 2
    check (max_concurrent_runs between 1 and 8);

alter table public.app_budget
  add column if not exists max_runs_per_user integer not null default 1
    check (max_runs_per_user between 1 and 5);
