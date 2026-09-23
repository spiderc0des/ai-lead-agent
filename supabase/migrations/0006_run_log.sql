-- ============================================================================
-- 0006_run_log.sql — resume a run in place, and keep a log of who did what
--
-- A run that stops for clarification or ICP approval now resumes as the SAME
-- run rather than spawning a linked one. That makes a run a sequence of agent
-- sessions, which changes two things:
--
--   * money is cumulative. total_cost_usd must add up across sessions, and each
--     session reserves only what the run has left, not max_budget_usd again.
--   * history needs its own table. "Who answered, with what, and when" is not
--     something a single status column can hold.
-- ============================================================================

-- The budget currently held against the shared pool for this run's active
-- session. Every release and settle uses this rather than assuming it equals
-- max_budget_usd, which stops being true the moment a run resumes.
alter table public.runs
  add column if not exists reserved_usd numeric(12,6) not null default 0;

-- total_cost_usd at the start of the current session. Session spend is
-- total_cost_usd minus this, which is what a crashed session is settled at.
alter table public.runs
  add column if not exists session_baseline_usd numeric(12,6) not null default 0;

-- Set when a person approves the ICP. Discovery-gating keys off this, so an
-- approved run never stops to ask again, and the approved criteria cannot be
-- quietly rewritten by a later set_icp call.
alter table public.runs
  add column if not exists icp_approved_at timestamptz;

-- Idempotent restatement of 0005's status list, so this file is safe to apply
-- on a database that skipped 0005.
alter table public.runs drop constraint if exists runs_status_check;
alter table public.runs add constraint runs_status_check check (
  status in ('queued','running','completed','needs_review','needs_clarification',
             'awaiting_confirmation','failed','cancelled')
);
alter table public.runs
  add column if not exists parent_run_id uuid references public.runs(id) on delete set null;

-- ------------------------------------------------------------ run_events ---
create table if not exists public.run_events (
  id          bigserial primary key,
  run_id      uuid not null references public.runs(id) on delete cascade,
  -- the run's OWNER, for RLS — not necessarily the person who acted
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- who acted; null for the agent or the system
  actor_id    uuid references auth.users(id) on delete set null,
  -- denormalised so a member can see which admin cancelled their run without
  -- being able to read that admin's profile row
  actor_email text,
  kind        text not null check (kind in (
                'created','started','resumed','answered','approved',
                'needs_clarification','awaiting_confirmation',
                'completed','needs_review','failed','cancelled')),
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists run_events_run_idx on public.run_events (run_id, created_at);

alter table public.run_events enable row level security;

drop policy if exists run_events_select_own_or_admin on public.run_events;
create policy run_events_select_own_or_admin on public.run_events
  for select to authenticated
  using ( user_id = (select auth.uid()) or (select public.is_admin()) );

-- Read-only to the browser, like every other table: no write policies.

do $$ begin
  alter publication supabase_realtime add table public.run_events;
exception when duplicate_object then null; end $$;
