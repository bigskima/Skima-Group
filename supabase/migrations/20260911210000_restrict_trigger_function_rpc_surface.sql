-- Phase 19: remove client RPC EXECUTE from SECURITY DEFINER functions that are
-- verified live trigger functions. PostgreSQL invokes these through their bound
-- triggers; they are not application RPC entry points.
--
-- PUBLIC/anon/authenticated access is removed explicitly because some functions
-- inherited EXECUTE through PUBLIC. service_role is retained for internal tooling.

REVOKE EXECUTE ON FUNCTION public.apply_configured_application_capabilities() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_configured_application_capabilities() TO service_role;

REVOKE EXECUTE ON FUNCTION public.assign_public_reference_after_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_public_reference_after_insert() TO service_role;

REVOKE EXECUTE ON FUNCTION public.auto_accept_dispatched_lpg_driver() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_dispatched_lpg_driver() TO service_role;

REVOKE EXECUTE ON FUNCTION public.auto_grant_permission_to_super_admin_roles() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_grant_permission_to_super_admin_roles() TO service_role;

REVOKE EXECUTE ON FUNCTION public.auto_release_lpg_driver_payout_after_delivery() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_release_lpg_driver_payout_after_delivery() TO service_role;

REVOKE EXECUTE ON FUNCTION public.auto_settle_lpg_station_after_refill() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_settle_lpg_station_after_refill() TO service_role;

REVOKE EXECUTE ON FUNCTION public.classify_lpg_revenue_after_station_settlement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classify_lpg_revenue_after_station_settlement() TO service_role;

REVOKE EXECUTE ON FUNCTION public.copy_lpg_quote_policy_snapshot_to_order() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.copy_lpg_quote_policy_snapshot_to_order() TO service_role;

REVOKE EXECUTE ON FUNCTION public.emit_vehicle_assignment_event() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_vehicle_assignment_event() TO service_role;

REVOKE EXECUTE ON FUNCTION public.enforce_lpg_safe_inspection_before_refill() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_lpg_safe_inspection_before_refill() TO service_role;

REVOKE EXECUTE ON FUNCTION public.enqueue_webhook_deliveries_on_event_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_webhook_deliveries_on_event_insert() TO service_role;

REVOKE EXECUTE ON FUNCTION public.guard_dispatch_driver_vehicle_pair() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_dispatch_driver_vehicle_pair() TO service_role;

REVOKE EXECUTE ON FUNCTION public.guard_fee_bearing_withdrawal_approval() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_fee_bearing_withdrawal_approval() TO service_role;

REVOKE EXECUTE ON FUNCTION public.guard_paystack_deposit_amount() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_paystack_deposit_amount() TO service_role;

REVOKE EXECUTE ON FUNCTION public.guard_platform_revenue_beneficiary_write() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_platform_revenue_beneficiary_write() TO service_role;

REVOKE EXECUTE ON FUNCTION public.guard_utility_cashback_activation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_utility_cashback_activation() TO service_role;

REVOKE EXECUTE ON FUNCTION public.guard_utility_promotion_activation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_utility_promotion_activation() TO service_role;

REVOKE EXECUTE ON FUNCTION public.guard_utility_route_activation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_utility_route_activation() TO service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_auth_user() TO service_role;

REVOKE EXECUTE ON FUNCTION public.hydrate_driver_profile_from_application() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hydrate_driver_profile_from_application() TO service_role;

REVOKE EXECUTE ON FUNCTION public.hydrate_vehicle_from_application() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hydrate_vehicle_from_application() TO service_role;

REVOKE EXECUTE ON FUNCTION public.prepare_utility_reward_award() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_utility_reward_award() TO service_role;

REVOKE EXECUTE ON FUNCTION public.preserve_lpg_driver_geography_payload() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preserve_lpg_driver_geography_payload() TO service_role;

REVOKE EXECUTE ON FUNCTION public.prevent_public_reference_record_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_public_reference_record_mutation() TO service_role;

REVOKE EXECUTE ON FUNCTION public.prevent_reference_sequence_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_reference_sequence_delete() TO service_role;

REVOKE EXECUTE ON FUNCTION public.prevent_subject_public_reference_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_subject_public_reference_update() TO service_role;

REVOKE EXECUTE ON FUNCTION public.protect_platform_revenue_ledger_entry() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_platform_revenue_ledger_entry() TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_table_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_table_audit() TO service_role;

REVOKE EXECUTE ON FUNCTION public.remove_applicant_capability_grants() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_applicant_capability_grants() TO service_role;

REVOKE EXECUTE ON FUNCTION public.seed_canonical_vehicle_owner() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_canonical_vehicle_owner() TO service_role;

REVOKE EXECUTE ON FUNCTION public.sync_driver_card_identity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_driver_card_identity() TO service_role;

REVOKE EXECUTE ON FUNCTION public.sync_driver_vehicle_link_from_approved_vehicle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_driver_vehicle_link_from_approved_vehicle() TO service_role;

REVOKE EXECUTE ON FUNCTION public.sync_public_payout_directory_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_public_payout_directory_trigger() TO service_role;

REVOKE EXECUTE ON FUNCTION public.sync_utility_reward_award_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_utility_reward_award_status() TO service_role;

REVOKE EXECUTE ON FUNCTION public.validate_public_reference_after_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_public_reference_after_insert() TO service_role;
