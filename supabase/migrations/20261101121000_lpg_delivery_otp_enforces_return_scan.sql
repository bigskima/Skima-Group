begin;

-- Enforce the physical returned-cylinder scan at both server-side OTP entry
-- points. UI gating is for clarity only; these guards are the security boundary.
do $migration$
declare
  request_ddl text;
  verify_ddl text;
  request_anchor text := $request_anchor$  challenge_id := public.request_otp_challenge($request_anchor$;
  verify_anchor text := $verify_anchor$  verified_challenge_id := public.verify_otp_challenge($verify_anchor$;
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
begin
  request_ddl := pg_get_functiondef(
    'public.request_lpg_delivery_challenge(uuid,text,text,text,jsonb,text)'::regprocedure
  );
  if position('final cylinder hand-over scan must be recorded before requesting customer OTP' in request_ddl)=0 then
    if position(request_anchor in request_ddl)=0 then
      raise exception 'Could not locate the delivery challenge request call; refusing to add an incomplete OTP guard';
    end if;
    request_ddl := replace(request_ddl,request_anchor,request_guard||request_anchor);
    execute request_ddl;
  end if;

  verify_ddl := pg_get_functiondef(
    'public.verify_lpg_delivery_challenge(uuid,uuid,text,text,jsonb)'::regprocedure
  );
  if position('final cylinder hand-over scan must be recorded before customer OTP verification' in verify_ddl)=0 then
    if position(verify_anchor in verify_ddl)=0 then
      raise exception 'Could not locate the delivery OTP verification call; refusing to add an incomplete OTP guard';
    end if;
    verify_ddl := replace(verify_ddl,verify_anchor,verify_guard||verify_anchor);
    execute verify_ddl;
  end if;
end
$migration$;

notify pgrst, 'reload schema';
commit;
