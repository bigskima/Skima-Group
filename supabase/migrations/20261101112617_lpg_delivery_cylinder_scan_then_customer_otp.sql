begin;

-- Final hand-over has two independent confirmations:
-- the assigned driver records physical custody of the returned cylinder;
-- the customer then verifies the order-specific OTP to close the order.
do $migration$
declare
  function_ddl text;
  old_guard text := $old$    if delivery_challenge_id is null
      or not public.lpg_delivery_challenge_is_verified(order_record.id, delivery_challenge_id) then
      raise exception 'verified LPG delivery challenge is required';
    end if;
$old$;
  new_guard text := $new$    -- The driver records physical cylinder hand-over first.
    -- Customer OTP verification is the separate final confirmation.
$new$;
  old_status text := $old_status$    new_status := 'delivered';
    history_event := 'delivery_verified';
$old_status$;
  new_status text := $new_status$    new_status := order_record.status;
    history_event := 'delivery_handover_scan';
$new_status$;
  old_tracking text := $old_tracking$  if target_scan_type = 'customer_delivery'
    and order_record.tracking_session_id is not null then
$old_tracking$;
  new_tracking text := $new_tracking$  if target_scan_type = 'customer_delivery'
    and new_status = 'delivered'
    and order_record.tracking_session_id is not null then
$new_tracking$;
begin
  function_ddl := pg_get_functiondef(
    'public.record_lpg_cylinder_scan(uuid,text,text,numeric,numeric,numeric,jsonb,text)'::regprocedure
  );

  if position('verified LPG delivery challenge is required' in function_ddl) = 0
     and position('new_status := order_record.status;' in function_ddl) > 0 then
    return;
  end if;

  if position(old_guard in function_ddl) = 0
     or position(old_status in function_ddl) = 0
     or position(old_tracking in function_ddl) = 0 then
    raise exception 'Expected original customer-delivery scan rules were not found; refusing to change unrelated lifecycle code';
  end if;

  function_ddl := replace(function_ddl, old_guard, new_guard);
  function_ddl := replace(function_ddl, old_status, new_status);
  function_ddl := replace(function_ddl, old_tracking, new_tracking);
  execute function_ddl;
end
$migration$;

notify pgrst, 'reload schema';
commit;
