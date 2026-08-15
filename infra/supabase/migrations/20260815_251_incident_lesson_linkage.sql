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

  select count(*), min(id)
  into v_count, v_incident_id
  from public.af_incidents
  where run_id = new.run_id;

  if v_count = 1 then
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

revoke all on function public.af_link_lesson_to_single_incident() from public, anon, authenticated;
revoke all on function public.af_claim_improvement_candidate(text) from public, anon, authenticated;
grant execute on function public.af_claim_improvement_candidate(text) to service_role;
