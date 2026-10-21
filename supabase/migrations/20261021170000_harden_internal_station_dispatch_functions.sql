begin;

-- These routines are exclusively trigger/internal helpers. SECURITY DEFINER must
-- not make branch dispatch callable directly through the authenticated Data API.
revoke all on function public.auto_dispatch_pending_station_orders_for_branch(uuid)
  from public, anon, authenticated;
revoke all on function public.on_station_managed_dispatch_readiness_changed()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
