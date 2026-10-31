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
    select jsonb_build_object('queue',resolved.queue_name,'lpgOrderId',resolved.id,'publicReference',resolved.public_reference,'status',resolved.status,'assignmentStatus',resolved.assignment_status,'stationBranchId',resolved.station_branch_id,'stationDisplayName',station.display_name,'stationAddress',station.formatted_address,'driverProfileId',resolved.driver_profile_id,'driverDisplayName',assigned_driver.driver_display_name,'driverReference',assigned_driver.public_driver_id,'driverVerificationStatus',assigned_driver.verification_status,'cylinderId',resolved.cylinder_id,'cylinderReference',cylinder.cylinder_identifier,'cylinderIdentifier',cylinder.cylinder_identifier,'cylinderRegistryReference',cylinder.public_reference,'cylinderSizeKg',cylinder.size_kg,'cylinderTagStatus',cylinder.tag_status,'activeTagReference',active_tag.public_tag_reference,'requestedKg',resolved.requested_kg,'actualKg',resolved.actual_kg,'latestInspectionResult',case when resolved.queue_name in ('driver','station','admin') then latest_inspection.result else null end,'latestInspectionNotes',case when resolved.queue_name in ('station','admin') then latest_inspection.observations->>'notes' else null end,'latestInspectionAt',case when resolved.queue_name in ('driver','station','admin') then latest_inspection.created_at else null end,'updatedAt',resolved.updated_at,'metadata',resolved.metadata) as job_payload
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
    left join lateral (select inspection.result,inspection.observations,inspection.created_at from public.lpg_cylinder_inspections inspection where inspection.lpg_order_id=resolved.id order by inspection.created_at desc limit 1) latest_inspection on true
    left join lateral (select tag.public_tag_reference from public.lpg_cylinder_tags tag where tag.cylinder_id=resolved.cylinder_id and tag.status='active' order by tag.bound_at desc nulls last,tag.created_at desc limit 1) active_tag on true
    order by resolved.updated_at desc limit resolved_limit
  ) jobs),'[]'::jsonb);
end;
$function$
;

create or replace function public.record_lpg_cylinder_scan_for_active_job(
  target_workspace text,
  target_token text,
  target_idempotency_key text,
  target_latitude numeric default null,
  target_longitude numeric default null,
  target_accuracy_meters numeric default null,
  target_source text default 'skima.lpg.continuous'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  token_value text;
  matched_cylinder_id uuid;
  matched_cylinder_identifier text;
  candidate_count integer := 0;
  order_id uuid;
  order_status text;
  scan_type text;
  scan_id uuid;
  final_status text;
  order_reference text;
begin
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'authenticated user context is required';
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

  -- A retry returns the original result. It must not reinterpret the same
  -- token against the order's next lifecycle stage.
  select existing.id, existing.lpg_order_id, existing.scan_type,
         order_row.public_reference, cylinder.cylinder_identifier, order_row.status
  into scan_id, order_id, scan_type, order_reference, matched_cylinder_identifier, final_status
  from public.lpg_cylinder_scans existing
  join public.lpg_refill_orders order_row on order_row.id = existing.lpg_order_id
  join public.lpg_cylinders cylinder on cylinder.id = existing.cylinder_id
  join public.driver_profiles driver on driver.id = order_row.driver_profile_id
  join public.driver_profiles driver on driver.id = order_row.driver_profile_id
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key
    and (
      (target_workspace = 'driver' and (
        driver.user_id = auth.uid()
        or public.is_lpg_station_managed_order_driver(order_row.id, auth.uid())
      ))
      or
      (target_workspace = 'station'
        and public.user_can_operate_lpg_station_branch(
          auth.uid(),
          order_row.station_branch_id,
          'lpg.orders.read'
        ))
    );
  if found then
    return jsonb_build_object(
      'scanId', scan_id,
      'lpgOrderId', order_id,
      'orderReference', order_reference,
      'cylinderIdentifier', matched_cylinder_identifier,
      'scanType', scan_type,
      'status', final_status,
      'replayed', true
    );
  end if;

  -- Match only exact human IDs, previous aliases, QR/barcode credentials or
  -- active physical-tag credentials. Never search by a loose substring.
  select count(distinct cylinder.id),
         (array_agg(cylinder.id order by cylinder.created_at desc))[1],
         (array_agg(cylinder.cylinder_identifier order by cylinder.created_at desc))[1]
  into candidate_count, matched_cylinder_id, matched_cylinder_identifier
  from public.lpg_cylinders cylinder
  where upper(cylinder.cylinder_identifier) = upper(token_value)
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

  if candidate_count = 0 then
    raise exception 'cylinder code was not recognised. Check the code and try again.';
  elsif candidate_count > 1 then
    raise exception 'this code matches more than one cylinder. Open the assigned order for manual review.';
  end if;

  if target_workspace = 'driver' then
    select count(*),
           (array_agg(candidate.id order by candidate.updated_at desc))[1],
           (array_agg(candidate.status order by candidate.updated_at desc))[1],
           (array_agg(candidate.scan_type order by candidate.updated_at desc))[1]
    into candidate_count, order_id, order_status, scan_type
    from (
      select order_row.id, order_row.status, order_row.updated_at,
        case
          when order_row.status in ('driver_accepted', 'pickup_en_route') then 'customer_pickup'
          when order_row.status in ('pickup_verified', 'station_en_route') then 'station_receipt'
          when order_row.status in ('return_en_route', 'delivery_verification_pending') then 'customer_delivery'
          else null
        end as scan_type
      from public.lpg_refill_orders order_row
      left join public.driver_profiles driver on driver.id = order_row.driver_profile_id
      where order_row.cylinder_id = matched_cylinder_id
        and (driver.user_id = auth.uid() or public.is_lpg_station_managed_order_driver(order_row.id, auth.uid()))
        and order_row.status in (
          'driver_accepted', 'pickup_en_route', 'pickup_verified',
          'station_en_route', 'return_en_route', 'delivery_verification_pending'
        )
    ) candidate;
  else
    select count(*),
           (array_agg(candidate.id order by candidate.updated_at desc))[1],
           (array_agg(candidate.status order by candidate.updated_at desc))[1],
           (array_agg(candidate.scan_type order by candidate.updated_at desc))[1]
    into candidate_count, order_id, order_status, scan_type
    from (
      select order_row.id, order_row.status, order_row.updated_at,
        case
          when order_row.status = 'station_en_route' then 'station_receipt'
          when order_row.status in ('refill_confirmed', 'station_settled') then 'station_release'
          else null
        end as scan_type
      from public.lpg_refill_orders order_row
      where order_row.cylinder_id = matched_cylinder_id
        and order_row.station_branch_id is not null
        and public.user_can_operate_lpg_station_branch(auth.uid(), order_row.station_branch_id, 'lpg.orders.read')
        and (
          (order_row.status = 'station_en_route' and (
            public.can_operate_lpg_station_branch(order_row.station_branch_id, 'lpg.stations.scan')
            or public.can_operate_lpg_station_branch(order_row.station_branch_id, 'lpg.stations.pump')
          ))
          or
          (order_row.status in ('refill_confirmed', 'station_settled')
            and public.can_operate_lpg_station_branch(order_row.station_branch_id, 'lpg.stations.scan'))
        )
        and order_row.status in ('station_en_route', 'refill_confirmed', 'station_settled')
    ) candidate;
  end if;

  if candidate_count = 0 then
    raise exception 'this cylinder has no active order ready for verification in your workspace.';
  elsif candidate_count > 1 then
    raise exception 'this cylinder is linked to more than one active order. Open the order queue to resolve the assignment.';
  end if;

  -- Scanning at pickup can begin the route when the driver hasn't pressed
  -- Start route. The same transaction then records custody and starts station
  -- transit. Every transition still uses the existing action definitions.
  if scan_type = 'customer_pickup' and order_status = 'driver_accepted' then
    perform public.process_lpg_order_action(
      order_id,
      'lpg.pickup.start',
      target_idempotency_key || ':pickup-start',
      jsonb_build_object('startedByContinuousScan', true),
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
      'continuousScan', true,
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
    'cylinderIdentifier', matched_cylinder_identifier,
    'scanType', scan_type,
    'status', final_status,
    'replayed', false
  );
end;
$function$;

revoke all on function public.record_lpg_cylinder_scan_for_active_job(text,text,text,numeric,numeric,numeric,text) from public, anon;
grant execute on function public.record_lpg_cylinder_scan_for_active_job(text,text,text,numeric,numeric,numeric,text) to authenticated, service_role;


comment on function public.record_lpg_cylinder_scan_for_active_job(text,text,text,numeric,numeric,numeric,text) is
  'Continuous driver/station cylinder scan resolver. Matches exact QR, barcode, physical tag, five-character ID or legacy alias only against the authenticated actor\x27s current assigned jobs, then delegates to the existing order-level cylinder scan and action functions.';

commit;
