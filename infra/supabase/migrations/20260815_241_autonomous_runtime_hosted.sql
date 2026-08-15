-- AI Factory 2.4.1 hosted autonomous runtime
-- Uses an af_* namespace to avoid colliding with legacy public.factory_runs already present
-- in the shared Supabase project.

create extension if not exists pgcrypto;

create table if not exists public.af_runs (
  id uuid primary key default gen_random_uuid(),
  objective text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  status text not null default 'QUEUED' check (status in ('QUEUED','QUALIFYING','ROUTED','WORKING','VALIDATING','REPAIRING','LEARNING','COMPLETE','BLOCKED','FAILED')),
  autonomy_level text not null default 'A3' check (autonomy_level in ('A0','A1','A2','A3','A4','A5','A6','A7')),
  activated_agents text[] not null default '{}',
  selected_skills text[] not null default '{}',
  retry_budget integer not null default 3 check (retry_budget between 0 and 20),
  blocker jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.af_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.af_runs(id) on delete cascade,
  kind text not null default 'general',
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  status text not null default 'QUEUED' check (status in ('QUEUED','WORKING','COMPLETE','BLOCKED','FAILED')),
  priority integer not null default 100,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.af_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.af_runs(id) on delete cascade,
  task_id uuid references public.af_tasks(id) on delete set null,
  event_type text not null,
  source text not null,
  evidence_class text not null check (evidence_class in ('MEASURED','OBSERVED','CONFIRMED','DERIVED','INFERRED','ASSUMPTION','UNKNOWN','BLOCKER')),
  payload jsonb not null default '{}'::jsonb,
  provenance jsonb,
  occurred_at timestamptz not null default now()
);

create table if not exists public.af_checkpoints (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.af_runs(id) on delete cascade,
  task_id uuid references public.af_tasks(id) on delete set null,
  state text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.af_incidents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.af_runs(id) on delete cascade,
  task_id uuid references public.af_tasks(id) on delete set null,
  severity text not null check (severity in ('UNDESIRABLE','FORBIDDEN','CATASTROPHIC')),
  status text not null default 'OPEN' check (status in ('OPEN','REPAIRING','RESOLVED','ACCEPTED_RISK','BLOCKED')),
  summary text not null,
  evidence jsonb not null default '{}'::jsonb,
  root_cause jsonb,
  affected_invariants text[] not null default '{}',
  repair jsonb,
  negative_action_id text,
  regression_eval_ref text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.af_lessons (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.af_runs(id) on delete cascade,
  incident_id uuid references public.af_incidents(id) on delete set null,
  lesson_class text not null,
  status text not null default 'CANDIDATE' check (status in ('CANDIDATE','EVALUATING','PROMOTED','REJECTED','SUPERSEDED')),
  statement text not null,
  generalization jsonb,
  regression_eval_ref text,
  candidate_change jsonb,
  baseline_result jsonb,
  candidate_result jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists public.af_negative_action_observations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.af_runs(id) on delete cascade,
  incident_id uuid references public.af_incidents(id) on delete set null,
  negative_action_id text not null,
  matched boolean not null default true,
  evidence jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);

create index if not exists af_runs_status_idx on public.af_runs(status, heartbeat_at);
create index if not exists af_tasks_claim_idx on public.af_tasks(status, available_at, priority, created_at);
create index if not exists af_events_run_idx on public.af_events(run_id, occurred_at);
create index if not exists af_incidents_run_idx on public.af_incidents(run_id, created_at);
create index if not exists af_lessons_status_idx on public.af_lessons(status, created_at);

create or replace function public.af_enqueue_run(
  p_objective text,
  p_payload jsonb default '{}'::jsonb,
  p_kind text default 'general',
  p_autonomy_level text default 'A3'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
begin
  if p_objective is null or length(trim(p_objective)) < 3 then
    raise exception 'objective is required';
  end if;
  if p_autonomy_level not in ('A0','A1','A2','A3','A4','A5','A6','A7') then
    raise exception 'invalid autonomy level';
  end if;

  insert into public.af_runs(objective, input, autonomy_level)
  values (left(trim(p_objective), 12000), coalesce(p_payload, '{}'::jsonb), p_autonomy_level)
  returning id into v_run_id;

  insert into public.af_tasks(run_id, kind, payload)
  values (v_run_id, coalesce(nullif(trim(p_kind), ''), 'general'), coalesce(p_payload, '{}'::jsonb));

  insert into public.af_events(run_id, event_type, source, evidence_class, payload)
  values (v_run_id, 'RUN_QUEUED', 'runtime', 'CONFIRMED', jsonb_build_object('kind', p_kind));

  return v_run_id;
end;
$$;

create or replace function public.af_claim_task(p_worker_id text)
returns setof public.af_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_run_id uuid;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'worker id is required';
  end if;

  select id, run_id into v_id, v_run_id
  from public.af_tasks
  where status = 'QUEUED'
    and available_at <= now()
    and attempts < max_attempts
  order by priority asc, created_at asc
  for update skip locked
  limit 1;

  if v_id is null then return; end if;

  update public.af_tasks
  set status='WORKING', locked_at=now(), locked_by=left(p_worker_id,200), attempts=attempts+1, updated_at=now()
  where id=v_id;

  update public.af_runs
  set status='WORKING', heartbeat_at=now(), updated_at=now()
  where id=v_run_id and status not in ('COMPLETE','BLOCKED','FAILED');

  insert into public.af_events(run_id, task_id, event_type, source, evidence_class, payload)
  values (v_run_id, v_id, 'TASK_CLAIMED', 'runtime', 'CONFIRMED', jsonb_build_object('worker', left(p_worker_id,200)));

  return query select * from public.af_tasks where id=v_id;
end;
$$;

create or replace function public.af_touch_run(p_run_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.af_runs set heartbeat_at=now(), updated_at=now() where id=p_run_id;
$$;

create or replace function public.af_finish_task(
  p_task_id uuid,
  p_status text,
  p_result jsonb,
  p_activated_agents text[] default '{}',
  p_selected_skills text[] default '{}'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
begin
  if p_status not in ('COMPLETE','BLOCKED','FAILED') then raise exception 'invalid terminal status'; end if;
  select run_id into v_run_id from public.af_tasks where id=p_task_id for update;
  if v_run_id is null then raise exception 'task not found'; end if;

  update public.af_tasks
  set status=p_status, result=coalesce(p_result,'{}'::jsonb), locked_at=null, locked_by=null, updated_at=now()
  where id=p_task_id;

  update public.af_runs
  set status=p_status,
      output=coalesce(p_result,'{}'::jsonb),
      activated_agents=coalesce(p_activated_agents,'{}'),
      selected_skills=coalesce(p_selected_skills,'{}'),
      heartbeat_at=now(), updated_at=now(), completed_at=now()
  where id=v_run_id;

  insert into public.af_events(run_id, task_id, event_type, source, evidence_class, payload)
  values (v_run_id, p_task_id, 'RUN_' || p_status, 'runtime', case when p_status='COMPLETE' then 'CONFIRMED' else 'BLOCKER' end, coalesce(p_result,'{}'::jsonb));

  return v_run_id;
end;
$$;

create or replace function public.af_recover_stale(p_stale_minutes integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requeued integer := 0;
  v_failed integer := 0;
begin
  with changed as (
    update public.af_tasks
    set status='QUEUED', locked_at=null, locked_by=null, available_at=now(), updated_at=now(),
        last_error=jsonb_build_object('code','STALE_LOCK_RECOVERED','at',now())
    where status='WORKING'
      and locked_at < now() - make_interval(mins => greatest(5, least(coalesce(p_stale_minutes,20), 1440)))
      and attempts < max_attempts
    returning run_id
  ) select count(*) into v_requeued from changed;

  with exhausted as (
    update public.af_tasks
    set status='FAILED', locked_at=null, locked_by=null, updated_at=now(),
        last_error=jsonb_build_object('code','RETRY_BUDGET_EXHAUSTED','at',now())
    where status='WORKING'
      and locked_at < now() - make_interval(mins => greatest(5, least(coalesce(p_stale_minutes,20), 1440)))
      and attempts >= max_attempts
    returning run_id
  ) select count(*) into v_failed from exhausted;

  update public.af_runs r
  set status='QUEUED', updated_at=now()
  where status='WORKING' and exists (select 1 from public.af_tasks t where t.run_id=r.id and t.status='QUEUED');

  update public.af_runs r
  set status='FAILED', completed_at=now(), updated_at=now(), blocker=jsonb_build_object('code','RETRY_BUDGET_EXHAUSTED')
  where status='WORKING' and exists (select 1 from public.af_tasks t where t.run_id=r.id and t.status='FAILED')
    and not exists (select 1 from public.af_tasks t where t.run_id=r.id and t.status in ('QUEUED','WORKING'));

  return jsonb_build_object('requeued',v_requeued,'failed',v_failed,'at',now());
end;
$$;

alter table public.af_runs enable row level security;
alter table public.af_tasks enable row level security;
alter table public.af_events enable row level security;
alter table public.af_checkpoints enable row level security;
alter table public.af_incidents enable row level security;
alter table public.af_lessons enable row level security;
alter table public.af_negative_action_observations enable row level security;

revoke all on public.af_runs, public.af_tasks, public.af_events, public.af_checkpoints, public.af_incidents, public.af_lessons, public.af_negative_action_observations from anon, authenticated;
revoke all on function public.af_enqueue_run(text,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.af_claim_task(text) from public, anon, authenticated;
revoke all on function public.af_touch_run(uuid) from public, anon, authenticated;
revoke all on function public.af_finish_task(uuid,text,jsonb,text[],text[]) from public, anon, authenticated;
revoke all on function public.af_recover_stale(integer) from public, anon, authenticated;

grant execute on function public.af_enqueue_run(text,jsonb,text,text) to service_role;
grant execute on function public.af_claim_task(text) to service_role;
grant execute on function public.af_touch_run(uuid) to service_role;
grant execute on function public.af_finish_task(uuid,text,jsonb,text[],text[]) to service_role;
grant execute on function public.af_recover_stale(integer) to service_role;
