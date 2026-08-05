begin;

create or replace function public.verify_lpg_scan_cylinder_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cylinder_record record;
  scanned_cylinder_id text;
  scanned_reference text;
  scanned_token text;
begin
  select cylinder.id,
         cylinder.public_reference,
         cylinder.cylinder_identifier,
         cylinder.qr_payload,
         cylinder.barcode_payload
  into cylinder_record
  from public.lpg_cylinders cylinder
  where cylinder.id = new.cylinder_id;

  if not found then
    raise exception 'scan cylinder does not exist';
  end if;

  scanned_cylinder_id := nullif(btrim(coalesce(new.payload ->> 'scannedCylinderId', '')), '');
  scanned_reference := nullif(btrim(coalesce(new.payload ->> 'scannedPublicReference', '')), '');
  scanned_token := nullif(btrim(coalesce(new.payload ->> 'scannedToken', '')), '');

  if scanned_cylinder_id is null and scanned_reference is null and scanned_token is null then
    raise exception 'a scanned cylinder identity is required';
  end if;

  if scanned_cylinder_id is not null
    and scanned_cylinder_id <> cylinder_record.id::text then
    raise exception 'scanned cylinder does not match the LPG order cylinder';
  end if;

  if scanned_reference is not null
    and scanned_reference <> cylinder_record.public_reference then
    raise exception 'scanned cylinder does not match the LPG order cylinder';
  end if;

  if scanned_token is not null
    and scanned_token is distinct from cylinder_record.public_reference
    and scanned_token is distinct from cylinder_record.cylinder_identifier
    and scanned_token is distinct from cylinder_record.qr_payload
    and scanned_token is distinct from cylinder_record.barcode_payload then
    raise exception 'scanned cylinder does not match the LPG order cylinder';
  end if;

  new.payload := new.payload || jsonb_build_object(
    'verifiedCylinderId', cylinder_record.id,
    'verifiedCylinderReference', cylinder_record.public_reference
  );
  return new;
end;
$$;

drop trigger if exists lpg_cylinder_scans_verify_identity on public.lpg_cylinder_scans;
create trigger lpg_cylinder_scans_verify_identity
before insert on public.lpg_cylinder_scans
for each row execute function public.verify_lpg_scan_cylinder_identity();

create or replace function public.read_lpg_job_details(target_lpg_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
      'publicReference', cylinder.public_reference,
      'cylinderIdentifier', cylinder.cylinder_identifier,
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
      'avatarUrl', customer.avatar_url
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
      'contactPhone', pickup.contact_phone
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
      'contactPhone', delivery.contact_phone
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
  where target_order.id = target_lpg_order_id;

  if result is null then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  return result;
end;
$$;

revoke all on function public.verify_lpg_scan_cylinder_identity() from public;
revoke all on function public.read_lpg_job_details(uuid) from public;
grant execute on function public.read_lpg_job_details(uuid) to authenticated, service_role;

commit;
