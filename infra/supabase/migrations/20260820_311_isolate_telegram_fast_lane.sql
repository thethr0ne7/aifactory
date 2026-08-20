create or replace function public.af_claim_task(p_worker_id text)
returns setof public.af_tasks
language plpgsql
security definer
set search_path=public
as $$
declare v_id uuid; v_run_id uuid;
begin
  if p_worker_id is null or length(trim(p_worker_id))=0 then raise exception 'worker id is required'; end if;
  select id,run_id into v_id,v_run_id
  from public.af_tasks
  where status='QUEUED'
    and available_at<=now()
    and attempts<max_attempts
    and not (kind like 'telegram-hq-%' or kind='factory-maintenance-telegram')
  order by priority asc,created_at asc
  for update skip locked
  limit 1;
  if v_id is null then return; end if;
  update public.af_tasks set status='WORKING',locked_at=now(),locked_by=left(p_worker_id,200),attempts=attempts+1,updated_at=now() where id=v_id;
  update public.af_runs set status='WORKING',heartbeat_at=now(),updated_at=now() where id=v_run_id and status not in ('COMPLETE','BLOCKED','FAILED');
  insert into public.af_events(run_id,task_id,event_type,source,evidence_class,payload)
  values(v_run_id,v_id,'TASK_CLAIMED','runtime','CONFIRMED',jsonb_build_object('worker',left(p_worker_id,200),'lane','general-non-telegram'));
  return query select * from public.af_tasks where id=v_id;
end;
$$;
