begin;

-- Give driver, Station Managed driver, and customer read models one canonical
-- flag so clients can stop asking for the return-cylinder scan after it passes.
do $migration$
declare
  jobs_ddl text;
  jobs_anchor text := $anchor$'cylinderIdentifier',cylinder.cylinder_identifier,$anchor$;
  jobs_replacement text := $replacement$'cylinderIdentifier',cylinder.cylinder_identifier,
      'customerDeliveryScanVerified',exists(
        select 1
        from public.lpg_cylinder_scans return_scan
        where return_scan.lpg_order_id=resolved.id
          and return_scan.cylinder_id=resolved.cylinder_id
          and return_scan.scan_type='customer_delivery'
          and return_scan.result='passed'
      ),$replacement$;
  station_ddl text;
  station_anchor text := $station_anchor$'orderStatus',order_record.status,$station_anchor$;
  station_replacement text := $station_replacement$'orderStatus',order_record.status,
      'customerDeliveryScanVerified',exists(
        select 1
        from public.lpg_cylinder_scans return_scan
        where return_scan.lpg_order_id=order_record.id
          and return_scan.cylinder_id=order_record.cylinder_id
          and return_scan.scan_type='customer_delivery'
          and return_scan.result='passed'
      ),$station_replacement$;
begin
  jobs_ddl := pg_get_functiondef('public.read_lpg_jobs(text,integer)'::regprocedure);
  if position('customerDeliveryScanVerified' in jobs_ddl)=0 then
    if position(jobs_anchor in jobs_ddl)=0 then
      raise exception 'Could not find the cylinder identifier in read_lpg_jobs; refusing to patch';
    end if;
    jobs_ddl := replace(jobs_ddl,jobs_anchor,jobs_replacement);
    execute jobs_ddl;
  end if;

  station_ddl := pg_get_functiondef('public.read_lpg_station_managed_driver_jobs(integer)'::regprocedure);
  if position('customerDeliveryScanVerified' in station_ddl)=0 then
    if position(station_anchor in station_ddl)=0 then
      raise exception 'Could not find the order status in read_lpg_station_managed_driver_jobs; refusing to patch';
    end if;
    station_ddl := replace(station_ddl,station_anchor,station_replacement);
    execute station_ddl;
  end if;
end
$migration$;

notify pgrst, 'reload schema';
commit;
