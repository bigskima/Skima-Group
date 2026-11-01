begin;

-- Customer hand-over is deliberately two-factor:
-- 1) the assigned driver records the physical cylinder scan while it is at
--    the customer address;
-- 2) the customer verifies the order-specific OTP.
-- Only the customer OTP completes the order and releases the existing
-- delivery-completion event/payout bridge.

do $scan_patch$
declare
  function_ddl text;
  old_guard constant text := E'    if delivery_challenge_id is null\n      or not public.lpg_delivery_challenge_is_verified(order_record.id, delivery_challenge_id) then\n      raise exception ''verified LPG delivery challenge is required'';\n    end if;';
  new_guard constant text := E'    -- The assigned driver records the physical cylinder hand-over first.\n    -- Customer OTP verification is a separate final confirmation below.';
  old_status constant text := E'    new_status := ''delivered'';\n    history_event := ''delivery_verified'';';
  new_status constant text := E'    new_status := order_record.status;\n    history_event := ''verified'';';
  old_tracking constant text := E'  if target_scan_type = ''customer_delivery''\n    and order_record.tracking_session_id is not null then';
  new_tracking constant text := E'  if target_scan_type = ''customer_delivery''\n    and new_status = ''delivered''\n    and order_record.tracking_session_id is not null then';
begin
  function_ddl:=pg_get_functiondef(
    'public.record_lpg_cylinder_scan(uuid,text,text,numeric,numeric,numeric,jsonb,text)'::regprocedure
  );

  if position('history_event := ''verified''' in function_ddl)>0
     and position('verified LPG delivery challenge is required' in function_ddl)=0 then
    return;
  end if;

  if (length(function_ddl)-length(replace(function_ddl,old_guard,'')))/length(old_guard) <> 1 then
    raise exception 'Expected exactly one final delivery OTP guard in record_lpg_cylinder_scan';
  end if;
  if (length(function_ddl)-length(replace(function_ddl,old_status,'')))/length(old_status) <> 1 then
    raise exception 'Expected exactly one final delivery status block in record_lpg_cylinder_scan';
  end if;
  if (length(function_ddl)-length(replace(function_ddl,old_tracking,'')))/length(old_tracking) <> 1 then
    raise exception 'Expected exactly one final delivery tracking completion block';
  end if;

  function_ddl:=replace(function_ddl,old_guard,new_guard);
  function_ddl:=replace(function_ddl,old_status,new_status);
  function_ddl:=replace(function_ddl,old_tracking,new_tracking);
  execute function_ddl;
end
$scan_patch$;

do $request_patch$
declare
  function_ddl text;
  anchor constant text := E'  challenge_id := public.request_otp_challenge(';
  guard constant text := E'  if not exists (\n    select 1\n    from public.lpg_cylinder_scans handover_scan\n    where handover_scan.lpg_order_id=order_record.id\n      and handover_scan.cylinder_id=order_record.cylinder_id\n      and handover_scan.scan_type=''customer_delivery''\n      and handover_scan.result=''passed''\n  ) then\n    raise exception ''final cylinder hand-over scan must be recorded before requesting customer OTP'';\n  end if;\n\n';
begin
  function_ddl:=pg_get_functiondef(
    'public.request_lpg_delivery_challenge(uuid,text,text,text,jsonb,text)'::regprocedure
  );

  if position('final cylinder hand-over scan must be recorded before requesting customer OTP' in function_ddl)>0 then
    return;
  end if;
  if (length(function_ddl)-length(replace(function_ddl,anchor,'')))/length(anchor) <> 1 then
    raise exception 'Could not locate delivery challenge creation in request_lpg_delivery_challenge';
  end if;

  function_ddl:=replace(function_ddl,anchor,guard||anchor);
  execute function_ddl;
end
$request_patch$;

do $verify_patch$
declare
  function_ddl text;
  verify_anchor constant text := E'  verified_challenge_id := public.verify_otp_challenge(';
  guard constant text := E'  if not exists (\n    select 1\n    from public.lpg_cylinder_scans handover_scan\n    where handover_scan.lpg_order_id=order_record.id\n      and handover_scan.cylinder_id=order_record.cylinder_id\n      and handover_scan.scan_type=''customer_delivery''\n      and handover_scan.result=''passed''\n  ) then\n    raise exception ''final cylinder hand-over scan must be recorded before customer OTP verification'';\n  end if;\n\n';
  update_block constant text := E'  if order_record.status = ''delivery_verification_pending'' then\n    update public.lpg_refill_orders\n    set status = ''delivered'',\n        updated_at = timezone(''utc'', now())\n    where id = order_record.id\n      and status = ''delivery_verification_pending'';\n\n    if not found then\n      raise exception ''LPG order changed while completing the customer hand-over; refresh and retry'';\n    end if;\n  end if;';
  completion_block constant text := E'\n\n  -- Finalise the wider LPG order only after both the physical hand-over scan\n  -- and the customer OTP have been verified.\n  update public.service_requests\n  set status=''completed'',updated_at=timezone(''utc'',now())\n  where id=order_record.service_request_id;\n\n  if order_record.order_record_id is not null then\n    update public.order_records\n    set status=''fulfilled'',fulfilled_at=coalesce(fulfilled_at,timezone(''utc'',now())),updated_at=timezone(''utc'',now())\n    where id=order_record.order_record_id;\n  end if;\n\n  if order_record.tracking_session_id is not null then\n    update public.tracking_sessions\n    set status=''completed'',ended_at=coalesce(ended_at,timezone(''utc'',now())),updated_at=timezone(''utc'',now())\n    where id=order_record.tracking_session_id and status<>''completed'';\n\n    insert into public.tracking_session_events(tracking_session_id,status,idempotency_key,metadata)\n    values(order_record.tracking_session_id,''completed'',target_idempotency_key||'':tracking-completed'',jsonb_build_object(''lpg_order_id'',order_record.id))\n    on conflict do nothing;\n  end if;\n\n  if order_record.fulfillment_mode=''station_managed'' then\n    update public.lpg_station_managed_driver_assignments\n    set status=''delivered'',completed_at=timezone(''utc'',now())\n    where lpg_order_id=order_record.id and status in (''assigned'',''accepted'',''en_route'');\n  end if;';
begin
  function_ddl:=pg_get_functiondef(
    'public.verify_lpg_delivery_challenge(uuid,uuid,text,text,jsonb)'::regprocedure
  );

  if position('final cylinder hand-over scan must be recorded before customer OTP verification' in function_ddl)>0
     and position('Finalise the wider LPG order only after both' in function_ddl)>0 then
    return;
  end if;

  if (length(function_ddl)-length(replace(function_ddl,verify_anchor,'')))/length(verify_anchor) <> 1 then
    raise exception 'Could not locate OTP verification call in verify_lpg_delivery_challenge';
  end if;
  if (length(function_ddl)-length(replace(function_ddl,update_block,'')))/length(update_block) <> 1 then
    raise exception 'Could not locate the delivered status update block in verify_lpg_delivery_challenge';
  end if;

  function_ddl:=replace(function_ddl,verify_anchor,guard||verify_anchor);
  function_ddl:=replace(function_ddl,update_block,update_block||completion_block);
  execute function_ddl;
end
$verify_patch$;

notify pgrst,'reload schema';
commit;