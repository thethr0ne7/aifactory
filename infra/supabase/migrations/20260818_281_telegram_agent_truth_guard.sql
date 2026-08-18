-- AI Factory Telegram HQ truth guard.
-- Telegram member labels are allowed only when the same agent is durably recorded
-- in af_runs.activated_agents. Unsupported model-authored posts are dropped so
-- delivery falls back to the run's verified decision/participant ledger.

create or replace function public.af_guard_telegram_agent_truth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_posts jsonb;
  v_filtered jsonb;
  v_original_count integer := 0;
  v_filtered_count integer := 0;
begin
  if new.output is null or jsonb_typeof(new.output) <> 'object' then
    return new;
  end if;

  v_posts := new.output #> '{output,telegram_posts}';
  if v_posts is null or jsonb_typeof(v_posts) <> 'array' then
    return new;
  end if;

  v_original_count := jsonb_array_length(v_posts);

  select coalesce(jsonb_agg(item order by ord), '[]'::jsonb)
    into v_filtered
  from jsonb_array_elements(v_posts) with ordinality as p(item, ord)
  where jsonb_typeof(item) = 'object'
    and nullif(btrim(item->>'text'), '') is not null
    and nullif(btrim(item->>'agent'), '') is not null
    and (item->>'agent') = any(coalesce(new.activated_agents, array[]::text[]));

  v_filtered_count := jsonb_array_length(v_filtered);

  if v_filtered_count <> v_original_count then
    new.output := jsonb_set(new.output, '{output,telegram_posts}', v_filtered, false);
    new.output := jsonb_set(
      new.output,
      '{telegram_truth_guard}',
      jsonb_build_object(
        'enforced', true,
        'original_posts', v_original_count,
        'accepted_posts', v_filtered_count,
        'dropped_unauthorized_posts', v_original_count - v_filtered_count,
        'rule', 'telegram author must be present in activated_agents'
      ),
      true
    );
  end if;

  return new;
end;
$$;

revoke all on function public.af_guard_telegram_agent_truth() from public, anon, authenticated;

drop trigger if exists trg_af_runs_telegram_agent_truth on public.af_runs;
create trigger trg_af_runs_telegram_agent_truth
before insert or update of output, activated_agents
on public.af_runs
for each row
execute function public.af_guard_telegram_agent_truth();

comment on function public.af_guard_telegram_agent_truth() is
  'Drops Telegram HQ posts whose author is not durably recorded in af_runs.activated_agents.';
