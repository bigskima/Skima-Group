begin;

create or replace function public.read_lpg_job_route_state(
  target_lpg_order_id uuid,
  target_workspace text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  order_record record;
  expired_station_branch_id uuid;
  expired_driver_profile_id uuid;
  historical_station_access boolean := false;
  historical_driver_access boolean := false;
  unavailable_reason text;
begin
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'authenticated user context is required';
  end if;

  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if target_workspace is not null and target_workspace not in ('station','driver','customer') then
    raise exception 'target_workspace is not supported';
  end if;

  select target_order.*
  into order_record
  from public.lpg_refill_orders target_order
  where target_order.id = target_lpg_order_id;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if public.can_access_lpg_order(target_lpg_order_id) then
    return jsonb_build_object(
      'state', 'accessible',
      'status', order_record.status,
      'paymentStatus', order_record.payment_status,
      'publicReference', order_record.public_reference
    );
  end if;

  if coalesce(order_record.metadata ->> 'expiredStationBranchId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    expired_station_branch_id := (order_record.metadata ->> 'expiredStationBranchId')::uuid;
  end if;

  if coalesce(order_record.metadata ->> 'expiredDriverProfileId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    expired_driver_profile_id := (order_record.metadata ->> 'expiredDriverProfileId')::uuid;
  end if;

  if target_workspace = 'station'
     and order_record.status = 'expired'
     and expired_station_branch_id is not null
     and public.user_can_operate_lpg_station_branch(
       auth.uid(),
       expired_station_branch_id,
       'lpg.orders.read'
     ) then
    return jsonb_build_object(
      'state', 'unavailable',
      'reason', 'payment_expired',
      'status', order_record.status,
      'paymentStatus', order_record.payment_status,
      'publicReference', order_record.public_reference
    );
  end if;

  if target_workspace = 'driver'
     and order_record.status = 'expired'
     and expired_driver_profile_id is not null
     and exists (
       select 1
       from public.driver_profiles driver
       where driver.id = expired_driver_profile_id
         and driver.user_id = auth.uid()
     ) then
    return jsonb_build_object(
      'state', 'unavailable',
      'reason', 'payment_expired',
      'status', order_record.status,
      'paymentStatus', order_record.payment_status,
      'publicReference', order_record.public_reference
    );
  end if;

  if target_workspace = 'station' then
    select
      exists (
        select 1
        from public.lpg_station_capacity_reservations reservation
        where reservation.lpg_order_id = target_lpg_order_id
          and public.user_can_operate_lpg_station_branch(
            auth.uid(),
            reservation.station_branch_id,
            'lpg.orders.read'
          )
      )
      or exists (
        select 1
        from public.lpg_order_events event
        where event.lpg_order_id = target_lpg_order_id
          and coalesce(event.metadata ->> 'station_branch_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          and public.user_can_operate_lpg_station_branch(
            auth.uid(),
            (event.metadata ->> 'station_branch_id')::uuid,
            'lpg.orders.read'
          )
      )
    into historical_station_access;

    if not historical_station_access then
      raise exception 'LPG order access permission is required';
    end if;
  elsif target_workspace = 'driver' then
    select exists (
      select 1
      from public.lpg_order_events event
      join public.driver_profiles driver
        on driver.id = (event.metadata ->> 'driver_profile_id')::uuid
      where event.lpg_order_id = target_lpg_order_id
        and coalesce(event.metadata ->> 'driver_profile_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and driver.user_id = auth.uid()
    ) into historical_driver_access;

    if not historical_driver_access then
      raise exception 'LPG order access permission is required';
    end if;
  else
    raise exception 'LPG order access permission is required';
  end if;

  unavailable_reason := case order_record.status
    when 'expired' then 'payment_expired'
    when 'cancelled' then 'cancelled'
    when 'failed' then 'failed'
    when 'refunded' then 'refunded'
    when 'completed' then 'completed'
    else 'reassigned'
  end;

  return jsonb_build_object(
    'state', 'unavailable',
    'reason', unavailable_reason,
    'status', order_record.status,
    'paymentStatus', order_record.payment_status,
    'publicReference', order_record.public_reference
  );
end;
$$;

revoke all on function public.read_lpg_job_route_state(uuid,text) from public, anon;
grant execute on function public.read_lpg_job_route_state(uuid,text) to authenticated, service_role;

commit;
