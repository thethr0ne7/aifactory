-- AI Factory 2.6: bounded venture-economy execution layer.
-- Existing evolutionary tables from 20260820_320 are extended, not replaced.

alter table public.af_value_chain_runs
  add column if not exists run_mode text not null default 'LIVE' check (run_mode in ('LIVE','LIVE_RUNTIME_SYNTHETIC_SCENARIO')),
  add column if not exists hypothesis text,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists attempts integer not null default 0 check (attempts >= 0),
  add column if not exists last_error jsonb not null default '{}'::jsonb,
  add column if not exists provenance jsonb not null default '{}'::jsonb;

create table if not exists public.af_value_chain_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.af_value_chain_runs(id) on delete cascade,
  chain_key text not null,
  composition jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  constraint_result jsonb not null default '{}'::jsonb,
  valid boolean not null default false,
  score numeric,
  rank integer,
  selected boolean not null default false,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(run_id, chain_key)
);

create unique index if not exists af_value_chain_candidates_one_selected_idx
  on public.af_value_chain_candidates(run_id)
  where selected = true;

create table if not exists public.af_venture_cells (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.af_value_chain_runs(id) on delete restrict,
  objective text not null,
  hypothesis text,
  status text not null default 'FORMING' check (status in ('FORMING','ACTIVE','REPAIRING','PAUSED','COMPLETE','REJECTED')),
  champion_chain_id uuid references public.af_value_chain_candidates(id) on delete restrict,
  champion_chain jsonb not null default '{}'::jsonb,
  budget jsonb not null default '{}'::jsonb,
  kpis jsonb not null default '{}'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  suppliers jsonb not null default '[]'::jsonb,
  customers jsonb not null default '[]'::jsonb,
  evidence_refs uuid[] not null default '{}'::uuid[],
  feedback jsonb not null default '[]'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.af_venture_cell_members (
  id uuid primary key default gen_random_uuid(),
  venture_cell_id uuid not null references public.af_venture_cells(id) on delete cascade,
  candidate_id text not null references public.af_agent_candidates(candidate_id) on delete restrict,
  role text not null,
  scope text not null default 'VENTURE_LOCAL' check (scope in ('VENTURE_LOCAL','CROSS_VENTURE_PROVEN','FACTORY_WIDE_CAPABILITY')),
  active boolean not null default true,
  provenance jsonb not null default '{}'::jsonb,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique(venture_cell_id,candidate_id,role)
);

create table if not exists public.af_venture_experiments (
  id uuid primary key default gen_random_uuid(),
  venture_cell_id uuid not null references public.af_venture_cells(id) on delete cascade,
  hypothesis text not null,
  metric text not null,
  baseline numeric,
  target numeric,
  observed numeric,
  status text not null default 'PLANNED' check (status in ('PLANNED','RUNNING','PASS','FAIL','BLOCKED','CANCELLED')),
  evidence_refs uuid[] not null default '{}'::uuid[],
  provenance jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.af_venture_metrics (
  id uuid primary key default gen_random_uuid(),
  venture_cell_id uuid not null references public.af_venture_cells(id) on delete cascade,
  metric text not null,
  value numeric not null,
  unit text,
  evidence_class text not null check (evidence_class in ('MEASURED','OBSERVED','CONFIRMED','DERIVED','INFERRED','ASSUMPTION','UNKNOWN','BLOCKER')),
  evidence_refs uuid[] not null default '{}'::uuid[],
  provenance jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);

create table if not exists public.af_venture_bottlenecks (
  id uuid primary key default gen_random_uuid(),
  venture_cell_id uuid not null references public.af_venture_cells(id) on delete cascade,
  stage text not null check (stage in ('RESOURCE','MATERIAL','GLOBAL_NEED','PRODUCT','MANUFACTURING','GO_TO_MARKET','USER_FEEDBACK')),
  specialization text not null,
  metric text not null,
  description text not null,
  severity numeric not null check (severity >= 0 and severity <= 1),
  existing_capability_score numeric not null check (existing_capability_score >= 0 and existing_capability_score <= 100),
  expected_gain numeric not null check (expected_gain >= 0 and expected_gain <= 100),
  evidence_class text not null check (evidence_class in ('MEASURED','OBSERVED','CONFIRMED','DERIVED')),
  evidence_refs uuid[] not null default '{}'::uuid[],
  status text not null default 'OPEN' check (status in ('OPEN','GAP_CONFIRMED','REPAIRING','RESOLVED','REJECTED')),
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.af_specialization_gaps (
  id uuid primary key default gen_random_uuid(),
  venture_cell_id uuid not null references public.af_venture_cells(id) on delete cascade,
  bottleneck_id uuid not null references public.af_venture_bottlenecks(id) on delete restrict,
  specialization text not null,
  metric text not null,
  severity numeric not null check (severity >= 0 and severity <= 1),
  existing_capability_score numeric not null check (existing_capability_score >= 0 and existing_capability_score <= 100),
  expected_gain numeric not null check (expected_gain >= 0 and expected_gain <= 100),
  parent_refs text[] not null default '{}'::text[],
  child_candidate_id text references public.af_agent_candidates(candidate_id) on delete set null,
  breeding_event_id uuid references public.af_agent_breeding_events(id) on delete set null,
  status text not null default 'CONFIRMED' check (status in ('CONFIRMED','BREEDING','EVALUATING','RESOLVED','REJECTED')),
  evidence_refs uuid[] not null default '{}'::uuid[],
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(venture_cell_id,bottleneck_id)
);

create table if not exists public.af_venture_feedback_events (
  id uuid primary key default gen_random_uuid(),
  venture_cell_id uuid not null references public.af_venture_cells(id) on delete cascade,
  run_id uuid not null references public.af_value_chain_runs(id) on delete restrict,
  kind text not null,
  summary text not null,
  severity numeric not null check (severity >= 0 and severity <= 1),
  measured_regression boolean not null default false,
  target_stage text not null check (target_stage in ('RESOURCE','MATERIAL','GLOBAL_NEED','PRODUCT','MANUFACTURING','GO_TO_MARKET','USER_FEEDBACK')),
  action text not null check (action in ('CONFIRM','LOWER_CONFIDENCE','REPAIR','SUPERSEDE','BRANCH')),
  evidence_class text not null check (evidence_class in ('MEASURED','OBSERVED','CONFIRMED','DERIVED')),
  evidence_refs uuid[] not null default '{}'::uuid[],
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.af_capability_proofs (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null references public.af_agent_candidates(candidate_id) on delete cascade,
  venture_cell_id uuid not null references public.af_venture_cells(id) on delete cascade,
  outcome text not null check (outcome in ('WIN','LOSS','INCONCLUSIVE','BLOCKED')),
  metric text not null,
  value numeric,
  evidence_refs uuid[] not null default '{}'::uuid[],
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.af_capability_promotions (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null references public.af_agent_candidates(candidate_id) on delete cascade,
  scope text not null check (scope in ('VENTURE_LOCAL','CROSS_VENTURE_PROVEN','FACTORY_WIDE_CAPABILITY')),
  independent_ventures integer not null default 0 check (independent_ventures >= 0),
  proof_refs uuid[] not null default '{}'::uuid[],
  authority_expanded boolean not null default false check (authority_expanded = false),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUPERSEDED','REVOKED')),
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);

create unique index if not exists af_capability_promotions_one_active_idx
  on public.af_capability_promotions(candidate_id)
  where status = 'ACTIVE';

create index if not exists af_value_chain_candidates_run_idx on public.af_value_chain_candidates(run_id,valid,score desc);
create index if not exists af_venture_cells_status_idx on public.af_venture_cells(status,created_at desc);
create index if not exists af_venture_bottlenecks_open_idx on public.af_venture_bottlenecks(venture_cell_id,status,severity desc);
create index if not exists af_specialization_gaps_status_idx on public.af_specialization_gaps(status,created_at);
create index if not exists af_capability_proofs_candidate_idx on public.af_capability_proofs(candidate_id,venture_cell_id,created_at desc);
create index if not exists af_venture_feedback_run_idx on public.af_venture_feedback_events(run_id,created_at desc);

create or replace function public.af_claim_venture_run(p_worker text)
returns setof public.af_value_chain_runs
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_worker),'') is null then raise exception 'worker_required'; end if;
  return query
  with picked as (
    select id from public.af_value_chain_runs
    where status in ('DISCOVERING','WORKING')
      and (locked_at is null or locked_at < now() - interval '15 minutes')
    order by created_at
    for update skip locked
    limit 1
  )
  update public.af_value_chain_runs r
     set status='WORKING', locked_at=now(), locked_by=left(p_worker,200), attempts=r.attempts+1, updated_at=now()
    from picked
   where r.id=picked.id
  returning r.*;
end;
$$;

create or replace function public.af_release_venture_run(p_run_id uuid, p_status text, p_error jsonb default '{}'::jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('DISCOVERING','WORKING','EVALUATING','ACTIONABLE','BLOCKED','REJECTED','COMPLETE') then raise exception 'invalid_status'; end if;
  update public.af_value_chain_runs
     set status=p_status,
         last_error=coalesce(p_error,'{}'::jsonb),
         locked_at=null,
         locked_by=null,
         updated_at=now(),
         completed_at=case when p_status='COMPLETE' then now() else completed_at end
   where id=p_run_id;
  return found;
end;
$$;

create or replace function public.af_set_active_champion(
  p_niche text,
  p_context_key text,
  p_candidate_id text,
  p_fitness_snapshot jsonb,
  p_evidence_refs uuid[] default '{}'::uuid[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passes integer;
  v_id uuid;
  v_evidence numeric;
  v_truth numeric;
  v_safety numeric;
begin
  select count(*),
         avg(nullif(scores->>'evidence_quality','')::numeric),
         avg(nullif(scores->>'truthfulness','')::numeric),
         avg(nullif(scores->>'safety_compliance','')::numeric)
    into v_passes,v_evidence,v_truth,v_safety
    from public.af_agent_fitness_trials
   where candidate_id=p_candidate_id and niche=p_niche and context_key=coalesce(nullif(p_context_key,''),'global') and outcome='PASS';
  if v_passes < 3 then raise exception 'champion_requires_three_pass_trials'; end if;
  if coalesce(v_evidence,0) < 75 or coalesce(v_truth,0) < 75 or coalesce(v_safety,0) < 75 then raise exception 'champion_hard_gate_failed'; end if;

  update public.af_agent_champions
     set status='SUPERSEDED', superseded_at=now()
   where niche=p_niche and context_key=coalesce(nullif(p_context_key,''),'global') and status='ACTIVE' and candidate_id<>p_candidate_id;

  insert into public.af_agent_champions(niche,context_key,candidate_id,status,fitness_snapshot,evidence_refs,selection_method)
  values(p_niche,coalesce(nullif(p_context_key,''),'global'),p_candidate_id,'ACTIVE',coalesce(p_fitness_snapshot,'{}'::jsonb),coalesce(p_evidence_refs,'{}'::uuid[]),'pareto-plus-context')
  on conflict(niche,context_key,candidate_id) do update set status='ACTIVE',fitness_snapshot=excluded.fitness_snapshot,evidence_refs=excluded.evidence_refs,selected_at=now(),superseded_at=null
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.af_promote_capability_scope(p_candidate_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ventures integer;
  v_scope text;
  v_refs uuid[];
begin
  select count(*), coalesce(array_agg(id),'{}'::uuid[])
    into v_ventures,v_refs
    from (
      select min(id) as id, venture_cell_id
      from public.af_capability_proofs
      where candidate_id=p_candidate_id and outcome='WIN'
      group by venture_cell_id
      having count(*) >= 2
    ) q;
  v_scope := case when v_ventures >= 3 then 'FACTORY_WIDE_CAPABILITY' when v_ventures >= 2 then 'CROSS_VENTURE_PROVEN' else 'VENTURE_LOCAL' end;
  update public.af_capability_promotions set status='SUPERSEDED',superseded_at=now() where candidate_id=p_candidate_id and status='ACTIVE';
  insert into public.af_capability_promotions(candidate_id,scope,independent_ventures,proof_refs,authority_expanded,status,provenance)
  values(p_candidate_id,v_scope,v_ventures,v_refs,false,'ACTIVE',jsonb_build_object('rule','two wins per independent venture; 2 ventures cross, 3 ventures factory-wide'));
  return v_scope;
end;
$$;

alter table public.af_value_chain_candidates enable row level security;
alter table public.af_venture_cells enable row level security;
alter table public.af_venture_cell_members enable row level security;
alter table public.af_venture_experiments enable row level security;
alter table public.af_venture_metrics enable row level security;
alter table public.af_venture_bottlenecks enable row level security;
alter table public.af_specialization_gaps enable row level security;
alter table public.af_venture_feedback_events enable row level security;
alter table public.af_capability_proofs enable row level security;
alter table public.af_capability_promotions enable row level security;

revoke all on public.af_value_chain_candidates,public.af_venture_cells,public.af_venture_cell_members,public.af_venture_experiments,public.af_venture_metrics,public.af_venture_bottlenecks,public.af_specialization_gaps,public.af_venture_feedback_events,public.af_capability_proofs,public.af_capability_promotions from public,anon,authenticated;
grant all on public.af_value_chain_candidates,public.af_venture_cells,public.af_venture_cell_members,public.af_venture_experiments,public.af_venture_metrics,public.af_venture_bottlenecks,public.af_specialization_gaps,public.af_venture_feedback_events,public.af_capability_proofs,public.af_capability_promotions to service_role;

revoke all on function public.af_claim_venture_run(text) from public,anon,authenticated;
revoke all on function public.af_release_venture_run(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.af_set_active_champion(text,text,text,jsonb,uuid[]) from public,anon,authenticated;
revoke all on function public.af_promote_capability_scope(text) from public,anon,authenticated;
grant execute on function public.af_claim_venture_run(text),public.af_release_venture_run(uuid,text,jsonb),public.af_set_active_champion(text,text,text,jsonb,uuid[]),public.af_promote_capability_scope(text) to service_role;
