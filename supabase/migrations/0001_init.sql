-- ============================================================================
-- 0001_init.sql — domain tables for the lead research & outreach agent
--
-- Every table carries BOTH run_id and a denormalised user_id. The user_id is
-- redundant relative to runs.user_id, but it keeps every RLS policy a single
-- indexed comparison instead of a per-row subquery into runs.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- runs -----
create table public.runs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,

  -- what the user asked for, verbatim
  objective         text not null,
  -- refined ICP the agent produced via set_icp (icp-refinement skill)
  icp               jsonb,
  -- frozen at creation; the agent can never change these
  limits            jsonb not null,

  status            text not null default 'queued'
                      check (status in ('queued','running','completed',
                                        'needs_review','failed','cancelled')),
  status_reason     text,

  -- agent telemetry
  model             text,
  session_id        text,
  total_cost_usd    numeric(12,6) not null default 0,
  usage             jsonb,
  model_usage       jsonb,
  num_turns         integer,
  duration_ms       integer,

  -- final output of finalize_run
  summary           text,
  quality_scorecard jsonb,

  queued_at         timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  heartbeat_at      timestamptz,
  created_at        timestamptz not null default now()
);

create index runs_user_idx      on public.runs (user_id, created_at desc);
create index runs_queue_idx     on public.runs (status, queued_at);
create index runs_heartbeat_idx on public.runs (status, heartbeat_at);

-- ---------------------------------------------------- candidates -----------
-- The raw discovery pool. Kept separate from leads so the
-- discovered -> scraped -> qualified funnel stays reviewable.
create table public.candidates (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references public.runs(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,

  company_name    text,
  domain          text not null,
  source_url      text,
  snippet         text,
  discovery_query text,

  status          text not null default 'new'
                    check (status in ('new','scraped','evaluated','skipped')),
  discovered_at   timestamptz not null default now(),

  -- DB-level dedupe: the same domain cannot enter one run twice
  unique (run_id, domain)
);

create index candidates_run_idx  on public.candidates (run_id);
create index candidates_user_idx on public.candidates (user_id);

-- --------------------------------------------------------------- leads -----
create table public.leads (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid not null references public.runs(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  candidate_id         uuid references public.candidates(id) on delete set null,

  company_name         text not null,
  company_domain       text not null,

  qualification_status text not null
                         check (qualification_status in
                                ('qualified','not_qualified','needs_review')),
  confidence           numeric(3,2) not null
                         check (confidence >= 0 and confidence <= 1),

  fit_reasons          text[] not null default '{}',
  concerns             text[] not null default '{}',
  source_urls          text[] not null default '{}',
  source_summary       text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (run_id, company_domain)
);

create index leads_run_idx    on public.leads (run_id);
create index leads_user_idx   on public.leads (user_id);
create index leads_status_idx on public.leads (run_id, qualification_status);

-- -------------------------------------------------------- page_sources -----
-- Every scraped page, stored verbatim so a human reviewer can check that the
-- qualification reasoning is actually grounded in the page, and so flagged
-- injection attempts stay visible in the UI.
create table public.page_sources (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references public.runs(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  candidate_id     uuid references public.candidates(id) on delete set null,

  url              text not null,
  http_status      integer,
  title            text,
  content_markdown text,
  content_chars    integer,

  -- populated by sanitize.ts; non-empty means the page tried to give the
  -- agent instructions. Lines are kept, not stripped, so the UI can show them.
  injection_flags  text[] not null default '{}',
  scraper          text not null check (scraper in ('firecrawl','fallback')),

  scraped_at       timestamptz not null default now()
);

create index page_sources_run_idx  on public.page_sources (run_id);
create index page_sources_user_idx on public.page_sources (user_id);

-- ----------------------------------------------------- outreach_drafts -----
create table public.outreach_drafts (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references public.runs(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  lead_id             uuid not null references public.leads(id) on delete cascade,

  channel             text not null check (channel in ('email','linkedin')),
  step_number         integer not null check (step_number between 1 and 3),

  subject             text,
  body                text not null,
  personalization_note text,
  -- must be one of the parent lead's source_urls; enforced in save_outreach_drafts
  evidence_url        text,

  created_at          timestamptz not null default now(),

  unique (lead_id, channel, step_number)
);

create index outreach_run_idx  on public.outreach_drafts (run_id);
create index outreach_user_idx on public.outreach_drafts (user_id);
create index outreach_lead_idx on public.outreach_drafts (lead_id);

-- ---------------------------------------------------------- tool_calls -----
-- The agent's audit trail. Written by every tool handler AND by the
-- canUseTool gate, so denied calls are recorded too.
create table public.tool_calls (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.runs(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,

  tool_name      text not null,
  purpose        text,
  input_summary  jsonb,
  result_summary jsonb,

  status         text not null
                   check (status in ('success','error','denied','limit_blocked')),
  error_message  text,
  duration_ms    integer,

  created_at     timestamptz not null default now()
);

create index tool_calls_run_idx  on public.tool_calls (run_id, created_at);
create index tool_calls_user_idx on public.tool_calls (user_id);
