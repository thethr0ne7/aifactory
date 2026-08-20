-- AI Factory 2.7: visible, owner-controllable agent organization for Telegram HQ.
-- Durable task execution stays in Supabase/n8n; Telegram is the observable control surface.

alter table public.af_telegram_topics
  add column if not exists agent_live_mode boolean not null default true,
  add column if not exists default_initiative_mode text not null default 'AUTO_INTERNAL'
    check (default_initiative_mode in ('AUTO_INTERNAL','SUGGEST','OFF'));

create table if not exists public.af_agent_sessions (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null unique default gen_random_uuid(),
  workspace_id uuid not null references public.af_telegram_workspaces(id) on delete cascade,
  topic_id uuid references public.af_telegram_topics(id) on delete set null,
  telegram_chat_id bigint not null,
  telegram_thread_id bigint not null default 1,
  root_objective text not null,
  state text not null default 'RUNNING' check (state in ('RUNNING','PAUSED','STOPPED','COMPLETE','BLOCKED')),
  initiative_mode text not null default 'AUTO_INTERNAL' check (initiative_mode in ('AUTO_INTERNAL','SUGGEST','OFF')),
  max_active_tasks integer not null default 4 check (max_active_tasks between 1 and 8),
  max_auto_tasks integer not null default 16 check (max_auto_tasks between 0 and 64),
  auto_task_count integer not null default 0 check (auto_task_count >= 0),
  max_task_depth integer not null default 6 check (max_task_depth between 1 and 12),
  initiative_cursor integer not null default 0 check (initiative_cursor >= 0),
  last_activity_at timestamptz not null default now(),
  last_initiative_at timestamptz,
  owner_last_command text,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists af_agent_sessions_thread_idx
  on public.af_agent_sessions(workspace_id,telegram_thread_id,state,updated_at desc);
create index if not exists af_agent_sessions_idle_idx
  on public.af_agent_sessions(state,initiative_mode,last_activity_at)
  where state='RUNNING' and initiative_mode<>'OFF';

create table if not exists public.af_agent_tasks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.af_agent_sessions(id) on delete cascade,
  correlation_id uuid not null,
  parent_task_id uuid references public.af_agent_tasks(id) on delete set null,
  created_by_agent_ref text not null,
  assigned_agent_ref text not null,
  domain text not null default 'general',
  objective text not null,
  rationale text,
  expected_value numeric not null default 50 check (expected_value between 0 and 100),
  risk_class text not null default 'LOW' check (risk_class in ('LOW','MEDIUM','HIGH','ROOT')),
  requires_owner_approval boolean not null default false,
  owner_decision text check (owner_decision is null or owner_decision in ('APPROVED','REJECTED')),
  status text not null default 'QUEUED' check (status in ('PROPOSED','QUEUED','CLAIMED','WORKING','WAIT_OWNER','PAUSED','DONE','BLOCKED','REJECTED','CANCELLED','FAILED')),
  priority integer not null default 500 check (priority between 0 and 1000),
  depth integer not null default 0 check (depth between 0 and 12),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  evidence_refs jsonb not null default '[]'::jsonb,
  result jsonb not null default '{}'::jsonb,
  last_error jsonb,
  fingerprint text not null,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(session_id,fingerprint)
);
create index if not exists af_agent_tasks_ready_idx
  on public.af_agent_tasks(status,available_at,priority desc,created_at)
  where status='QUEUED';
create index if not exists af_agent_tasks_session_idx
  on public.af_agent_tasks(session_id,status,created_at);
create index if not exists af_agent_tasks_agent_idx
  on public.af_agent_tasks(assigned_agent_ref,status,available_at);

create table if not exists public.af_agent_activity (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.af_agent_sessions(id) on delete cascade,
  task_id uuid references public.af_agent_tasks(id) on delete set null,
  event_type text not null check (event_type in (
    'SESSION_STARTED','OWNER_DIRECTIVE','TASK_CREATED','TASK_PROPOSED','TASK_APPROVED','TASK_REJECTED',
    'TASK_STARTED','AGENT_MESSAGE','DELEGATED','EVIDENCE','BLOCKER','OWNER_GATE','TASK_DONE','TASK_FAILED',
    'INITIATIVE','SESSION_PAUSED','SESSION_RESUMED','SESSION_STOPPED','SESSION_COMPLETE','SYSTEM'
  )),
  agent_ref text,
  target_agent_ref text,
  title text,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  telegram_status text not null default 'PENDING' check (telegram_status in ('PENDING','SENDING','DELIVERED','FAILED','SUPPRESSED')),
  telegram_message_id bigint,
  delivery_attempts integer not null default 0,
  locked_at timestamptz,
  locked_by text,
  last_error jsonb,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists af_agent_activity_delivery_idx
  on public.af_agent_activity(telegram_status,created_at)
  where telegram_status in ('PENDING','SENDING');
create index if not exists af_agent_activity_session_idx
  on public.af_agent_activity(session_id,created_at);

create table if not exists public.af_agent_controls (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.af_agent_sessions(id) on delete cascade,
  task_id uuid references public.af_agent_tasks(id) on delete set null,
  action text not null check (action in ('SUPPORT','REJECT','PAUSE','RESUME','STOP','SET_PRIORITY','SET_INITIATIVE_MODE','FOCUS','STATUS')),
  value jsonb not null default '{}'::jsonb,
  telegram_user_id bigint not null,
  telegram_message_id bigint,
  applied boolean not null default false,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index if not exists af_agent_controls_session_idx on public.af_agent_controls(session_id,created_at desc);

create or replace function public.af_claim_agent_tasks(p_worker text,p_limit integer default 4)
returns setof public.af_agent_tasks
language plpgsql
security definer
set search_path=public
as $$
begin
  if nullif(btrim(p_worker),'') is null then raise exception 'worker_required'; end if;
  if p_limit < 1 or p_limit > 8 then raise exception 'limit_must_be_1_8'; end if;
  return query
  with picked as (
    select t.id
    from public.af_agent_tasks t
    join public.af_agent_sessions s on s.id=t.session_id
    where t.status='QUEUED'
      and t.available_at<=now()
      and t.attempts<t.max_attempts
      and s.state='RUNNING'
      and (not t.requires_owner_approval or t.owner_decision='APPROVED')
      and (select count(*) from public.af_agent_tasks a where a.session_id=t.session_id and a.status in ('CLAIMED','WORKING')) < s.max_active_tasks
    order by t.priority desc,t.created_at
    for update of t skip locked
    limit p_limit
  )
  update public.af_agent_tasks t
     set status='CLAIMED',locked_by=p_worker,locked_at=now(),attempts=t.attempts+1,updated_at=now()
    from picked
   where t.id=picked.id
  returning t.*;
end;
$$;

create or replace function public.af_finish_agent_task(p_task_id uuid,p_worker text,p_status text,p_result jsonb default '{}'::jsonb,p_error jsonb default null)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare affected integer; sid uuid;
begin
  if p_status not in ('DONE','BLOCKED','WAIT_OWNER','FAILED') then raise exception 'invalid_terminal_status'; end if;
  update public.af_agent_tasks
     set status=p_status,result=coalesce(p_result,'{}'::jsonb),last_error=p_error,locked_at=null,locked_by=null,
         completed_at=case when p_status in ('DONE','BLOCKED','FAILED') then now() else null end,updated_at=now()
   where id=p_task_id and status in ('CLAIMED','WORKING') and locked_by=p_worker
   returning session_id into sid;
  get diagnostics affected=row_count;
  if affected=1 then update public.af_agent_sessions set last_activity_at=now(),updated_at=now() where id=sid; end if;
  return affected=1;
end;
$$;

create or replace function public.af_fail_agent_task(p_task_id uuid,p_worker text,p_error jsonb,p_retry_seconds integer default 30)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare a integer;m integer; next_status text;
begin
  select attempts,max_attempts into a,m from public.af_agent_tasks
   where id=p_task_id and status in ('CLAIMED','WORKING') and locked_by=p_worker for update;
  if not found then return 'NOT_CLAIMED'; end if;
  next_status:=case when a>=m then 'FAILED' else 'QUEUED' end;
  update public.af_agent_tasks set status=next_status,last_error=coalesce(p_error,'{}'::jsonb),
    available_at=case when next_status='QUEUED' then now()+make_interval(secs=>greatest(5,least(p_retry_seconds,3600))) else available_at end,
    locked_at=null,locked_by=null,updated_at=now(),completed_at=case when next_status='FAILED' then now() else null end
    where id=p_task_id;
  return next_status;
end;
$$;

create or replace function public.af_claim_agent_activity(p_worker text,p_limit integer default 20)
returns setof public.af_agent_activity
language plpgsql
security definer
set search_path=public
as $$
begin
  if nullif(btrim(p_worker),'') is null then raise exception 'worker_required'; end if;
  return query
  with picked as (
    select id from public.af_agent_activity
    where telegram_status='PENDING'
    order by created_at
    for update skip locked
    limit greatest(1,least(p_limit,50))
  )
  update public.af_agent_activity a
     set telegram_status='SENDING',locked_by=p_worker,locked_at=now(),delivery_attempts=a.delivery_attempts+1
    from picked where a.id=picked.id
  returning a.*;
end;
$$;

create or replace function public.af_complete_agent_activity(p_activity_id uuid,p_worker text,p_telegram_message_id bigint)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare affected integer;
begin
  update public.af_agent_activity set telegram_status='DELIVERED',telegram_message_id=p_telegram_message_id,delivered_at=now(),locked_at=null,locked_by=null,last_error=null
   where id=p_activity_id and telegram_status='SENDING' and locked_by=p_worker;
  get diagnostics affected=row_count; return affected=1;
end;
$$;

create or replace function public.af_fail_agent_activity(p_activity_id uuid,p_worker text,p_error jsonb)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare attempts_now integer; next_status text;
begin
  select delivery_attempts into attempts_now from public.af_agent_activity
   where id=p_activity_id and telegram_status='SENDING' and locked_by=p_worker for update;
  if not found then return 'NOT_CLAIMED'; end if;
  next_status:=case when attempts_now>=5 then 'FAILED' else 'PENDING' end;
  update public.af_agent_activity set telegram_status=next_status,last_error=coalesce(p_error,'{}'::jsonb),locked_at=null,locked_by=null where id=p_activity_id;
  return next_status;
end;
$$;

create or replace function public.af_recover_agent_org(p_stale_minutes integer default 10)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare tasks_recovered integer; activity_recovered integer;
begin
  update public.af_agent_tasks set status=case when attempts>=max_attempts then 'FAILED' else 'QUEUED' end,
    locked_at=null,locked_by=null,available_at=now(),updated_at=now(),last_error=coalesce(last_error,'{}'::jsonb)||jsonb_build_object('recovered_at',now())
  where status in ('CLAIMED','WORKING') and locked_at<now()-make_interval(mins=>greatest(5,p_stale_minutes));
  get diagnostics tasks_recovered=row_count;
  update public.af_agent_activity set telegram_status=case when delivery_attempts>=5 then 'FAILED' else 'PENDING' end,
    locked_at=null,locked_by=null,last_error=coalesce(last_error,'{}'::jsonb)||jsonb_build_object('recovered_at',now())
  where telegram_status='SENDING' and locked_at<now()-make_interval(mins=>greatest(5,p_stale_minutes));
  get diagnostics activity_recovered=row_count;
  return jsonb_build_object('tasks',tasks_recovered,'activity',activity_recovered);
end;
$$;

alter table public.af_agent_sessions enable row level security;
alter table public.af_agent_tasks enable row level security;
alter table public.af_agent_activity enable row level security;
alter table public.af_agent_controls enable row level security;

revoke all on public.af_agent_sessions,public.af_agent_tasks,public.af_agent_activity,public.af_agent_controls from public,anon,authenticated;
grant all on public.af_agent_sessions,public.af_agent_tasks,public.af_agent_activity,public.af_agent_controls to service_role;

revoke all on function public.af_claim_agent_tasks(text,integer) from public,anon,authenticated;
revoke all on function public.af_finish_agent_task(uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.af_fail_agent_task(uuid,text,jsonb,integer) from public,anon,authenticated;
revoke all on function public.af_claim_agent_activity(text,integer) from public,anon,authenticated;
revoke all on function public.af_complete_agent_activity(uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.af_fail_agent_activity(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.af_recover_agent_org(integer) from public,anon,authenticated;
grant execute on function public.af_claim_agent_tasks(text,integer),public.af_finish_agent_task(uuid,text,text,jsonb,jsonb),public.af_fail_agent_task(uuid,text,jsonb,integer),public.af_claim_agent_activity(text,integer),public.af_complete_agent_activity(uuid,text,bigint),public.af_fail_agent_activity(uuid,text,jsonb),public.af_recover_agent_org(integer) to service_role;

comment on table public.af_agent_sessions is 'Owner-visible Telegram workroom sessions for ongoing bounded agent collaboration.';
comment on table public.af_agent_tasks is 'Durable agent-created and owner-created work items; only LOW internal work can auto-run.';
comment on table public.af_agent_activity is 'Human-readable agent activity outbox delivered into Telegram in chronological order.';
comment on table public.af_agent_controls is 'Owner control audit trail for support, reject, pause, stop, priority, focus and initiative-mode commands.';
