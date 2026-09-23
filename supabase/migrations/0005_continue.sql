-- ============================================================================
-- 0005_continue.sql — answering a run, and approving its ICP before it spends
--
-- Two ways a run can end waiting on a person:
--   needs_clarification   the objective said nothing usable; questions recorded
--   awaiting_confirmation the ICP is written and wants a look before discovery
--
-- Both are answered by starting a NEW run rather than resuming the old one.
-- The agent session is not persisted (persistSession: false), so there is
-- nothing to resume — and a fresh run is the better shape regardless: the
-- original stays intact as evidence of the question that was asked, instead of
-- being mutated into something that no longer shows it.
-- ============================================================================

alter table public.runs
  drop constraint if exists runs_status_check;

alter table public.runs
  add constraint runs_status_check check (
    status in (
      'queued', 'running', 'completed',
      'needs_review', 'needs_clarification', 'awaiting_confirmation',
      'failed', 'cancelled'
    )
  );

-- The run this one answers. Kept on delete so a chain survives its parent
-- being removed; the UI just stops showing the link.
alter table public.runs
  add column if not exists parent_run_id uuid references public.runs(id) on delete set null;

create index if not exists runs_parent_idx on public.runs (parent_run_id);
