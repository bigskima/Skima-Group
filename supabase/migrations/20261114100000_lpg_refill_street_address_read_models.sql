begin;

-- Driver queues and single-order reads must carry normalized address evidence.
-- Older LocationIQ records can have the road in addressComponents.name while
-- their dedicated street field is empty; the client can only recover this if
-- the protected read models include the structured components.
do $migration$
declare
  jobs_ddl text;
  jobs_anchor text := $anchor$'metadata',resolved.metadata) as job_payload$anchor$;
  jobs_replacement text := $replacement$
      'pickupLocation',(select jsonb_build_object(
        'id', pickup.id,
        'label', pickup.label,
        'formattedAddress', pickup.formatted_address,
        'metadata', jsonb_build_object(
          'addressComponents', coalesce(
            pickup.metadata->'addressComponents',
            pickup.metadata->'address_components',
            pickup.metadata->'addressSnapshot'->'addressComponents',
            pickup.metadata->'address_snapshot'->'addressComponents',
            pickup.metadata->'addressSnapshot',
            pickup.metadata->'address_snapshot',
            '{}'::jsonb
          )
        )
      ) from public.lpg_customer_locations pickup where pickup.id=resolved.pickup_location_id),
      'deliveryLocation',(select jsonb_build_object(
        'id', delivery.id,
        'label', delivery.label,
        'formattedAddress', delivery.formatted_address,
        'metadata', jsonb_build_object(
          'addressComponents', coalesce(
            delivery.metadata->'addressComponents',
            delivery.metadata->'address_components',
            delivery.metadata->'addressSnapshot'->'addressComponents',
            delivery.metadata->'address_snapshot'->'addressComponents',
            delivery.metadata->'addressSnapshot',
            delivery.metadata->'address_snapshot',
            '{}'::jsonb
          )
        )
      ) from public.lpg_customer_locations delivery where delivery.id=resolved.delivery_location_id),
      'metadata',resolved.metadata) as job_payload
  $replacement$;
  details_ddl text;
  pickup_anchor text := $anchor$'contactEmail', pickup.metadata #>> '{deliveryContact,email}'$anchor$;
  pickup_replacement text := $replacement$'contactEmail', pickup.metadata #>> '{deliveryContact,email}',
      'metadata', jsonb_build_object('addressComponents', coalesce(
        pickup.metadata->'addressComponents', pickup.metadata->'address_components',
        pickup.metadata->'addressSnapshot'->'addressComponents',
        pickup.metadata->'address_snapshot'->'addressComponents',
        pickup.metadata->'addressSnapshot', pickup.metadata->'address_snapshot', '{}'::jsonb
      ))$replacement$;
  delivery_anchor text := $anchor$'contactEmail', delivery.metadata #>> '{deliveryContact,email}'$anchor$;
  delivery_replacement text := $replacement$'contactEmail', delivery.metadata #>> '{deliveryContact,email}',
      'metadata', jsonb_build_object('addressComponents', coalesce(
        delivery.metadata->'addressComponents', delivery.metadata->'address_components',
        delivery.metadata->'addressSnapshot'->'addressComponents',
        delivery.metadata->'address_snapshot'->'addressComponents',
        delivery.metadata->'addressSnapshot', delivery.metadata->'address_snapshot', '{}'::jsonb
      ))$replacement$;
begin
  jobs_ddl := pg_get_functiondef('public.read_lpg_jobs(text,integer)'::regprocedure);
  if position('pickupLocation' in jobs_ddl) = 0 then
    if position(jobs_anchor in jobs_ddl) = 0 then
      raise exception 'Could not find the read_lpg_jobs payload anchor; refusing to patch';
    end if;
    jobs_ddl := replace(jobs_ddl, jobs_anchor, jobs_replacement);
    if position('pickupLocation' in jobs_ddl) = 0 then
      raise exception 'Could not add pickup/delivery addresses to read_lpg_jobs';
    end if;
    execute jobs_ddl;
  end if;

  details_ddl := pg_get_functiondef('public.read_lpg_job_details(uuid)'::regprocedure);
  if position('addressComponents' in details_ddl) = 0 then
    if position(pickup_anchor in details_ddl) = 0 or position(delivery_anchor in details_ddl) = 0 then
      raise exception 'Could not find both LPG job detail address anchors; refusing to patch';
    end if;
    details_ddl := replace(details_ddl, pickup_anchor, pickup_replacement);
    details_ddl := replace(details_ddl, delivery_anchor, delivery_replacement);
    if position('addressComponents' in details_ddl) = 0 then
      raise exception 'Could not add structured address components to read_lpg_job_details';
    end if;
    execute details_ddl;
  end if;
end
$migration$;

notify pgrst, 'reload schema';
commit;
