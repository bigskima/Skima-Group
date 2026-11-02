begin;

-- LPG final delivery is a single customer-authorized event:
-- the assigned driver completes the pickup identity scan once;
-- the customer confirms physical receipt with the order-specific OTP.
-- Station receipt/release scans and the SKIMA Managed supplier/refill record
-- remain in place as their own custody and financial controls.

do $migration$
declare
  request_ddl text;
  verify_ddl text;
  request_guard text := $request_guard$  if not exists (
    select 1
    from public.lpg_cylinder_scans handover_scan
    where handover_scan.lpg_order_id=order_record.id
      and handover_scan.cylinder_id=order_record.cylinder_id
      and handover_scan.scan_type='customer_delivery'
      and handover_scan.result='passed'
  ) then
    raise exception 'final cylinder hand-over scan must be recorded before requesting customer OTP';
  end if;

$request_guard$;
  verify_guard text := $verify_guard$  if not exists (
    select 1
    from public.lpg_cylinder_scans handover_scan
    where handover_scan.lpg_order_id=order_record.id
      and handover_scan.cylinder_id=order_record.cylinder_id
      and handover_scan.scan_type='customer_delivery'
      and handover_scan.result='passed'
  ) then
    raise exception 'final cylinder hand-over scan must be recorded before customer OTP verification';
  end if;

$verify_guard$;
  old_completion_comment text := $old_comment$  -- Finalise the wider LPG order only after both the physical hand-over scan
  -- and the customer OTP have been verified.
$old_comment$;
  new_completion_comment text := $new_comment$  -- Finalise the wider LPG order after the customer's verified OTP.
  -- Pickup, station receipt/release and supplier/refill evidence are recorded
  -- independently during the route; no second driver scan is required here.
$new_comment$;
begin
  request_ddl := pg_get_functiondef(
    'public.request_lpg_delivery_challenge(uuid,text,text,text,jsonb,text)'::regprocedure
  );
  if position('final cylinder hand-over scan must be recorded before requesting customer OTP' in request_ddl)>0 then
    if position(request_guard in request_ddl)=0 then
      raise exception 'The LPG customer OTP request guard changed; refusing an unsafe hand-over simplification';
    end if;
    request_ddl := replace(request_ddl,request_guard,'');
    execute request_ddl;
  end if;

  verify_ddl := pg_get_functiondef(
    'public.verify_lpg_delivery_challenge(uuid,uuid,text,text,jsonb)'::regprocedure
  );
  if position('final cylinder hand-over scan must be recorded before customer OTP verification' in verify_ddl)>0 then
    if position(verify_guard in verify_ddl)=0 then
      raise exception 'The LPG customer OTP verification guard changed; refusing an unsafe hand-over simplification';
    end if;
    verify_ddl := replace(verify_ddl,verify_guard,'');
  end if;
  if position(old_completion_comment in verify_ddl)>0 then
    verify_ddl := replace(verify_ddl,old_completion_comment,new_completion_comment);
  end if;
  execute verify_ddl;
end
$migration$;

-- SKIMA Managed drivers now record supplier/refill evidence directly from the
-- job after customer pickup. The supplier name, actual quantity/price,
-- safety inspection and optional receipt are the evidence; a second QR scan
-- at the supplier is not needed to enable the refill confirmation.
do $migration$
declare
  function_ddl text;
  old_status_guard text := $old_guard$  if order_record.status not in ('station_verified','refill_in_progress') then
    raise exception using errcode='55000',message='internal refill cannot be confirmed from the current order status';
  end if;
$old_guard$;
  new_status_guard text := $new_guard$  if order_record.status not in ('station_en_route','station_verified','refill_in_progress') then
    raise exception using errcode='55000',message='internal refill cannot be confirmed from the current order status';
  end if;
$new_guard$;
begin
  function_ddl := pg_get_functiondef(
    'public.confirm_lpg_internal_refill(uuid,numeric,text,numeric,text,text,text,numeric,numeric,uuid,jsonb,uuid[],text,jsonb,text)'::regprocedure
  );
  if position('order_record.status not in (''station_en_route'',''station_verified'',''refill_in_progress'')' in function_ddl)=0 then
    if position(old_status_guard in function_ddl)=0 then
      raise exception 'The SKIMA Managed refill stage guard changed; refusing to bypass an unrelated lifecycle check';
    end if;
    function_ddl := replace(function_ddl,old_status_guard,new_status_guard);
    execute function_ddl;
  end if;
end
$migration$;

notify pgrst, 'reload schema';
commit;
