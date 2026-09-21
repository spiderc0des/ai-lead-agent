-- ============================================================================
-- 0002_auth_rls.sql — profiles, admin role, row level security, realtime
--
-- Security posture:
--   * The browser holds the anon key and may SELECT its own rows, nothing more.
--   * There are NO insert/update/delete policies for anon or authenticated on
--     any table. Every write goes through the service-role key server-side, so
--     a signed-in user cannot fabricate a lead or forge a tool-call log.
--   * An 'admin' profile may SELECT every row.
-- ============================================================================

-- ------------------------------------------------------------ profiles -----
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       text not null default 'member' check (role in ('member','admin')),
  created_at timestamptz not null default now()
);

-- Admin-managed allowlist. Sign-in uses shouldCreateUser:false, so an address
-- that was never invited simply never receives a link.
create table public.allowed_emails (
  email       text primary key,
  invited_by  uuid references auth.users(id) on delete set null,
  invited_at  timestamptz not null default now(),
  accepted_at timestamptz
);

-- Mirror every new auth user into profiles, and stamp the allowlist.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  update public.allowed_emails
     set accepted_at = now()
   where email = new.email
     and accepted_at is null;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------ is_admin -----
-- SECURITY DEFINER is required: the function reads profiles from inside the
-- policies that guard profiles, and would otherwise recurse.
-- The explicit search_path prevents schema hijacking.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ----------------------------------------------------------------- RLS -----
alter table public.profiles        enable row level security;
alter table public.allowed_emails  enable row level security;
alter table public.runs            enable row level security;
alter table public.candidates      enable row level security;
alter table public.leads           enable row level security;
alter table public.page_sources    enable row level security;
alter table public.outreach_drafts enable row level security;
alter table public.tool_calls      enable row level security;

-- You can always read your own profile; an admin can read everyone's.
create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using ( id = (select auth.uid()) or (select public.is_admin()) );

-- The allowlist is admin-only; it reveals who has access.
create policy allowed_emails_select_admin on public.allowed_emails
  for select to authenticated
  using ( (select public.is_admin()) );

-- Domain tables: own rows, or everything if admin.
-- Both calls are wrapped in (select ...) so Postgres evaluates them once per
-- query as an InitPlan rather than once per row.
create policy runs_select_own_or_admin on public.runs
  for select to authenticated
  using ( user_id = (select auth.uid()) or (select public.is_admin()) );

create policy candidates_select_own_or_admin on public.candidates
  for select to authenticated
  using ( user_id = (select auth.uid()) or (select public.is_admin()) );

create policy leads_select_own_or_admin on public.leads
  for select to authenticated
  using ( user_id = (select auth.uid()) or (select public.is_admin()) );

create policy page_sources_select_own_or_admin on public.page_sources
  for select to authenticated
  using ( user_id = (select auth.uid()) or (select public.is_admin()) );

create policy outreach_drafts_select_own_or_admin on public.outreach_drafts
  for select to authenticated
  using ( user_id = (select auth.uid()) or (select public.is_admin()) );

create policy tool_calls_select_own_or_admin on public.tool_calls
  for select to authenticated
  using ( user_id = (select auth.uid()) or (select public.is_admin()) );

-- Deliberately absent: any INSERT / UPDATE / DELETE policy. Writes are
-- service-role only.

-- ------------------------------------------------------------ realtime -----
-- postgres_changes re-checks the SELECT policies above against the
-- subscriber's JWT, so each user's live feed is scoped to their own runs
-- automatically (and an admin's to everything).
alter publication supabase_realtime add table public.runs;
alter publication supabase_realtime add table public.candidates;
alter publication supabase_realtime add table public.leads;
alter publication supabase_realtime add table public.page_sources;
alter publication supabase_realtime add table public.outreach_drafts;
alter publication supabase_realtime add table public.tool_calls;
