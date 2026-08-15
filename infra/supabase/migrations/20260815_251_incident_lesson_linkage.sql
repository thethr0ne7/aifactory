-- AI Factory 2.5 incident -> lesson provenance linkage
-- Only auto-links when a run has exactly one incident; ambiguity stays unlinked.

create or replace function public.af_link_lesson_to_single_incident()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_incident_id uuid;
begin
  if new.incident_id is not null then return new; end if;

  select count(*) into v_count
  from public.af_incidents
  where run_id = new.run_id;

  if v_count = 1 then
    select id into v_incident_id
    from public.af_incidents
    where run_id = new.run_id
    limit 1;
    new.incident_id := v_incident_id;
  end if;
  return new;
end;
$$;

drop trigger if exists af_lessons_link_single_incident on public.af_lessons;
create trigger af_lessons_link_single_incident
before insert on public.af_lessons
for each row execute function public.af_link_lesson_to_single_incident();

create or replace function public.af_claim_improvement_candidate(p_worker_id text)
returns table(
  lesson_id uuid,
  run_id uuid,
  incident_id uuid,
  lesson_class text,
  statement text,
  generalization jsonb,
  candidate_change jsonb,
  provenance jsonb,
  regression_eval_id uuid,
  regression_eval_status text,
  incident_severity text,
  incident_summary text,
  incident_evidence jsonb,
  negative_action_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson_id uuid;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'worker id is required';
  end if;

  select l.id into v_lesson_id
  from public.af_lessons l
  where l.status = 'CANDIDATE'
    and l.incident_id is not null
    and l.lesson_class in ('PATTERN','HEURISTIC','SUCCESS_PATTERN','ROUTING_ERROR','EVIDENCE_GAP','SPEC_GAP','QUALITY_REGRESSION')
    and not exists (select 1 from public.af_patch_candidates p where p.lesson_id=l.id)
    and exists (
      select 1 from public.af_regression_evals e
      where e.incident_id=l.incident_id and e.status='CANDIDATE'
    )
  order by l.created_at asc
  for update skip locked
  limit 1;

  if v_lesson_id is null then return; end if;

  update public.af_lessons set status='EVALUATING' where id=v_lesson_id;

  return query
  select l.id, l.run_id, l.incident_id, l.lesson_class, l.statement, l.generalization,
         l.candidate_change, l.provenance,
         e.id, e.status,
         i.severity, i.summary, i.evidence, i.negative_action_id
  from public.af_lessons l
  join public.af_incidents i on i.id=l.incident_id
  join public.af_regression_evals e on e.incident_id=l.incident_id and e.status='CANDIDATE'
  where l.id=v_lesson_id
  order by e.created_at asc
  limit 1;
end;
$$;

-- Defense in depth: A4 database promotion gate also blocks autonomy-routing guidance.
create or replace function public.af_promote_low_risk_memory(
  p_lesson_id uuid,
  p_patch_candidate_id uuid,
  p_regression_eval_id uuid,
  p_evidence jsonb,
  p_decision jsonb,
  p_rollback_ref text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_promotion_id uuid;
  v_statement text;
  v_class text;
  v_patch_status text;
  v_risk text;
  v_target text;
  v_eval_status text;
begin
  select statement, lesson_class into v_statement, v_class
  from public.af_lessons where id=p_lesson_id and status='EVALUATING' for update;
  if v_statement is null then raise exception 'lesson is not evaluable'; end if;

  select status, risk_class, target_type into v_patch_status, v_risk, v_target
  from public.af_patch_candidates
  where id=p_patch_candidate_id and lesson_id=p_lesson_id for update;

  select status into v_eval_status
  from public.af_regression_evals
  where id=p_regression_eval_id for update;

  if v_patch_status <> 'READY' or v_risk <> 'LOW' or v_target <> 'MEMORY_GUIDANCE' then
    raise exception 'patch candidate is not eligible for A4 promotion';
  end if;
  if v_eval_status <> 'PASS' then raise exception 'regression eval has not passed'; end if;
  if v_class not in ('PATTERN','HEURISTIC','SUCCESS_PATTERN','EVIDENCE_GAP','SPEC_GAP','QUALITY_REGRESSION') then
    raise exception 'lesson class is outside A4 auto-promotion allowlist';
  end if;
  if lower(v_statement) ~ '(root of trust|catastrophic|security weaken|weaken security|production permission|autonomy ceiling|raise autonomy|a[0-7]\+ autonomy|autonomy level|lower autonomy|higher autonomy|service[_ -]?role|secret handling|unrestricted filesystem|unbounded network)' then
    raise exception 'protected governance topic cannot be auto-promoted';
  end if;
  if p_rollback_ref is null or length(trim(p_rollback_ref)) < 3 then raise exception 'rollback ref required'; end if;

  update public.af_lessons
  set status='PROMOTED', decided_at=now(),
      regression_eval_ref=p_regression_eval_id::text,
      baseline_result=(select baseline_result from public.af_regression_evals where id=p_regression_eval_id),
      candidate_result=(select candidate_result from public.af_regression_evals where id=p_regression_eval_id)
  where id=p_lesson_id;

  update public.af_patch_candidates
  set status='PROMOTED', decided_at=now()
  where id=p_patch_candidate_id;

  insert into public.af_promotions(lesson_id, patch_candidate_id, regression_eval_id, rollback_ref, evidence, decision)
  values (p_lesson_id, p_patch_candidate_id, p_regression_eval_id, left(trim(p_rollback_ref),500), coalesce(p_evidence,'{}'::jsonb), coalesce(p_decision,'{}'::jsonb))
  returning id into v_promotion_id;

  return v_promotion_id;
end;
$$;

revoke all on function public.af_link_lesson_to_single_incident() from public, anon, authenticated;
revoke all on function public.af_claim_improvement_candidate(text) from public, anon, authenticated;
revoke all on function public.af_promote_low_risk_memory(uuid,uuid,uuid,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.af_claim_improvement_candidate(text) to service_role;
grant execute on function public.af_promote_low_risk_memory(uuid,uuid,uuid,jsonb,jsonb,text) to service_role;
