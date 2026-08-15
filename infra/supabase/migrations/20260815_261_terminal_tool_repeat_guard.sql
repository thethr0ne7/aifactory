-- AI Factory controlled tool runtime repeat guard
-- Prevents a reasoning worker from failing or looping when it repeats a request_key
-- whose tool request is already terminal. The run is blocked honestly instead.

create or replace function public.af_wait_for_tools(p_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_pending integer;
  v_total integer;
begin
  select run_id into v_run_id from public.af_tasks where id=p_task_id for update;
  if v_run_id is null then raise exception 'task not found'; end if;

  select count(*) filter (where status in ('PENDING','CLAIMED')), count(*)
  into v_pending, v_total
  from public.af_tool_requests
  where task_id=p_task_id;

  if v_pending = 0 then
    if v_total = 0 then
      raise exception 'no tool requests exist';
    end if;

    update public.af_tasks
    set status='BLOCKED',locked_at=null,locked_by=null,completed_at=now(),updated_at=now()
    where id=p_task_id and status not in ('COMPLETE','BLOCKED','FAILED');

    update public.af_runs
    set status='BLOCKED',heartbeat_at=now(),completed_at=now(),updated_at=now(),
        output=jsonb_build_object(
          'decision','WAITING_TOOLS rejected because no new pending tool request exists.',
          'tool_runtime',jsonb_build_object(
            'code','TERMINAL_TOOL_REQUEST_REPEATED',
            'reason','reasoning worker repeated or referenced only terminal tool request keys instead of consuming existing durable results'
          )
        )
    where id=v_run_id and status not in ('COMPLETE','BLOCKED','FAILED');

    insert into public.af_events(run_id,task_id,event_type,source,evidence_class,payload)
    values (
      v_run_id,p_task_id,'TOOL_WAIT_NO_PENDING_BLOCKED','tool-runtime','BLOCKER',
      jsonb_build_object('code','TERMINAL_TOOL_REQUEST_REPEATED','tool_request_count',v_total)
    );
    return v_run_id;
  end if;

  update public.af_tasks set status='WAITING_TOOLS',locked_at=null,locked_by=null,updated_at=now() where id=p_task_id;
  update public.af_runs set status='WAITING_TOOLS',heartbeat_at=now(),updated_at=now() where id=v_run_id and status not in ('COMPLETE','BLOCKED','FAILED');
  insert into public.af_events(run_id,task_id,event_type,source,evidence_class,payload)
  values (v_run_id,p_task_id,'WAITING_FOR_TOOLS','tool-runtime','CONFIRMED',jsonb_build_object('pending_tool_requests',v_pending));
  return v_run_id;
end;
$$;

revoke all on function public.af_wait_for_tools(uuid) from public, anon, authenticated;
grant execute on function public.af_wait_for_tools(uuid) to service_role;
