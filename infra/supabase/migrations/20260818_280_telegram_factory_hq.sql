-- AI Factory HQ: Telegram workspace, topics and durable message/run linkage.
-- Owner/chat/topic IDs are data, not source-code constants, and are seeded out of band.

create table if not exists public.af_telegram_workspaces (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null unique,
  owner_user_id bigint not null,
  title text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.af_telegram_topics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.af_telegram_workspaces(id) on delete cascade,
  topic_key text not null,
  telegram_thread_id bigint not null,
  display_name text not null,
  route_kind text not null,
  route_instruction text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, topic_key),
  unique (workspace_id, telegram_thread_id)
);

create table if not exists public.af_telegram_messages (
  update_id bigint primary key,
  workspace_id uuid not null references public.af_telegram_workspaces(id) on delete cascade,
  topic_id uuid references public.af_telegram_topics(id) on delete set null,
  telegram_user_id bigint not null,
  telegram_chat_id bigint not null,
  telegram_message_id bigint not null,
  telegram_thread_id bigint not null default 1,
  message_text text not null,
  run_id uuid references public.af_runs(id) on delete set null,
  status text not null default 'RECEIVED' check (status in ('RECEIVED','QUEUED','DELIVERED','IGNORED','FAILED')),
  raw_update jsonb not null default '{}'::jsonb,
  delivery_error jsonb,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists af_telegram_messages_run_id_idx
  on public.af_telegram_messages(run_id)
  where run_id is not null;

create index if not exists af_telegram_messages_delivery_idx
  on public.af_telegram_messages(status, created_at)
  where status = 'QUEUED';

alter table public.af_telegram_workspaces enable row level security;
alter table public.af_telegram_topics enable row level security;
alter table public.af_telegram_messages enable row level security;

revoke all on table public.af_telegram_workspaces from anon, authenticated;
revoke all on table public.af_telegram_topics from anon, authenticated;
revoke all on table public.af_telegram_messages from anon, authenticated;

comment on table public.af_telegram_workspaces is 'Private Telegram workspaces allowed to enqueue AI Factory runs.';
comment on table public.af_telegram_topics is 'Forum-topic routing policy for AI Factory HQ.';
comment on table public.af_telegram_messages is 'Idempotent Telegram update ledger linked to durable AI Factory runs.';
