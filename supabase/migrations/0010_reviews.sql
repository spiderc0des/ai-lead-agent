-- ============================================================================
-- 0010_reviews.sql — a person's verdict on what the agent left for review
--
-- `needs_review` is where the agent hands a decision to a person: a lead whose
-- fit it could not verify, or a run the server would not sign off. Until now
-- nothing recorded what that person decided, so the review queue never got
-- shorter. These columns record the verdict, the note behind it, and who gave
-- it — alongside the agent's own status, which is left untouched, so the list
-- still shows what the agent concluded and what the person made of it.
--
--   leads.review_decision  'good' | 'not_good'   (only for needs_review leads)
--   runs.review_decision   'good' | 'not_good'   (only for needs_review runs)
--
-- Written server-side only, like every other column. Idempotent.
-- ============================================================================

alter table public.leads add column if not exists review_decision  text;
alter table public.leads add column if not exists review_note      text;
alter table public.leads add column if not exists reviewed_by      uuid references auth.users(id) on delete set null;
alter table public.leads add column if not exists reviewed_by_name text;
alter table public.leads add column if not exists reviewed_at      timestamptz;

alter table public.runs add column if not exists review_decision  text;
alter table public.runs add column if not exists review_note      text;
alter table public.runs add column if not exists reviewed_by      uuid references auth.users(id) on delete set null;
alter table public.runs add column if not exists reviewed_by_name text;
alter table public.runs add column if not exists reviewed_at      timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_review_decision_check') then
    alter table public.leads
      add constraint leads_review_decision_check check (review_decision in ('good', 'not_good'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'runs_review_decision_check') then
    alter table public.runs
      add constraint runs_review_decision_check check (review_decision in ('good', 'not_good'));
  end if;
end $$;

-- Both verdicts are logged on the run, so its history shows who reviewed what.
alter table public.run_events drop constraint if exists run_events_kind_check;
alter table public.run_events add constraint run_events_kind_check check (kind in (
  'created','started','resumed','answered','approved',
  'needs_clarification','awaiting_confirmation',
  'completed','needs_review','failed','cancelled',
  'emailed','email_failed',
  'lead_reviewed','run_reviewed'));
