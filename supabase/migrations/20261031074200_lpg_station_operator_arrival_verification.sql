begin;

CREATE OR REPLACE FUNCTION public.record_lpg_cylinder_scan(target_lpg_order_id uuid, target_scan_type text, target_idempotency_key text, target_latitude numeric DEFAULT NULL::numeric, target_longitude numeric DEFAULT NULL::numeric, target_accuracy_meters numeric DEFAULT NULL::numeric, target_payload jsonb DEFAULT '{}'::jsonb, target_source text DEFAULT 'lpg.verification_api'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  order_record record;
  driver_record record;
  scan_id uuid;
  new_status text;
  history_event text;
  verification_definition_key text;
  verification_event_id uuid;
  result_status text := 'passed';
  delivery_challenge_id uuid;
begin
  if target_scan_type not in ('customer_pickup', 'station_receipt', 'station_release', 'customer_delivery', 'inspection') then
    raise exception 'target_scan_type is not supported';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_payload is null or jsonb_typeof(target_payload) <> 'object' then
    raise exception 'target_payload must be a JSON object';
  end if;

  select existing.id
  into scan_id
  from public.lpg_cylinder_scans existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    return scan_id;
  end if;

  select target_order.*
  into order_record
  from public.lpg_refill_orders target_order
  where target_order.id = target_lpg_order_id
  for update;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if not public.can_access_lpg_order(target_lpg_order_id) then
    raise exception 'LPG order access permission is required';
  end if;
  -- Station Managed pickup and receipt scans require the order's active station-driver assignment.

  select driver.*
  into driver_record
  from public.driver_profiles driver
  where driver.id = order_record.driver_profile_id;

  if target_scan_type = 'customer_pickup' then
    if order_record.status not in ('driver_accepted', 'pickup_en_route') then
      raise exception 'customer pickup scan is not valid for the current order status';
    end if;
    if auth.role() <> 'service_role'
      and (driver_record.user_id is distinct from auth.uid() and not public.is_lpg_station_managed_order_driver(order_record.id,auth.uid()))
      and not public.can_manage_lpg_operations() then
      raise exception 'assigned driver is required for pickup scan';
    end if;
    new_status := 'pickup_verified';
    history_event := 'pickup_scan';
    verification_definition_key := 'verification.lpg.pickup.asset_scan';
  elsif target_scan_type = 'station_receipt' then
    if order_record.status not in ('pickup_verified', 'station_en_route') then
      raise exception 'station receipt scan is not valid for the current order status';
    end if;
    if auth.role() <> 'service_role'
      and driver_record.user_id is distinct from auth.uid()
      and not public.is_lpg_station_managed_order_driver(order_record.id,auth.uid())
      and not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.stations.scan')
      and not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.stations.pump')
      and not public.can_manage_lpg_operations() then
      raise exception 'assigned driver or authorized station operator is required for station receipt scan';
    end if;
    new_status := 'station_verified';
    history_event := 'station_scan';
    verification_definition_key := 'verification.lpg.partner.fulfillment_scan';
  elsif target_scan_type = 'station_release' then
    if order_record.status not in ('refill_confirmed', 'station_settled') then
      raise exception 'station release scan is not valid for the current order status';
    end if;
    if not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.stations.scan') then
      raise exception 'branch-scoped LPG scanner permission is required';
    end if;
    new_status := 'return_en_route';
    history_event := 'station_scan';
    verification_definition_key := 'verification.lpg.partner.fulfillment_scan';
  elsif target_scan_type = 'customer_delivery' then
    if order_record.status not in ('return_en_route', 'delivery_verification_pending') then
      raise exception 'customer delivery scan is not valid for the current order status';
    end if;

    if target_payload ? 'deliveryChallengeId' then
      delivery_challenge_id := nullif(target_payload ->> 'deliveryChallengeId', '')::uuid;
    else
      delivery_challenge_id := order_record.delivery_challenge_id;
    end if;

    if auth.role() <> 'service_role'
      and auth.uid() is distinct from order_record.customer_user_id
      and (driver_record.user_id is distinct from auth.uid() and not public.is_lpg_station_managed_order_driver(order_record.id,auth.uid()))
      and not public.can_manage_lpg_operations() then
      raise exception 'customer or assigned driver is required for delivery scan';
    end if;

    if delivery_challenge_id is null
      or not public.lpg_delivery_challenge_is_verified(order_record.id, delivery_challenge_id) then
      raise exception 'verified LPG delivery challenge is required';
    end if;

    new_status := 'delivered';
    history_event := 'delivery_verified';
    verification_definition_key := 'verification.lpg.delivery.asset_scan';
  else
    if not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.stations.scan')
      and not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.stations.pump')
      and not public.can_manage_lpg_operations() then
      raise exception 'branch-scoped LPG inspection permission is required';
    end if;
    new_status := order_record.status;
    history_event := 'inspection';
    verification_definition_key := 'verification.lpg.partner.fulfillment_scan';
  end if;

  verification_event_id := public.record_verification_event(
    verification_definition_key,
    target_source,
    'asset',
    order_record.cylinder_id,
    'lpg.scan.' || target_scan_type,
    jsonb_build_object('latitude', target_latitude, 'longitude', target_longitude, 'accuracy_meters', target_accuracy_meters),
    'passed',
    target_payload || jsonb_build_object('lpg_order_id', order_record.id, 'scan_type', target_scan_type),
    target_idempotency_key || ':verification',
    timezone('utc', now())
  );

  insert into public.lpg_cylinder_scans (
    lpg_order_id,
    cylinder_id,
    scan_type,
    driver_profile_id,
    station_branch_id,
    verification_event_id,
    latitude,
    longitude,
    accuracy_meters,
    result,
    payload,
    source,
    idempotency_key
  )
  values (
    order_record.id,
    order_record.cylinder_id,
    target_scan_type,
    order_record.driver_profile_id,
    order_record.station_branch_id,
    verification_event_id,
    target_latitude,
    target_longitude,
    target_accuracy_meters,
    result_status,
    target_payload,
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key) do nothing
  returning id into scan_id;

  if scan_id is null then
    select existing.id
    into scan_id
    from public.lpg_cylinder_scans existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    return scan_id;
  end if;

  if new_status <> order_record.status then
    update public.lpg_refill_orders
    set status = new_status,
        updated_at = timezone('utc', now())
    where id = order_record.id;

    update public.service_requests
    set status = case
      when new_status = 'delivered' then 'completed'
      when new_status in ('pickup_verified', 'station_verified', 'return_en_route') then 'in_progress'
      else status
    end,
        updated_at = timezone('utc', now())
    where id = order_record.service_request_id;

    if order_record.order_record_id is not null then
      update public.order_records
      set status = case
            when new_status = 'delivered' then 'fulfilled'
            when new_status in ('cancelled', 'refunded') then 'cancelled'
            else status
          end,
          fulfilled_at = case when new_status = 'delivered' then timezone('utc', now()) else fulfilled_at end,
          updated_at = timezone('utc', now())
      where id = order_record.order_record_id;
    end if;
  end if;

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.scan.' || target_scan_type,
    order_record.status,
    new_status,
    target_idempotency_key || ':event',
    target_payload || jsonb_build_object(
      'scan_id',
      scan_id,
      'verification_event_id',
      verification_event_id
    )
  );

  perform public.record_lpg_cylinder_history(
    order_record.cylinder_id,
    history_event,
    target_idempotency_key || ':cylinder-history',
    order_record.id,
    order_record.station_branch_id,
    order_record.driver_profile_id,
    null,
    target_payload,
    jsonb_build_object('latitude', target_latitude, 'longitude', target_longitude, 'accuracy_meters', target_accuracy_meters)
  );

  if target_scan_type = 'customer_delivery'
    and order_record.tracking_session_id is not null then
    update public.tracking_sessions
    set status = 'completed',
        ended_at = coalesce(ended_at, timezone('utc', now())),
        updated_at = timezone('utc', now())
    where id = order_record.tracking_session_id
      and status <> 'completed';

    insert into public.tracking_session_events (
      tracking_session_id,
      status,
      idempotency_key,
      metadata
    )
    values (
      order_record.tracking_session_id,
      'completed',
      target_idempotency_key || ':tracking-completed',
      jsonb_build_object('lpg_order_id', order_record.id)
    )
    on conflict do nothing;
  end if;

  if target_scan_type = 'customer_delivery' and new_status = 'delivered'
    and order_record.fulfillment_mode = 'station_managed' then
    update public.lpg_station_managed_driver_assignments assignment
    set status = 'delivered', completed_at = timezone('utc', now())
    from public.lpg_station_managed_drivers station_driver
    where assignment.lpg_order_id = order_record.id
      and assignment.station_driver_id = station_driver.id
      and station_driver.user_id = auth.uid()
      and station_driver.status = 'active'
      and assignment.status in ('accepted', 'en_route');
  end if;

  return scan_id;
end;
$function$
;

commit;
