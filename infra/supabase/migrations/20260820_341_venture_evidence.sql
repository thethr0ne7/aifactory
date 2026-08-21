-- Traceable evidence produced by the hosted Venture Economy runtime.
create table if not exists public.af_venture_evidence (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.af_value_chain_runs(id) on delete cascade,
  stage text not null check (stage in ('RESOURCE','MATERIAL','GLOBAL_NEED','PRODUCT','MANUFACTURING','GO_TO_MARKET','USER_FEEDBACK','SELECTION')),
  producer_candidate_id text not null references public.af_agent_candidates(candidate_id) on delete restrict,
  evidence_class text not null check (evidence_class in ('MEASURED','OBSERVED','CONFIRMED','DERIVED')),
  claim text not null,
  source_refs text[] not null default '{}'::text[],
  payload jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists af_venture_evidence_run_stage_idx
  on public.af_venture_evidence(run_id,stage,created_at);
create index if not exists af_venture_evidence_producer_idx
  on public.af_venture_evidence(producer_candidate_id,created_at desc);

alter table public.af_venture_evidence enable row level security;
revoke all on public.af_venture_evidence from public,anon,authenticated;
grant all on public.af_venture_evidence to service_role;
