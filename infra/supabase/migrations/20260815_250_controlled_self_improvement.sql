-- AI Factory 2.5 controlled self-improvement ledger
-- INCIDENT -> REGRESSION EVAL -> PATCH CANDIDATE -> COMPARE -> A4 PROMOTE -> OBSERVE -> ROLLBACK/RETAIN

create table if not exists public.af_regression_evals (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references public.af_incidents(id) on delete set null,
  lesson_id uuid references public.af_lessons(id) on delete set null,
  eval_kind text not null default 'production-derived',
  status text not null default 'CANDIDATE' check (status in ('CANDIDATE','RUNNING','PASS','FAIL','SUPERSEDED')),
  source_refs jsonb not null default '{}'::jsonb,
  baseline_result jsonb,
  candidate_result jsonb,
  score numeric,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists af_regression_evals_incident_unique
  on public.af_regression_evals(incident_id) where incident_id is not null;
create index if not exists af_regression_evals_status_idx
  on public.af_regression_evals(status, created_at);

create table if not exists public.af_patch_candidates (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.af_lessons(id) on delete cascade,
  incident_id uuid references public.af_incidents(id) on delete set null,
  regression_eval_id uuid references public.af_regression_evals(id) on delete set null,
  target_type text not null check (target_type in ('MEMORY_GUIDANCE','ROUTING_HEURISTIC','SKILL_PATCH','WORKFLOW_PATCH')),
  target_ref text,
  patch jsonb not null,
  risk_class text not null check (risk_class in ('LOW','MEDIUM','HIGH','ROOT_OR_CATASTROPHIC')),
  status text not null default 'DRAFT' check (status in ('DRAFT','EVALUATING','READY','REVIEW_REQUIRED','PROMOTED','REJECTED','ROLLED_BACK','SUPERSEDED')),
  rollback jsonb not null,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create unique index if not exists af_patch_candidates_lesson_unique
  on public.af_patch_candidates(lesson_id);
create index if not exists af_patch_candidates_status_idx
  on public.af_patch_candidates(status, risk_class, created_at);

create table if not exists public.af_promotions (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.af_lessons(id) on delete restrict,
  patch_candidate_id uuid not null references public.af_patch_candidates(id) on delete restrict,
  regression_eval_id uuid not null references public.af_regression_evals(id) on delete restrict,
  autonomy_level text not null default 'A4' check (autonomy_level = 'A4'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','RETAINED','ROLLED_BACK','SUPERSEDED')),
  rollback_ref text not null,
  evidence jsonb not null default '{}'::jsonb,
  decision jsonb not null default '{}'::jsonb,
  promoted_at timestamptz not null default now(),
  observed_until timestamptz,
  decided_at timestamptz
);

create index if not exists af_promotions_status_idx
  on public.af_promotions(status, promoted_at);

create table if not exists public.af_promotion_observations (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.af_promotions(id) on delete cascade,
  run_id uuid references public.af_runs(id) on delete set null,
  outcome text not null check (outcome in ('PASS','REGRESSION','INCONCLUSIVE')),
  regression_detected boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(promotion_id, run_id)
);

create index if not exists af_promotion_observations_idx
  on public.af_promotion_observations(promotion_id, created_at);

create or replace function public.af_seed_regression_eval_candidates(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with candidates as (
    select i.id, i.run_id, i.task_id, i.severity, i.summary, i.negative_action_id, i.regression_eval_ref
    from public.af_incidents i
    where not exists (
      select 1 from public.af_regression_evals e where e.incident_id = i.id
    )
    order by i.created_at asc
    limit greatest(1, least(coalesce(p_limit,20), 100))
  ), inserted as (
    insert into public.af_regression_evals(incident_id, eval_kind, status, source_refs, provenance)
    select id,
           'production-derived',
           'CANDIDATE',
           jsonb_build_object(
             'incident_id', id,
             'run_id', run_id,
             'task_id', task_id,
             'severity', severity,
             'negative_action_id', negative_action_id,
             'existing_regression_eval_ref', regression_eval_ref
           ),
           jsonb_build_object('source','af_seed_regression_eval_candidates','created_at',now())
    from candidates
    on conflict do nothing
    returning 1
  ) select count(*) into v_count from inserted;
  return v_count;
end;
$$;

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
    and l.lesson_class in ('PATTERN','HEURISTIC','SUCCESS_PATTERN','ROUTING_ERROR','EVIDENCE_GAP','SPEC_GAP','QUALITY_REGRESSION')
    and not exists (select 1 from public.af_patch_candidates p where p.lesson_id=l.id)
  order by l.created_at asc
  for update skip locked
  limit 1;

  if v_lesson_id is null then return; end if;

  update public.af_lessons
  set status='EVALUATING'
  where id=v_lesson_id;

  return query
  select l.id, l.run_id, l.incident_id, l.lesson_class, l.statement, l.generalization,
         l.candidate_change, l.provenance,
         e.id, e.status,
         i.severity, i.summary, i.evidence, i.negative_action_id
  from public.af_lessons l
  left join public.af_incidents i on i.id=l.incident_id
  left join public.af_regression_evals e on e.incident_id=l.incident_id
  where l.id=v_lesson_id
  order by e.created_at asc
  limit 1;
end;
$$;

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
  if lower(v_statement) ~ '(root of trust|catastrophic|security weaken|weaken security|production permission|autonomy ceiling|raise autonomy)' then
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

create or replace function public.af_rollback_promotion(
  p_promotion_id uuid,
  p_evidence jsonb,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson_id uuid;
  v_patch_id uuid;
begin
  select lesson_id, patch_candidate_id into v_lesson_id, v_patch_id
  from public.af_promotions
  where id=p_promotion_id and status='ACTIVE'
  for update;
  if v_lesson_id is null then raise exception 'active promotion not found'; end if;

  update public.af_promotions
  set status='ROLLED_BACK', decided_at=now(), evidence=evidence || coalesce(p_evidence,'{}'::jsonb),
      decision=decision || jsonb_build_object('rollback_reason',left(coalesce(p_reason,'regression detected'),2000),'rolled_back_at',now())
  where id=p_promotion_id;

  update public.af_lessons set status='SUPERSEDED', decided_at=now() where id=v_lesson_id;
  update public.af_patch_candidates set status='ROLLED_BACK', decided_at=now() where id=v_patch_id;
  return v_lesson_id;
end;
$$;

create or replace function public.af_retain_promotion(
  p_promotion_id uuid,
  p_evidence jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson_id uuid;
begin
  select lesson_id into v_lesson_id from public.af_promotions where id=p_promotion_id and status='ACTIVE' for update;
  if v_lesson_id is null then raise exception 'active promotion not found'; end if;
  update public.af_promotions
  set status='RETAINED', observed_until=now(), decided_at=now(), evidence=evidence || coalesce(p_evidence,'{}'::jsonb)
  where id=p_promotion_id;
  return v_lesson_id;
end;
$$;

alter table public.af_regression_evals enable row level security;
alter table public.af_patch_candidates enable row level security;
alter table public.af_promotions enable row level security;
alter table public.af_promotion_observations enable row level security;

revoke all on public.af_regression_evals, public.af_patch_candidates, public.af_promotions, public.af_promotion_observations from anon, authenticated;
revoke all on function public.af_seed_regression_eval_candidates(integer) from public, anon, authenticated;
revoke all on function public.af_claim_improvement_candidate(text) from public, anon, authenticated;
revoke all on function public.af_promote_low_risk_memory(uuid,uuid,uuid,jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function public.af_rollback_promotion(uuid,jsonb,text) from public, anon, authenticated;
revoke all on function public.af_retain_promotion(uuid,jsonb) from public, anon, authenticated;

grant execute on function public.af_seed_regression_eval_candidates(integer) to service_role;
grant execute on function public.af_claim_improvement_candidate(text) to service_role;
grant execute on function public.af_promote_low_risk_memory(uuid,uuid,uuid,jsonb,jsonb,text) to service_role;
grant execute on function public.af_rollback_promotion(uuid,jsonb,text) to service_role;
grant execute on function public.af_retain_promotion(uuid,jsonb) to service_role;
