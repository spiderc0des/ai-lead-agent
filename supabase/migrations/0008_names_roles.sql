-- ============================================================================
-- 0008_names_roles.sql — people have names, and invites carry a role
--
--   * profiles.full_name: shown instead of an email wherever a person is named
--     (the run log, the admin runs list, the header).
--   * allowed_emails.full_name / role: what the admin chose at invite time,
--     applied when the account is created.
--   * run_events.actor_name: the name as it was when the action happened. A
--     log records history, so a later rename must not rewrite who did what.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

alter table public.profiles       add column if not exists full_name text;
alter table public.allowed_emails add column if not exists full_name text;
alter table public.allowed_emails add column if not exists role text not null default 'member';
alter table public.run_events     add column if not exists actor_name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'allowed_emails_role_check'
  ) then
    alter table public.allowed_emails
      add constraint allowed_emails_role_check check (role in ('member', 'admin'));
  end if;
end $$;

-- New accounts take their name from the invite (Supabase stores the `data`
-- passed to inviteUserByEmail as raw_user_meta_data) and their role from the
-- allowlist row the admin wrote. Falling back to 'member' keeps an account
-- created any other way — the dashboard, a script — from ever being admin by
-- accident.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.allowed_emails%rowtype;
begin
  select * into v_invite from public.allowed_emails where email = lower(new.email);

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), v_invite.full_name),
    coalesce(v_invite.role, 'member')
  )
  on conflict (id) do nothing;

  update public.allowed_emails
     set accepted_at = now()
   where email = lower(new.email)
     and accepted_at is null;

  return new;
end;
$$;

-- Backfill the log so earlier entries show names too, where one is known.
update public.run_events e
   set actor_name = p.full_name
  from public.profiles p
 where e.actor_id = p.id
   and e.actor_name is null
   and p.full_name is not null;
