begin;

-- Public/anonymous execution must not be inherited by privileged Station Managed RPCs.
-- Authenticated access is retained only for the app-facing RPCs whose bodies enforce
-- branch, order, driver or admin authorization; service_role retains runtime access.
revoke all on function public.read_lpg_station_managed_fulfillment_option(uuid) from public, anon;
revoke all on function public.read_lpg_station_managed_workspace(uuid) from public, anon;
revoke all on function public.configure_lpg_station_managed_fulfillment(uuid,boolean,text,numeric,text,jsonb,text,jsonb) from public, anon;
revoke all on function public.register_lpg_station_managed_driver(uuid,uuid,text,text,jsonb) from public, anon;
revoke all on function public.assign_lpg_station_managed_driver(uuid,uuid,text,jsonb) from public, anon;
revoke all on function public.record_lpg_station_managed_driver_agreement(uuid,text,text,jsonb,text,timestamptz,timestamptz,jsonb) from public, anon;
revoke all on function public.record_lpg_station_managed_driver_payment(uuid,uuid,text,numeric,text,text,text,text,text,jsonb) from public, anon;
revoke all on function public.is_lpg_station_managed_order_driver(uuid,uuid) from public, anon;
revoke all on function public.read_lpg_admin_station_managed_fulfillment(uuid) from public, anon;
revoke all on function public.read_lpg_station_managed_driver_access() from public, anon;
revoke all on function public.read_lpg_station_managed_driver_jobs(integer) from public, anon;
revoke all on function public.update_lpg_station_managed_driver_assignment_status(uuid,text,text,jsonb) from public, anon;

grant execute on function public.read_lpg_station_managed_fulfillment_option(uuid) to authenticated, service_role;
grant execute on function public.read_lpg_station_managed_workspace(uuid) to authenticated, service_role;
grant execute on function public.configure_lpg_station_managed_fulfillment(uuid,boolean,text,numeric,text,jsonb,text,jsonb) to authenticated, service_role;
grant execute on function public.register_lpg_station_managed_driver(uuid,uuid,text,text,jsonb) to authenticated, service_role;
grant execute on function public.assign_lpg_station_managed_driver(uuid,uuid,text,jsonb) to authenticated, service_role;
grant execute on function public.record_lpg_station_managed_driver_agreement(uuid,text,text,jsonb,text,timestamptz,timestamptz,jsonb) to authenticated, service_role;
grant execute on function public.record_lpg_station_managed_driver_payment(uuid,uuid,text,numeric,text,text,text,text,text,jsonb) to authenticated, service_role;
grant execute on function public.is_lpg_station_managed_order_driver(uuid,uuid) to authenticated, service_role;
grant execute on function public.read_lpg_admin_station_managed_fulfillment(uuid) to authenticated, service_role;
grant execute on function public.read_lpg_station_managed_driver_access() to authenticated, service_role;
grant execute on function public.read_lpg_station_managed_driver_jobs(integer) to authenticated, service_role;
grant execute on function public.update_lpg_station_managed_driver_assignment_status(uuid,text,text,jsonb) to authenticated, service_role;

-- Trigger-only helpers must not be callable directly through the Data API.
revoke all on function public.apply_lpg_station_managed_quote_policy() from public, anon, authenticated;
revoke all on function public.copy_lpg_station_fulfillment_snapshot_to_order() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
