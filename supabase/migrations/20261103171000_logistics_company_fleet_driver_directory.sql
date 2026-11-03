begin;

create or replace function public.read_logistics_company_fleet_drivers(
  target_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  driver_rows jsonb;
begin
  if target_organization_id is null then raise exception 'target_organization_id is required'; end if;
  if not public.can_manage_logistics_company(target_organization_id) then
    raise exception 'company fleet management permission is required';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'driver_profile_id', driver.id,
        'user_id', driver.user_id,
        'display_name', coalesce(nullif(btrim(driver.driver_display_name), ''), profile.display_name, 'Logistics driver'),
        'public_driver_id', driver.public_driver_id,
        'verification_status', driver.verification_status,
        'operational_status', driver.operational_status,
        'profile_photo_asset_id', driver.profile_photo_asset_id
      )
      order by coalesce(nullif(btrim(driver.driver_display_name), ''), profile.display_name, 'Logistics driver')
    ),
    '[]'::jsonb
  )
  into driver_rows
  from public.driver_profiles driver
  join public.organization_memberships membership
    on membership.organization_id = target_organization_id
   and membership.user_id = driver.user_id
   and membership.status = 'active'
  left join public.profiles profile on profile.id = driver.user_id;

  return jsonb_build_object(
    'organization_id', target_organization_id,
    'drivers', driver_rows
  );
end;
$$;

revoke all on function public.read_logistics_company_fleet_drivers(uuid) from public, anon;
grant execute on function public.read_logistics_company_fleet_drivers(uuid) to authenticated, service_role;

commit;
