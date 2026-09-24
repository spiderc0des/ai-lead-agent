-- ============================================================================
-- 0009_email_events.sql — record every notification email in the run log
--
-- A notification that fails to send used to leave a line in the server log and
-- nothing else, so from the app a failed email and one that was never tried
-- looked the same. Each attempt is now a run_events row: 'emailed' when it was
-- handed to the mail server, 'email_failed' with the reason when it was not.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

alter table public.run_events drop constraint if exists run_events_kind_check;
alter table public.run_events add constraint run_events_kind_check check (kind in (
  'created','started','resumed','answered','approved',
  'needs_clarification','awaiting_confirmation',
  'completed','needs_review','failed','cancelled',
  'emailed','email_failed'));
