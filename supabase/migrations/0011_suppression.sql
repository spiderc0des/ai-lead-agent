-- ============================================================================
-- 0011_suppression.sql — a team skip list, and marking qualified leads processed
--
-- suppressed_domains
--   Domains discovery must drop: existing customers, companies already
--   contacted, ones asked to be excluded. Shared by everyone on the app — it is
--   the team's list, not a person's. Stores a bare domain and why, nothing
--   about any individual. discover_companies also skips domains qualified in
--   ANY earlier run, so a known answer is never paid for twice.
--
-- leads.processed_*
--   The team has acted on a qualified lead (contacted it, handed it on,
--   decided against it). Marking one processed can add its domain to the skip
--   list in the same step.
--
-- Written server-side only. Idempotent.
-- ============================================================================

create table if not exists public.suppressed_domains (
  domain        text primary key check (domain = lower(domain) and domain !~ '[/:@\s]'),
  reason        text not null default 'excluded'
                  check (reason in ('customer', 'contacted', 'excluded', 'other')),
  note          text,
  added_by      uuid references auth.users(id) on delete set null,
  added_by_name text,
  -- Set when the entry came from marking a lead processed, for traceability.
  source_run_id uuid references public.runs(id) on delete set null,
  created_at    timestamptz not null default now()
);

alter table public.suppressed_domains enable row level security;

-- Everyone signed in can read the team's list; nobody writes from the browser.
drop policy if exists suppressed_domains_select_authenticated on public.suppressed_domains;
create policy suppressed_domains_select_authenticated on public.suppressed_domains
  for select to authenticated using (true);

alter table public.leads add column if not exists processed_at      timestamptz;
alter table public.leads add column if not exists processed_by      uuid references auth.users(id) on delete set null;
alter table public.leads add column if not exists processed_by_name text;
alter table public.leads add column if not exists processed_note    text;

-- For the "qualified in an earlier run" check discovery makes on every call.
create index if not exists leads_qualified_domain_idx
  on public.leads (company_domain) where qualification_status = 'qualified';

alter table public.run_events drop constraint if exists run_events_kind_check;
alter table public.run_events add constraint run_events_kind_check check (kind in (
  'created','started','resumed','answered','approved',
  'needs_clarification','awaiting_confirmation',
  'completed','needs_review','failed','cancelled',
  'emailed','email_failed',
  'lead_reviewed','run_reviewed','lead_processed'));
