-- Persist production Telegram thread context behavior in repository source of truth.
-- Production migration name: telegram_thread_context_v1.

create or replace function public.af_enqueue_run(
  p_objective text,
  p_payload jsonb default '{}'::jsonb,
  p_kind text default 'general'::text,
  p_autonomy_level text default 'A3'::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_run_id uuid;
  v_kind text := coalesce(nullif(trim(p_kind), ''), 'general');
  v_priority integer := 100;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_chat_id bigint;
  v_thread_id bigint;
  v_update_id bigint;
  v_thread_context jsonb := '[]'::jsonb;
begin
  if p_objective is null or length(trim(p_objective)) < 3 then raise exception 'objective is required'; end if;
  if p_autonomy_level not in ('A0','A1','A2','A3','A4','A5','A6','A7') then raise exception 'invalid autonomy level'; end if;

  if v_kind like 'telegram-hq-%' or v_kind = 'factory-maintenance-telegram' then
    v_priority := 10;
    v_chat_id := nullif(v_payload #>> '{telegram,chat_id}', '')::bigint;
    v_thread_id := nullif(v_payload #>> '{telegram,thread_id}', '')::bigint;
    v_update_id := nullif(v_payload #>> '{telegram,update_id}', '')::bigint;

    if v_chat_id is not null and v_thread_id is not null and v_update_id is not null then
      select coalesce(jsonb_agg(x.context_item order by x.created_at), '[]'::jsonb)
      into v_thread_context
      from (
        select q.created_at,
               jsonb_build_object(
                 'update_id', q.update_id,
                 'user_message', left(coalesce(q.message_text, ''), 2500),
                 'run_status', q.run_status,
                 'assistant_response', left(coalesce(
                   (
                     select string_agg(
                       concat(coalesce(nullif(p->>'agent',''), 'AI Factory'), ': ', coalesce(p->>'text','')),
                       E'\n'
                       order by ord
                     )
                     from jsonb_array_elements(
                       case
                         when jsonb_typeof(q.run_output #> '{output,telegram_posts}') = 'array'
                           then q.run_output #> '{output,telegram_posts}'
                         else '[]'::jsonb
                       end
                     ) with ordinality as posts(p, ord)
                     where nullif(btrim(p->>'text'), '') is not null
                   ),
                   q.run_output->>'decision',
                   q.run_output->>'next_action',
                   ''
                 ), 6000)
               ) as context_item
        from (
          select m.update_id,m.message_text,m.created_at,r.status as run_status,coalesce(r.output,'{}'::jsonb) as run_output
          from public.af_telegram_messages m
          left join public.af_runs r on r.id=m.run_id
          where m.telegram_chat_id=v_chat_id
            and m.telegram_thread_id=v_thread_id
            and m.update_id < v_update_id
            and m.run_id is not null
          order by m.created_at desc
          limit 4
        ) q
      ) x;

      if jsonb_array_length(v_thread_context) > 0 then
        v_payload := jsonb_set(v_payload, '{telegram,thread_context}', v_thread_context, true);
        v_payload := jsonb_set(v_payload, '{telegram,thread_context_version}', to_jsonb('1.0.0'::text), true);
      end if;
    end if;
  end if;

  insert into public.af_runs(objective, input, autonomy_level)
  values (left(trim(p_objective), 12000), v_payload, p_autonomy_level)
  returning id into v_run_id;

  insert into public.af_tasks(run_id, kind, payload, priority)
  values (v_run_id, v_kind, v_payload, v_priority);

  insert into public.af_events(run_id, event_type, source, evidence_class, payload)
  values (
    v_run_id,
    'RUN_QUEUED',
    'runtime',
    'CONFIRMED',
    jsonb_build_object(
      'kind', v_kind,
      'priority', v_priority,
      'telegram_thread_context_turns', case when v_priority=10 then jsonb_array_length(v_thread_context) else 0 end
    )
  );
  return v_run_id;
end;
$function$;
