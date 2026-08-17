-- AI Factory reliability + memory repairs v2.4.2
-- 1) durable incident fingerprints/clusters
-- 2) every incident becomes anti-regression memory
-- 3) stale-run recovery uses worker heartbeat + task lease
-- 4) critical incidents are queryable as mandatory memory

alter table public.af_incidents add column if not exists fingerprint text;
alter table public.af_incidents add column if not exists occurrence_count integer not null default 1 check (occurrence_count >= 1);
alter table public.af_incidents add column if not exists last_seen_at timestamptz not null default now();

create table if not exists public.af_incident_clusters (
  fingerprint text primary key,
  canonical_incident_id uuid references public.af_incidents(id) on delete set null,
  severity text not null check (severity in ('UNDESIRABLE','FORBIDDEN','CATASTROPHIC')),
  status text not null default 'OPEN' check (status in ('OPEN','REPAIRING','RESOLVED','ACCEPTED_RISK','BLOCKED')),
  occurrence_count integer not null default 1 check (occurrence_count >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_summary text not null,
  affected_invariants text[] not null default '{}',
  last_run_id uuid references public.af_runs(id) on delete set null,
  last_task_id uuid references public.af_tasks(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists af_incidents_fingerprint_idx on public.af_incidents(fingerprint, created_at desc);
create index if not exists af_incident_clusters_status_idx on public.af_incident_clusters(status, severity, last_seen_at desc);

create or replace function public.af_incident_fingerprint(
  p_summary text,
  p_evidence jsonb default '{}'::jsonb,
  p_affected_invariants text[] default '{}',
  p_negative_action_id text default null
) returns text
language sql
immutable
as $$
  select 'inc:' || md5(
    lower(
      regexp_replace(
        regexp_replace(coalesce(p_summary,''), '[0-9a-f]{8}-[0-9a-f-]{20,}', '<uuid>', 'gi'),
        '[0-9]{4,}', '<n>', 'g'
      )
    ) || '|' ||
    coalesce(p_evidence->>'code','') || '|' ||
    coalesce(p_evidence->>'error_code','') || '|' ||
    coalesce(p_negative_action_id,'') || '|' ||
    coalesce(array_to_string(p_affected_invariants, ','),'')
  );
$$;

create or replace function public.af_prepare_incident_memory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fingerprint is null or length(trim(new.fingerprint)) = 0 then
    new.fingerprint := public.af_incident_fingerprint(new.summary, new.evidence, new.affected_invariants, new.negative_action_id);
  end if;
  new.last_seen_at := coalesce(new.last_seen_at, now());
  return new;
end;
$$;

drop trigger if exists af_prepare_incident_memory_trg on public.af_incidents;
create trigger af_prepare_incident_memory_trg
before insert or update of summary,evidence,affected_invariants,negative_action_id,fingerprint
on public.af_incidents
for each row execute function public.af_prepare_incident_memory();

create or replace function public.af_record_incident_memory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.af_incident_clusters(
    fingerprint, canonical_incident_id, severity, status, occurrence_count,
    first_seen_at, last_seen_at, last_summary, affected_invariants, last_run_id, last_task_id, metadata
  ) values (
    new.fingerprint, new.id, new.severity, new.status, 1,
    new.created_at, coalesce(new.last_seen_at,new.created_at), new.summary, new.affected_invariants, new.run_id, new.task_id,
    jsonb_build_object('latest_incident_id',new.id)
  )
  on conflict (fingerprint) do update set
    severity = case
      when excluded.severity='CATASTROPHIC' then 'CATASTROPHIC'
      when public.af_incident_clusters.severity='CATASTROPHIC' then 'CATASTROPHIC'
      when excluded.severity='FORBIDDEN' then 'FORBIDDEN'
      else public.af_incident_clusters.severity
    end,
    status = case when public.af_incident_clusters.status='RESOLVED' then 'OPEN' else public.af_incident_clusters.status end,
    occurrence_count = public.af_incident_clusters.occurrence_count + 1,
    last_seen_at = greatest(public.af_incident_clusters.last_seen_at, excluded.last_seen_at),
    last_summary = excluded.last_summary,
    affected_invariants = (
      select array_agg(distinct x)
      from unnest(public.af_incident_clusters.affected_invariants || excluded.affected_invariants) as x
    ),
    last_run_id = excluded.last_run_id,
    last_task_id = excluded.last_task_id,
    metadata = public.af_incident_clusters.metadata || jsonb_build_object('latest_incident_id',new.id)
  returning occurrence_count into v_count;

  update public.af_incidents
  set occurrence_count=v_count, last_seen_at=now()
  where id=new.id and occurrence_count is distinct from v_count;

  if not exists (select 1 from public.af_lessons where incident_id=new.id) then
    insert into public.af_lessons(
      run_id, incident_id, lesson_class, status, statement, generalization, candidate_change, provenance
    ) values (
      new.run_id,
      new.id,
      'FAILURE_PATTERN',
      'CANDIDATE',
      left('Anti-regression memory [' || new.fingerprint || ']: ' || new.summary || '. Before similar work, inspect this incident cluster, verify repair evidence and regression coverage, and do not repeat the failure blindly.', 6000),
      jsonb_build_object(
        'fingerprint',new.fingerprint,
        'severity',new.severity,
        'affected_invariants',new.affected_invariants,
        'memory_rule','current evidence wins; unresolved critical incidents remain mandatory context'
      ),
      jsonb_build_object('target','failure-prevention','requires_regression_eval',true),
      jsonb_build_object('source','automatic-incident-memory-trigger','incident_id',new.id,'fingerprint',new.fingerprint)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists af_record_incident_memory_trg on public.af_incidents;
create trigger af_record_incident_memory_trg
after insert on public.af_incidents
for each row execute function public.af_record_incident_memory();

-- Backfill fingerprints for incidents created before this migration.
update public.af_incidents
set fingerprint = public.af_incident_fingerprint(summary,evidence,affected_invariants,negative_action_id),
    last_seen_at = coalesce(last_seen_at,created_at)
where fingerprint is null or fingerprint='';

insert into public.af_incident_clusters(
  fingerprint,severity,status,occurrence_count,first_seen_at,last_seen_at,last_summary,affected_invariants,last_run_id,last_task_id,metadata
)
select
  i.fingerprint,
  case
    when bool_or(i.severity='CATASTROPHIC') then 'CATASTROPHIC'
    when bool_or(i.severity='FORBIDDEN') then 'FORBIDDEN'
    else 'UNDESIRABLE'
  end,
  case when bool_or(i.status not in ('RESOLVED','ACCEPTED_RISK')) then 'OPEN' else 'RESOLVED' end,
  count(*)::integer,
  min(i.created_at),
  max(coalesce(i.last_seen_at,i.created_at)),
  (array_agg(i.summary order by i.created_at desc))[1],
  (select array_agg(distinct x) from unnest(array_cat_agg(i.affected_invariants)) as x),
  (array_agg(i.run_id order by i.created_at desc))[1],
  (array_agg(i.task_id order by i.created_at desc))[1],
  jsonb_build_object('backfilled',true)
from public.af_incidents i
where i.fingerprint is not null
group by i.fingerprint
on conflict (fingerprint) do update set
  occurrence_count=excluded.occurrence_count,
  first_seen_at=least(public.af_incident_clusters.first_seen_at,excluded.first_seen_at),
  last_seen_at=greatest(public.af_incident_clusters.last_seen_at,excluded.last_seen_at),
  last_summary=excluded.last_summary,
  affected_invariants=excluded.affected_invariants,
  last_run_id=excluded.last_run_id,
  last_task_id=excluded.last_task_id,
  metadata=public.af_incident_clusters.metadata || excluded.metadata;

insert into public.af_lessons(run_id,incident_id,lesson_class,status,statement,generalization,candidate_change,provenance)
select
  i.run_id,
  i.id,
  'FAILURE_PATTERN',
  'CANDIDATE',
  left('Anti-regression memory [' || i.fingerprint || ']: ' || i.summary || '. Before similar work, inspect this incident cluster, verify repair evidence and regression coverage, and do not repeat the failure blindly.', 6000),
  jsonb_build_object('fingerprint',i.fingerprint,'severity',i.severity,'affected_invariants',i.affected_invariants),
  jsonb_build_object('target','failure-prevention','requires_regression_eval',true),
  jsonb_build_object('source','migration-backfill','incident_id',i.id,'fingerprint',i.fingerprint)
from public.af_incidents i
where not exists (select 1 from public.af_lessons l where l.incident_id=i.id);

create or replace view public.af_open_critical_incidents as
select i.*
from public.af_incidents i
where i.severity in ('FORBIDDEN','CATASTROPHIC')
  and i.status not in ('RESOLVED','ACCEPTED_RISK')
order by case when i.severity='CATASTROPHIC' then 0 else 1 end, i.created_at desc;

create or replace function public.af_reconcile_incident_memory()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clusters integer;
  v_critical integer;
  v_open integer;
begin
  select count(*) into v_clusters from public.af_incident_clusters;
  select count(*) into v_critical from public.af_open_critical_incidents;
  select count(*) into v_open from public.af_incidents where status not in ('RESOLVED','ACCEPTED_RISK');
  return jsonb_build_object(
    'clusters',v_clusters,
    'open_incidents',v_open,
    'open_critical_incidents',v_critical,
    'reconciled_at',now()
  );
end;
$$;

-- Lease-aware recovery: a task is stale only when both its lock and run heartbeat are stale.
create or replace function public.af_recover_stale(p_stale_minutes integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requeued integer := 0;
  v_failed integer := 0;
  v_minutes integer := greatest(5, least(coalesce(p_stale_minutes,5), 1440));
begin
  with candidates as (
    select t.id,t.run_id,t.attempts,t.max_attempts,t.locked_by,t.locked_at,r.heartbeat_at
    from public.af_tasks t
    join public.af_runs r on r.id=t.run_id
    where t.status='WORKING'
      and greatest(coalesce(t.locked_at,'epoch'::timestamptz),coalesce(r.heartbeat_at,'epoch'::timestamptz)) < now() - make_interval(mins => v_minutes)
    for update of t,r skip locked
  ), changed as (
    update public.af_tasks t
    set status='QUEUED',locked_at=null,locked_by=null,available_at=now(),updated_at=now(),
        last_error=jsonb_build_object('code','STALE_LEASE_RECOVERED','at',now())
    from candidates c
    where t.id=c.id and c.attempts < c.max_attempts
    returning t.run_id
  ) select count(*) into v_requeued from changed;

  with candidates as (
    select t.id,t.run_id,t.attempts,t.max_attempts,t.locked_by,t.locked_at,r.heartbeat_at
    from public.af_tasks t
    join public.af_runs r on r.id=t.run_id
    where t.status='WORKING'
      and greatest(coalesce(t.locked_at,'epoch'::timestamptz),coalesce(r.heartbeat_at,'epoch'::timestamptz)) < now() - make_interval(mins => v_minutes)
      and t.attempts >= t.max_attempts
    for update of t,r skip locked
  ), failed as (
    update public.af_tasks t
    set status='FAILED',locked_at=null,locked_by=null,updated_at=now(),
        last_error=jsonb_build_object('code','RETRY_BUDGET_EXHAUSTED','at',now())
    from candidates c where t.id=c.id
    returning t.id,t.run_id,t.last_error
  ), incident_rows as (
    insert into public.af_incidents(run_id,task_id,severity,summary,evidence,root_cause,affected_invariants,repair)
    select f.run_id,f.id,'UNDESIRABLE','Worker lease expired and retry budget was exhausted.',
      jsonb_build_object('code','RETRY_BUDGET_EXHAUSTED','source','af_recover_stale'),
      jsonb_build_object('status','KNOWN','cause','worker stopped heartbeating before terminal transition'),
      array['bounded-retries','terminal-state-integrity','durable-error-memory'],
      jsonb_build_object('action','inspect failure fingerprint, repair root cause, prove regression before retry')
    from failed f
    returning id
  ) select count(*) into v_failed from incident_rows;

  update public.af_runs r
  set status='QUEUED',heartbeat_at=now(),updated_at=now()
  where r.status='WORKING' and exists (select 1 from public.af_tasks t where t.run_id=r.id and t.status='QUEUED');

  update public.af_runs r
  set status='FAILED',completed_at=now(),updated_at=now(),heartbeat_at=now(),
      blocker=jsonb_build_object('code','RETRY_BUDGET_EXHAUSTED','source','lease-aware-watchdog')
  where r.status='WORKING'
    and exists (select 1 from public.af_tasks t where t.run_id=r.id and t.status='FAILED')
    and not exists (select 1 from public.af_tasks t where t.run_id=r.id and t.status in ('QUEUED','WORKING','WAITING_TOOLS'));

  return jsonb_build_object('requeued',v_requeued,'failed',v_failed,'lease_minutes',v_minutes,'at',now());
end;
$$;

alter table public.af_incident_clusters enable row level security;
revoke all on public.af_incident_clusters from anon, authenticated;
revoke all on function public.af_incident_fingerprint(text,jsonb,text[],text) from public, anon, authenticated;
revoke all on function public.af_reconcile_incident_memory() from public, anon, authenticated;
revoke all on function public.af_recover_stale(integer) from public, anon, authenticated;
grant execute on function public.af_incident_fingerprint(text,jsonb,text[],text) to service_role;
grant execute on function public.af_reconcile_incident_memory() to service_role;
grant execute on function public.af_recover_stale(integer) to service_role;
