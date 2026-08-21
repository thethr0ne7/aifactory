-- AI Factory 2.7 realtime event stream.
-- Postgres remains source of truth; Realtime is notification transport only.
-- Existing RLS/revokes remain unchanged.

do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='af_agent_activity'
    ) then
      alter publication supabase_realtime add table public.af_agent_activity;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='af_agent_tasks'
    ) then
      alter publication supabase_realtime add table public.af_agent_tasks;
    end if;
  end if;
end $$;

comment on table public.af_agent_activity is
'Human-readable durable agent activity. Published to Supabase Realtime as a notification stream; Telegram delivery and Postgres remain authoritative.';
