-- Prioritize interactive Telegram HQ work over maintenance/self-audit backlog.
create or replace function public.af_enqueue_run(
  p_objective text,
  p_payload jsonb default '{}'::jsonb,
  p_kind text default 'general'::text,
  p_autonomy_level text default 'A3'::text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_kind text := coalesce(nullif(trim(p_kind), ''), 'general');
  v_priority integer := 100;
begin
  if p_objective is null or length(trim(p_objective)) < 3 then raise exception 'objective is required'; end if;
  if p_autonomy_level not in ('A0','A1','A2','A3','A4','A5','A6','A7') then raise exception 'invalid autonomy level'; end if;

  if v_kind like 'telegram-hq-%' or v_kind = 'factory-maintenance-telegram' then
    v_priority := 10;
  end if;

  insert into public.af_runs(objective, input, autonomy_level)
  values (left(trim(p_objective), 12000), coalesce(p_payload, '{}'::jsonb), p_autonomy_level)
  returning id into v_run_id;

  insert into public.af_tasks(run_id, kind, payload, priority)
  values (v_run_id, v_kind, coalesce(p_payload, '{}'::jsonb), v_priority);

  insert into public.af_events(run_id, event_type, source, evidence_class, payload)
  values (v_run_id, 'RUN_QUEUED', 'runtime', 'CONFIRMED', jsonb_build_object('kind', v_kind, 'priority', v_priority));
  return v_run_id;
end;
$$;

revoke all on function public.af_enqueue_run(text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.af_enqueue_run(text,jsonb,text,text) to service_role;

with promoted as (
  update public.af_tasks t
  set priority = 10,
      updated_at = now()
  where t.status = 'QUEUED'
    and (t.kind like 'telegram-hq-%' or t.kind = 'factory-maintenance-telegram')
    and t.priority > 10
  returning t.id,t.run_id,t.kind
)
insert into public.af_events(run_id,task_id,event_type,source,evidence_class,payload)
select run_id,id,'TELEGRAM_PRIORITY_PROMOTED','runtime','CONFIRMED',jsonb_build_object('kind',kind,'priority',10)
from promoted;
