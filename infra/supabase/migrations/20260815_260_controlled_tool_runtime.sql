-- AI Factory controlled tool runtime v1
-- Adds a durable request/result ledger and WAITING_TOOLS resume semantics.
-- The database independently enforces the small v1 tool allowlist and autonomy floor.

create table if not exists public.af_tool_requests (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.af_runs(id) on delete cascade,
  task_id uuid not null references public.af_tasks(id) on delete cascade,
  tool_id text not null,
  request_key text not null,
  arguments jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING','CLAIMED','EXECUTED','DENIED','FAILED')),
  risk_class text not null check (risk_class in ('LOW','MEDIUM','HIGH','ROOT_OR_CATASTROPHIC')),
  requested_autonomy text not null check (requested_autonomy in ('A0','A1','A2','A3','A4','A5','A6','A7')),
  required_autonomy text not null check (required_autonomy in ('A0','A1','A2','A3','A4','A5','A6','A7')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  claimed_by text,
  claimed_at timestamptz,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(run_id, request_key)
);

create table if not exists public.af_tool_results (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.af_tool_requests(id) on delete cascade,
  run_id uuid not null references public.af_runs(id) on delete cascade,
  task_id uuid not null references public.af_tasks(id) on delete cascade,
  outcome text not null check (outcome in ('EXECUTED','DENIED','FAILED')),
  result jsonb not null default '{}'::jsonb,
  error jsonb,
  evidence_class text not null default 'OBSERVED' check (evidence_class in ('MEASURED','OBSERVED','CONFIRMED','DERIVED','INFERRED','ASSUMPTION','UNKNOWN','BLOCKER')),
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists af_tool_requests_claim_idx on public.af_tool_requests(status, created_at);
create index if not exists af_tool_requests_task_idx on public.af_tool_requests(task_id, status, created_at);
create index if not exists af_tool_requests_run_idx on public.af_tool_requests(run_id, created_at);
create index if not exists af_tool_results_run_idx on public.af_tool_results(run_id, created_at);

alter table public.af_runs drop constraint if exists af_runs_status_check;
alter table public.af_runs add constraint af_runs_status_check check (status in ('QUEUED','QUALIFYING','ROUTED','WORKING','WAITING_TOOLS','VALIDATING','REPAIRING','LEARNING','COMPLETE','BLOCKED','FAILED'));
alter table public.af_tasks drop constraint if exists af_tasks_status_check;
alter table public.af_tasks add constraint af_tasks_status_check check (status in ('QUEUED','WORKING','WAITING_TOOLS','COMPLETE','BLOCKED','FAILED'));

create or replace function public.af_autonomy_rank(p_level text)
returns integer
language sql
immutable
as $$
  select case p_level
    when 'A0' then 0 when 'A1' then 1 when 'A2' then 2 when 'A3' then 3
    when 'A4' then 4 when 'A5' then 5 when 'A6' then 6 when 'A7' then 7
    else -1 end;
$$;

create or replace function public.af_request_tool(
  p_run_id uuid,
  p_task_id uuid,
  p_tool_id text,
  p_request_key text,
  p_arguments jsonb default '{}'::jsonb,
  p_required_autonomy text default 'A3',
  p_risk_class text default 'LOW',
  p_provenance jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_autonomy text;
  v_existing public.af_tool_requests%rowtype;
  v_id uuid;
  v_required text;
  v_risk text;
begin
  if p_tool_id not in ('factory.repo.read_file','factory.repo.list_files','factory.repo.run_validation','factory.repo.candidate_write') then
    raise exception 'tool is not allowlisted';
  end if;

  -- v1 allowlist is intentionally small: all tools are A3/LOW and side effects are confined to candidate branches.
  v_required := 'A3';
  v_risk := 'LOW';
  if p_required_autonomy <> v_required or p_risk_class <> v_risk then
    raise exception 'tool policy mismatch';
  end if;
  if p_request_key is null or p_request_key !~ '^[a-z0-9][a-z0-9._:-]{2,119}$' then
    raise exception 'invalid request key';
  end if;
  if octet_length(coalesce(p_arguments, '{}'::jsonb)::text) > 120000 then
    raise exception 'tool arguments too large';
  end if;

  select r.autonomy_level into v_run_autonomy
  from public.af_runs r
  join public.af_tasks t on t.run_id=r.id
  where r.id=p_run_id and t.id=p_task_id and t.run_id=p_run_id
    and r.status not in ('COMPLETE','BLOCKED','FAILED')
  for update of r;
  if v_run_autonomy is null then raise exception 'run/task not found or terminal'; end if;
  if public.af_autonomy_rank(v_run_autonomy) < public.af_autonomy_rank(v_required) then
    raise exception 'run autonomy below tool requirement';
  end if;

  select * into v_existing from public.af_tool_requests where run_id=p_run_id and request_key=p_request_key;
  if found then
    if v_existing.tool_id <> p_tool_id or v_existing.arguments <> coalesce(p_arguments,'{}'::jsonb) then
      raise exception 'request key reused with different tool or arguments';
    end if;
    return v_existing.id;
  end if;

  insert into public.af_tool_requests(
    run_id,task_id,tool_id,request_key,arguments,risk_class,requested_autonomy,required_autonomy,provenance
  ) values (
    p_run_id,p_task_id,p_tool_id,p_request_key,coalesce(p_arguments,'{}'::jsonb),v_risk,v_run_autonomy,v_required,coalesce(p_provenance,'{}'::jsonb)
  ) returning id into v_id;

  insert into public.af_events(run_id,task_id,event_type,source,evidence_class,payload,provenance)
  values (p_run_id,p_task_id,'TOOL_REQUESTED','tool-runtime','CONFIRMED',jsonb_build_object('request_id',v_id,'tool_id',p_tool_id,'request_key',p_request_key),coalesce(p_provenance,'{}'::jsonb));
  return v_id;
end;
$$;

create or replace function public.af_wait_for_tools(p_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
begin
  select run_id into v_run_id from public.af_tasks where id=p_task_id for update;
  if v_run_id is null then raise exception 'task not found'; end if;
  if not exists (select 1 from public.af_tool_requests where task_id=p_task_id and status in ('PENDING','CLAIMED')) then
    raise exception 'no pending tool requests';
  end if;

  update public.af_tasks set status='WAITING_TOOLS',locked_at=null,locked_by=null,updated_at=now() where id=p_task_id;
  update public.af_runs set status='WAITING_TOOLS',heartbeat_at=now(),updated_at=now() where id=v_run_id and status not in ('COMPLETE','BLOCKED','FAILED');
  insert into public.af_events(run_id,task_id,event_type,source,evidence_class,payload)
  values (v_run_id,p_task_id,'WAITING_FOR_TOOLS','tool-runtime','CONFIRMED','{}'::jsonb);
  return v_run_id;
end;
$$;

create or replace function public.af_recover_stale_tools(p_stale_minutes integer default 20)
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
    update public.af_tool_requests
    set status='PENDING',claimed_by=null,claimed_at=null,updated_at=now()
    where status='CLAIMED'
      and claimed_at < now() - make_interval(mins => greatest(5,least(coalesce(p_stale_minutes,20),1440)))
      and attempts < max_attempts
    returning id
  ) select count(*) into v_requeued from changed;

  with exhausted as (
    update public.af_tool_requests
    set status='FAILED',claimed_by=null,completed_at=now(),updated_at=now()
    where status='CLAIMED'
      and claimed_at < now() - make_interval(mins => greatest(5,least(coalesce(p_stale_minutes,20),1440)))
      and attempts >= max_attempts
    returning id,run_id,task_id
  ), inserted as (
    insert into public.af_tool_results(request_id,run_id,task_id,outcome,error,evidence_class)
    select id,run_id,task_id,'FAILED',jsonb_build_object('code','TOOL_RETRY_BUDGET_EXHAUSTED'),'BLOCKER' from exhausted
    on conflict (request_id) do nothing
    returning request_id
  ) select count(*) into v_failed from inserted;

  update public.af_tasks t
  set status='QUEUED',available_at=now(),locked_at=null,locked_by=null,updated_at=now()
  where t.status='WAITING_TOOLS'
    and exists (select 1 from public.af_tool_requests q where q.task_id=t.id)
    and not exists (select 1 from public.af_tool_requests q where q.task_id=t.id and q.status in ('PENDING','CLAIMED'));

  update public.af_runs r
  set status='QUEUED',heartbeat_at=now(),updated_at=now()
  where r.status='WAITING_TOOLS'
    and exists (select 1 from public.af_tasks t where t.run_id=r.id and t.status='QUEUED');

  return jsonb_build_object('requeued',v_requeued,'failed',v_failed,'at',now());
end;
$$;

create or replace function public.af_claim_tool_request(p_worker_id text)
returns setof public.af_tool_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_worker_id is null or length(trim(p_worker_id))=0 then raise exception 'worker id is required'; end if;
  select id into v_id
  from public.af_tool_requests
  where status='PENDING' and attempts < max_attempts
  order by created_at asc
  for update skip locked
  limit 1;
  if v_id is null then return; end if;

  update public.af_tool_requests
  set status='CLAIMED',claimed_by=left(p_worker_id,200),claimed_at=now(),attempts=attempts+1,updated_at=now()
  where id=v_id;

  insert into public.af_events(run_id,task_id,event_type,source,evidence_class,payload)
  select run_id,task_id,'TOOL_CLAIMED','tool-runtime','CONFIRMED',jsonb_build_object('request_id',id,'tool_id',tool_id,'worker',left(p_worker_id,200))
  from public.af_tool_requests where id=v_id;

  return query select * from public.af_tool_requests where id=v_id;
end;
$$;

create or replace function public.af_finish_tool_request(
  p_request_id uuid,
  p_status text,
  p_result jsonb default '{}'::jsonb,
  p_error jsonb default null,
  p_evidence_class text default 'OBSERVED',
  p_provenance jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_task_id uuid;
begin
  if p_status not in ('EXECUTED','DENIED','FAILED') then raise exception 'invalid tool terminal status'; end if;
  if p_evidence_class not in ('MEASURED','OBSERVED','CONFIRMED','DERIVED','INFERRED','ASSUMPTION','UNKNOWN','BLOCKER') then raise exception 'invalid evidence class'; end if;

  select run_id,task_id into v_run_id,v_task_id from public.af_tool_requests where id=p_request_id for update;
  if v_run_id is null then raise exception 'tool request not found'; end if;

  update public.af_tool_requests
  set status=p_status,claimed_by=null,completed_at=now(),updated_at=now()
  where id=p_request_id;

  insert into public.af_tool_results(request_id,run_id,task_id,outcome,result,error,evidence_class,provenance)
  values (p_request_id,v_run_id,v_task_id,p_status,coalesce(p_result,'{}'::jsonb),p_error,p_evidence_class,coalesce(p_provenance,'{}'::jsonb))
  on conflict (request_id) do update
    set outcome=excluded.outcome,result=excluded.result,error=excluded.error,evidence_class=excluded.evidence_class,provenance=excluded.provenance;

  insert into public.af_events(run_id,task_id,event_type,source,evidence_class,payload,provenance)
  values (v_run_id,v_task_id,'TOOL_' || p_status,'tool-runtime',p_evidence_class,jsonb_build_object('request_id',p_request_id),coalesce(p_provenance,'{}'::jsonb));

  if not exists (select 1 from public.af_tool_requests where task_id=v_task_id and status in ('PENDING','CLAIMED')) then
    update public.af_tasks set status='QUEUED',available_at=now(),locked_at=null,locked_by=null,updated_at=now() where id=v_task_id and status='WAITING_TOOLS';
    update public.af_runs set status='QUEUED',heartbeat_at=now(),updated_at=now() where id=v_run_id and status='WAITING_TOOLS';
    insert into public.af_events(run_id,task_id,event_type,source,evidence_class,payload)
    values (v_run_id,v_task_id,'TOOL_BATCH_READY','tool-runtime','CONFIRMED',jsonb_build_object('request_id',p_request_id));
  end if;
  return v_run_id;
end;
$$;

alter table public.af_tool_requests enable row level security;
alter table public.af_tool_results enable row level security;
revoke all on public.af_tool_requests, public.af_tool_results from anon, authenticated;
revoke all on function public.af_autonomy_rank(text) from public, anon, authenticated;
revoke all on function public.af_request_tool(uuid,uuid,text,text,jsonb,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.af_wait_for_tools(uuid) from public, anon, authenticated;
revoke all on function public.af_recover_stale_tools(integer) from public, anon, authenticated;
revoke all on function public.af_claim_tool_request(text) from public, anon, authenticated;
revoke all on function public.af_finish_tool_request(uuid,text,jsonb,jsonb,text,jsonb) from public, anon, authenticated;

grant execute on function public.af_autonomy_rank(text) to service_role;
grant execute on function public.af_request_tool(uuid,uuid,text,text,jsonb,text,text,jsonb) to service_role;
grant execute on function public.af_wait_for_tools(uuid) to service_role;
grant execute on function public.af_recover_stale_tools(integer) to service_role;
grant execute on function public.af_claim_tool_request(text) to service_role;
grant execute on function public.af_finish_tool_request(uuid,text,jsonb,jsonb,text,jsonb) to service_role;
