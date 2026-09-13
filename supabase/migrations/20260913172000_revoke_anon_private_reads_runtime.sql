begin;

-- Final narrow anonymous-exposure pass for clearly private/internal helpers.
-- Deliberately excluded: startup branding, published content, maps renderer,
-- public driver/station discovery reads, utility public catalog/offers, current
-- policy reads, and the pre-auth OTP request/verify contract.
do $$
declare
  routine record;
  target_names text[] := array[
    'check_rate_limit',
    'get_cache_entry',
    'lpg_policy_config',
    'read_fleet_admin_workspace',
    'read_lpg_station_runtime',
    'read_my_fleet_workspace',
    'read_my_support_threads',
    'read_my_vehicle_workspace',
    'resolve_financial_policy',
    'resolve_lpg_refill_quantity_from_amount',
    'respond_to_support_thread'
  ];
begin
  for routine in
    select p.oid::regprocedure as identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname = any(target_names)
  loop
    execute format('revoke execute on function %s from public', routine.identity);
    execute format('revoke execute on function %s from anon', routine.identity);
    execute format('grant execute on function %s to authenticated, service_role', routine.identity);
  end loop;
end
$$;

commit;
