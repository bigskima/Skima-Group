begin;

-- These functions are invoked only by database triggers. Keep them out of the
-- exposed RPC surface; PostgreSQL does not require caller EXECUTE for triggers.
revoke all on function public.capture_fuel_station_affiliate_commission_failure()
  from public, anon, authenticated, service_role;
revoke all on function public.reverse_fuel_station_affiliate_on_refund()
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
