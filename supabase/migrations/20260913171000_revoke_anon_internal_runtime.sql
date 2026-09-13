begin;

-- Second pass over SECURITY DEFINER exposure. These routines either mutate
-- authenticated/platform state, execute financial/worker flows, or are internal
-- permission/eligibility helpers. None has a legitimate anonymous invocation
-- path. Preserve authenticated/service-role compatibility because the shared API
-- gateway and existing app runtimes intentionally call some of them directly.
--
-- Public bootstrap/catalog reads and pre-auth OTP functions are intentionally
-- excluded from this migration and require separate product-policy review.
do $$
declare
  routine record;
  target_names text[] := array[
    'advance_application_record_state',
    'application_document_requirement_satisfied',
    'application_verification_has_passed',
    'application_verification_mapping_applies',
    'assert_financial_policy_no_conflict',
    'attach_lpg_cylinder_media',
    'calculate_deposit_fee_from_policy',
    'calculate_lpg_commercial_quote',
    'calculate_price_quote',
    'calculate_withdrawal_fee_from_policy',
    'can_access_lpg_order',
    'can_access_wallet_account',
    'can_execute_financial_runtime',
    'can_execute_platform_runtime',
    'can_manage_applications',
    'can_manage_lpg_operations',
    'can_manage_platform_admin_roles',
    'can_operate_lpg_station_branch',
    'can_read_application_record',
    'can_read_document_submission',
    'can_read_lpg_station_branch',
    'can_read_platform_runtime',
    'can_review_applications',
    'classify_lpg_platform_settlement_revenue',
    'confirm_lpg_refill',
    'enforce_expired_compliance',
    'ensure_driver_card_identity',
    'ensure_lpg_order_record',
    'ensure_platform_purpose_wallet',
    'evaluate_driver_vehicle_eligibility',
    'execute_driver_commission',
    'execute_driver_commission_from_order',
    'execute_lpg_driver_commission',
    'execute_order_business_settlement',
    'execute_order_business_settlement_from_snapshot',
    'execute_service_request_settlement',
    'expire_escrow_holds',
    'financial_transaction_touches_revenue',
    'fleet_application_compliance',
    'fund_order_from_wallet',
    'generate_public_reference',
    'initialize_wallet_deposit',
    'is_fleet_staff',
    'is_organization_creator',
    'is_organization_member',
    'is_platform_revenue_wallet',
    'is_platform_super_admin',
    'is_wallet_owner',
    'link_fleet_application_document',
    'lpg_delivery_challenge_is_verified',
    'queue_communication_message',
    'queue_lpg_order_status_notifications',
    'queue_webhook_deliveries',
    'reconcile_lpg_order_financials',
    'reconcile_service_request_financials',
    'refund_escrow_hold',
    'refund_lpg_order_payment',
    'reply_to_my_support_thread',
    'resubmit_fleet_application',
    'return_escrow_hold_amount',
    'review_document_submission',
    'review_fleet_application',
    'settle_lpg_station_order',
    'start_service_request_workflow',
    'sync_communication_message_statuses',
    'sync_public_payout_directory',
    'user_can_operate_lpg_station_branch',
    'user_has_permission_for_branch',
    'verify_lpg_delivery_challenge',
    'verify_wallet_deposit'
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
