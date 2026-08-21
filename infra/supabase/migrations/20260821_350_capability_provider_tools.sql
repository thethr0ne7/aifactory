-- AI Factory 2.7 capability providers: extend the durable auto-tool gate.
-- Only LOW/A3 tools are admitted here. Owner-gated browser/dev capabilities remain outside auto execution.

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
  v_required text := 'A3';
  v_risk text := 'LOW';
begin
  if p_tool_id not in (
    'factory.repo.read_file',
    'factory.repo.list_files',
    'factory.repo.run_validation',
    'factory.repo.candidate_write',
    'factory.web.crawl',
    'factory.document.ocr'
  ) then
    raise exception 'tool is not auto-execution allowlisted';
  end if;

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
  values (
    p_run_id,p_task_id,'TOOL_REQUESTED','tool-runtime','CONFIRMED',
    jsonb_build_object('request_id',v_id,'tool_id',p_tool_id,'request_key',p_request_key),
    coalesce(p_provenance,'{}'::jsonb)
  );
  return v_id;
end;
$$;

revoke all on function public.af_request_tool(uuid,uuid,text,text,jsonb,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.af_request_tool(uuid,uuid,text,text,jsonb,text,text,jsonb) to service_role;

comment on function public.af_request_tool(uuid,uuid,text,text,jsonb,text,text,jsonb)
is 'Durable LOW/A3 auto-tool gate. Includes bounded public web crawl and tracked-PDF OCR; interactive browser and dev workspace are intentionally excluded.';
