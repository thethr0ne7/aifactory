-- AI Factory tool tracing and observability v1.
-- Existing tool policy/allowlist remains authoritative. This migration only adds
-- correlation metadata, adapter identity fields, and read-only observability views.

alter table public.af_tool_requests add column if not exists trace_id uuid;
alter table public.af_tool_requests add column if not exists span_id uuid;
alter table public.af_tool_requests add column if not exists parent_span_id uuid;
alter table public.af_tool_requests add column if not exists transport text not null default 'native';
alter table public.af_tool_requests add column if not exists adapter_id text;
alter table public.af_tool_requests add column if not exists external_server text;
alter table public.af_tool_requests add column if not exists external_tool text;
alter table public.af_tool_requests add column if not exists idempotency_key text;

alter table public.af_tool_results add column if not exists trace_id uuid;
alter table public.af_tool_results add column if not exists span_id uuid;
alter table public.af_tool_results add column if not exists parent_span_id uuid;

alter table public.af_events add column if not exists trace_id uuid;
alter table public.af_events add column if not exists span_id uuid;
alter table public.af_events add column if not exists parent_span_id uuid;

update public.af_tool_requests
set trace_id = coalesce(trace_id, run_id),
    span_id = coalesce(span_id, gen_random_uuid()),
    transport = coalesce(nullif(lower(trim(transport)), ''), 'native'),
    adapter_id = coalesce(nullif(trim(adapter_id), ''), 'native-factory'),
    idempotency_key = coalesce(nullif(trim(idempotency_key), ''), request_key)
where trace_id is null or span_id is null or adapter_id is null or idempotency_key is null;

update public.af_tool_results r
set trace_id = coalesce(r.trace_id, q.trace_id, r.run_id),
    span_id = coalesce(r.span_id, gen_random_uuid()),
    parent_span_id = coalesce(r.parent_span_id, q.span_id)
from public.af_tool_requests q
where q.id = r.request_id
  and (r.trace_id is null or r.span_id is null or r.parent_span_id is null);

update public.af_events
set trace_id = coalesce(trace_id, run_id),
    span_id = coalesce(span_id, gen_random_uuid())
where trace_id is null or span_id is null;

create or replace function public.af_fill_tool_request_trace()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.trace_id := coalesce(new.trace_id, new.run_id);
  new.span_id := coalesce(new.span_id, gen_random_uuid());
  new.transport := coalesce(nullif(lower(trim(new.transport)), ''), 'native');
  if new.transport not in ('native','mcp','http','connector') then
    raise exception 'unsupported tool transport';
  end if;

  if new.transport = 'native' then
    new.adapter_id := coalesce(nullif(trim(new.adapter_id), ''), 'native-factory');
  elsif new.transport = 'mcp' then
    if nullif(trim(new.adapter_id), '') is null
       or nullif(trim(new.external_server), '') is null
       or nullif(trim(new.external_tool), '') is null then
      raise exception 'mcp tool identity requires adapter_id, external_server and external_tool';
    end if;
  end if;

  new.idempotency_key := coalesce(nullif(trim(new.idempotency_key), ''), new.request_key);
  return new;
end;
$$;

create or replace function public.af_fill_tool_result_trace()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_trace_id uuid;
  v_request_span uuid;
begin
  select trace_id, span_id into v_trace_id, v_request_span
  from public.af_tool_requests
  where id = new.request_id;

  new.trace_id := coalesce(new.trace_id, v_trace_id, new.run_id);
  new.span_id := coalesce(new.span_id, gen_random_uuid());
  new.parent_span_id := coalesce(new.parent_span_id, v_request_span);
  return new;
end;
$$;

create or replace function public.af_fill_event_trace()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_request_id uuid;
  v_parent uuid;
begin
  new.trace_id := coalesce(new.trace_id, new.run_id);
  new.span_id := coalesce(new.span_id, gen_random_uuid());

  if new.parent_span_id is null
     and coalesce(new.payload->>'request_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_request_id := (new.payload->>'request_id')::uuid;
    select span_id into v_parent from public.af_tool_requests where id = v_request_id;
    new.parent_span_id := v_parent;
  end if;

  return new;
end;
$$;

revoke all on function public.af_fill_tool_request_trace() from public, anon, authenticated;
revoke all on function public.af_fill_tool_result_trace() from public, anon, authenticated;
revoke all on function public.af_fill_event_trace() from public, anon, authenticated;

drop trigger if exists trg_af_tool_request_trace on public.af_tool_requests;
create trigger trg_af_tool_request_trace
before insert or update of run_id, request_key, transport, adapter_id, external_server, external_tool, idempotency_key
on public.af_tool_requests
for each row execute function public.af_fill_tool_request_trace();

drop trigger if exists trg_af_tool_result_trace on public.af_tool_results;
create trigger trg_af_tool_result_trace
before insert or update of request_id, run_id
on public.af_tool_results
for each row execute function public.af_fill_tool_result_trace();

drop trigger if exists trg_af_event_trace on public.af_events;
create trigger trg_af_event_trace
before insert or update of run_id, payload
on public.af_events
for each row execute function public.af_fill_event_trace();

create index if not exists af_tool_requests_trace_idx on public.af_tool_requests(trace_id, created_at);
create index if not exists af_tool_results_trace_idx on public.af_tool_results(trace_id, created_at);
create index if not exists af_events_trace_idx on public.af_events(trace_id, occurred_at);
create index if not exists af_events_type_time_idx on public.af_events(event_type, occurred_at desc);

create or replace view public.af_trace_timeline
with (security_invoker = true)
as
select
  e.trace_id,
  e.span_id,
  e.parent_span_id,
  e.run_id,
  e.task_id,
  null::uuid as request_id,
  'event'::text as record_kind,
  e.event_type as record_name,
  null::text as status,
  e.source,
  e.evidence_class,
  e.occurred_at as observed_at,
  null::numeric as duration_ms,
  e.payload,
  e.provenance
from public.af_events e
union all
select
  q.trace_id,
  q.span_id,
  q.parent_span_id,
  q.run_id,
  q.task_id,
  q.id as request_id,
  'tool_request'::text as record_kind,
  q.tool_id as record_name,
  q.status,
  coalesce(q.transport, 'native') as source,
  'CONFIRMED'::text as evidence_class,
  q.created_at as observed_at,
  null::numeric as duration_ms,
  jsonb_build_object(
    'request_key', q.request_key,
    'idempotency_key', q.idempotency_key,
    'adapter_id', q.adapter_id,
    'external_server', q.external_server,
    'external_tool', q.external_tool,
    'risk_class', q.risk_class,
    'required_autonomy', q.required_autonomy
  ) as payload,
  q.provenance
from public.af_tool_requests q
union all
select
  r.trace_id,
  r.span_id,
  r.parent_span_id,
  r.run_id,
  r.task_id,
  r.request_id,
  'tool_result'::text as record_kind,
  q.tool_id as record_name,
  r.outcome as status,
  coalesce(q.transport, 'native') as source,
  r.evidence_class,
  r.created_at as observed_at,
  round(extract(epoch from (r.created_at - q.created_at)) * 1000.0, 3) as duration_ms,
  jsonb_build_object('error', r.error, 'result', r.result) as payload,
  r.provenance
from public.af_tool_results r
join public.af_tool_requests q on q.id = r.request_id;

create or replace view public.af_run_observability
with (security_invoker = true)
as
select
  r.id as run_id,
  r.id as trace_id,
  r.status,
  r.autonomy_level,
  r.created_at,
  r.completed_at,
  case when r.completed_at is null then null
       else round(extract(epoch from (r.completed_at - r.created_at)) * 1000.0, 3)
  end as run_duration_ms,
  (select count(*) from public.af_events e where e.run_id = r.id) as event_count,
  (select count(*) from public.af_tool_requests q where q.run_id = r.id) as tool_request_count,
  (select count(*) from public.af_tool_requests q where q.run_id = r.id and q.status = 'EXECUTED') as tool_executed_count,
  (select count(*) from public.af_tool_requests q where q.run_id = r.id and q.status = 'DENIED') as tool_denied_count,
  (select count(*) from public.af_tool_requests q where q.run_id = r.id and q.status = 'FAILED') as tool_failed_count,
  (select count(*) from public.af_tool_requests q where q.run_id = r.id and q.status in ('PENDING','CLAIMED')) as tool_pending_count,
  (select max(e.occurred_at) from public.af_events e where e.run_id = r.id) as last_event_at,
  (select max(extract(epoch from (tr.created_at - tq.created_at)) * 1000.0)
     from public.af_tool_results tr join public.af_tool_requests tq on tq.id = tr.request_id
    where tr.run_id = r.id) as max_tool_latency_ms
from public.af_runs r;

revoke all on public.af_trace_timeline, public.af_run_observability from public, anon, authenticated;
grant select on public.af_trace_timeline, public.af_run_observability to service_role;

comment on view public.af_trace_timeline is 'Unified run/event/tool timeline correlated by trace_id and spans; service-role only.';
comment on view public.af_run_observability is 'Per-run operational summary for AI Factory observability; service-role only.';
