-- AI Factory 2.4: durable bounded agent population lifecycle.
-- Service-role internal state only. Runtime agents do not receive direct mutation authority over Root of Trust.

create table if not exists public.af_agent_candidates (
  candidate_id text primary key,
  n8n_agent_id text unique,
  name text not null,
  generation integer not null check (generation >= 0),
  role text not null,
  state text not null check (state in ('DRAFT','SPAWNED','TRAINING','EVALUATING','REPAIRING','CANDIDATE','PROMOTED','REJECTED','QUARANTINED')),
  autonomy_level text not null check (autonomy_level in ('A0','A1','A2','A3','A4','A5','A6','A7')),
  parent_refs jsonb not null default '[]'::jsonb,
  skills jsonb not null default '[]'::jsonb,
  tools jsonb not null default '[]'::jsonb,
  model jsonb not null default '{}'::jsonb,
  mutation_summary text,
  fingerprint text,
  fitness jsonb not null default '{}'::jsonb,
  last_evaluation_ref uuid,
  provenance jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists af_agent_candidates_fingerprint_uidx
  on public.af_agent_candidates(fingerprint)
  where fingerprint is not null;
create index if not exists af_agent_candidates_state_idx
  on public.af_agent_candidates(state, generation, updated_at desc);

create table if not exists public.af_agent_evaluations (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null references public.af_agent_candidates(candidate_id) on delete cascade,
  run_ref text,
  baseline_ref text not null,
  regression_suite_ref text not null,
  status text not null check (status in ('PENDING','PASS','FAIL','BLOCKED')),
  dimensions jsonb not null default '{}'::jsonb,
  aggregate_score numeric,
  decision text,
  failures jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists af_agent_evaluations_candidate_idx
  on public.af_agent_evaluations(candidate_id, created_at desc);

create table if not exists public.af_agent_relationships (
  id uuid primary key default gen_random_uuid(),
  parent_candidate_id text not null references public.af_agent_candidates(candidate_id) on delete cascade,
  child_candidate_id text not null references public.af_agent_candidates(candidate_id) on delete cascade,
  relation_type text not null check (relation_type in ('PARENT','MENTOR','SUPERVISOR','SUBAGENT','EVALUATOR')),
  use_when text,
  active boolean not null default true,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(parent_candidate_id, child_candidate_id, relation_type)
);
create index if not exists af_agent_relationships_parent_idx
  on public.af_agent_relationships(parent_candidate_id, active);
create index if not exists af_agent_relationships_child_idx
  on public.af_agent_relationships(child_candidate_id, active);

create table if not exists public.af_agent_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null references public.af_agent_candidates(candidate_id) on delete cascade,
  from_state text,
  to_state text not null,
  event_type text not null,
  evidence_class text not null check (evidence_class in ('CONFIRMED','OBSERVED','MEASURED','DERIVED','ASSUMPTION','UNKNOWN','BLOCKER')),
  payload jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists af_agent_lifecycle_events_candidate_idx
  on public.af_agent_lifecycle_events(candidate_id, created_at);

alter table public.af_agent_candidates enable row level security;
alter table public.af_agent_evaluations enable row level security;
alter table public.af_agent_relationships enable row level security;
alter table public.af_agent_lifecycle_events enable row level security;

revoke all on public.af_agent_candidates from public, anon, authenticated;
revoke all on public.af_agent_evaluations from public, anon, authenticated;
revoke all on public.af_agent_relationships from public, anon, authenticated;
revoke all on public.af_agent_lifecycle_events from public, anon, authenticated;

grant select, insert, update, delete on public.af_agent_candidates to service_role;
grant select, insert, update, delete on public.af_agent_evaluations to service_role;
grant select, insert, update, delete on public.af_agent_relationships to service_role;
grant select, insert, update, delete on public.af_agent_lifecycle_events to service_role;

create or replace view public.af_agent_lineage
with (security_invoker = true)
as
select
  r.parent_candidate_id,
  p.name as parent_name,
  r.child_candidate_id,
  c.name as child_name,
  r.relation_type,
  r.use_when,
  r.active,
  c.generation as child_generation,
  c.state as child_state,
  c.autonomy_level as child_autonomy_level,
  r.created_at
from public.af_agent_relationships r
join public.af_agent_candidates p on p.candidate_id = r.parent_candidate_id
join public.af_agent_candidates c on c.candidate_id = r.child_candidate_id;

revoke all on public.af_agent_lineage from public, anon, authenticated;
grant select on public.af_agent_lineage to service_role;
