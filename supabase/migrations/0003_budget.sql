-- ============================================================================
-- 0003_budget.sql — one global, shared spend cap across ALL users
--
-- Apify and Anthropic are shared paid resources for everyone on this app, so
-- the cap is enforced globally and atomically rather than per run.
--
-- The concurrency primitive is a single-row UPDATE ... WHERE remaining >=
-- amount. Postgres takes a row lock on the 'global' row, so two users starting
-- runs in the same instant serialise and cannot both claim the last cent.
--
-- Money moves in two steps: reserve the worst case up front, then settle the
-- actual once the provider reports it. budget_ledger keeps the audit trail.
-- ============================================================================

create table public.app_budget (
  id                 text primary key default 'global',

  apify_cap_usd      numeric(12,6) not null default 5.00,
  apify_spent_usd    numeric(12,6) not null default 0,
  apify_reserved_usd numeric(12,6) not null default 0,

  agent_cap_usd      numeric(12,6) not null default 20.00,
  agent_spent_usd    numeric(12,6) not null default 0,
  agent_reserved_usd numeric(12,6) not null default 0,

  -- admin kill switch: refuses new runs without touching the caps
  runs_paused        boolean not null default false,

  updated_at         timestamptz not null default now(),
  constraint app_budget_singleton check (id = 'global')
);

insert into public.app_budget (id) values ('global') on conflict (id) do nothing;

create table public.budget_ledger (
  id         bigserial primary key,
  kind       text not null check (kind in ('apify','agent')),
  phase      text not null check (phase in ('reserve','settle','release')),
  run_id     uuid,
  user_id    uuid,
  amount_usd numeric(12,6) not null,
  note       text,
  created_at timestamptz not null default now()
);

create index budget_ledger_run_idx     on public.budget_ledger (run_id, created_at);
create index budget_ledger_created_idx on public.budget_ledger (created_at desc);

-- ------------------------------------------------------------- reserve -----
-- Returns { ok, remaining, reason } rather than raising, so the caller can
-- branch without matching on exception text.
create or replace function public.reserve_budget(
  p_kind    text,
  p_amount  numeric,
  p_run_id  uuid    default null,
  p_user_id uuid    default null,
  p_note    text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining numeric;
  v_paused    boolean;
begin
  if p_kind not in ('apify','agent') then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_KIND');
  end if;
  if p_amount is null or p_amount < 0 then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_AMOUNT');
  end if;

  select runs_paused into v_paused from public.app_budget where id = 'global';
  if v_paused then
    return jsonb_build_object('ok', false, 'reason', 'RUNS_PAUSED');
  end if;

  if p_kind = 'apify' then
    update public.app_budget
       set apify_reserved_usd = apify_reserved_usd + p_amount,
           updated_at = now()
     where id = 'global'
       and (apify_cap_usd - apify_spent_usd - apify_reserved_usd) >= p_amount
    returning (apify_cap_usd - apify_spent_usd - apify_reserved_usd)
      into v_remaining;
  else
    update public.app_budget
       set agent_reserved_usd = agent_reserved_usd + p_amount,
           updated_at = now()
     where id = 'global'
       and (agent_cap_usd - agent_spent_usd - agent_reserved_usd) >= p_amount
    returning (agent_cap_usd - agent_spent_usd - agent_reserved_usd)
      into v_remaining;
  end if;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'reason', upper(p_kind) || '_BUDGET_EXHAUSTED'
    );
  end if;

  insert into public.budget_ledger (kind, phase, run_id, user_id, amount_usd, note)
  values (p_kind, 'reserve', p_run_id, p_user_id, p_amount, p_note);

  return jsonb_build_object('ok', true, 'remaining', v_remaining);
end;
$$;

-- -------------------------------------------------------------- settle -----
-- Converts a reservation into actual spend. Overspend beyond the reservation
-- is still recorded: the ledger must reflect reality even if a provider
-- charged more than the worst case we predicted.
create or replace function public.settle_budget(
  p_kind     text,
  p_reserved numeric,
  p_actual   numeric,
  p_run_id   uuid    default null,
  p_user_id  uuid    default null,
  p_note     text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_remaining numeric;
begin
  if p_kind not in ('apify','agent') then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_KIND');
  end if;

  if p_kind = 'apify' then
    update public.app_budget
       set apify_reserved_usd = greatest(0, apify_reserved_usd - coalesce(p_reserved, 0)),
           apify_spent_usd    = apify_spent_usd + coalesce(p_actual, 0),
           updated_at = now()
     where id = 'global'
    returning (apify_cap_usd - apify_spent_usd - apify_reserved_usd) into v_remaining;
  else
    update public.app_budget
       set agent_reserved_usd = greatest(0, agent_reserved_usd - coalesce(p_reserved, 0)),
           agent_spent_usd    = agent_spent_usd + coalesce(p_actual, 0),
           updated_at = now()
     where id = 'global'
    returning (agent_cap_usd - agent_spent_usd - agent_reserved_usd) into v_remaining;
  end if;

  insert into public.budget_ledger (kind, phase, run_id, user_id, amount_usd, note)
  values (p_kind, 'settle', p_run_id, p_user_id, coalesce(p_actual, 0), p_note);

  return jsonb_build_object('ok', true, 'remaining', v_remaining);
end;
$$;

-- ------------------------------------------------------------- release -----
-- Give a reservation back untouched (the call failed before spending).
create or replace function public.release_budget(
  p_kind    text,
  p_amount  numeric,
  p_run_id  uuid default null,
  p_user_id uuid default null,
  p_note    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind = 'apify' then
    update public.app_budget
       set apify_reserved_usd = greatest(0, apify_reserved_usd - coalesce(p_amount, 0)),
           updated_at = now()
     where id = 'global';
  elsif p_kind = 'agent' then
    update public.app_budget
       set agent_reserved_usd = greatest(0, agent_reserved_usd - coalesce(p_amount, 0)),
           updated_at = now()
     where id = 'global';
  else
    return jsonb_build_object('ok', false, 'reason', 'INVALID_KIND');
  end if;

  insert into public.budget_ledger (kind, phase, run_id, user_id, amount_usd, note)
  values (p_kind, 'release', p_run_id, p_user_id, coalesce(p_amount, 0), p_note);

  return jsonb_build_object('ok', true);
end;
$$;

-- -------------------------------------------------------- budget_status ----
-- Safe read for the UI: how much is left and whether runs are paused.
-- app_budget itself has no SELECT policy, so this is the only client path in.
create or replace function public.budget_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'apify_remaining_usd', apify_cap_usd - apify_spent_usd - apify_reserved_usd,
    'apify_cap_usd',       apify_cap_usd,
    'apify_spent_usd',     apify_spent_usd,
    'agent_remaining_usd', agent_cap_usd - agent_spent_usd - agent_reserved_usd,
    'agent_cap_usd',       agent_cap_usd,
    'agent_spent_usd',     agent_spent_usd,
    'runs_paused',         runs_paused
  )
  from public.app_budget where id = 'global';
$$;

-- --------------------------------------------------------------- grants ----
-- app_budget and budget_ledger have RLS on with no policies: invisible to the
-- browser. The mutating RPCs are revoked from anon/authenticated so a
-- signed-in user cannot call settle_budget to zero out the ledger.
alter table public.app_budget    enable row level security;
alter table public.budget_ledger enable row level security;

revoke all on function public.reserve_budget(text, numeric, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.settle_budget(text, numeric, numeric, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.release_budget(text, numeric, uuid, uuid, text) from public, anon, authenticated;

-- Read-only status is safe to expose to signed-in users.
revoke all on function public.budget_status() from public, anon;
grant execute on function public.budget_status() to authenticated;
