begin;

-- Advance LPG jobs from verified physical events, not extra driver buttons.
-- The customer OTP remains the final delivery authorization and escrow gate.

do $automatic_lpg_scan_advancement$
declare
  function_sql text;
  old_block text;
  new_block text;
begin
  function_sql := pg_get_functiondef(
    'public.record_lpg_cylinder_scan(uuid,text,text,numeric,numeric,numeric,jsonb,text)'::regprocedure
  );

  old_block := E'  return scan_id;\nend;\n$function$';
  new_block := E'
  -- Once the customer's cylinder is physically collected, start the station
  -- leg automatically. The scan function has already authenticated the
  -- assigned driver (including Station Managed assignments) and recorded
  -- the immutable pickup event above.
  if target_scan_type = ''customer_pickup'' and new_status = ''pickup_verified'' then
    perform public.process_lpg_order_action(
      order_record.id,
      ''lpg.station.start'',
      target_idempotency_key || '':auto-station-start'',
      target_payload || jsonb_build_object(
        ''automatic_transition'', true,
        ''trigger_scan_id'', scan_id,
        ''trigger_scan_type'', target_scan_type
      ),
      ''lpg.scan.auto_advance''
    );
  end if;

  -- Station Managed drivers should not need a second "start return" tap after
  -- the station has scanned the released cylinder. The station release scan
  -- already moved the order to return_en_route, so activate its assignment
  -- here without invoking lpg.return.start a second time.
  if target_scan_type = ''station_release''
    and new_status = ''return_en_route''
    and order_record.fulfillment_mode = ''station_managed'' then
    update public.lpg_station_managed_driver_assignments assignment
    set status = ''en_route'',
        completed_at = null,
        metadata = assignment.metadata || jsonb_build_object(
          ''automaticReturnStart'', true,
          ''returnStartedByScanId'', scan_id,
          ''returnStartedAt'', timezone(''utc'', now())
        )
    where assignment.lpg_order_id = order_record.id
      and assignment.station_branch_id = order_record.station_branch_id
      and assignment.status = ''accepted'';
  end if;

  return scan_id;
end;
$function$';
  if position(old_block in function_sql) = 0 then
    raise exception 'Could not locate the final return block in record_lpg_cylinder_scan';
  end if;
  execute replace(function_sql, old_block, new_block);
end;
$automatic_lpg_scan_advancement$;

do $automatic_lpg_internal_return$
declare
  function_sql text;
  old_block text;
  new_block text;
begin
  function_sql := pg_get_functiondef(
    'public.confirm_lpg_internal_refill(uuid,numeric,text,numeric,text,text,text,numeric,numeric,uuid,jsonb,uuid[],text,jsonb,text)'::regprocedure
  );

  old_block := '  return procurement_id;';
  new_block := E'  -- Refill confirmation is the authoritative completion signal for
  -- SKIMA Managed procurement. Begin the return leg in the same transaction;
  -- the driver should not have to press "Start return delivery".
  perform public.process_lpg_order_action(
    order_record.id,
    ''lpg.return.start'',
    target_idempotency_key || '':auto-return-start'',
    jsonb_build_object(
      ''automatic_transition'', true,
      ''trigger_procurement_id'', procurement_id,
      ''trigger_event'', ''lpg.internal.refill.confirmed''
    ),
    ''lpg.internal.refill.auto_advance''
  );

  return procurement_id;';
  if position(old_block in function_sql) = 0 then
    raise exception 'Could not locate the final return block in confirm_lpg_internal_refill';
  end if;
  execute replace(function_sql, old_block, new_block);
end;
$automatic_lpg_internal_return$;

do $enforce_current_lpg_route_policy$
declare
  function_sql text;
  old_block text;
  new_block text;
begin
  function_sql := pg_get_functiondef(
    'public.create_lpg_refill_order(uuid,text,jsonb,text)'::regprocedure
  );

  old_block := E'  update public.lpg_refill_quotes\n  set status = ''accepted'',\n      updated_at = timezone(''utc'', now())\n  where id = quote_record.id;';
  new_block := E'  -- Revalidate against the live Admin availability + priority policy
  -- immediately before consuming the quote. A quote made before an Admin
  -- switch must not create an order on a route that is now disabled or has
  -- fallen outside the configured priority/fallback rules.
  if not exists (
    select 1
    from public.read_lpg_eligible_stations(
      quote_record.pickup_location_id,
      quote_record.delivery_location_id,
      quote_record.cylinder_id,
      quote_record.requested_kg,
      50,
      timezone(''utc'', now())
    ) eligible
    where eligible.station_branch_id = quote_record.station_branch_id
  ) then
    raise exception using
      errcode = ''55000'',
      message = ''This fulfillment option is no longer available under the current Admin routing settings. Refresh the quote and select an available option.'';
  end if;

  update public.lpg_refill_quotes
  set status = ''accepted'',
      updated_at = timezone(''utc'', now())
  where id = quote_record.id;';
  if position(old_block in function_sql) = 0 then
    raise exception 'Could not locate the quote acceptance block in create_lpg_refill_order';
  end if;
  execute replace(function_sql, old_block, new_block);
end;
$enforce_current_lpg_route_policy$;

notify pgrst, 'reload schema';
commit;
