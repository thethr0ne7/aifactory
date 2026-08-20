create or replace function public.af_is_runtime_agent_allowed(p_agent text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(nullif(btrim(p_agent),''),'') in ('ceo','cfo','coo','cio','cmo','cro','reliability-sre','runtime-mechanic','memory-curator','incident-auditor')
    or exists (
      select 1 from public.af_agent_candidates c
      where c.candidate_id = nullif(btrim(p_agent),'')
        and c.state not in ('REJECTED','QUARANTINED')
    );
$$;

revoke all on function public.af_is_runtime_agent_allowed(text) from public, anon, authenticated;
grant execute on function public.af_is_runtime_agent_allowed(text) to service_role;

create or replace function public.af_claim_telegram_task(p_worker_id text)
returns setof public.af_tasks
language plpgsql
security definer
set search_path=public
as $$
declare v_id uuid; v_run_id uuid;
begin
  if p_worker_id is null or length(trim(p_worker_id))=0 then raise exception 'worker id is required'; end if;
  select t.id,t.run_id into v_id,v_run_id
  from public.af_tasks t
  where t.status='QUEUED'
    and t.available_at<=now()
    and t.attempts<t.max_attempts
    and (t.kind like 'telegram-hq-%' or t.kind='factory-maintenance-telegram')
  order by t.priority asc,t.created_at asc
  for update skip locked
  limit 1;
  if v_id is null then return; end if;
  update public.af_tasks set status='WORKING',locked_at=now(),locked_by=left(p_worker_id,200),attempts=attempts+1,updated_at=now() where id=v_id;
  update public.af_runs set status='WORKING',heartbeat_at=now(),updated_at=now() where id=v_run_id and status not in ('COMPLETE','BLOCKED','FAILED');
  insert into public.af_events(run_id,task_id,event_type,source,evidence_class,payload)
  values(v_run_id,v_id,'TASK_CLAIMED','telegram-fast-native','CONFIRMED',jsonb_build_object('worker',left(p_worker_id,200),'lane','telegram-native-agent'));
  return query select * from public.af_tasks where id=v_id;
end;
$$;

revoke all on function public.af_claim_telegram_task(text) from public, anon, authenticated;
grant execute on function public.af_claim_telegram_task(text) to service_role;

create or replace function public.af_finish_task(p_task_id uuid,p_status text,p_result jsonb,p_activated_agents text[] default '{}'::text[],p_selected_skills text[] default '{}'::text[])
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_run_id uuid;
  v_gated jsonb;
  v_status text;
  v_result jsonb;
  v_agents text[] := '{}'::text[];
  v_agent text;
  v_recovered integer := 0;
  v_posts jsonb;
begin
  if p_status not in ('COMPLETE','BLOCKED','FAILED') then raise exception 'invalid terminal status'; end if;
  select run_id into v_run_id from public.af_tasks where id=p_task_id for update;
  if v_run_id is null then raise exception 'task not found'; end if;

  foreach v_agent in array coalesce(p_activated_agents,'{}'::text[]) loop
    v_agent := nullif(btrim(v_agent),'');
    if public.af_is_runtime_agent_allowed(v_agent)
       and not (v_agent=any(v_agents)) and cardinality(v_agents)<6 then
      v_agents := array_append(v_agents,v_agent);
    end if;
  end loop;

  v_posts := coalesce(p_result,'{}'::jsonb) #> '{output,telegram_posts}';
  if v_posts is not null and jsonb_typeof(v_posts)='array' then
    for v_agent in select nullif(btrim(item->>'agent'),'') from jsonb_array_elements(v_posts) item loop
      if public.af_is_runtime_agent_allowed(v_agent)
         and not (v_agent=any(v_agents)) and cardinality(v_agents)<6 then
        v_agents := array_append(v_agents,v_agent);
        v_recovered := v_recovered+1;
      end if;
    end loop;
  end if;

  v_gated := public.af_apply_runtime_truth_gate(p_status,coalesce(p_result,'{}'::jsonb),v_agents);
  v_status := v_gated->>'status';
  v_result := v_gated->'result';
  if v_recovered>0 then
    v_result := jsonb_set(v_result,'{agent_reconciliation}',jsonb_build_object('version','2.0.0','recovered_from_validated_telegram_posts',v_recovered,'durable_agent_count',cardinality(v_agents),'registered_agent_directory_enforced',true),true);
  end if;
  update public.af_tasks set status=v_status,result=v_result,locked_at=null,locked_by=null,updated_at=now() where id=p_task_id;
  update public.af_runs set status=v_status,output=v_result,activated_agents=v_agents,selected_skills=coalesce(p_selected_skills,'{}'::text[]),heartbeat_at=now(),updated_at=now(),completed_at=now() where id=v_run_id;
  insert into public.af_events(run_id,task_id,event_type,source,evidence_class,payload)
  values(v_run_id,p_task_id,'RUN_'||v_status,'runtime-truth-gate',case when v_status='COMPLETE' then 'CONFIRMED' else 'BLOCKER' end,v_result);
  return v_run_id;
end;
$$;
