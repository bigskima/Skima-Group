begin;

do $migration$
declare
  function_ddl text;
  anchor text := $anchor$  -- Scanning at pickup can begin the route when the driver hasn't pressed
  -- Start route. The same transaction then records custody and starts station
  -- transit. Every transition still uses the existing action definitions.
$anchor$;
  insertion text := $insert$  -- A final hand-over scan is recorded once per order/cylinder.
  -- The customer OTP remains the separate action that closes the order.
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
        'cylinderIdentifier', matched_cylinder_identifier,
        'scanType', scan_type,
        'status', final_status,
        'replayed', true,
        'alreadyVerified', true
      );
    end if;
  end if;

$insert$;
begin
  function_ddl := pg_get_functiondef(
    'public.record_lpg_cylinder_scan_for_active_job(text,text,text,numeric,numeric,numeric,text)'::regprocedure
  );

  if position('alreadyVerified' in function_ddl) > 0 then
    return;
  end if;

  if position(anchor in function_ddl) = 0 then
    raise exception 'Could not locate the active-job scan insertion point; refusing to patch';
  end if;

  function_ddl := replace(function_ddl, anchor, insertion || anchor);
  execute function_ddl;
end
$migration$;

notify pgrst, 'reload schema';
commit;
