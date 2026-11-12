begin;

-- Trigger functions should not be directly callable through the exposed public RPC schema.
-- PostgreSQL invokes this function through its attached trigger without requiring caller EXECUTE.
revoke all on function public.validate_fuel_station_affiliate_policy_version()
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
