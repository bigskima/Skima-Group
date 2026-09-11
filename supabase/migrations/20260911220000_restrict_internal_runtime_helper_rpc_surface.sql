-- Phase 20: restrict verified internal SECURITY DEFINER runtime helpers from
-- direct client RPC execution.
--
-- Repository call-graph review finds these functions only in database/runtime
-- migrations and higher-level SECURITY DEFINER/trigger flows, not in Admin,
-- LPG, or Edge direct RPC contracts. All are owned by postgres, so existing
-- SECURITY DEFINER callers continue to resolve them as their definer; service_role
-- remains explicitly available for worker/internal execution.

REVOKE EXECUTE ON FUNCTION public.claim_pending_webhook_deliveries(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_webhook_deliveries(integer, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_webhook_deliveries_for_event(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_webhook_deliveries_for_event(uuid, text, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.ensure_platform_clearing_wallet(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_platform_clearing_wallet(text, text, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.ensure_platform_liability_wallet(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_platform_liability_wallet(text, text, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.ensure_platform_provider_wallet(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_platform_provider_wallet(text, text, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.ensure_platform_revenue_wallet(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_platform_revenue_wallet(text, text, text)
  TO service_role;
