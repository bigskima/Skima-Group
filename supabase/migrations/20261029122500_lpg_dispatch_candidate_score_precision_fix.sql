begin;

-- dispatch_candidates.score is numeric(10,4), whose maximum representable
-- positive value is 999999.9999. Dispatch distance zero previously produced
-- a score of 1000000 and aborted otherwise eligible refills during dispatch.
do $lpg_dispatch_candidate_score_precision$
declare
  v_function_sql text;
  v_old_marketplace text := 'greatest(1000000-coalesce(candidate_record.dispatch_cost,1000000),1)';
  v_new_marketplace text := 'least(999999.9999,greatest(1000000-coalesce(candidate_record.dispatch_cost,1000000),1))';
  v_old_internal text := 'greatest(1000000-candidate_record.dispatch_cost,1)';
  v_new_internal text := 'least(999999.9999,greatest(1000000-candidate_record.dispatch_cost,1))';
begin
  v_function_sql:=pg_get_functiondef('public.dispatch_lpg_order(uuid,integer,text,text)'::regprocedure);
  if position(v_new_marketplace in v_function_sql)=0 then
    if position(v_old_marketplace in v_function_sql)=0 then
      raise exception 'Could not locate marketplace dispatch score calculation';
    end if;
    execute replace(v_function_sql,v_old_marketplace,v_new_marketplace);
  end if;

  v_function_sql:=pg_get_functiondef('public.dispatch_lpg_internal_order(uuid,integer,text,text)'::regprocedure);
  if position(v_new_internal in v_function_sql)=0 then
    if position(v_old_internal in v_function_sql)=0 then
      raise exception 'Could not locate SKIMA internal dispatch score calculation';
    end if;
    execute replace(v_function_sql,v_old_internal,v_new_internal);
  end if;
end
$lpg_dispatch_candidate_score_precision$;

comment on function public.dispatch_lpg_order(uuid,integer,text,text) is
  'LPG marketplace dispatch with bounded candidate scores compatible with dispatch_candidates.score numeric(10,4).';
comment on function public.dispatch_lpg_internal_order(uuid,integer,text,text) is
  'SKIMA internal LPG dispatch with bounded candidate scores compatible with dispatch_candidates.score numeric(10,4).';

notify pgrst,'reload schema';
commit;
