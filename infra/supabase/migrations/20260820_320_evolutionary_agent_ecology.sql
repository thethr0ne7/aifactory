create table if not exists public.af_agent_genomes (
  candidate_id text primary key references public.af_agent_candidates(candidate_id) on delete cascade,
  genome_version integer not null default 1 check (genome_version>0),
  genome jsonb not null default '{}'::jsonb,
  immutable_factory_genes jsonb not null default '{}'::jsonb,
  lineage_refs text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.af_agent_fitness_trials (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null references public.af_agent_candidates(candidate_id) on delete cascade,
  niche text not null,
  context_key text not null default 'global',
  task_ref text,
  outcome text not null check (outcome in ('PASS','FAIL','INCONCLUSIVE','BLOCKED')),
  scores jsonb not null default '{}'::jsonb,
  evidence_refs uuid[] not null default '{}'::uuid[],
  latency_ms bigint,
  cost_units numeric,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.af_agent_champions (
  id uuid primary key default gen_random_uuid(),
  niche text not null,
  context_key text not null default 'global',
  candidate_id text not null references public.af_agent_candidates(candidate_id) on delete cascade,
  status text not null default 'CHALLENGER' check (status in ('CHALLENGER','ACTIVE','SUPERSEDED','RETIRED')),
  fitness_snapshot jsonb not null default '{}'::jsonb,
  evidence_refs uuid[] not null default '{}'::uuid[],
  selection_method text not null default 'pareto-plus-context',
  selected_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique(niche,context_key,candidate_id)
);

create unique index if not exists af_agent_champions_one_active_idx
on public.af_agent_champions(niche,context_key)
where status='ACTIVE';

create table if not exists public.af_agent_breeding_events (
  id uuid primary key default gen_random_uuid(),
  objective text not null,
  niche text,
  context_key text not null default 'global',
  parent_refs text[] not null default '{}'::text[],
  parent_traits jsonb not null default '{}'::jsonb,
  crossover jsonb not null default '{}'::jsonb,
  mutation jsonb not null default '{}'::jsonb,
  expected_gain jsonb not null default '{}'::jsonb,
  child_candidate_id text references public.af_agent_candidates(candidate_id) on delete set null,
  status text not null default 'PROPOSED' check (status in ('PROPOSED','RESEARCHING','EVIDENCED','AUDITED','SPAWNED','PUBLISHED','TRAINING','EVALUATING','RETAINED','REJECTED','QUARANTINED')),
  evidence_refs uuid[] not null default '{}'::uuid[],
  audit_evidence_refs uuid[] not null default '{}'::uuid[],
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.af_value_chain_runs (
  id uuid primary key default gen_random_uuid(),
  project_ref text,
  objective text not null,
  status text not null default 'DISCOVERING' check (status in ('DISCOVERING','WORKING','EVALUATING','ACTIONABLE','BLOCKED','REJECTED','COMPLETE')),
  current_stage text not null default 'RESOURCE' check (current_stage in ('RESOURCE','MATERIAL','GLOBAL_NEED','PRODUCT','MANUFACTURING','GO_TO_MARKET','USER_FEEDBACK','SELECTION')),
  context jsonb not null default '{}'::jsonb,
  selected_chain jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.af_value_chain_stage_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.af_value_chain_runs(id) on delete cascade,
  stage text not null check (stage in ('RESOURCE','MATERIAL','GLOBAL_NEED','PRODUCT','MANUFACTURING','GO_TO_MARKET','USER_FEEDBACK','SELECTION')),
  candidate_id text not null references public.af_agent_candidates(candidate_id) on delete restrict,
  claim text not null,
  evidence_class text not null check (evidence_class in ('MEASURED','OBSERVED','CONFIRMED','DERIVED','INFERRED','ASSUMPTION','UNKNOWN','BLOCKER')),
  evidence_refs uuid[] not null default '{}'::uuid[],
  metrics jsonb not null default '{}'::jsonb,
  status text not null default 'PROPOSED' check (status in ('PROPOSED','PASS','BLOCK','REPAIR','SUPERSEDED')),
  created_at timestamptz not null default now()
);

create index if not exists af_agent_fitness_niche_idx on public.af_agent_fitness_trials(niche,context_key,candidate_id,created_at desc);
create index if not exists af_agent_breeding_status_idx on public.af_agent_breeding_events(status,created_at);
create index if not exists af_value_chain_runs_status_idx on public.af_value_chain_runs(status,current_stage,created_at);
create index if not exists af_value_chain_stage_run_idx on public.af_value_chain_stage_results(run_id,stage,created_at);

create or replace view public.af_agent_fitness_summary
with (security_invoker=true)
as
select candidate_id,niche,context_key,
       count(*) filter (where outcome='PASS') as pass_count,
       count(*) as trial_count,
       avg(nullif(scores->>'task_success','')::numeric) as task_success,
       avg(nullif(scores->>'evidence_quality','')::numeric) as evidence_quality,
       avg(nullif(scores->>'truthfulness','')::numeric) as truthfulness,
       avg(nullif(scores->>'contradiction_detection','')::numeric) as contradiction_detection,
       avg(nullif(scores->>'downstream_value','')::numeric) as downstream_value,
       avg(nullif(scores->>'cost_efficiency','')::numeric) as cost_efficiency,
       avg(nullif(scores->>'tool_discipline','')::numeric) as tool_discipline,
       avg(nullif(scores->>'safety_compliance','')::numeric) as safety_compliance,
       avg(latency_ms)::bigint as avg_latency_ms,
       max(created_at) as last_trial_at
from public.af_agent_fitness_trials
group by candidate_id,niche,context_key;

alter table public.af_agent_genomes enable row level security;
alter table public.af_agent_fitness_trials enable row level security;
alter table public.af_agent_champions enable row level security;
alter table public.af_agent_breeding_events enable row level security;
alter table public.af_value_chain_runs enable row level security;
alter table public.af_value_chain_stage_results enable row level security;

revoke all on public.af_agent_genomes,public.af_agent_fitness_trials,public.af_agent_champions,public.af_agent_breeding_events,public.af_value_chain_runs,public.af_value_chain_stage_results from public,anon,authenticated;
revoke all on public.af_agent_fitness_summary from public,anon,authenticated;
grant all on public.af_agent_genomes,public.af_agent_fitness_trials,public.af_agent_champions,public.af_agent_breeding_events,public.af_value_chain_runs,public.af_value_chain_stage_results to service_role;
grant select on public.af_agent_fitness_summary to service_role;
