-- ============================================================================
-- 0004_clarification.sql — let a run stop and ask
--
-- The ICP guide says to ask for clarification when an objective is too vague
-- to search, but the agent has no interactive user: it runs unattended for
-- twenty minutes. "Asking" therefore means ending the run in a state that
-- carries the questions, so the person can read them and start again with a
-- better objective — rather than guessing and spending the shared budget on a
-- search nobody wanted.
-- ============================================================================

alter table public.runs
  drop constraint if exists runs_status_check;

alter table public.runs
  add constraint runs_status_check check (
    status in (
      'queued', 'running', 'completed',
      'needs_review', 'needs_clarification',
      'failed', 'cancelled'
    )
  );

-- The specific questions that would make the objective searchable.
alter table public.runs
  add column if not exists clarification_questions text[];
