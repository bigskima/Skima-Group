begin;

update public.lpg_operation_policies
set policy = policy || '{"max_driver_distance_meters":20000}'::jsonb,
    updated_at = timezone('utc', now())
where key = 'lpg.dispatch.phase_one';

create or replace function public.dispatch_lpg_order(
  target_lpg_order_id uuid,
  target_candidate_limit integer default null,
  target_idempotency_key text default null,
  target_source text default 'lpg.dispatch_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  station_record record;
  dispatch_request_id uuid;
  candidate_record record;
  candidate_rank integer := 0;
  selected_driver_profile_id uuid;
  selected_vehicle_id uuid;
  existing_dispatch_request_id uuid;
  dispatch_policy jsonb;
  policy_candidate_limit integer;
  freshness_seconds integer;
  max_driver_distance_meters numeric;
  offer_ttl_seconds integer;
  reservation_ttl_seconds integer;
  driver_required jsonb;
  vehicle_required jsonb;
  configured_dispatch_policy_key text;
  dispatch_policy_key text;
  reservation_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('lpg.dispatch.execute', null)
    and not public.can_manage_lpg_operations() then
    raise exception 'LPG dispatch permission is required';
  end if;

  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  dispatch_policy := public.lpg_policy_config('lpg.dispatch.phase_one');
  policy_candidate_limit := nullif(dispatch_policy ->> 'candidate_limit', '')::integer;
  freshness_seconds := nullif(dispatch_policy ->> 'driver_location_freshness_seconds', '')::integer;
  max_driver_distance_meters := nullif(dispatch_policy ->> 'max_driver_distance_meters', '')::numeric;
  offer_ttl_seconds := nullif(dispatch_policy ->> 'offer_ttl_seconds', '')::integer;
  reservation_ttl_seconds := nullif(dispatch_policy ->> 'capacity_reservation_ttl_seconds', '')::integer;
  driver_required := coalesce(dispatch_policy -> 'required_driver_capabilities', '[]'::jsonb);
  vehicle_required := coalesce(dispatch_policy -> 'required_vehicle_capabilities', '[]'::jsonb);

  if policy_candidate_limit is null or policy_candidate_limit <= 0 or policy_candidate_limit > 25
    or freshness_seconds is null or freshness_seconds <= 0
    or max_driver_distance_meters is null or max_driver_distance_meters <= 0
    or offer_ttl_seconds is null or offer_ttl_seconds <= 0
    or reservation_ttl_seconds is null or reservation_ttl_seconds <= 0
    or jsonb_typeof(driver_required) <> 'array'
    or jsonb_typeof(vehicle_required) <> 'array' then
    raise exception 'LPG dispatch policy is incomplete';
  end if;

  target_candidate_limit := coalesce(target_candidate_limit, policy_candidate_limit);

  if target_candidate_limit <= 0 or target_candidate_limit > 25 then
    raise exception 'target_candidate_limit must be between 1 and 25';
  end if;

  target_candidate_limit := least(target_candidate_limit, policy_candidate_limit);

  configured_dispatch_policy_key := public.lpg_policy_config('lpg.quote.phase_one') ->> 'dispatch_policy_key';

  if configured_dispatch_policy_key is null then
    raise exception 'LPG quote policy must define dispatch_policy_key';
  end if;

  select policy.key
  into dispatch_policy_key
  from public.dispatch_policies policy
  where policy.key = configured_dispatch_policy_key
    and policy.status = 'active'
  limit 1;

  if dispatch_policy_key is null then
    raise exception 'active LPG dispatch policy is required';
  end if;

  select target_order.*,
         pickup.latitude as pickup_latitude,
         pickup.longitude as pickup_longitude,
         delivery.latitude as delivery_latitude,
         delivery.longitude as delivery_longitude,
         cylinder.size_kg as cylinder_size_kg
  into order_record
  from public.lpg_refill_orders target_order
  join public.lpg_customer_locations pickup on pickup.id = target_order.pickup_location_id
  join public.lpg_customer_locations delivery on delivery.id = target_order.delivery_location_id
  join public.lpg_cylinders cylinder on cylinder.id = target_order.cylinder_id
  where target_order.id = target_lpg_order_id
  for update of target_order;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  existing_dispatch_request_id := nullif(order_record.metadata ->> 'dispatch_request_id', '')::uuid;

  if existing_dispatch_request_id is not null
    and order_record.metadata ->> 'dispatch_idempotency_key' = target_idempotency_key then
    return existing_dispatch_request_id;
  end if;

  if order_record.status not in ('payment_reserved', 'matching_station', 'matching_driver', 'driver_offered') then
    raise exception 'LPG order must be funded before dispatch';
  end if;

  if order_record.station_branch_id is not null then
    select station.*
    into station_record
    from public.lpg_station_branches station
    where station.id = order_record.station_branch_id
      and station.approval_status = 'approved'
      and station.compliance_status = 'approved'
      and station.availability_status = 'available'
      and station.current_available_kg >= order_record.requested_kg
    for update;
  else
    select station.*
    into station_record
    from public.lpg_station_branches station
    where station.approval_status = 'approved'
      and station.compliance_status = 'approved'
      and station.availability_status = 'available'
      and station.current_available_kg >= order_record.requested_kg
      and (
        array_length(station.supported_cylinder_sizes_kg, 1) is null
        or order_record.cylinder_size_kg = any(station.supported_cylinder_sizes_kg)
      )
      and public.lpg_distance_meters(
        order_record.pickup_latitude,
        order_record.pickup_longitude,
        station.latitude,
        station.longitude
      ) <= station.service_radius_meters
    order by
      public.lpg_distance_meters(
        order_record.pickup_latitude,
        order_record.pickup_longitude,
        station.latitude,
        station.longitude
      ) asc,
      station.current_available_kg desc,
      station.created_at asc
    limit 1
    for update;
  end if;

  if not found then
    raise exception 'no eligible LPG station is available for this order';
  end if;

  dispatch_request_id := public.create_dispatch_request(
    dispatch_policy_key,
    target_source,
    'lpg_order',
    order_record.id,
    jsonb_build_object(
      'driver_required_capabilities',
      driver_required,
      'vehicle_required_capabilities',
      vehicle_required
    ),
    jsonb_build_object('latitude', order_record.pickup_latitude, 'longitude', order_record.pickup_longitude),
    jsonb_build_object('latitude', order_record.delivery_latitude, 'longitude', order_record.delivery_longitude),
    100,
    jsonb_build_object(
      'bounded_context',
      'lpg',
      'station_branch_id',
      station_record.id,
      'candidate_limit',
      target_candidate_limit,
      'max_driver_distance_meters',
      max_driver_distance_meters
    ),
    target_idempotency_key || ':dispatch-request'
  );

  for candidate_record in
    select
      driver.id as driver_profile_id,
      selected_vehicle.id as vehicle_id,
      latest_location.recorded_at,
      public.lpg_distance_meters(
        order_record.pickup_latitude,
        order_record.pickup_longitude,
        latest_location.latitude,
        latest_location.longitude
      ) as distance_meters
    from public.driver_profiles driver
    join public.driver_vehicle_links vehicle_link
      on vehicle_link.driver_profile_id = driver.id
      and vehicle_link.status = 'active'
      and vehicle_link.starts_at <= timezone('utc', now())
      and (vehicle_link.ends_at is null or vehicle_link.ends_at > timezone('utc', now()))
    join public.vehicles selected_vehicle
      on selected_vehicle.id = vehicle_link.vehicle_id
      and selected_vehicle.status = 'active'
    join lateral (
      select location.latitude, location.longitude, location.recorded_at
      from public.lpg_driver_locations location
      where location.driver_profile_id = driver.id
        and location.online_status = 'online'
        and location.recorded_at >= timezone('utc', now()) - make_interval(secs => freshness_seconds)
      order by location.recorded_at desc
      limit 1
    ) latest_location on true
    where driver.verification_status = 'approved'
      and driver.operational_status = 'available'
      and not exists (
        select 1
        from jsonb_array_elements_text(driver_required) required_capability(capability_key)
        where not exists (
          select 1
          from public.entity_capabilities driver_capability
          where driver_capability.entity_type = 'driver'
            and driver_capability.entity_id = driver.id
            and driver_capability.capability_key = required_capability.capability_key
            and driver_capability.status = 'active'
        )
      )
      and not exists (
        select 1
        from jsonb_array_elements_text(vehicle_required) required_capability(capability_key)
        where not exists (
          select 1
          from public.entity_capabilities vehicle_capability
          where vehicle_capability.entity_type = 'vehicle'
            and vehicle_capability.entity_id = selected_vehicle.id
            and vehicle_capability.capability_key = required_capability.capability_key
            and vehicle_capability.status = 'active'
        )
      )
      and public.lpg_distance_meters(
        order_record.pickup_latitude,
        order_record.pickup_longitude,
        latest_location.latitude,
        latest_location.longitude
      ) <= max_driver_distance_meters
    order by distance_meters asc, latest_location.recorded_at desc, driver.created_at asc
    limit target_candidate_limit
  loop
    candidate_rank := candidate_rank + 1;

    if candidate_rank = 1 then
      selected_driver_profile_id := candidate_record.driver_profile_id;
      selected_vehicle_id := candidate_record.vehicle_id;
    end if;

    perform public.upsert_dispatch_candidate(
      dispatch_request_id,
      'driver',
      candidate_record.driver_profile_id,
      greatest(100000 - coalesce(candidate_record.distance_meters, 100000), 1),
      candidate_rank,
      jsonb_build_object(
        'vehicle_id',
        candidate_record.vehicle_id,
        'distance_meters',
        candidate_record.distance_meters,
        'location_recorded_at',
        candidate_record.recorded_at,
        'selection_mode',
        'lpg_nearest_qualified_driver'
      ),
      case when candidate_rank = 1 then 'offered' else 'suggested' end,
      target_idempotency_key || ':candidate:' || candidate_rank::text
    );
  end loop;

  if candidate_rank = 0 then
    raise exception 'no fresh eligible LPG driver location is available for dispatch';
  end if;

  update public.lpg_station_branches
  set current_available_kg = current_available_kg - order_record.requested_kg,
      availability_status = case
        when current_available_kg - order_record.requested_kg <= 0 then 'capacity_reached'
        else availability_status
      end,
      updated_at = timezone('utc', now())
  where id = station_record.id
    and current_available_kg >= order_record.requested_kg;

  if not found then
    raise exception 'station capacity could not be reserved';
  end if;

  insert into public.lpg_station_capacity_reservations (
    lpg_order_id,
    station_branch_id,
    requested_kg,
    reserved_kg,
    status,
    expires_at,
    metadata,
    source,
    idempotency_key
  )
  values (
    order_record.id,
    station_record.id,
    order_record.requested_kg,
    order_record.requested_kg,
    'reserved',
    timezone('utc', now()) + make_interval(secs => reservation_ttl_seconds),
    jsonb_build_object('dispatch_request_id', dispatch_request_id),
    target_source,
    target_idempotency_key || ':capacity'
  )
  on conflict (lpg_order_id) do update
  set station_branch_id = excluded.station_branch_id,
      requested_kg = excluded.requested_kg,
      reserved_kg = excluded.reserved_kg,
      status = 'reserved',
      expires_at = excluded.expires_at,
      metadata = public.lpg_station_capacity_reservations.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into reservation_id;

  update public.dispatch_requests
  set assigned_entity_type = 'driver',
      assigned_entity_id = selected_driver_profile_id,
      metadata = metadata || jsonb_build_object('vehicle_id', selected_vehicle_id, 'capacity_reservation_id', reservation_id),
      updated_at = timezone('utc', now())
  where id = dispatch_request_id;

  update public.lpg_refill_orders
  set station_branch_id = station_record.id,
      driver_profile_id = selected_driver_profile_id,
      vehicle_id = selected_vehicle_id,
      status = 'driver_offered',
      assignment_status = 'driver_offered',
      metadata = metadata || jsonb_build_object(
        'dispatch_request_id',
        dispatch_request_id,
        'dispatch_idempotency_key',
        target_idempotency_key,
        'dispatch_candidate_count',
        candidate_rank,
        'driver_offer_expires_at',
        timezone('utc', now()) + make_interval(secs => offer_ttl_seconds),
        'capacity_reservation_id',
        reservation_id
      ),
      updated_at = timezone('utc', now())
  where id = order_record.id;

  update public.service_requests
  set status = 'matching',
      participants = participants || jsonb_build_object(
        'station_branch_id',
        station_record.id,
        'driver_profile_id',
        selected_driver_profile_id,
        'vehicle_id',
        selected_vehicle_id
      ),
      updated_at = timezone('utc', now())
  where id = order_record.service_request_id;

  perform public.ensure_lpg_order_record(
    order_record.id,
    target_idempotency_key || ':order-record',
    'lpg.order_projection',
    jsonb_build_object('dispatch_request_id', dispatch_request_id)
  );

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.dispatch.driver_offered',
    order_record.status,
    'driver_offered',
    target_idempotency_key || ':event',
    jsonb_build_object(
      'dispatch_request_id',
      dispatch_request_id,
      'station_branch_id',
      station_record.id,
      'driver_profile_id',
      selected_driver_profile_id,
      'vehicle_id',
      selected_vehicle_id,
      'capacity_reservation_id',
      reservation_id
    )
  );

  return dispatch_request_id;
end;
$$;

commit;
