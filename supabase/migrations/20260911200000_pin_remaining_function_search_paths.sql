-- Phase 18: pin the remaining public functions flagged by the Supabase
-- function_search_path_mutable security advisor.
--
-- This changes only function configuration. Function bodies, trigger bindings,
-- volatility, ownership, grants, and business behavior remain unchanged.

ALTER FUNCTION public.calculate_utility_campaign_amount(text, numeric, numeric, numeric)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.financial_policy_scope_matches(public.financial_policy_versions, uuid, uuid, text, text, text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.is_authenticated()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.jsonb_numeric_value(jsonb, text, numeric)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.lpg_distance_meters(numeric, numeric, numeric, numeric)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.prevent_application_runtime_event_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_audit_log_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_business_module_event_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_catalog_runtime_event_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_driver_verification_escalation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_finance_communication_event_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_financial_policy_event_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_financial_policy_version_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_lpg_accepted_quote_financial_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_lpg_financial_snapshot_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_operational_runtime_event_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_order_event_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_organization_staff_event_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_platform_super_admin_client_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_profile_privilege_escalation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_provider_execution_log_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_runtime_event_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_vehicle_relationship_event_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_wallet_account_balance_columns()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_wallet_account_event_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_wallet_ledger_entry_mutation()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_webhook_delivery_attempt_mutation()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.set_updated_at()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.skima_driver_public_id(uuid)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.validate_financial_policy_configuration(text, jsonb)
  SET search_path = public, pg_temp;
