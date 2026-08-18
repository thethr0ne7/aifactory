-- Harden the public open-critical-incidents view against RLS bypass.
-- The view is SECURITY INVOKER so caller privileges/RLS apply, and public API roles have no direct access.

create or replace view public.af_open_critical_incidents
with (security_invoker = true)
as
select i.*
from public.af_incidents i
where i.severity in ('FORBIDDEN','CATASTROPHIC')
  and i.status not in ('RESOLVED','ACCEPTED_RISK')
order by case when i.severity='CATASTROPHIC' then 0 else 1 end, i.created_at desc;

revoke all on public.af_open_critical_incidents from public, anon, authenticated;
grant select on public.af_open_critical_incidents to service_role;
