begin;

-- These functions are implementation details used by database triggers and
-- security-definer settlement/OTP functions. They are not public RPC APIs.
revoke all on function public.advance_fuel_order_after_driver_handover() from public, anon, authenticated;
revoke all on function public.advance_fuel_order_after_station_preparation() from public, anon, authenticated;
revoke all on function public.advance_fuel_order_after_stock_reservation() from public, anon, authenticated;
revoke all on function public.can_advance_fuel_order_from_verified_otp(uuid) from public, anon, authenticated;
revoke all on function public.can_complete_fuel_delivery_settlement(uuid) from public, anon, authenticated;
revoke all on function public.can_create_fuel_verified_settlement_wallet(text,text,uuid,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.can_post_verified_fuel_financial_transaction(text,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.can_settle_verified_fuel_service_request(uuid) from public, anon, authenticated;
revoke all on function public.complete_fuel_rental_after_station_inspection() from public, anon, authenticated;
revoke all on function public.enforce_fuel_branch_offer_global_controls() from public, anon, authenticated;
revoke all on function public.fuel_delivery_challenge_is_verified(uuid,uuid) from public, anon, authenticated;
revoke all on function public.fuel_managed_price_is_available(text,text) from public, anon, authenticated;
revoke all on function public.advance_fuel_rental_after_final_inspection_event() from public, anon, authenticated;

notify pgrst,'reload schema';
commit;
