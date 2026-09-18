begin;

-- The notification runtime predates layered fulfillment. Internal orders reuse
-- lifecycle status keys such as station_en_route/station_verified, but those
-- statuses represent the Managed Driver's supplier leg rather than an assigned
-- marketplace station.

do $migration$
declare
  fn text;
  patched text;
begin
  fn := pg_get_functiondef(
    'public.queue_lpg_order_status_notifications(uuid,text,text)'::regprocedure
  );
  patched := fn;

  patched := replace(
    patched,
    $old$when 'matching_station' then 'Finding a station'$old$,
    $new$when 'matching_station' then case when order_record.fulfillment_channel='skima_internal' then 'Preparing SKIMA fulfillment' else 'Finding a station' end$new$
  );
  patched := replace(
    patched,
    $old$when 'station_en_route' then 'Heading to the station'$old$,
    $new$when 'station_en_route' then case when order_record.fulfillment_channel='skima_internal' then 'Heading to a refill supplier' else 'Heading to the station' end$new$
  );
  patched := replace(
    patched,
    $old$when 'station_verified' then 'Station received your cylinder'$old$,
    $new$when 'station_verified' then case when order_record.fulfillment_channel='skima_internal' then 'Cylinder received for refill' else 'Station received your cylinder' end$new$
  );
  patched := replace(
    patched,
    $old$when 'station_settled' then 'Station processing complete'$old$,
    $new$when 'station_settled' then case when order_record.fulfillment_channel='skima_internal' then 'Refill stage complete' else 'Station processing complete' end$new$
  );

  patched := replace(
    patched,
    $old$when 'matching_station' then 'SKIMA is finding an eligible station for your refill.'$old$,
    $new$when 'matching_station' then case when order_record.fulfillment_channel='skima_internal' then 'SKIMA is preparing the Managed Driver and SKIMA fleet route for your refill.' else 'SKIMA is finding an eligible station for your refill.' end$new$
  );
  patched := replace(
    patched,
    $old$when 'station_en_route' then 'Your cylinder is on the way to the assigned station.'$old$,
    $new$when 'station_en_route' then case when order_record.fulfillment_channel='skima_internal' then 'Your cylinder is moving to the refill supplier selected for this SKIMA-managed trip.' else 'Your cylinder is on the way to the assigned station.' end$new$
  );
  patched := replace(
    patched,
    $old$when 'station_verified' then 'The station confirmed receipt of your cylinder.'$old$,
    $new$when 'station_verified' then case when order_record.fulfillment_channel='skima_internal' then 'The refill supplier hand-off for your SKIMA-managed trip has been confirmed.' else 'The station confirmed receipt of your cylinder.' end$new$
  );
  patched := replace(
    patched,
    $old$when 'refill_in_progress' then 'The station has started your LPG refill.'$old$,
    $new$when 'refill_in_progress' then case when order_record.fulfillment_channel='skima_internal' then 'Your LPG refill is in progress.' else 'The station has started your LPG refill.' end$new$
  );
  patched := replace(
    patched,
    $old$when 'station_settled' then 'The station stage is complete and your order is moving to return delivery.'$old$,
    $new$when 'station_settled' then case when order_record.fulfillment_channel='skima_internal' then 'The refill stage is complete and your order is moving to return delivery.' else 'The station stage is complete and your order is moving to return delivery.' end$new$
  );

  patched := replace(
    patched,
    $old$when 'station_en_route' then 'Proceed to the station'$old$,
    $new$when 'station_en_route' then case when order_record.fulfillment_channel='skima_internal' then 'Source the refill' else 'Proceed to the station' end$new$
  );
  patched := replace(
    patched,
    $old$when 'station_verified' then 'Station handoff confirmed'$old$,
    $new$when 'station_verified' then case when order_record.fulfillment_channel='skima_internal' then 'Supplier handoff confirmed' else 'Station handoff confirmed' end$new$
  );
  patched := replace(
    patched,
    $old$when 'station_en_route' then 'Continue to the assigned station.'$old$,
    $new$when 'station_en_route' then case when order_record.fulfillment_channel='skima_internal' then 'Continue the supplier refill workflow in your SKIMA job.' else 'Continue to the assigned station.' end$new$
  );
  patched := replace(
    patched,
    $old$when 'station_verified' then 'The station confirmed the cylinder handoff.'$old$,
    $new$when 'station_verified' then case when order_record.fulfillment_channel='skima_internal' then 'The supplier handoff has been confirmed.' else 'The station confirmed the cylinder handoff.' end$new$
  );
  patched := replace(
    patched,
    $old$when 'station_settled' then 'The station stage is complete. Continue the return workflow.'$old$,
    $new$when 'station_settled' then case when order_record.fulfillment_channel='skima_internal' then 'The refill stage is complete. Continue the return workflow.' else 'The station stage is complete. Continue the return workflow.' end$new$
  );

  if patched = fn then
    raise exception 'could not align LPG order notifications with layered fulfillment';
  end if;

  execute patched;
end
$migration$;

commit;
