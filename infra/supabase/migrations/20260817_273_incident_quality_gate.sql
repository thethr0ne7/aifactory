-- AI Factory incident quality gate
-- Prevent confirmation-only / evidence-free incident candidates from polluting open incident memory.

create or replace function public.af_incident_is_substantive(
  p_evidence jsonb,
  p_root_cause jsonb,
  p_affected_invariants text[],
  p_repair jsonb,
  p_negative_action_id text,
  p_regression_eval_ref text
) returns boolean
language sql
immutable
as $$
  select
    coalesce(p_evidence,'{}'::jsonb) <> '{}'::jsonb
    or coalesce(p_root_cause,'{}'::jsonb) <> '{}'::jsonb
    or coalesce(cardinality(p_affected_invariants),0) > 0
    or coalesce(p_repair,'{}'::jsonb) <> '{}'::jsonb
    or coalesce(length(trim(p_negative_action_id)),0) > 0
    or coalesce(length(trim(p_regression_eval_ref)),0) > 0;
$$;

create or replace function public.af_record_incident_memory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.af_incident_is_substantive(
    new.evidence,new.root_cause,new.affected_invariants,new.repair,new.negative_action_id,new.regression_eval_ref
  ) then
    update public.af_incidents
    set status='RESOLVED',
        resolved_at=now(),
        root_cause=jsonb_build_object('status','DISMISSED','reason','non-substantive confirmation-only incident candidate'),
        repair=jsonb_build_object('action','reference the existing incident/lesson in memory_refs instead of opening a duplicate confirmation incident')
    where id=new.id;

    insert into public.af_events(run_id,task_id,event_type,source,evidence_class,payload)
    values(
      new.run_id,new.task_id,'INCIDENT_CANDIDATE_QUARANTINED','incident-quality-gate','OBSERVED',
      jsonb_build_object('incident_id',new.id,'summary',new.summary,'reason','missing concrete evidence/root-cause/invariant/repair/regression reference')
    );
    return new;
  end if;

  insert into public.af_incident_clusters(
    fingerprint,canonical_incident_id,severity,status,occurrence_count,
    first_seen_at,last_seen_at,last_summary,affected_invariants,last_run_id,last_task_id,metadata
  ) values (
    new.fingerprint,new.id,new.severity,new.status,1,
    new.created_at,coalesce(new.last_seen_at,new.created_at),new.summary,new.affected_invariants,new.run_id,new.task_id,
    jsonb_build_object('latest_incident_id',new.id)
  )
  on conflict(fingerprint) do update set
    severity=case
      when excluded.severity='CATASTROPHIC' or public.af_incident_clusters.severity='CATASTROPHIC' then 'CATASTROPHIC'
      when excluded.severity='FORBIDDEN' or public.af_incident_clusters.severity='FORBIDDEN' then 'FORBIDDEN'
      else 'UNDESIRABLE'
    end,
    status=case when public.af_incident_clusters.status in('RESOLVED','ACCEPTED_RISK') then 'OPEN' else public.af_incident_clusters.status end,
    occurrence_count=public.af_incident_clusters.occurrence_count+1,
    last_seen_at=greatest(public.af_incident_clusters.last_seen_at,excluded.last_seen_at),
    last_summary=excluded.last_summary,
    affected_invariants=(select coalesce(array_agg(distinct v),'{}'::text[]) from unnest(public.af_incident_clusters.affected_invariants||excluded.affected_invariants) as u(v)),
    last_run_id=excluded.last_run_id,
    last_task_id=excluded.last_task_id,
    metadata=public.af_incident_clusters.metadata||jsonb_build_object('latest_incident_id',new.id)
  returning occurrence_count into v_count;

  update public.af_incidents
  set occurrence_count=v_count,last_seen_at=now()
  where id=new.id and occurrence_count is distinct from v_count;

  if not exists(select 1 from public.af_lessons where incident_id=new.id) then
    insert into public.af_lessons(
      run_id,incident_id,lesson_class,status,statement,generalization,candidate_change,provenance
    ) values (
      new.run_id,new.id,'FAILURE_PATTERN','CANDIDATE',
      left('Anti-regression memory ['||new.fingerprint||']: '||new.summary||'. Before similar work, inspect this incident cluster, verify repair evidence and regression coverage, and do not repeat the failure blindly.',6000),
      jsonb_build_object('fingerprint',new.fingerprint,'severity',new.severity,'affected_invariants',new.affected_invariants,'memory_rule','current evidence wins; unresolved critical incidents remain mandatory context'),
      jsonb_build_object('target','failure-prevention','requires_regression_eval',true),
      jsonb_build_object('source','automatic-incident-memory-trigger','incident_id',new.id,'fingerprint',new.fingerprint)
    );
  end if;
  return new;
end;
$$;

-- Quarantine any already-created confirmation-only incidents and supersede their generated lessons.
with quarantined as (
  update public.af_incidents i
  set status='RESOLVED',
      resolved_at=coalesce(i.resolved_at,now()),
      root_cause=jsonb_build_object('status','DISMISSED','reason','non-substantive confirmation-only incident candidate'),
      repair=jsonb_build_object('action','reference the existing incident/lesson in memory_refs instead of opening a duplicate confirmation incident')
  where i.status not in('RESOLVED','ACCEPTED_RISK')
    and not public.af_incident_is_substantive(i.evidence,i.root_cause,i.affected_invariants,i.repair,i.negative_action_id,i.regression_eval_ref)
  returning i.id
)
update public.af_lessons l
set status='SUPERSEDED',
    decided_at=now(),
    provenance=coalesce(l.provenance,'{}'::jsonb)||jsonb_build_object('superseded_reason','source incident quarantined by incident-quality-gate')
where l.incident_id in(select id from quarantined);

select public.af_reconcile_incident_memory();

revoke all on function public.af_incident_is_substantive(jsonb,jsonb,text[],jsonb,text,text) from public,anon,authenticated;
grant execute on function public.af_incident_is_substantive(jsonb,jsonb,text[],jsonb,text,text) to service_role;
