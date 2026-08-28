-- AI Factory: low-latency Telegram agent runtime.
-- GitHub Actions remains recovery/CI; owner Telegram directives can be claimed immediately by Supabase.

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
  if p_name not in ('n8n_mcp_token') then raise exception 'runtime_secret_name_not_allowed'; end if;
  select decrypted_secret into value from vault.decrypted_secrets where name=p_name limit 1;
  if value is null then raise exception 'runtime_secret_not_configured'; end if;
  return value;
end;
$$;

revoke all on function public.af_claim_agent_task_by_id(uuid,text) from public,anon,authenticated;
revoke all on function public.af_set_runtime_secret(text,text) from public,anon,authenticated;
revoke all on function public.af_get_runtime_secret(text) from public,anon,authenticated;
grant execute on function public.af_claim_agent_task_by_id(uuid,text),public.af_set_runtime_secret(text,text),public.af_get_runtime_secret(text) to service_role;

comment on function public.af_claim_agent_task_by_id(uuid,text) is 'Claims one specific Telegram-visible task immediately for the Supabase hot runtime.';
comment on function public.af_set_runtime_secret(text,text) is 'Stores allowlisted runtime credentials in Supabase Vault; service-role only.';
comment on function public.af_get_runtime_secret(text) is 'Reads allowlisted runtime credentials from Supabase Vault; service-role only.';
