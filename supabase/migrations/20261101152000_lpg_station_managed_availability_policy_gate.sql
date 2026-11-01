begin;

-- Station Managed is a Partner Network route. Its direct candidate RPCs must
-- obey the same live Admin policy as independent-driver and SKIMA Fleet
-- candidates, otherwise that separate read path can bypass the main resolver.
do $station_managed_kg_availability$
declare
  function_sql text;
  old_block text;
  new_block text;
begin
  function_sql := pg_get_functiondef(
    'public.read_lpg_station_managed_eligible_stations(uuid,uuid,uuid,numeric,integer,timestamptz)'::regprocedure
  );
  old_block := E'begin\n  if actor_user_id is null then';
  new_block := E'begin
  -- When SKIMA Fleet is actively selected as the only fulfillment network,
  -- Station Managed partner candidates must not be returned.
  if coalesce((public.lpg_policy_config(''lpg.fulfillment.launch_assurance'')->>''enabled'')::boolean,false)
    and coalesce(public.lpg_policy_config(''lpg.fulfillment.launch_assurance'')->>''mode'',''hybrid'') = ''internal_only'' then
    return;
  end if;

  if actor_user_id is null then';
  if position(old_block in function_sql) = 0 then
    raise exception 'Could not locate Station Managed KG resolver entry point';
  end if;
  execute replace(function_sql, old_block, new_block);
end;
$station_managed_kg_availability$;

do $station_managed_amount_availability$
declare
  function_sql text;
  old_block text;
  new_block text;
begin
  function_sql := pg_get_functiondef(
    'public.read_lpg_station_managed_eligible_stations_for_amount(uuid,uuid,uuid,numeric,integer,timestamptz)'::regprocedure
  );
  old_block := E'begin\n  if actor_user_id is null then';
  new_block := E'begin
  -- Keep amount-based station discovery aligned with weight-based discovery.
  if coalesce((public.lpg_policy_config(''lpg.fulfillment.launch_assurance'')->>''enabled'')::boolean,false)
    and coalesce(public.lpg_policy_config(''lpg.fulfillment.launch_assurance'')->>''mode'',''hybrid'') = ''internal_only'' then
    return;
  end if;

  if actor_user_id is null then';
  if position(old_block in function_sql) = 0 then
    raise exception 'Could not locate Station Managed amount resolver entry point';
  end if;
  execute replace(function_sql, old_block, new_block);
end;
$station_managed_amount_availability$;

notify pgrst, 'reload schema';
commit;
