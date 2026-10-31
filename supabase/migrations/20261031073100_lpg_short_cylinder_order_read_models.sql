begin;

CREATE OR REPLACE FUNCTION public.read_lpg_jobs(target_queue text DEFAULT NULL::text, target_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare resolved_limit integer;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then raise exception 'authenticated user context is required'; end if;
  if target_queue is not null and target_queue not in ('customer','driver','station','admin') then raise exception 'target_queue is not supported'; end if;
  resolved_limit := least(greatest(coalesce(target_limit,50),1),200);
  return coalesce((select jsonb_agg(job_payload order by (job_payload->>'updatedAt') desc) from (
    select jsonb_build_object('queue',resolved.queue_name,'lpgOrderId',resolved.id,'publicReference',resolved.public_reference,'status',resolved.status,'assignmentStatus',resolved.assignment_status,'stationBranchId',resolved.station_branch_id,'stationDisplayName',station.display_name,'stationAddress',station.formatted_address,'driverProfileId',resolved.driver_profile_id,'driverDisplayName',assigned_driver.driver_display_name,'driverReference',assigned_driver.public_driver_id,'driverVerificationStatus',assigned_driver.verification_status,'cylinderId',resolved.cylinder_id,'cylinderReference',cylinder.cylinder_identifier,'cylinderIdentifier',cylinder.cylinder_identifier,'cylinderRegistryReference',cylinder.public_reference,'cylinderSizeKg',cylinder.size_kg,'cylinderTagStatus',cylinder.tag_status,'activeTagReference',active_tag.public_tag_reference,'requestedKg',resolved.requested_kg,'actualKg',resolved.actual_kg,'updatedAt',resolved.updated_at,'metadata',resolved.metadata) as job_payload
    from (
      select 'customer' as queue_name,target_order.* from public.lpg_refill_orders target_order where (target_queue is null or target_queue='customer') and target_order.customer_user_id=auth.uid() and target_order.status not in ('completed','cancelled','refunded','failed','expired')
      union all
      select 'driver' as queue_name,target_order.* from public.lpg_refill_orders target_order join public.driver_profiles driver on driver.id=target_order.driver_profile_id where (target_queue is null or target_queue='driver') and driver.user_id=auth.uid() and target_order.status not in ('completed','cancelled','refunded','failed','expired')
      union all
      select 'station' as queue_name,target_order.* from public.lpg_refill_orders target_order join public.lpg_station_branches station_scope on station_scope.id=target_order.station_branch_id where (target_queue is null or target_queue='station') and public.user_can_operate_lpg_station_branch(auth.uid(),station_scope.id,'lpg.orders.read') and target_order.status not in ('completed','cancelled','refunded','failed','expired')
      union all
      select 'admin' as queue_name,target_order.* from public.lpg_refill_orders target_order where (target_queue is null or target_queue='admin') and (auth.role()='service_role' or public.can_manage_lpg_operations()) and target_order.status not in ('completed','cancelled','refunded','failed','expired')
    ) resolved
    join public.lpg_cylinders cylinder on cylinder.id=resolved.cylinder_id
    left join public.driver_profiles assigned_driver on assigned_driver.id=resolved.driver_profile_id
    left join public.lpg_station_branches station on station.id=resolved.station_branch_id
    left join lateral (select tag.public_tag_reference from public.lpg_cylinder_tags tag where tag.cylinder_id=resolved.cylinder_id and tag.status='active' order by tag.bound_at desc nulls last,tag.created_at desc limit 1) active_tag on true
    order by resolved.updated_at desc limit resolved_limit
  ) jobs),'[]'::jsonb);
end;
$function$
;

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
      'avatarUrl', customer.avatar_url, 'email', (select account.email from auth.users account where account.id = customer.id)
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

CREATE OR REPLACE FUNCTION public.read_customer_refill_outlook()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with refill_history as (
    select
      orders.cylinder_id,
      orders.updated_at as refill_at,
      coalesce(orders.actual_kg, orders.quoted_kg, orders.requested_kg, 0)::numeric as refill_kg,
      lag(orders.updated_at) over (
        partition by orders.cylinder_id
        order by orders.updated_at
      ) as previous_refill_at
    from public.lpg_refill_orders orders
    where orders.customer_user_id = (select auth.uid())
      and orders.status in ('delivered', 'completed')
  ),
  cylinder_stats as (
    select
      history.cylinder_id,
      count(*)::integer as refill_count,
      max(history.refill_at) as last_refill_at,
      avg(history.refill_kg) as average_refill_kg,
      avg(
        extract(epoch from (history.refill_at - history.previous_refill_at)) / 86400.0
      ) filter (where history.previous_refill_at is not null) as average_interval_days
    from refill_history history
    group by history.cylinder_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'cylinderId', stats.cylinder_id,
        'cylinderName', cylinder.display_name,
        'cylinderReference', cylinder.cylinder_identifier,
        'legacyRegistryReference', cylinder.public_reference,
        'refillCount', stats.refill_count,
        'lastRefillAt', stats.last_refill_at,
        'averageRefillKg', case
          when stats.average_refill_kg is null then null
          else round(stats.average_refill_kg, 2)
        end,
        'averageIntervalDays', case
          when stats.average_interval_days is null then null
          else round(stats.average_interval_days::numeric, 1)
        end,
        'estimatedNextRefillAt', case
          when stats.average_interval_days is null then null
          else stats.last_refill_at
            + make_interval(secs => (stats.average_interval_days * 86400.0)::double precision)
        end,
        'confidence', case
          when stats.refill_count >= 5 then 'high'
          when stats.refill_count >= 3 then 'medium'
          when stats.refill_count >= 2 then 'low'
          else 'insufficient_history'
        end,
        'estimateOnly', true,
        'measurement', 'historical_refill_interval',
        'doesNotMeasureRemainingGas', true
      )
      order by stats.last_refill_at desc
    ),
    '[]'::jsonb
  )
  from cylinder_stats stats
  join public.lpg_cylinders cylinder
    on cylinder.id = stats.cylinder_id
   and cylinder.owner_user_id = (select auth.uid())
   and cylinder.status <> 'deactivated';
$function$
;

CREATE OR REPLACE FUNCTION public.read_lpg_station_runtime(target_station_branch_id uuid DEFAULT NULL::uuid, target_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  station_record record;
  resolved_limit integer;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  resolved_limit := least(greatest(coalesce(target_limit, 100), 1), 200);

  select station.*
  into station_record
  from public.lpg_station_branches station
  where (target_station_branch_id is null or station.id = target_station_branch_id)
    and public.can_read_lpg_station_branch(station.id)
  order by station.created_at asc
  limit 1;

  if not found then
    raise exception 'branch-scoped LPG station access is required';
  end if;

  return jsonb_build_object(
    'branch', jsonb_build_object(
      'id', station_record.id,
      'organizationId', station_record.organization_id,
      'branchId', station_record.branch_id,
      'displayName', station_record.display_name,
      'formattedAddress', station_record.formatted_address,
      'latitude', station_record.latitude,
      'longitude', station_record.longitude,
      'serviceRadiusMeters', station_record.service_radius_meters,
      'operatingHours', station_record.operating_hours,
      'supportedCylinderSizesKg', station_record.supported_cylinder_sizes_kg,
      'refillCapacityKg', station_record.refill_capacity_kg,
      'currentAvailableKg', station_record.current_available_kg,
      'availabilityStatus', station_record.availability_status,
      'approvalStatus', station_record.approval_status,
      'complianceStatus', station_record.compliance_status,
      'metadata', station_record.metadata,
      'updatedAt', station_record.updated_at
    ),
    'summary', jsonb_build_object(
      'activeJobs', (
        select count(*)
        from public.lpg_refill_orders target_order
        where target_order.station_branch_id = station_record.id
          and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed')
      ),
      'atStationJobs', (
        select count(*)
        from public.lpg_refill_orders target_order
        where target_order.station_branch_id = station_record.id
          and target_order.status in ('station_verified', 'refill_in_progress', 'refill_confirmed', 'station_settled')
      ),
      'completedJobs', (
        select count(*)
        from public.lpg_refill_orders target_order
        where target_order.station_branch_id = station_record.id
          and target_order.status in ('delivered', 'completed')
      ),
      'totalRefilledKg', coalesce((
        select sum(refill.actual_kg)
        from public.lpg_refill_records refill
        where refill.station_branch_id = station_record.id
          and refill.status = 'confirmed'
      ), 0),
      'activeReservedKg', coalesce((
        select sum(reservation.reserved_kg)
        from public.lpg_station_capacity_reservations reservation
        where reservation.station_branch_id = station_record.id
          and reservation.status = 'reserved'
      ), 0)
    ),
    'orders', coalesce((
      select jsonb_agg(order_payload order by (order_payload ->> 'updatedAt') desc)
      from (
        select jsonb_build_object(
          'id', target_order.id,
          'publicReference', target_order.public_reference,
          'status', target_order.status,
          'paymentStatus', target_order.payment_status,
          'assignmentStatus', target_order.assignment_status,
          'requestedKg', target_order.requested_kg,
          'actualKg', target_order.actual_kg,
          'currencyCode', target_order.currency_code,
          'stationAmount', target_order.station_amount,
          'driverProfileId', target_order.driver_profile_id,
          'cylinder', jsonb_build_object(
            'id', cylinder.id,
            'publicReference', cylinder.cylinder_identifier,
            'cylinderIdentifier', cylinder.cylinder_identifier,
            'legacyRegistryReference', cylinder.public_reference,
            'sizeKg', cylinder.size_kg,
            'conditionStatus', cylinder.condition_status,
            'status', cylinder.status,
            'imageAssetIds', cylinder.image_asset_ids
          ),
          'createdAt', target_order.created_at,
          'updatedAt', target_order.updated_at
        ) as order_payload
        from public.lpg_refill_orders target_order
        join public.lpg_cylinders cylinder on cylinder.id = target_order.cylinder_id
        where target_order.station_branch_id = station_record.id
        order by target_order.updated_at desc
        limit resolved_limit
      ) recent_orders
    ), '[]'::jsonb),
    'reservations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', reservation.id,
          'lpgOrderId', reservation.lpg_order_id,
          'requestedKg', reservation.requested_kg,
          'reservedKg', reservation.reserved_kg,
          'consumedKg', reservation.consumed_kg,
          'status', reservation.status,
          'expiresAt', reservation.expires_at,
          'createdAt', reservation.created_at,
          'updatedAt', reservation.updated_at
        ) order by reservation.created_at desc
      )
      from public.lpg_station_capacity_reservations reservation
      where reservation.station_branch_id = station_record.id
    ), '[]'::jsonb),
    'pricing', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pricing.id,
          'currencyCode', pricing.currency_code,
          'pricePerKg', pricing.price_per_kg,
          'deliveryBaseFee', pricing.delivery_base_fee,
          'platformFeeAmount', pricing.platform_fee_amount,
          'taxRatePercent', pricing.tax_rate_percent,
          'driverCommissionAmount', pricing.driver_commission_amount,
          'minKg', pricing.min_kg,
          'maxKg', pricing.max_kg,
          'status', pricing.status,
          'effectiveFrom', pricing.effective_from,
          'effectiveUntil', pricing.effective_until
        ) order by pricing.effective_from desc
      )
      from public.lpg_refill_pricing pricing
      where pricing.station_branch_id = station_record.id
        and pricing.status = 'active'
        and pricing.effective_from <= timezone('utc', now())
        and (pricing.effective_until is null or pricing.effective_until > timezone('utc', now()))
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', branch_event.id,
          'eventType', branch_event.event_type,
          'payload', branch_event.payload,
          'createdAt', branch_event.created_at
        ) order by branch_event.created_at desc
      )
      from (
        select event_record.*
        from public.lpg_station_branch_events event_record
        where event_record.station_branch_id = station_record.id
        order by event_record.created_at desc
        limit resolved_limit
      ) branch_event
    ), '[]'::jsonb)
  );
end;
$function$
;

commit;
