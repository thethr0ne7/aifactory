-- AI Factory 2.4: durable bounded inter-agent message bus.
-- Service-role only. No table or RPC below grants production authority to an Agent.

create table if not exists public.af_agent_messages (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null default gen_random_uuid(),
  causation_id uuid references public.af_agent_messages(id) on delete set null,
  from_agent_ref text not null,
  to_agent_ref text not null,
  kind text not null check (kind in ('TASK','HANDOFF','EVIDENCE','REVIEW','RESULT','INCIDENT','BIRTH_PROPOSAL')),
  stage text not null check (stage in ('RESEARCH','EVIDENCE','BUILD','AUDIT','BIRTH','CONTROL')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'QUEUED' check (status in ('QUEUED','CLAIMED','DELIVERED','FAILED','DEAD_LETTER','BLOCKED')),
  priority integer not null default 100 check (priority between 0 and 1000),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  delivered_at timestamptz,
  last_error jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists af_agent_messages_ready_idx
  on public.af_agent_messages(status, available_at, priority desc, created_at)
  where status = 'QUEUED';
create index if not exists af_agent_messages_correlation_idx
  on public.af_agent_messages(correlation_id, created_at);
create index if not exists af_agent_messages_recipient_idx
  on public.af_agent_messages(to_agent_ref, status, available_at);

create table if not exists public.af_shared_evidence (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null,
  message_id uuid references public.af_agent_messages(id) on delete set null,
  producer_agent_ref text not null,
  stage text not null check (stage in ('RESEARCH','EVIDENCE','BUILD','AUDIT','BIRTH','CONTROL')),
  evidence_class text not null check (evidence_class in ('CONFIRMED','OBSERVED','MEASURED','DERIVED','ASSUMPTION','UNKNOWN','BLOCKER')),
  claim text not null,
  source_refs jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  supersedes_id uuid references public.af_shared_evidence(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists af_shared_evidence_correlation_idx
  on public.af_shared_evidence(correlation_id, stage, created_at);

create table if not exists public.af_agent_handoffs (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null,
  from_stage text not null check (from_stage in ('RESEARCH','EVIDENCE','BUILD','AUDIT','BIRTH','CONTROL')),
  to_stage text not null check (to_stage in ('RESEARCH','EVIDENCE','BUILD','AUDIT','BIRTH','CONTROL')),
  from_agent_ref text not null,
  to_agent_ref text not null,
  message_id uuid references public.af_agent_messages(id) on delete set null,
  evidence_refs jsonb not null default '[]'::jsonb,
  gate_status text not null check (gate_status in ('PASS','BLOCK','REPAIR','PENDING')),
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists af_agent_handoffs_correlation_idx
  on public.af_agent_handoffs(correlation_id, created_at);

create table if not exists public.af_agent_birth_proposals (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null,
  proposed_candidate_id text not null,
  proposed_name text not null,
  proposed_role text not null,
  generation integer not null check (generation >= 1),
  autonomy_level text not null default 'A2' check (autonomy_level in ('A0','A1','A2','A3')),
  parent_refs jsonb not null default '[]'::jsonb,
  sponsor_agent_refs jsonb not null default '[]'::jsonb,
  evidence_refs jsonb not null default '[]'::jsonb,
  blueprint jsonb not null default '{}'::jsonb,
  audit_result jsonb not null default '{}'::jsonb,
  status text not null default 'PROPOSED' check (status in ('PROPOSED','EVALUATING','APPROVED_FOR_SPAWN','SPAWNED','REJECTED','BLOCKED')),
  n8n_agent_id text,
  production_authority_granted boolean not null default false,
  publication_attempted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(correlation_id, proposed_candidate_id)
);
create index if not exists af_agent_birth_proposals_status_idx
  on public.af_agent_birth_proposals(status, created_at desc);

alter table public.af_agent_messages enable row level security;
alter table public.af_shared_evidence enable row level security;
alter table public.af_agent_handoffs enable row level security;
alter table public.af_agent_birth_proposals enable row level security;

revoke all on public.af_agent_messages from public, anon, authenticated;
revoke all on public.af_shared_evidence from public, anon, authenticated;
revoke all on public.af_agent_handoffs from public, anon, authenticated;
revoke all on public.af_agent_birth_proposals from public, anon, authenticated;

grant select, insert, update on public.af_agent_messages to service_role;
grant select, insert on public.af_shared_evidence to service_role;
grant select, insert on public.af_agent_handoffs to service_role;
grant select, insert, update on public.af_agent_birth_proposals to service_role;

create or replace function public.af_bus_claim(p_worker text, p_limit integer default 4)
returns setof public.af_agent_messages
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_worker is null or btrim(p_worker) = '' then
    raise exception 'worker required';
  end if;
  if p_limit < 1 or p_limit > 6 then
    raise exception 'claim limit must be 1..6';
  end if;

  return query
  with picked as (
    select m.id
    from public.af_agent_messages m
    where m.status = 'QUEUED'
      and m.available_at <= now()
      and m.attempts < m.max_attempts
    order by m.priority desc, m.created_at
    for update skip locked
    limit p_limit
  ), updated as (
    update public.af_agent_messages m
       set status = 'CLAIMED',
           locked_by = p_worker,
           locked_at = now(),
           attempts = m.attempts + 1,
           updated_at = now()
      from picked
     where m.id = picked.id
    returning m.*
  )
  select * from updated;
end;
$$;

create or replace function public.af_bus_complete(p_message_id uuid, p_worker text, p_result jsonb default '{}'::jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare affected integer;
begin
  update public.af_agent_messages
     set status = 'DELIVERED', result = coalesce(p_result, '{}'::jsonb), delivered_at = now(), locked_at = null, locked_by = null, updated_at = now()
   where id = p_message_id and status = 'CLAIMED' and locked_by = p_worker;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.af_bus_fail(p_message_id uuid, p_worker text, p_error jsonb, p_retry_seconds integer default 30)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare next_status text; current_attempts integer; current_max integer;
begin
  select attempts, max_attempts into current_attempts, current_max
  from public.af_agent_messages
  where id = p_message_id and status = 'CLAIMED' and locked_by = p_worker
  for update;
  if not found then return 'NOT_CLAIMED'; end if;
  next_status := case when current_attempts >= current_max then 'DEAD_LETTER' else 'QUEUED' end;
  update public.af_agent_messages
     set status = next_status,
         last_error = coalesce(p_error, '{}'::jsonb),
         available_at = case when next_status = 'QUEUED' then now() + make_interval(secs => greatest(5, least(p_retry_seconds, 3600))) else available_at end,
         locked_at = null,
         locked_by = null,
         updated_at = now()
   where id = p_message_id;
  return next_status;
end;
$$;

create or replace function public.af_bus_recover_stale(p_stale_minutes integer default 10)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare affected integer;
begin
  if p_stale_minutes < 5 then raise exception 'stale window must be at least 5 minutes'; end if;
  update public.af_agent_messages
     set status = case when attempts >= max_attempts then 'DEAD_LETTER' else 'QUEUED' end,
         locked_at = null,
         locked_by = null,
         available_at = now(),
         last_error = coalesce(last_error, '{}'::jsonb) || jsonb_build_object('recovered_stale_claim_at', now()),
         updated_at = now()
   where status = 'CLAIMED'
     and locked_at < now() - make_interval(mins => p_stale_minutes);
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.af_bus_claim(text, integer) from public, anon, authenticated;
revoke all on function public.af_bus_complete(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.af_bus_fail(uuid, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.af_bus_recover_stale(integer) from public, anon, authenticated;
grant execute on function public.af_bus_claim(text, integer) to service_role;
grant execute on function public.af_bus_complete(uuid, text, jsonb) to service_role;
grant execute on function public.af_bus_fail(uuid, text, jsonb, integer) to service_role;
grant execute on function public.af_bus_recover_stale(integer) to service_role;
