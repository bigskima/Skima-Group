begin;

-- A refill can consume the customer's entire remaining test allocation while
-- moving the value into escrow. In that case the dispatch gate must recognize
-- escrow value from the same active batch instead of requiring a customer-side
-- remainder. This only applies to the pre-marked temporary lifecycle fixtures.
do $temporary_lpg_test_escrow_provenance$
declare
  v_function_sql text;
  v_old text := 'and test_allocation.remaining_amount>0';
  v_new text := $patch$
and (
  test_allocation.remaining_amount>0
  or exists (
    select 1
    from public.escrow_holds test_hold
    join public.wallet_test_funding_allocations test_escrow_allocation
      on test_escrow_allocation.wallet_id=test_hold.wallet_id
     and test_escrow_allocation.batch_id=test_batch.id
     and test_escrow_allocation.remaining_amount>0
    where test_hold.id=order_record.escrow_hold_id
      and test_hold.status in ('pending','held','partially_released')
  )
)
$patch$;
begin
  v_function_sql:=pg_get_functiondef('public.dispatch_lpg_order(uuid,integer,text,text)'::regprocedure);
  if position('temporary_lpg_test_fixture' in v_function_sql)>0
     and position(v_new in v_function_sql)=0 then
    if position(v_old in v_function_sql)=0 then
      raise exception 'Could not locate the test-funding dispatch predicate in dispatch_lpg_order';
    end if;
    execute replace(v_function_sql,v_old,v_new);
  end if;

  v_function_sql:=pg_get_functiondef('public.dispatch_lpg_internal_order(uuid,integer,text,text)'::regprocedure);
  if position('temporary_lpg_test_fixture' in v_function_sql)>0
     and position(v_new in v_function_sql)=0 then
    if position(v_old in v_function_sql)=0 then
      raise exception 'Could not locate the test-funding dispatch predicate in dispatch_lpg_internal_order';
    end if;
    execute replace(v_function_sql,v_old,v_new);
  end if;
end
$temporary_lpg_test_escrow_provenance$;

comment on function public.dispatch_lpg_order(uuid,integer,text,text) is
  'LPG marketplace dispatch; test fixtures require an active test-funding allocation in the customer wallet or that same batch held in escrow.';
comment on function public.dispatch_lpg_internal_order(uuid,integer,text,text) is
  'SKIMA internal LPG dispatch; test fixtures require an active test-funding allocation in the customer wallet or that same batch held in escrow.';

notify pgrst,'reload schema';
commit;
