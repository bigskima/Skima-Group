begin;

-- Keep the acceptance RPC return type consistent with the mobile workspace contract.
drop function if exists public.accept_lpg_station_managed_driver_invitation();
drop function if exists public.accept_lpg_station_managed_driver_invite();

create function public.accept_lpg_station_managed_driver_invite()
returns uuid
language sql
volatile
security definer
set search_path=public,pg_temp
as $accept_station_driver_invite$
  select nullif(public.read_lpg_station_managed_driver_access()->>'stationDriverId','')::uuid;
$accept_station_driver_invite$;

create function public.accept_lpg_station_managed_driver_invitation()
returns uuid
language sql
volatile
security definer
set search_path=public,pg_temp
as $accept_station_driver_invitation$
  select public.accept_lpg_station_managed_driver_invite();
$accept_station_driver_invitation$;

revoke all on function public.accept_lpg_station_managed_driver_invite() from public,anon;
revoke all on function public.accept_lpg_station_managed_driver_invitation() from public,anon;
grant execute on function public.accept_lpg_station_managed_driver_invite() to authenticated,service_role;
grant execute on function public.accept_lpg_station_managed_driver_invitation() to authenticated,service_role;

notify pgrst,'reload schema';
commit;
