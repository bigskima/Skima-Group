-- Phase 15: reduce the public RPC execute surface for privileged SECURITY DEFINER routines.
-- Authorization behavior is preserved for authenticated administrators and service-role runtimes.
-- Internal finance/provider helpers are service-only because their callers already run through guarded SECURITY DEFINER routines.

-- Internal helpers: never client-callable.
REVOKE ALL ON FUNCTION public.record_withdrawal_event(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_withdrawal_event(uuid, text, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_withdrawal_event(uuid, text, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.insert_provider_execution_log(uuid, text, text, text, jsonb, jsonb, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_provider_execution_log(uuid, text, text, text, jsonb, jsonb, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_provider_execution_log(uuid, text, text, text, jsonb, jsonb, text, text) TO service_role;

-- Admin/financial RPCs retain authenticated + service-role access but are not anonymous endpoints.
REVOKE EXECUTE ON FUNCTION public.read_support_admin_queue(text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_wallet_withdrawal(uuid, text, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_wallet_deposit_provider_event(uuid, text, text, boolean, jsonb, text, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_wallet_withdrawal_transfer(uuid, text, text, jsonb, text, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_provider_execution(text, text, text, jsonb, jsonb, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.request_wallet_withdrawal(uuid, uuid, numeric, numeric, text, text, jsonb) FROM anon;

REVOKE EXECUTE ON FUNCTION public.create_financial_policy_version(text, text, text, text, jsonb, timestamptz, text, text, text, uuid, text, text, text, timestamptz, integer, boolean, boolean, uuid, uuid, uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.submit_financial_policy_version(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.review_financial_policy_version(uuid, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.activate_financial_policy_version(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.activate_financial_policy_replacement(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.deactivate_financial_policy_version(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rollback_financial_policy_version(uuid, uuid, timestamptz, text, text) FROM anon;

-- LPG station activation is privileged even when invoked through compatibility wrappers.
REVOKE EXECUTE ON FUNCTION public.activate_lpg_station_branch(uuid, uuid, uuid, text, text, numeric, numeric, text, uuid, text, integer, numeric[], numeric, numeric, jsonb, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.activate_configured_lpg_station_branch(uuid, uuid, uuid, text, text, numeric, numeric, text, uuid, text, numeric[], numeric, numeric, jsonb, jsonb, jsonb, text) FROM anon;

-- Explicitly retain intended runtime audiences for guarded public entry points.
GRANT EXECUTE ON FUNCTION public.read_support_admin_queue(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_wallet_withdrawal(uuid, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_wallet_deposit_provider_event(uuid, text, text, boolean, jsonb, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_wallet_withdrawal_transfer(uuid, text, text, jsonb, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_provider_execution(text, text, text, jsonb, jsonb, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_wallet_withdrawal(uuid, uuid, numeric, numeric, text, text, jsonb) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_financial_policy_version(text, text, text, text, jsonb, timestamptz, text, text, text, uuid, text, text, text, timestamptz, integer, boolean, boolean, uuid, uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_financial_policy_version(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_financial_policy_version(uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activate_financial_policy_version(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activate_financial_policy_replacement(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_financial_policy_version(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rollback_financial_policy_version(uuid, uuid, timestamptz, text, text) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.activate_configured_lpg_station_branch(uuid, uuid, uuid, text, text, numeric, numeric, text, uuid, text, numeric[], numeric, numeric, jsonb, jsonb, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activate_lpg_station_branch(uuid, uuid, uuid, text, text, numeric, numeric, text, uuid, text, integer, numeric[], numeric, numeric, jsonb, jsonb, jsonb, text) TO service_role;
