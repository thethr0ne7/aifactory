-- AI Factory: direct model-provider execution with transport-safe retries.

create or replace function public.af_set_runtime_secret(p_name text,p_secret text)
returns boolean
language plpgsql
security definer
set search_path=public,vault
as $$
declare secret_id uuid;
begin
  if p_name not in ('n8n_mcp_token','groq_api_key') then raise exception 'runtime_secret_name_not_allowed'; end if;
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
  if p_name not in ('n8n_mcp_token','groq_api_key','gi_scheduler_token') then raise exception 'runtime_secret_name_not_allowed'; end if;
  select decrypted_secret into value from vault.decrypted_secrets where name=p_name limit 1;
  if value is null then raise exception 'runtime_secret_not_configured'; end if;
  return value;
end;
$$;

create or replace function public.af_defer_agent_task(
  p_task_id uuid,
  p_worker text,
  p_reason jsonb default '{}'::jsonb,
  p_retry_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare changed integer;
begin
  update public.af_agent_tasks
     set status='QUEUED',
         attempts=greatest(attempts-1,0),
         locked_by=null,
         locked_at=null,
         available_at=now()+make_interval(secs=>greatest(30,least(p_retry_seconds,3600))),
         result=coalesce(result,'{}'::jsonb)||jsonb_build_object('last_transport_defer',coalesce(p_reason,'{}'::jsonb)),
         updated_at=now()
   where id=p_task_id
     and locked_by=p_worker
     and status in ('CLAIMED','WORKING');
  get diagnostics changed=row_count;
  return changed=1;
end;
$$;

revoke all on function public.af_set_runtime_secret(text,text) from public,anon,authenticated;
revoke all on function public.af_get_runtime_secret(text) from public,anon,authenticated;
revoke all on function public.af_defer_agent_task(uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.af_set_runtime_secret(text,text),public.af_get_runtime_secret(text),public.af_defer_agent_task(uuid,text,jsonb,integer) to service_role;

comment on function public.af_defer_agent_task(uuid,text,jsonb,integer) is 'Returns a task to the durable queue without consuming an attempt when execution infrastructure is unavailable.';
