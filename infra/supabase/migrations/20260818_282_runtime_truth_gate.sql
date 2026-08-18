-- AI Factory runtime Truth Gate v1.0.0.
-- Enforces terminal consistency before af_tasks, af_runs and terminal events are persisted.

create or replace function public.af_apply_runtime_truth_gate(
  p_status text,
  p_result jsonb,
  p_activated_agents text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := p_status;
  v_result jsonb := coalesce(p_result, '{}'::jsonb);
  v_posts jsonb;
  v_filtered_posts jsonb := '[]'::jsonb;
  v_original_posts integer := 0;
  v_accepted_posts integer := 0;
  v_blockers integer := 0;
  v_gate_state text := 'PASS';
begin
  if p_status not in ('COMPLETE', 'BLOCKED', 'FAILED') then
    raise exception 'invalid terminal status';
  end if;

  if jsonb_typeof(v_result) <> 'object' then
    v_result := jsonb_build_object('raw_result', v_result);
    v_gate_state := 'REPAIRED';
  end if;

  v_posts := v_result #> '{output,telegram_posts}';
  if v_posts is not null and jsonb_typeof(v_posts) = 'array' then
    v_original_posts := jsonb_array_length(v_posts);

    select coalesce(jsonb_agg(item order by ord), '[]'::jsonb)
      into v_filtered_posts
    from (
      select item, ord
      from jsonb_array_elements(v_posts) with ordinality as p(item, ord)
      where jsonb_typeof(item) = 'object'
        and nullif(btrim(item->>'text'), '') is not null
        and nullif(btrim(item->>'agent'), '') is not null
        and (item->>'agent') = any(coalesce(p_activated_agents, array[]::text[]))
      order by ord
      limit 6
    ) accepted;

    v_accepted_posts := jsonb_array_length(v_filtered_posts);
    if v_accepted_posts <> v_original_posts then
      v_result := jsonb_set(v_result, '{output,telegram_posts}', v_filtered_posts, false);
      v_gate_state := 'REPAIRED';
    end if;
  end if;

  if jsonb_typeof(v_result->'evidence') = 'array' then
    select count(*)::integer
      into v_blockers
    from jsonb_array_elements(v_result->'evidence') e
    where e->>'class' = 'BLOCKER';
  end if;

  if v_status = 'COMPLETE' and v_blockers > 0 then
    v_status := 'BLOCKED';
    v_gate_state := 'BLOCKED';
    v_result := jsonb_set(v_result, '{tool_requests}', '[]'::jsonb, true);
    v_result := jsonb_set(
      v_result,
      '{risks}',
      coalesce(v_result->'risks', '[]'::jsonb) || jsonb_build_array(
        format('Truth Gate blocked COMPLETE because %s unresolved BLOCKER evidence item(s) remain.', v_blockers)
      ),
      true
    );
  end if;

  v_result := jsonb_set(
    v_result,
    '{truth_gate}',
    jsonb_build_object(
      'version', '1.0.0',
      'checked', true,
      'status', v_gate_state,
      'input_status', p_status,
      'final_status', v_status,
      'blocker_evidence_count', v_blockers,
      'telegram_original_posts', v_original_posts,
      'telegram_accepted_posts', v_accepted_posts,
      'telegram_dropped_posts', greatest(v_original_posts - v_accepted_posts, 0),
      'telegram_author_rule', 'agent must be present in activated_agents'
    ),
    true
  );

  return jsonb_build_object('status', v_status, 'result', v_result);
end;
$$;

revoke all on function public.af_apply_runtime_truth_gate(text, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.af_apply_runtime_truth_gate(text, jsonb, text[]) to service_role;

create or replace function public.af_finish_task(
  p_task_id uuid,
  p_status text,
  p_result jsonb,
  p_activated_agents text[] default '{}'::text[],
  p_selected_skills text[] default '{}'::text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_gated jsonb;
  v_status text;
  v_result jsonb;
begin
  if p_status not in ('COMPLETE', 'BLOCKED', 'FAILED') then
    raise exception 'invalid terminal status';
  end if;

  select run_id into v_run_id
  from public.af_tasks
  where id = p_task_id
  for update;

  if v_run_id is null then
    raise exception 'task not found';
  end if;

  v_gated := public.af_apply_runtime_truth_gate(
    p_status,
    coalesce(p_result, '{}'::jsonb),
    coalesce(p_activated_agents, '{}'::text[])
  );
  v_status := v_gated->>'status';
  v_result := v_gated->'result';

  update public.af_tasks
  set status = v_status,
      result = v_result,
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where id = p_task_id;

  update public.af_runs
  set status = v_status,
      output = v_result,
      activated_agents = coalesce(p_activated_agents, '{}'::text[]),
      selected_skills = coalesce(p_selected_skills, '{}'::text[]),
      heartbeat_at = now(),
      updated_at = now(),
      completed_at = now()
  where id = v_run_id;

  insert into public.af_events(run_id, task_id, event_type, source, evidence_class, payload)
  values (
    v_run_id,
    p_task_id,
    'RUN_' || v_status,
    'runtime-truth-gate',
    case when v_status = 'COMPLETE' then 'CONFIRMED' else 'BLOCKER' end,
    v_result
  );

  return v_run_id;
end;
$$;

revoke all on function public.af_finish_task(uuid, text, jsonb, text[], text[]) from public, anon, authenticated;
grant execute on function public.af_finish_task(uuid, text, jsonb, text[], text[]) to service_role;
