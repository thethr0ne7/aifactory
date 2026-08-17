-- AI Factory incident reconciliation v2
-- Cluster semantically equivalent failures by stable error family/invariant family rather than literal wording.

create or replace function public.af_incident_fingerprint(
  p_summary text,
  p_evidence jsonb default '{}'::jsonb,
  p_affected_invariants text[] default '{}',
  p_negative_action_id text default null
) returns text
language plpgsql
immutable
as $$
declare
  v_invariants text;
  v_code text;
  v_family text;
  v_summary text;
begin
  select coalesce(string_agg(v,',' order by v),'') into v_invariants
  from (select distinct lower(trim(x)) v from unnest(coalesce(p_affected_invariants,'{}'::text[])) x where trim(x)<>'') s;

  v_code := lower(trim(coalesce(p_evidence->>'code',p_evidence->>'error_code','')));
  v_summary := lower(regexp_replace(regexp_replace(coalesce(p_summary,''),'[0-9a-f]{8}-[0-9a-f-]{20,}','<uuid>','gi'),'[0-9]{4,}','<n>','g'));

  if position('root-001' in v_invariants)>0 and position('root-007' in v_invariants)>0 then
    v_family := 'root-of-trust-mutation';
  elsif v_code<>'' then
    v_family := 'code:'||v_code;
  elsif coalesce(trim(p_negative_action_id),'')<>'' then
    v_family := 'negative-action:'||lower(trim(p_negative_action_id));
  else
    v_family := 'summary:'||v_summary;
  end if;

  return 'inc:'||md5(v_family||'|'||v_invariants);
end;
$$;

update public.af_incidents
set fingerprint=public.af_incident_fingerprint(summary,evidence,affected_invariants,negative_action_id),
    last_seen_at=greatest(coalesce(last_seen_at,created_at),created_at);

update public.af_lessons l
set generalization=coalesce(l.generalization,'{}'::jsonb)||jsonb_build_object('fingerprint',i.fingerprint,'incident_cluster_reconciled',true),
    provenance=coalesce(l.provenance,'{}'::jsonb)||jsonb_build_object('incident_fingerprint',i.fingerprint)
from public.af_incidents i
where l.incident_id=i.id;

create or replace function public.af_reconcile_incident_memory()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_clusters integer;
  v_critical integer;
  v_open integer;
begin
  with grouped as (
    select i.fingerprint,
      (array_agg(i.id order by i.created_at asc))[1] canonical_incident_id,
      case when bool_or(i.severity='CATASTROPHIC') then 'CATASTROPHIC' when bool_or(i.severity='FORBIDDEN') then 'FORBIDDEN' else 'UNDESIRABLE' end severity,
      case when bool_or(i.status not in('RESOLVED','ACCEPTED_RISK')) then 'OPEN' else 'RESOLVED' end status,
      count(*)::integer occurrence_count,
      min(i.created_at) first_seen_at,
      max(coalesce(i.last_seen_at,i.created_at)) last_seen_at,
      (array_agg(i.summary order by i.created_at desc))[1] last_summary,
      (array_agg(i.run_id order by i.created_at desc))[1] last_run_id,
      (array_agg(i.task_id order by i.created_at desc))[1] last_task_id
    from public.af_incidents i
    where i.fingerprint is not null
    group by i.fingerprint
  ), enriched as (
    select g.*,coalesce((
      select array_agg(distinct u.v order by u.v)
      from public.af_incidents j cross join lateral unnest(j.affected_invariants) as u(v)
      where j.fingerprint=g.fingerprint
    ),'{}'::text[]) affected_invariants
    from grouped g
  ), upserted as (
    insert into public.af_incident_clusters(
      fingerprint,canonical_incident_id,severity,status,occurrence_count,first_seen_at,last_seen_at,last_summary,affected_invariants,last_run_id,last_task_id,metadata
    )
    select fingerprint,canonical_incident_id,severity,status,occurrence_count,first_seen_at,last_seen_at,last_summary,affected_invariants,last_run_id,last_task_id,jsonb_build_object('reconciled',true,'reconciled_at',now())
    from enriched
    on conflict(fingerprint) do update set
      canonical_incident_id=excluded.canonical_incident_id,
      severity=excluded.severity,
      status=excluded.status,
      occurrence_count=excluded.occurrence_count,
      first_seen_at=excluded.first_seen_at,
      last_seen_at=excluded.last_seen_at,
      last_summary=excluded.last_summary,
      affected_invariants=excluded.affected_invariants,
      last_run_id=excluded.last_run_id,
      last_task_id=excluded.last_task_id,
      metadata=public.af_incident_clusters.metadata||excluded.metadata
    returning fingerprint
  )
  delete from public.af_incident_clusters c
  where not exists(select 1 from public.af_incidents i where i.fingerprint=c.fingerprint);

  update public.af_incidents i
  set occurrence_count=c.occurrence_count,last_seen_at=c.last_seen_at
  from public.af_incident_clusters c
  where i.fingerprint=c.fingerprint
    and (i.occurrence_count is distinct from c.occurrence_count or i.last_seen_at is distinct from c.last_seen_at);

  select count(*) into v_clusters from public.af_incident_clusters;
  select count(*) into v_critical from public.af_open_critical_incidents;
  select count(*) into v_open from public.af_incidents where status not in('RESOLVED','ACCEPTED_RISK');
  return jsonb_build_object('clusters',v_clusters,'open_incidents',v_open,'open_critical_incidents',v_critical,'reconciled_at',now());
end;
$$;

select public.af_reconcile_incident_memory();

revoke all on function public.af_incident_fingerprint(text,jsonb,text[],text) from public,anon,authenticated;
revoke all on function public.af_reconcile_incident_memory() from public,anon,authenticated;
grant execute on function public.af_incident_fingerprint(text,jsonb,text[],text) to service_role;
grant execute on function public.af_reconcile_incident_memory() to service_role;
