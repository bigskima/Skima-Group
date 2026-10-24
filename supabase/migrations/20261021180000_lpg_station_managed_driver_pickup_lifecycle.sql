begin;

-- Station-managed drivers use the canonical LPG lifecycle with station-owned
-- identity. The driver must have the active station assignment for this order;
-- no independent driver_profiles row is needed.

do $station_managed_scans$
declare
  function_sql text;
  old_block text;
  new_block text;
  handover_patch text;
  final_return text := E'\n  return scan_id;\nend;\n$function$';
begin
  function_sql := pg_get_functiondef('public.record_lpg_cylinder_scan(uuid,text,text,numeric,numeric,numeric,jsonb,text)'::regprocedure);

  -- Remove the legacy blanket denial. The function's following authorization
  -- guards already check is_lpg_station_managed_order_driver(order_id, auth.uid()).
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

  -- Close a station driver's assignment only after the verified customer
  -- delivery scan has actually advanced the order to delivered.
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
  if position(final_return in function_sql)=0 then
    raise exception 'Could not locate final scan return in cylinder verification function';
  end if;
  function_sql := replace(function_sql,final_return,E'\n'||handover_patch||'  return scan_id;'||E'\nend;'||E'\n$function$');
  execute function_sql;
end
$station_managed_scans$;

-- A station release scan can already set an order to return_en_route. Starting
-- return delivery must accept that state without issuing lpg.return.start twice.
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
