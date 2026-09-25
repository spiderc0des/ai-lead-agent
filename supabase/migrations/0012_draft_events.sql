-- ============================================================================
-- 0012_draft_events.sql — outreach written or rewritten after a run
--
-- A person can rewrite a lead's drafts from the outreach pack, with an
-- instruction, or have first drafts written for a needs-review lead a reviewer
-- marked good. Each one is a 'drafts_generated' event in the run's log: who,
-- which lead, what was rewritten, the instruction and what it cost.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

alter table public.run_events drop constraint if exists run_events_kind_check;
alter table public.run_events add constraint run_events_kind_check check (kind in (
  'created','started','resumed','answered','approved',
  'needs_clarification','awaiting_confirmation',
  'completed','needs_review','failed','cancelled',
  'emailed','email_failed',
  'lead_reviewed','run_reviewed','lead_processed',
  'drafts_generated'));
