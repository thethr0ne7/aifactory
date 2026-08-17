-- AI Factory controlled tool failure memory
-- Every actual tool execution failure becomes an incident and therefore an automatic anti-regression lesson.

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
  v_tool_id text;
  v_request_key text;
begin
  if p_status not in ('EXECUTED','DENIED','FAILED') then raise exception 'invalid tool terminal status'; end if;
  if p_evidence_class not in ('MEASURED','OBSERVED','CONFIRMED','DERIVED','INFERRED','ASSUMPTION','UNKNOWN','BLOCKER') then raise exception 'invalid evidence class'; end if;

  select run_id,task_id,tool_id,request_key into v_run_id,v_task_id,v_tool_id,v_request_key
  from public.af_tool_requests where id=p_request_id for update;
  if v_run_id is null then raise exception 'tool request not found'; end if;

  update public.af_tool_requests
  set status=p_status,claimed_by=null,completed_at=now(),updated_at=now()
  where id=p_request_id;

  insert into public.af_tool_results(request_id,run_id,task_id,outcome,result,error,evidence_class,provenance)
  values(p_request_id,v_run_id,v_task_id,p_status,coalesce(p_result,'{}'::jsonb),p_error,p_evidence_class,coalesce(p_provenance,'{}'::jsonb))
  on conflict(request_id) do update set outcome=excluded.outcome,result=excluded.result,error=excluded.error,evidence_class=excluded.evidence_class,provenance=excluded.provenance;

  insert into public.af_events(run_id,task_id,event_type,source,evidence_class,payload,provenance)
  values(v_run_id,v_task_id,'TOOL_'||p_status,'tool-runtime',p_evidence_class,jsonb_build_object('request_id',p_request_id,'tool_id',v_tool_id,'request_key',v_request_key),coalesce(p_provenance,'{}'::jsonb));

  if p_status='FAILED' and not exists(
    select 1 from public.af_incidents i
    where i.run_id=v_run_id and i.task_id=v_task_id
      and i.evidence->>'tool_request_id'=p_request_id::text
  ) then
    insert into public.af_incidents(run_id,task_id,severity,summary,evidence,root_cause,affected_invariants,repair)
    values(
      v_run_id,v_task_id,'UNDESIRABLE',
      left('Controlled tool failure: '||coalesce(v_tool_id,'unknown')||' request_key='||coalesce(v_request_key,'unknown'),4000),
      jsonb_build_object('code','CONTROLLED_TOOL_FAILURE','tool_request_id',p_request_id,'tool_id',v_tool_id,'request_key',v_request_key,'error',coalesce(p_error,'{}'::jsonb)),
      jsonb_build_object('status','UNKNOWN','requires_reproduction',true),
      array['controlled-tool-authority','durable-error-memory','bounded-retries'],
      jsonb_build_object('action','reproduce tool failure, repair deterministic executor or boundary, then verify regression')
    );
  end if;

  if not exists(select 1 from public.af_tool_requests where task_id=v_task_id and status in('PENDING','CLAIMED')) then
    update public.af_tasks set status='QUEUED',available_at=now(),locked_at=null,locked_by=null,updated_at=now() where id=v_task_id and status='WAITING_TOOLS';
    update public.af_runs set status='QUEUED',heartbeat_at=now(),updated_at=now() where id=v_run_id and status='WAITING_TOOLS';
    insert into public.af_events(run_id,task_id,event_type,source,evidence_class,payload)
    values(v_run_id,v_task_id,'TOOL_BATCH_READY','tool-runtime','CONFIRMED',jsonb_build_object('request_id',p_request_id));
  end if;
  return v_run_id;
end;
$$;

revoke all on function public.af_finish_tool_request(uuid,text,jsonb,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.af_finish_tool_request(uuid,text,jsonb,jsonb,text,jsonb) to service_role;
