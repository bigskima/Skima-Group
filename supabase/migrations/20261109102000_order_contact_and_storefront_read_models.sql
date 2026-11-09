begin;

-- Fuel contacts are read through an order-scoped permission check. Driver
-- access is restricted to currently active assignments.
create or replace function public.read_fuel_order_contact_details(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if target_order_id is null then
    raise exception using errcode = '22023', message = 'Fuel order id is required';
  end if;

  if not public.can_read_fuel_order(target_order_id) and not exists (
    select 1
    from public.order_assignments assignment
    left join public.driver_profiles assigned_driver
      on assignment.entity_type = 'driver' and assigned_driver.id = assignment.entity_id
    left join public.lpg_station_managed_drivers station_driver
      on assignment.entity_type = 'driver' and station_driver.id = assignment.entity_id
    where assignment.order_id = target_order_id
      and assignment.participant_role = 'driver'
      and assignment.status = 'active'
      and (
        (assignment.entity_type = 'user' and assignment.entity_id = auth.uid())
        or assigned_driver.user_id = auth.uid()
        or station_driver.user_id = auth.uid()
      )
  ) then
    raise exception using errcode = '42501', message = 'Fuel order access permission is required';
  end if;

  select jsonb_build_object(
    'customer_contact', case when delivery_location.id is null then null else jsonb_build_object(
      'name', coalesce(delivery_location.contact_name, customer_profile.display_name),
      'phone', coalesce(nullif(btrim(delivery_location.contact_phone), ''), customer_account.phone),
      'email', coalesce(delivery_location.metadata #>> '{deliveryContact,email}', customer_account.email),
      'address', delivery_location.formatted_address,
      'label', delivery_location.label,
      'landmark', delivery_location.landmark,
      'instructions', coalesce(delivery_location.delivery_instructions, order_record.order_payload ->> 'delivery_instructions')
    ) end,
    'assigned_driver', case when driver_assignment.entity_id is null then null else jsonb_build_object(
      'id', driver_assignment.entity_id,
      'name', coalesce(station_driver.display_name, driver_profile_user.display_name),
      'phone', coalesce(nullif(btrim(station_driver.phone), ''), driver_account.phone),
      'assigned_at', driver_assignment.assigned_at,
      'status', driver_assignment.status
    ) end
  )
  into result
  from public.fuel_order_operations operation
  join public.order_records order_record on order_record.id = operation.order_id
  left join public.profiles customer_profile
    on customer_profile.id = coalesce(operation.customer_user_id, order_record.requester_user_id)
  left join auth.users customer_account
    on customer_account.id = coalesce(operation.customer_user_id, order_record.requester_user_id)
  left join public.lpg_customer_locations delivery_location
    on delivery_location.id = nullif(order_record.order_payload ->> 'delivery_location_id', '')::uuid
  left join lateral (
    select assignment.entity_type, assignment.entity_id, assignment.assigned_at, assignment.status
    from public.order_assignments assignment
    where assignment.order_id = operation.order_id
      and assignment.participant_role = 'driver'
      and assignment.status = 'active'
    order by assignment.assigned_at desc nulls last
    limit 1
  ) driver_assignment on true
  left join public.driver_profiles driver_profile
    on driver_assignment.entity_type = 'driver' and driver_profile.id = driver_assignment.entity_id
  left join public.lpg_station_managed_drivers station_driver
    on driver_assignment.entity_type = 'driver' and station_driver.id = driver_assignment.entity_id
  left join public.profiles driver_profile_user
    on driver_profile_user.id = coalesce(
      driver_profile.user_id,
      station_driver.user_id,
      case when driver_assignment.entity_type = 'user' then driver_assignment.entity_id end
    )
  left join auth.users driver_account
    on driver_account.id = coalesce(
      driver_profile.user_id,
      station_driver.user_id,
      case when driver_assignment.entity_type = 'user' then driver_assignment.entity_id end
    )
  where operation.order_id = target_order_id;

  if result is null then
    raise exception using errcode = 'P0002', message = 'Fuel order contact record was not found';
  end if;

  return result;
end;
$$;

revoke all on function public.read_fuel_order_contact_details(uuid) from public, anon;
grant execute on function public.read_fuel_order_contact_details(uuid) to authenticated, service_role;

revoke all on function public.read_fuel_order_contact_details(uuid) from public, anon;
grant execute on function public.read_fuel_order_contact_details(uuid) to authenticated, service_role;

commit;
