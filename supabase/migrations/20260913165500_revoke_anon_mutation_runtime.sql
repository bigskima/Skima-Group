begin;

-- PostgreSQL functions are executable by PUBLIC unless explicitly revoked.
-- These routines mutate authenticated, operational, administrative, financial,
-- or worker-owned state and have no legitimate anonymous invocation path.
-- Keep authenticated/service-role compatibility while removing anon/PUBLIC
-- execution. Pre-auth OTP initiation is intentionally not included here.
do $$
declare
  routine record;
  target_names text[] := array[
    'accept_lpg_driver_assignment',
    'accept_price_quote',
    'assign_application_reviewer',
    'assign_lpg_station_role',
    'assign_service_request_participant',
    'configure_lpg_cylinder_type_profile',
    'configure_lpg_operation_policy',
    'configure_lpg_refill_pricing',
    'configure_lpg_station_catalog_price',
    'configure_lpg_station_price',
    'configure_platform_organization',
    'configure_product_content_placement',
    'configure_product_content_publication',
    'configure_reference_namespace',
    'configure_utility_cashback',
    'configure_utility_catalog_item',
    'create_application_record',
    'create_escrow_hold',
    'create_lpg_customer_location',
    'create_lpg_refill_order',
    'create_lpg_refill_quote',
    'create_lpg_refill_quote_from_commercial_snapshot',
    'create_lpg_refill_quote_from_purchase_input',
    'create_lpg_safety_incident',
    'create_module_service_request',
    'create_support_thread',
    'create_utility_payment_request',
    'decide_vehicle_lifecycle',
    'enqueue_background_job',
    'process_lpg_order_action',
    'process_lpg_order_lifecycle',
    'process_service_request_event',
    'record_compliance_evidence',
    'record_health_check',
    'record_lpg_cylinder_history',
    'record_lpg_cylinder_inspection',
    'record_lpg_cylinder_scan',
    'record_lpg_driver_location',
    'record_lpg_order_event',
    'record_webhook_delivery_attempt',
    'register_customer_lpg_cylinder',
    'register_lpg_cylinder',
    'register_media_asset',
    'release_escrow_hold',
    'request_lpg_delivery_challenge',
    'set_background_job_status',
    'set_cache_entry',
    'set_product_content_publication_status',
    'set_profile_status',
    'set_vehicle_party_relationship',
    'submit_application',
    'submit_fleet_application',
    'update_application_payload',
    'update_escrow_hold_status',
    'update_lpg_station_settings',
    'withdraw_application'
  ];
begin
  for routine in
    select p.oid::regprocedure as identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname = any(target_names)
  loop
    execute format('revoke execute on function %s from public', routine.identity);
    execute format('revoke execute on function %s from anon', routine.identity);
    execute format('grant execute on function %s to authenticated, service_role', routine.identity);
  end loop;
end
$$;

commit;
