begin;

-- Station-managed drivers use the same verified LPG order lifecycle, but their
-- identity is the station assignment, not a public independent-driver profile.
-- Allow only the currently assigned station driver to advance their own pickup,
-- station receipt and return stages.

-- process_lpg_order_action already permits assigned Station Managed drivers via
-- the branch-scoped identity guard installed in the foundational migration.

do $station_managed_scans$
declare
  function_sql text;
  old_block text;
  new_block text;
begin
  function_sql := pg_get_functiondef('public.record_lpg_cylinder_scan(uuid,text,text,numeric,numeric,numeric,jsonb,text)'::regprocedure);

  -- Earlier Station Managed work deliberately disabled independent-driver scans
  -- for this mode. Remove that prohibition and authorize pickup scans by the
  -- station-scoped assignment below, without adding a driver_profiles identity.
  old_block :=
    '  if order_record.fulfillment_mode=''station_managed'' and target_scan_type in (''customer_pickup'',''station_receipt'') then'||E'\n'||
    '    raise exception using errcode=''55000'',message=''Station Managed orders use station-owned refill and customer hand-over scans, not SKIMA driver pickup or station-receipt scans'';'||E'\n'||
    '  end if;';
  new_block :=
    '  -- Station Managed pickup and receipt scans require the order''s active station-driver assignment.';
  if position(old_block in function_sql)=0 then
    raise exception 'Could not locate legacy Station Managed pickup/receipt scan prohibition';
  end if;
  function_sql := replace(function_sql,old_block,new_block);

  old_block :=
    '  elsif target_scan_type = ''station_receipt'' then'||E'\n'||
    '    if order_record.status not in (''pickup_verified'', ''station_en_route'') then'||E'\n'||
    '      raise exception ''station receipt scan is not valid for the current order status'';'||E'\n'||
    '    end if;'||E'\n'||
    '    if not public.can_operate_lpg_station_branch(order_record.station_branch_id, ''lpg.stations.scan'') then'||E'\n'||
    '      raise exception ''branch-scoped LPG scanner permission is required'';'||E'\n'||
    '    end if;'||E'\n'||
    '    new_status := ''station_verified'';';
  new_block :=
    '  elsif target_scan_type = ''station_receipt'' then'||E'\n'||
    '    if order_record.status not in (''pickup_verified'', ''station_en_route'') then'||E'\n'||
    '      raise exception ''station receipt scan is not valid for the current order status'';'||E'\n'||
    '    end if;'||E'\n'||
    '    if not public.can_operate_lpg_station_branch(order_record.station_branch_id, ''lpg.stations.scan'')'||E'\n'||
    '      and not public.is_lpg_station_managed_order_driver(order_record.id,auth.uid()) then'||E'\n'||
    '      raise exception ''branch-scoped LPG scanner permission or assigned station driver is required'';'||E'\n'||
    '    end if;'||E'\n'||
    '    new_status := ''station_verified'';';
  if position(old_block in function_sql)=0 then
    raise exception 'Could not locate station receipt scanner access guard';
  end if;
  function_sql := replace(function_sql,old_block,new_block);

  -- Keep the assignment state aligned with the completed order after the
  -- canonical cylinder scan has verified the final customer hand-over.
  declare
    return_idx integer;
    handover_patch text;
  begin
    return_idx := length(function_sql)
      - position(reverse('return scan_id') in reverse(lower(function_sql)))
      - length('return scan_id') + 2;
    if return_idx < 1 then
      raise exception 'Could not locate final scan return in cylinder verification function';
    end if;
    handover_patch :=
      '  if target_scan_type = ''customer_delivery'' and new_status = ''delivered'''||E'\n'||
      '    and order_record.fulfillment_mode = ''station_managed'' then'||E'\n'||
      '    update public.lpg_station_managed_driver_assignments assignment'||E'\n'||
      '    set status = ''delivered'', completed_at = timezone(''utc'', now())'||E'\n'||
      '    from public.lpg_station_managed_drivers station_driver'||E'\n'||
      '    where assignment.lpg_order_id = order_record.id'||E'\n'||
      '      and assignment.station_driver_id = station_driver.id'||E'\n'||
      '      and station_driver.user_id = auth.uid()'||E'\n'||
      '      and station_driver.status = ''active'''||E'\n'||
      '      and assignment.status in (''accepted'', ''en_route'');'||E'\n'||
      '  end if;'||E'\n'||E'\n';
    function_sql := substring(function_sql from 1 for return_idx - 1)
      || handover_patch
      || substring(function_sql from return_idx);
  end;
end
$station_managed_scans$;

-- The station performs its normal release scan first (which moves the LPG order
-- to return_en_route). Starting the driver's return leg must accept that already
-- advanced state, and must not try to run lpg.return.start a second time.
do $station_managed_return_status$
declare
  function_sql text;
  old_block text;
  new_block text;
begin
  function_sql := pg_get_functiondef('public.update_lpg_station_managed_driver_assignment_status(uuid,text,text,jsonb)'::regprocedure);

  old_block :=
    '  if target_status=''en_route'' and order_status_before<>''station_settled'' then'||E'\n'||
    '    raise exception using errcode=''55000'',message=''the station must complete refill settlement before delivery can start'';'||E'\n'||
    '  end if;';
  new_block :=
    '  if target_status=''en_route'' and order_status_before not in (''station_settled'',''return_en_route'') then'||E'\n'||
    '    raise exception using errcode=''55000'',message=''the station must complete refill and release the cylinder before delivery can start'';'||E'\n'||
    '  end if;';
  if position(old_block in function_sql)=0 then
    raise exception 'Could not locate Station Managed return-stage state guard';
  end if;
  function_sql := replace(function_sql,old_block,new_block);

  old_block :=
    '  else'||E'\n'||
    '    perform public.process_lpg_order_action('||E'\n'||
    '      assignment_record.lpg_order_id,''lpg.return.start'',target_idempotency_key||'':order-action'','||E'\n'||
    '      target_metadata||jsonb_build_object(''station_driver_id'',driver_record.id,''assignment_id'',assignment_record.id),'||E'\n'||
    '      ''lpg.station_managed_driver.mobile'''||E'\n'||
    '    );'||E'\n'||
    '  end if;';
  new_block :=
    '  elsif order_status_before=''station_settled'' then'||E'\n'||
    '    perform public.process_lpg_order_action('||E'\n'||
    '      assignment_record.lpg_order_id,''lpg.return.start'',target_idempotency_key||'':order-action'','||E'\n'||
    '      target_metadata||jsonb_build_object(''station_driver_id'',driver_record.id,''assignment_id'',assignment_record.id),'||E'\n'||
    '      ''lpg.station_managed_driver.mobile'''||E'\n'||
    '    );'||E'\n'||
    '  elsif order_status_before<>''return_en_route'' then'||E'\n'||
    '    raise exception using errcode=''55000'',message=''the order is not ready for the station driver'';'||E'\n'||
    '  end if;';
  if position(old_block in function_sql)=0 then
    raise exception 'Could not locate Station Managed return action block';
  end if;
  execute replace(function_sql,old_block,new_block);
end
$station_managed_return_status$;

notify pgrst, 'reload schema';
commit;
