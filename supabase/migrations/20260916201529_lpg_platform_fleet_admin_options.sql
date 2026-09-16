create or replace function public.read_platform_fleet_vehicle_types()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role'
    and not public.has_permission('platform.fleets.read',null)
    and not public.has_permission('platform.fleets.manage',null)
    and not public.has_permission('platform.vehicles.manage',null)
    and not public.is_platform_super_admin() then
    raise exception using errcode='42501',message='SKIMA fleet read permission is required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('vehicleTypeId',id,'key',key,'label',display_name) order by display_name),'[]'::jsonb)
  into result
  from public.vehicle_types
  where status='active';
  return result;
end;
$$;
revoke all on function public.read_platform_fleet_vehicle_types() from public, anon;
grant execute on function public.read_platform_fleet_vehicle_types() to authenticated, service_role;
