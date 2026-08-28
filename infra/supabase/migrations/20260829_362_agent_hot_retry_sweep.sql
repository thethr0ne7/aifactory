-- AI Factory: wake deferred realtime agent tasks without relying on GitHub Actions.

create or replace function public.af_sweep_hot_agent_runtime(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path=public,vault,extensions,net
as $$
declare
  scheduler_token text;
  task_row record;
  kicked integer := 0;
begin
  select decrypted_secret into scheduler_token
  from vault.decrypted_secrets
  where name='gi_scheduler_token'
  limit 1;

  if scheduler_token is null then
    return 0;
  end if;

  for task_row in
    select t.id
    from public.af_agent_tasks t
    join public.af_agent_sessions s on s.id=t.session_id
    where t.status='QUEUED'
      and t.available_at<=now()
      and t.attempts<t.max_attempts
      and s.state='RUNNING'
      and (not t.requires_owner_approval or t.owner_decision='APPROVED')
    order by t.priority desc,t.created_at
    limit greatest(1,least(p_limit,50))
  loop
    perform net.http_post(
      url := 'https://hgivyjjethjwswjrvroy.supabase.co/functions/v1/ai-factory-agent-hot-worker',
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-factory-hot-runtime-token',scheduler_token
      ),
      body := jsonb_build_object('task_id',task_row.id),
      timeout_milliseconds := 5000
    );
    kicked := kicked+1;
  end loop;

  return kicked;
exception when others then
  return kicked;
end;
$$;

revoke all on function public.af_sweep_hot_agent_runtime(integer) from public,anon,authenticated;
grant execute on function public.af_sweep_hot_agent_runtime(integer) to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname='ai-factory-agent-hot-retry-sweep';

select cron.schedule(
  'ai-factory-agent-hot-retry-sweep',
  '* * * * *',
  'select public.af_sweep_hot_agent_runtime(20);'
);

comment on function public.af_sweep_hot_agent_runtime(integer) is 'Minute-level recovery sweep for deferred visible-agent tasks; exact task claim still prevents duplicate execution.';
