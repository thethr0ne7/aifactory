-- PostgreSQL does not provide min(uuid); aggregate qualifying proof UUIDs directly.
create or replace function public.af_promote_capability_scope(p_candidate_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ventures integer := 0;
  v_scope text;
  v_refs uuid[] := '{}'::uuid[];
begin
  select count(*)
    into v_ventures
    from (
      select venture_cell_id
      from public.af_capability_proofs
      where candidate_id=p_candidate_id and outcome='WIN'
      group by venture_cell_id
      having count(*) >= 2
    ) qualified;

  select coalesce(array_agg(p.id order by p.created_at),'{}'::uuid[])
    into v_refs
    from public.af_capability_proofs p
   where p.candidate_id=p_candidate_id
     and p.outcome='WIN'
     and p.venture_cell_id in (
       select venture_cell_id
       from public.af_capability_proofs
       where candidate_id=p_candidate_id and outcome='WIN'
       group by venture_cell_id
       having count(*) >= 2
     );

  v_scope := case
    when v_ventures >= 3 then 'FACTORY_WIDE_CAPABILITY'
    when v_ventures >= 2 then 'CROSS_VENTURE_PROVEN'
    else 'VENTURE_LOCAL'
  end;

  update public.af_capability_promotions
     set status='SUPERSEDED',superseded_at=now()
   where candidate_id=p_candidate_id and status='ACTIVE';

  insert into public.af_capability_promotions(
    candidate_id,scope,independent_ventures,proof_refs,authority_expanded,status,provenance
  ) values (
    p_candidate_id,v_scope,v_ventures,v_refs,false,'ACTIVE',
    jsonb_build_object('rule','two wins per independent venture; 2 ventures cross, 3 ventures factory-wide')
  );

  return v_scope;
end;
$$;

revoke all on function public.af_promote_capability_scope(text) from public,anon,authenticated;
grant execute on function public.af_promote_capability_scope(text) to service_role;
