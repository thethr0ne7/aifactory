-- AI Factory: low-latency Telegram agent runtime.
-- GitHub Actions remains recovery/CI; owner Telegram directives are kicked immediately by Postgres -> Supabase Edge.

create extension if not exists pg_net with schema extensions;

create or replace function public.af_claim_agent_task_by_id(p_task_id uuid,p_worker text)
returns setof public.af_agent_tasks
language plpgsql
security definer
set search_path=public
as $$
begin
  if nullif(btrim(p_worker),'') is null then raise exception 'worker_required'; end if;
  return query
  with picked as (
    select t.id
    from public.af_agent_tasks t
    join public.af_agent_sessions s on s.id=t.session_id
    where t.id=p_task_id
      and t.status='QUEUED'
      and t.available_at<=now()
      and t.attempts<t.max_attempts
      and s.state='RUNNING'
      and (not t.requires_owner_approval or t.owner_decision='APPROVED')
      and (select count(*) from public.af_agent_tasks a where a.session_id=t.session_id and a.status in ('CLAIMED','WORKING')) < s.max_active_tasks
    for update of t skip locked
  )
  update public.af_agent_tasks t
     set status='CLAIMED',locked_by=p_worker,locked_at=now(),attempts=t.attempts+1,updated_at=now()
    from picked
   where t.id=picked.id
  returning t.*;
end;
$$;

create or replace function public.af_claim_agent_activity_for_session(p_session_id uuid,p_worker text,p_limit integer default 20)
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
    where session_id=p_session_id and telegram_status='PENDING'
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

create or replace function public.af_set_runtime_secret(p_name text,p_secret text)
returns boolean
language plpgsql
security definer
set search_path=public,vault
as $$
declare secret_id uuid;
begin
  if p_name not in ('n8n_mcp_token') then raise exception 'runtime_secret_name_not_allowed'; end if;
  if length(coalesce(p_secret,'')) < 20 then raise exception 'runtime_secret_invalid'; end if;
  select id into secret_id from vault.decrypted_secrets where name=p_name limit 1;
  if secret_id is null then
    perform vault.create_secret(p_secret,p_name,'AI Factory hot runtime credential; synchronized from GitHub Actions secret store');
  else
    perform vault.update_secret(secret_id,p_secret,p_name,'AI Factory hot runtime credential; synchronized from GitHub Actions secret store');
  end if;
  return true;
end;
$$;

create or replace function public.af_get_runtime_secret(p_name text)
returns text
language plpgsql
security definer
set search_path=public,vault
as $$
declare value text;
begin
  if p_name not in ('n8n_mcp_token','gi_scheduler_token') then raise exception 'runtime_secret_name_not_allowed'; end if;
  select decrypted_secret into value from vault.decrypted_secrets where name=p_name limit 1;
  if value is null then raise exception 'runtime_secret_not_configured'; end if;
  return value;
end;
$$;

create or replace function public.af_kick_hot_agent_runtime()
returns trigger
language plpgsql
security definer
set search_path=public,vault,extensions
as $$
declare scheduler_token text;
begin
  if new.status <> 'QUEUED' or new.available_at > now() then return new; end if;
  if tg_op='UPDATE' and old.status='QUEUED' and old.available_at=new.available_at then return new; end if;
  select decrypted_secret into scheduler_token from vault.decrypted_secrets where name='gi_scheduler_token' limit 1;
  if scheduler_token is null then return new; end if;
  perform net.http_post(
    url := 'https://hgivyjjethjwswjrvroy.supabase.co/functions/v1/ai-factory-agent-hot-worker',
    headers := jsonb_build_object('content-type','application/json','x-factory-hot-runtime-token',scheduler_token),
    body := jsonb_build_object('task_id',new.id),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  -- The durable queue remains authoritative; GitHub recovery can still pick the task up.
  return new;
end;
$$;

drop trigger if exists af_agent_task_hot_runtime_kick on public.af_agent_tasks;
create trigger af_agent_task_hot_runtime_kick
after insert or update of status,available_at on public.af_agent_tasks
for each row execute function public.af_kick_hot_agent_runtime();

revoke all on function public.af_claim_agent_task_by_id(uuid,text) from public,anon,authenticated;
revoke all on function public.af_claim_agent_activity_for_session(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.af_set_runtime_secret(text,text) from public,anon,authenticated;
revoke all on function public.af_get_runtime_secret(text) from public,anon,authenticated;
revoke all on function public.af_kick_hot_agent_runtime() from public,anon,authenticated;
grant execute on function public.af_claim_agent_task_by_id(uuid,text),public.af_claim_agent_activity_for_session(uuid,text,integer),public.af_set_runtime_secret(text,text),public.af_get_runtime_secret(text) to service_role;

comment on function public.af_claim_agent_task_by_id(uuid,text) is 'Claims one specific Telegram-visible task immediately for the Supabase hot runtime.';
comment on function public.af_claim_agent_activity_for_session(uuid,text,integer) is 'Claims only Telegram activity belonging to one hot-runtime session.';
comment on function public.af_set_runtime_secret(text,text) is 'Stores allowlisted runtime credentials in Supabase Vault; service-role only.';
comment on function public.af_get_runtime_secret(text) is 'Reads allowlisted runtime credentials from Supabase Vault; service-role only.';
comment on function public.af_kick_hot_agent_runtime() is 'Best-effort async kick from durable task queue to low-latency Supabase Edge runtime.';
