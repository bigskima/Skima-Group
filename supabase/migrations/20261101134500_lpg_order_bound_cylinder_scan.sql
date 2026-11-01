-- Physical cylinder verification from an open job must be scoped to that exact order.
-- The general continuous scanner remains a separate auto-matching queue endpoint.
begin;

create or replace function public.record_lpg_cylinder_scan_for_order(
  target_lpg_order_id uuid,
  target_workspace text,
  target_token text,
  target_idempotency_key text,
  target_latitude numeric default null,
  target_longitude numeric default null,
  target_accuracy_meters numeric default null,
  target_source text default 'skima.lpg.order_bound'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  token_value text;
  order_id uuid;
  order_status text;
  scan_type text;
  scan_id uuid;
  final_status text;
  order_reference text;
  matched_cylinder_id uuid;
  matched_cylinder_identifier text;
  candidate_count integer := 0;
  token_candidate_count integer := 0;
  scanned_identity_cylinder_id uuid;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'authenticated user context is required';
  end if;

  if target_lpg_order_id is null then
    raise exception 'lpgOrderId is required for order-bound cylinder verification';
  end if;

  if target_workspace not in ('driver', 'station') then
    raise exception 'workspace must be driver or station';
  end if;

  token_value := nullif(btrim(target_token), '');
  if token_value is null or char_length(token_value) > 512 then
    raise exception 'scan a cylinder QR/tag or enter its five-character Cylinder ID';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'idempotency key is required';
  end if;

  -- Do not allow a caller to replay a key that was already consumed by a different order.
  target_source := 'skima.lpg.order_bound';
  if exists (
    select 1
    from public.lpg_cylinder_scans existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key
      and existing.lpg_order_id <> target_lpg_order_id
  ) then
    raise exception 'this scan attempt key is already associated with a different LPG order';
  end if;

  -- A retry is valid only for the same order and same credential.
  select existing.id,
         existing.lpg_order_id,
         existing.scan_type,
         order_row.public_reference,
         cylinder.id,
         cylinder.cylinder_identifier,
         order_row.status
  into scan_id,
       order_id,
       scan_type,
       order_reference,
       matched_cylinder_id,
       matched_cylinder_identifier,
       final_status
  from public.lpg_cylinder_scans existing
  join public.lpg_refill_orders order_row on order_row.id = existing.lpg_order_id
  join public.lpg_cylinders cylinder on cylinder.id = existing.cylinder_id
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key
    and existing.lpg_order_id = target_lpg_order_id
    and existing.payload ->> 'scannedToken' = token_value
    and (
      (
        target_workspace = 'driver'
        and (
          exists (
            select 1
            from public.driver_profiles assigned_driver
            where assigned_driver.id = order_row.driver_profile_id
              and assigned_driver.user_id = auth.uid()
          )
          or public.is_lpg_station_managed_order_driver(order_row.id, auth.uid())
        )
      )
      or
      (
        target_workspace = 'station'
        and public.user_can_operate_lpg_station_branch(
          auth.uid(),
          order_row.station_branch_id,
          'lpg.orders.read'
        )
      )
    );

  if found then
    return jsonb_build_object(
      'scanId', scan_id,
      'lpgOrderId', order_id,
      'orderReference', order_reference,
      'cylinderId', matched_cylinder_id,
      'cylinderIdentifier', matched_cylinder_identifier,
      'scanType', scan_type,
      'status', final_status,
      'replayed', true
    );
  end if;

  -- Resolve only the requested order. A valid code from another active order
  -- can never redirect this verification to that other order.
  if target_workspace = 'driver' then
    select count(*),
           (array_agg(candidate.id order by candidate.updated_at desc))[1],
           (array_agg(candidate.status order by candidate.updated_at desc))[1],
           (array_agg(candidate.scan_type order by candidate.updated_at desc))[1],
           (array_agg(candidate.cylinder_id order by candidate.updated_at desc))[1]
    into candidate_count, order_id, order_status, scan_type, matched_cylinder_id
    from (
      select order_row.id,
             order_row.status,
             order_row.updated_at,
             order_row.cylinder_id,
             case
               when order_row.status in ('driver_accepted', 'pickup_en_route') then 'customer_pickup'
               when order_row.fulfillment_channel = 'skima_internal'
                 and order_row.status in ('pickup_verified', 'station_en_route') then 'station_receipt'
               when order_row.status in ('return_en_route', 'delivery_verification_pending') then 'customer_delivery'
               else null
             end as scan_type
      from public.lpg_refill_orders order_row
      left join public.driver_profiles driver on driver.id = order_row.driver_profile_id
      where order_row.id = target_lpg_order_id
        and (
          driver.user_id = auth.uid()
          or public.is_lpg_station_managed_order_driver(order_row.id, auth.uid())
        )
        and (
          order_row.status in (
            'driver_accepted',
            'pickup_en_route',
            'return_en_route',
            'delivery_verification_pending'
          )
          or (
            order_row.fulfillment_channel = 'skima_internal'
            and order_row.status in ('pickup_verified', 'station_en_route')
          )
        )
    ) candidate;
  else
    select count(*),
           (array_agg(candidate.id order by candidate.updated_at desc))[1],
           (array_agg(candidate.status order by candidate.updated_at desc))[1],
           (array_agg(candidate.scan_type order by candidate.updated_at desc))[1],
           (array_agg(candidate.cylinder_id order by candidate.updated_at desc))[1]
    into candidate_count, order_id, order_status, scan_type, matched_cylinder_id
    from (
      select order_row.id,
             order_row.status,
             order_row.updated_at,
             order_row.cylinder_id,
             case
               when order_row.status = 'station_en_route' then 'station_receipt'
               when order_row.status in ('refill_confirmed', 'station_settled') then 'station_release'
               else null
             end as scan_type
      from public.lpg_refill_orders order_row
      where order_row.id = target_lpg_order_id
        and order_row.station_branch_id is not null
        and public.user_can_operate_lpg_station_branch(
          auth.uid(),
          order_row.station_branch_id,
          'lpg.orders.read'
        )
        and (
          (
            order_row.status = 'station_en_route'
            and (
              public.can_operate_lpg_station_branch(order_row.station_branch_id, 'lpg.stations.scan')
              or public.can_operate_lpg_station_branch(order_row.station_branch_id, 'lpg.stations.pump')
            )
          )
          or
          (
            order_row.status in ('refill_confirmed', 'station_settled')
            and public.can_operate_lpg_station_branch(order_row.station_branch_id, 'lpg.stations.scan')
          )
        )
        and order_row.status in ('station_en_route', 'refill_confirmed', 'station_settled')
    ) candidate;
  end if;

  if candidate_count = 0 then
    raise exception 'this exact order is not active, assigned to you, or ready for cylinder verification in this workspace';
  elsif candidate_count > 1 then
    raise exception 'the requested order resolved to more than one active verification target';
  end if;

  select cylinder.cylinder_identifier
  into matched_cylinder_identifier
  from public.lpg_cylinders cylinder
  where cylinder.id = matched_cylinder_id;

  if matched_cylinder_id is null or matched_cylinder_identifier is null then
    raise exception 'the requested LPG order has no registered cylinder identity';
  end if;

  -- Independently resolve the supplied token globally. This catches both
  -- wrong-cylinder scans and ambiguous/colliding identifiers before any state changes.
  select count(distinct cylinder.id),
         (array_agg(cylinder.id order by cylinder.created_at desc))[1]
  into token_candidate_count, scanned_identity_cylinder_id
  from public.lpg_cylinders cylinder
  where upper(coalesce(cylinder.cylinder_identifier, '')) = upper(token_value)
     or upper(coalesce(cylinder.public_reference, '')) = upper(token_value)
     or cylinder.qr_payload = token_value
     or cylinder.barcode_payload = token_value
     or exists (
       select 1
       from jsonb_array_elements_text(
         case
           when jsonb_typeof(cylinder.metadata->'legacyCylinderIdentifiers') = 'array'
             then cylinder.metadata->'legacyCylinderIdentifiers'
           else '[]'::jsonb
         end
       ) legacy_alias
       where upper(legacy_alias) = upper(token_value)
     )
     or exists (
       select 1
       from public.lpg_cylinder_tags tag
       where tag.cylinder_id = cylinder.id
         and tag.status = 'active'
         and tag.credential_hash = public.hash_lpg_cylinder_tag_credential(token_value)
     );

  if token_candidate_count = 0 then
    raise exception 'the scanned credential does not identify a registered SKIMA cylinder';
  elsif token_candidate_count > 1 then
    raise exception 'this credential matches more than one cylinder and cannot be verified automatically';
  elsif scanned_identity_cylinder_id is distinct from matched_cylinder_id then
    raise exception 'scanned cylinder does not match the cylinder assigned to this exact LPG order';
  end if;

  -- A repeat return scan remains idempotent and does not create another hand-over event.
  if scan_type = 'customer_delivery' then
    select existing.id
    into scan_id
    from public.lpg_cylinder_scans existing
    where existing.lpg_order_id = order_id
      and existing.cylinder_id = matched_cylinder_id
      and existing.scan_type = 'customer_delivery'
      and existing.result = 'passed'
    order by existing.created_at desc
    limit 1;

    if found then
      select order_row.status, order_row.public_reference
      into final_status, order_reference
      from public.lpg_refill_orders order_row
      where order_row.id = order_id;

      return jsonb_build_object(
        'scanId', scan_id,
        'lpgOrderId', order_id,
        'orderReference', order_reference,
        'cylinderId', matched_cylinder_id,
        'cylinderIdentifier', matched_cylinder_identifier,
        'scanType', scan_type,
        'status', final_status,
        'replayed', true,
        'alreadyVerified', true
      );
    end if;
  end if;

  -- Start the relevant leg inside the same transaction where the lifecycle requires it.
  if scan_type = 'customer_pickup' and order_status = 'driver_accepted' then
    perform public.process_lpg_order_action(
      order_id,
      'lpg.pickup.start',
      target_idempotency_key || ':pickup-start',
      jsonb_build_object('startedByOrderBoundScan', true),
      target_source
    );
  elsif scan_type = 'station_receipt' and order_status = 'pickup_verified' then
    perform public.process_lpg_order_action(
      order_id,
      'lpg.station.start',
      target_idempotency_key || ':station-start',
      jsonb_build_object('startedBeforeStationReceipt', true),
      target_source
    );
  end if;

  scan_id := public.record_lpg_cylinder_scan(
    order_id,
    scan_type,
    target_idempotency_key,
    target_latitude,
    target_longitude,
    target_accuracy_meters,
    jsonb_build_object(
      'scannedToken', token_value,
      'scannedCylinderId', matched_cylinder_id,
      'orderBound', true,
      'scanWorkspace', target_workspace
    ),
    target_source
  );

  if scan_type = 'customer_pickup' then
    perform public.process_lpg_order_action(
      order_id,
      'lpg.station.start',
      target_idempotency_key || ':station-start',
      jsonb_build_object('startedAfterPickupVerification', true),
      target_source
    );
  end if;

  select order_row.status, order_row.public_reference
  into final_status, order_reference
  from public.lpg_refill_orders order_row
  where order_row.id = order_id;

  return jsonb_build_object(
    'scanId', scan_id,
    'lpgOrderId', order_id,
    'orderReference', order_reference,
    'cylinderId', matched_cylinder_id,
    'cylinderIdentifier', matched_cylinder_identifier,
    'scanType', scan_type,
    'status', final_status,
    'replayed', false
  );
end;
$function$;

revoke all on function public.record_lpg_cylinder_scan_for_order(uuid,text,text,text,numeric,numeric,numeric,text)
  from public, anon;
grant execute on function public.record_lpg_cylinder_scan_for_order(uuid,text,text,text,numeric,numeric,numeric,text)
  to authenticated, service_role;

comment on function public.record_lpg_cylinder_scan_for_order(uuid,text,text,text,numeric,numeric,numeric,text) is
  'Order-bound LPG cylinder scan. Resolves the credential globally, requires its cylinder ID to equal the exact open order cylinder, validates the assigned driver or station scope, and records the scan only against that order.';

commit;
