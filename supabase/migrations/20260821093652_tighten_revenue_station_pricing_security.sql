-- Trigger functions are invoked by PostgreSQL and should not be directly callable
-- by anonymous or authenticated clients.
revoke all on function public.provision_lpg_station_catalog_after_approval() from public, anon, authenticated;
grant execute on function public.provision_lpg_station_catalog_after_approval() to service_role;
