create table if not exists public.af_provider_benchmarks (
  id uuid primary key default gen_random_uuid(),
  capability_id text not null,
  context_key text not null default 'general',
  benchmark_key text not null,
  status text not null default 'RUNNING' check (status in ('RUNNING','COMPLETE','FAILED')),
  spec jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (capability_id, context_key, benchmark_key)
);

create table if not exists public.af_provider_trials (
  id uuid primary key default gen_random_uuid(),
  benchmark_id uuid not null references public.af_provider_benchmarks(id) on delete cascade,
  capability_id text not null,
  context_key text not null default 'general',
  provider_id text not null,
  case_key text not null,
  attempt integer not null default 1 check (attempt between 1 and 20),
  outcome text not null check (outcome in ('PASS','FAIL','BLOCKED')),
  scores jsonb not null default '{}'::jsonb,
  raw_metrics jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (benchmark_id, provider_id, case_key, attempt)
);

create table if not exists public.af_provider_champions (
  id uuid primary key default gen_random_uuid(),
  capability_id text not null,
  context_key text not null default 'general',
  provider_id text not null,
  state text not null default 'ACTIVE_CHAMPION' check (state in ('ACTIVE_CHAMPION','SUPERSEDED')),
  fitness_snapshot jsonb not null default '{}'::jsonb,
  benchmark_id uuid references public.af_provider_benchmarks(id) on delete set null,
  production_ready boolean not null default false,
  authority_expanded boolean not null default false check (authority_expanded = false),
  activated_at timestamptz not null default now(),
  superseded_at timestamptz,
  provenance jsonb not null default '{}'::jsonb
);

create unique index if not exists af_provider_champions_one_active_idx
  on public.af_provider_champions(capability_id, context_key)
  where state = 'ACTIVE_CHAMPION';

create table if not exists public.af_provider_rechallenges (
  id uuid primary key default gen_random_uuid(),
  capability_id text not null,
  context_key text not null default 'general',
  reason text not null,
  status text not null default 'QUEUED' check (status in ('QUEUED','CLAIMED','COMPLETE','CANCELLED')),
  current_champion text,
  challenger_ids text[] not null default '{}'::text[],
  due_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.af_set_provider_champion(
  p_capability_id text,
  p_context_key text,
  p_provider_id text,
  p_fitness_snapshot jsonb,
  p_benchmark_id uuid,
  p_production_ready boolean,
  p_provenance jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.af_provider_champions%rowtype;
  v_id uuid;
begin
  if coalesce(trim(p_capability_id), '') = '' or coalesce(trim(p_context_key), '') = '' or coalesce(trim(p_provider_id), '') = '' then
    raise exception 'provider champion identifiers required';
  end if;

  select * into v_existing
  from public.af_provider_champions
  where capability_id = p_capability_id
    and context_key = p_context_key
    and state = 'ACTIVE_CHAMPION'
  for update;

  if found and v_existing.provider_id = p_provider_id then
    update public.af_provider_champions
      set fitness_snapshot = coalesce(p_fitness_snapshot, '{}'::jsonb), benchmark_id = p_benchmark_id,
          production_ready = p_production_ready, authority_expanded = false,
          provenance = coalesce(p_provenance, '{}'::jsonb), activated_at = now()
    where id = v_existing.id returning id into v_id;
    return v_id;
  end if;

  if found then
    update public.af_provider_champions set state = 'SUPERSEDED', superseded_at = now() where id = v_existing.id;
  end if;

  insert into public.af_provider_champions(capability_id, context_key, provider_id, state, fitness_snapshot, benchmark_id, production_ready, authority_expanded, provenance)
  values (p_capability_id, p_context_key, p_provider_id, 'ACTIVE_CHAMPION', coalesce(p_fitness_snapshot, '{}'::jsonb), p_benchmark_id, p_production_ready, false, coalesce(p_provenance, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

alter table public.af_provider_benchmarks enable row level security;
alter table public.af_provider_trials enable row level security;
alter table public.af_provider_champions enable row level security;
alter table public.af_provider_rechallenges enable row level security;

revoke all on public.af_provider_benchmarks from anon, authenticated;
revoke all on public.af_provider_trials from anon, authenticated;
revoke all on public.af_provider_champions from anon, authenticated;
revoke all on public.af_provider_rechallenges from anon, authenticated;
revoke all on function public.af_set_provider_champion(text,text,text,jsonb,uuid,boolean,jsonb) from public, anon, authenticated;

grant select, insert, update on public.af_provider_benchmarks to service_role;
grant select, insert on public.af_provider_trials to service_role;
grant select, insert, update on public.af_provider_champions to service_role;
grant select, insert, update on public.af_provider_rechallenges to service_role;
grant execute on function public.af_set_provider_champion(text,text,text,jsonb,uuid,boolean,jsonb) to service_role;
