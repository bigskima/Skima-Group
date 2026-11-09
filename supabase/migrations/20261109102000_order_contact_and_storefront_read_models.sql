begin;

-- Preserve the existing order-level LPG access check while returning the contact
-- numbers already saved on the order locations and assigned driver records.
CREATE OR REPLACE FUNCTION public.read_lpg_job_details(target_lpg_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
begin
  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if not public.can_access_lpg_order(target_lpg_order_id) then
    raise exception 'LPG order access permission is required';
  end if;

  select jsonb_build_object(
    'order', jsonb_build_object(
      'id', target_order.id,
      'publicReference', target_order.public_reference,
      'status', target_order.status,
      'paymentStatus', target_order.payment_status,
      'assignmentStatus', target_order.assignment_status,
      'requestedKg', target_order.requested_kg,
      'actualKg', target_order.actual_kg,
      'currencyCode', target_order.currency_code,
      'totalAmount', target_order.total_amount,
      'stationAmount', target_order.station_amount,
      'deliveryFeeAmount', target_order.delivery_fee_amount,
      'platformFeeAmount', target_order.platform_fee_amount,
      'driverCommissionAmount', target_order.driver_commission_amount,
      'trackingSessionId', target_order.tracking_session_id,
      'deliveryChallengeId', target_order.delivery_challenge_id,
      'createdAt', target_order.created_at,
      'updatedAt', target_order.updated_at,
      'metadata', target_order.metadata
    ),
    'cylinder', jsonb_build_object(
      'id', cylinder.id,
      'publicReference', cylinder.cylinder_identifier,
      'cylinderIdentifier', cylinder.cylinder_identifier,
      'legacyRegistryReference', cylinder.public_reference,
      'sizeKg', cylinder.size_kg,
      'maxCapacityKg', cylinder.max_capacity_kg,
      'brand', cylinder.brand,
      'colour', cylinder.colour,
      'conditionStatus', cylinder.condition_status,
      'status', cylinder.status,
      'imageAssetIds', cylinder.image_asset_ids,
      'ownershipProofMediaAssetId', cylinder.ownership_proof_media_asset_id
    ),
    'customer', jsonb_build_object(
      'id', customer.id,
      'displayName', customer.display_name,
      'avatarUrl', customer.avatar_url, 'phone', (select account.phone from auth.users account where account.id = customer.id), 'email', (select account.email from auth.users account where account.id = customer.id)
    ),
    'pickupLocation', jsonb_build_object(
      'id', pickup.id,
      'label', pickup.label,
      'formattedAddress', pickup.formatted_address,
      'latitude', pickup.latitude,
      'longitude', pickup.longitude,
      'accuracyMeters', pickup.accuracy_meters,
      'landmark', pickup.landmark,
      'instructions', pickup.delivery_instructions,
      'contactName', pickup.contact_name,
      'contactPhone', pickup.contact_phone, 'contactEmail', pickup.metadata #>> '{deliveryContact,email}'
    ),
    'deliveryLocation', jsonb_build_object(
      'id', delivery.id,
      'label', delivery.label,
      'formattedAddress', delivery.formatted_address,
      'latitude', delivery.latitude,
      'longitude', delivery.longitude,
      'accuracyMeters', delivery.accuracy_meters,
      'landmark', delivery.landmark,
      'instructions', delivery.delivery_instructions,
      'contactName', delivery.contact_name,
      'contactPhone', delivery.contact_phone, 'contactEmail', delivery.metadata #>> '{deliveryContact,email}'
    ),
    'station', case when station.id is null then null else jsonb_build_object(
      'id', station.id,
      'displayName', station.display_name,
      'formattedAddress', station.formatted_address,
      'latitude', station.latitude,
      'longitude', station.longitude,
      'availabilityStatus', station.availability_status,
      'operatingHours', station.operating_hours,
      'metadata', station.metadata
    ) end,
    'driver', case when driver.id is null then null else jsonb_build_object(
      'id', driver.id,
      'displayName', driver_user.display_name,
      'avatarUrl', driver_user.avatar_url,
      'phone', (select driver_account.phone from auth.users driver_account where driver_account.id = driver.user_id),
      'operationalStatus', driver.operational_status,
      'verificationStatus', driver.verification_status,
      'metadata', driver.metadata
    ) end,
    'vehicle', case when vehicle.id is null then null else jsonb_build_object(
      'id', vehicle.id,
      'typeKey', vehicle_type.key,
      'typeName', vehicle_type.display_name,
      'status', vehicle.status,
      'capacityProfile', vehicle.capacity_profile,
      'metadata', vehicle.metadata
    ) end,
    'stationManagedDriver', case when station_driver.id is null then null else jsonb_build_object(
      'id', station_driver.id,
      'displayName', station_driver.display_name,
      'phone', station_driver.phone,
      'status', station_driver.status
    ) end,
    'stationManagedAssignment', case when station_assignment.id is null then null else jsonb_build_object(
      'id', station_assignment.id,
      'status', station_assignment.status,
      'assignedAt', station_assignment.assigned_at,
      'completedAt', station_assignment.completed_at,
      'vehicleId', station_assignment.vehicle_id
    ) end,
    'stationManagedVehicle', case when station_vehicle.id is null then null else jsonb_build_object(
      'id', station_vehicle.id,
      'registrationNumber', station_vehicle.registration_number,
      'typeName', station_vehicle_type.display_name,
      'status', station_vehicle.status
    ) end,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event.id,
        'eventType', event.event_type,
        'fromStatus', event.from_status,
        'toStatus', event.to_status,
        'metadata', event.metadata,
        'createdAt', event.created_at
      ) order by event.created_at asc)
      from public.lpg_order_events event
      where event.lpg_order_id = target_order.id
    ), '[]'::jsonb),
    'scans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', scan.id,
        'publicReference', scan.public_reference,
        'scanType', scan.scan_type,
        'result', scan.result,
        'verificationEventId', scan.verification_event_id,
        'createdAt', scan.created_at
      ) order by scan.created_at asc)
      from public.lpg_cylinder_scans scan
      where scan.lpg_order_id = target_order.id
    ), '[]'::jsonb)
  )
  into result
  from public.lpg_refill_orders target_order
  join public.lpg_cylinders cylinder on cylinder.id = target_order.cylinder_id
  join public.profiles customer on customer.id = target_order.customer_user_id
  join public.lpg_customer_locations pickup on pickup.id = target_order.pickup_location_id
  join public.lpg_customer_locations delivery on delivery.id = target_order.delivery_location_id
  left join public.lpg_station_branches station on station.id = target_order.station_branch_id
  left join public.driver_profiles driver on driver.id = target_order.driver_profile_id
  left join public.profiles driver_user on driver_user.id = driver.user_id
  left join public.vehicles vehicle on vehicle.id = target_order.vehicle_id
  left join public.vehicle_types vehicle_type on vehicle_type.id = vehicle.vehicle_type_id
  left join public.lpg_station_managed_driver_assignments station_assignment
    on station_assignment.lpg_order_id = target_order.id and station_assignment.status <> 'cancelled'
  left join public.lpg_station_managed_drivers station_driver on station_driver.id = station_assignment.station_driver_id
  left join public.vehicles station_vehicle on station_vehicle.id = station_assignment.vehicle_id
  left join public.vehicle_types station_vehicle_type on station_vehicle_type.id = station_vehicle.vehicle_type_id
  where target_order.id = target_lpg_order_id;

  if result is null then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  return result;
end;
$function$
;


revoke all on function public.read_lpg_job_details(uuid) from public, anon;
grant execute on function public.read_lpg_job_details(uuid) to authenticated, service_role;

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

commit;
