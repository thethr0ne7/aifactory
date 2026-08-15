-- AI Factory 2.4.0 Autonomous Runtime reference schema
-- Intended for a private/server-side control plane. Client access should remain denied unless explicit RLS policies are added.

create extension if not exists pgcrypto;

create table if not exists public.factory_runs (
  id uuid primary key default gen_random_uuid(),
  objective text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  status text not null default 'QUEUED' check (status in ('QUEUED','QUALIFYING','ROUTED','WORKING','VALIDATING','REPAIRING','LEARNING','COMPLETE','BLOCKED','FAILED')),
  autonomy_level text not null default 'A3' check (autonomy_level in ('A0','A1','A2','A3','A4','A5','A6','A7')),
  activated_agents text[] not null default '{}',
  selected_skills text[] not null default '{}',
  retry_budget integer not null default 3 check (retry_budget >= 0 and retry_budget <= 20),
  blocker jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.factory_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.factory_runs(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'QUEUED' check (status in ('QUEUED','WORKING','COMPLETE','BLOCKED','FAILED')),
  priority integer not null default 100,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts >= 1 and max_attempts <= 20),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.factory_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.factory_runs(id) on delete cascade,
  task_id uuid references public.factory_tasks(id) on delete set null,
  event_type text not null,
  source text not null,
  evidence_class text not null check (evidence_class in ('MEASURED','OBSERVED','CONFIRMED','DERIVED','INFERRED','ASSUMPTION','UNKNOWN','BLOCKER')),
  payload jsonb not null default '{}'::jsonb,
  provenance jsonb,
  occurred_at timestamptz not null default now()
);

create table if not exists public.factory_checkpoints (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.factory_runs(id) on delete cascade,
  task_id uuid references public.factory_tasks(id) on delete set null,
  state text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.factory_incidents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.factory_runs(id) on delete cascade,
  task_id uuid references public.factory_tasks(id) on delete set null,
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

create table if not exists public.factory_lessons (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.factory_runs(id) on delete cascade,
  incident_id uuid references public.factory_incidents(id) on delete set null,
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

create table if not exists public.factory_negative_action_observations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.factory_runs(id) on delete cascade,
  incident_id uuid references public.factory_incidents(id) on delete set null,
  negative_action_id text not null,
  matched boolean not null default true,
  evidence jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);

create index if not exists factory_runs_status_idx on public.factory_runs(status, heartbeat_at);
create index if not exists factory_tasks_claim_idx on public.factory_tasks(status, available_at, priority, created_at);
create index if not exists factory_events_run_idx on public.factory_events(run_id, occurred_at);
create index if not exists factory_incidents_run_idx on public.factory_incidents(run_id, created_at);
create index if not exists factory_lessons_status_idx on public.factory_lessons(status, created_at);

create or replace function public.claim_factory_task(p_worker_id text)
returns setof public.factory_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'worker id is required';
  end if;

  select id into v_id
  from public.factory_tasks
  where status = 'QUEUED'
    and available_at <= now()
    and attempts < max_attempts
  order by priority asc, created_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  update public.factory_tasks
  set status = 'WORKING',
      locked_at = now(),
      locked_by = p_worker_id,
      attempts = attempts + 1,
      updated_at = now()
  where id = v_id;

  return query select * from public.factory_tasks where id = v_id;
end;
$$;

create or replace function public.touch_factory_run(p_run_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.factory_runs
  set heartbeat_at = now(), updated_at = now()
  where id = p_run_id;
$$;

alter table public.factory_runs enable row level security;
alter table public.factory_tasks enable row level security;
alter table public.factory_events enable row level security;
alter table public.factory_checkpoints enable row level security;
alter table public.factory_incidents enable row level security;
alter table public.factory_lessons enable row level security;
alter table public.factory_negative_action_observations enable row level security;

-- No client RLS policies are created here intentionally.
-- Use a tightly scoped server-side/service-role worker, or add explicit policies after threat review.
