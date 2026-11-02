const pricing = await Deno.readTextFile(
  "supabase/migrations/20261102160000_fuel_easy_fulfillment_mode_aware_runtime.sql",
);
const progression = await Deno.readTextFile(
  "supabase/migrations/20261102161000_fuel_auto_progression_verified_delivery_completion.sql",
);
const walletGate = await Deno.readTextFile(
  "supabase/migrations/20261102162000_fuel_verified_settlement_platform_wallet_gate.sql",
);
const fuelRuntime = await Deno.readTextFile("supabase/functions/fuel-runtime/index.ts");
const customerOrder = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelOrderScreen.tsx");
const customerDetails = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelOrderDetailsScreen.tsx");
const station = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelStationOperationsScreen.tsx");
const driver = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelDriverJobsScreen.tsx");
const adminRevenue = await Deno.readTextFile("apps/admin/src/admin-revenue-workspace.tsx");

function includes(source: string, fragment: string, message: string): void {
  if (!source.includes(fragment)) throw new Error(`${message}: missing "${fragment}"`);
}
function excludes(source: string, fragment: string, message: string): void {
  if (source.includes(fragment)) throw new Error(`${message}: unexpected "${fragment}"`);
}

Deno.test("Fuel has three separately controlled fulfillment models", () => {
  for (const mode of ["station_managed", "independent_driver", "skima_managed"]) {
    includes(pricing, `('${mode}')`, `${mode} is represented in the platform mode defaults`);
    includes(pricing, `'${mode}'`, `${mode} is validated by the station offer configuration`);
    includes(customerOrder, `"${mode}"`, `${mode} is available to customer ordering`);
    includes(station, `"${mode}"`, `${mode} has distinct station instructions`);
  }
  includes(pricing, "configure_fuel_driver_product_qualification_mode", "the existing mode-specific qualification system remains the dispatch authority");
  includes(pricing, "fulfillment_mode=operation_record.fulfillment_mode", "driver assignment rechecks the order's selected mode");
  includes(driver, "Only the assigned Fuel driver can confirm", "delivery is tied to the assigned driver identity");
  includes(driver, "The station has recorded the full handover", "the driver does not need a second departure action");
});

Deno.test("station offers, platform product switches and Admin price overrides are enforced in the database", () => {
  includes(pricing, "create table if not exists public.fuel_fulfillment_mode_controls", "global mode controls are persisted");
  includes(pricing, "create table if not exists public.fuel_managed_product_prices", "SKIMA Managed retail prices are persisted per product and currency");
  includes(pricing, "admin_override_price_per_litre", "Admin station-price override is recorded on the station offer");
  includes(pricing, "public.configure_fuel_station_product_offer(", "station product offers are permission checked");
  includes(pricing, "product.status='enabled'", "a globally disabled product cannot be activated by a station");
  includes(pricing, "target_fulfillment_modes <@ allowed_modes", "a station cannot enable a globally disabled fulfillment mode");
  includes(progression, "global_product_is_enabled", "a previously active offer cannot bypass the global product kill switch at quote time");
  includes(progression, "This Fuel product is globally disabled by SKIMA and cannot be ordered", "direct quote creation rejects a globally disabled product");
  includes(fuelRuntime, 'routePath === "/runtime/fuel/offers"', "station offer configuration is exposed through the trusted Fuel runtime");
  includes(fuelRuntime, "configure_fuel_station_product_offer", "station saves use the guarded station-offer RPC");
  includes(station, "What your station sells", "station can configure products it offers");
  includes(station, "Save & enable this product", "station can enable a locally offered product");
  includes(station, "Pause at this station", "station can pause its own offer without overriding platform controls");
});

Deno.test("customer pricing follows the selected fulfillment model", () => {
  includes(progression, "pricing_owner", "accepted quote records who owns the customer-facing price");
  includes(progression, "station_supply_amount", "the accepted quote locks the station supply amount");
  includes(progression, "managed_product_margin_amount", "SKIMA Managed retail/supply spread is snapshotted");
  includes(progression, "operation_record.fulfillment_mode='skima_managed'", "SKIMA Managed uses a separate platform retail price");
  includes(pricing, "pricing.fuel.pms.platform_fee_per_litre", "PMS markup is administered per litre");
  includes(pricing, "pricing.fuel.ago.platform_fee_per_litre", "diesel markup is administered per litre");
  includes(pricing, "pricing.fuel.dpk.platform_fee_per_litre", "kerosene markup is administered per litre");
  includes(customerOrder, "/runtime/fuel/mode-controls", "customer sees only globally enabled fulfillment modes");
  includes(customerOrder, "/runtime/fuel/managed-prices", "customer price lookup includes SKIMA Managed retail values");
  includes(customerOrder, "admin_override_price_per_litre", "customer price uses an active Admin station-price override");
  includes(customerOrder, "managedRetailPricePerLitre", "customer price changes to SKIMA retail under SKIMA Managed");
  includes(progression, "station_payout_amount := station_supply_amount", "the station receives its own supply amount, not SKIMA retail");
  includes(progression, "platform_revenue_amount := quote_record.container_amount+quote_record.platform_fee_amount+managed_product_margin_amount", "the managed retail/supply spread is classified as SKIMA revenue");
});

Deno.test("Fuel progression follows verified operational events without duplicate advance buttons", () => {
  includes(progression, "advance_fuel_order_after_stock_reservation", "complete stock reservation auto-advances station preparation");
  includes(progression, "advance_fuel_order_after_station_preparation", "measured fill and consumed litres auto-advance to driver readiness");
  includes(progression, "fuel_auto_progress_after_measured_fill", "filled-litre aggregate changes are rechecked automatically");
  includes(progression, "fuel_auto_progress_after_driver_handover_event", "the final recorded handover event auto-starts delivery");
  includes(progression, "advance_fuel_rental_after_final_inspection_event", "the final passing rental inspection auto-completes the rental lifecycle");
  includes(progression, "drop trigger if exists fuel_auto_progress_after_driver_handover on public.fuel_container_allocations", "the earlier pre-custody-event handover trigger is removed");
  excludes(station, 'stageKey: "stock_reserved"', "station does not manually advance stock reservation");
  excludes(station, 'stageKey: "station_filling"', "station does not manually start a derived filling stage");
  excludes(station, 'stageKey: "ready_for_driver"', "station does not manually advance a completed measured fill");
  excludes(station, 'stageKey: "station_handover"', "station does not manually advance after the full custody handover");
  excludes(station, 'stageKey: "out_for_delivery"', "station does not manually write delivery departure");
  excludes(driver, 'stageKey: "out_for_delivery"', "driver does not confirm a second departure action");
  excludes(driver, "startDelivery", "driver UI contains no duplicate start-delivery function");
  includes(station, "Hand over containers & start delivery", "station's one physical full-order handoff remains explicit");
  includes(driver, "Confirm customer delivery", "driver confirms the physical customer handoff once for the whole order");
});

Deno.test("purchased orders settle only after customer OTP; rental orders settle after return and inspection", () => {
  includes(pricing, "public.request_fuel_delivery_challenge(", "customer delivery challenge is order-bound");
  includes(pricing, "public.verify_fuel_delivery_challenge(", "OTP verification is customer-authenticated");
  includes(pricing, "create trigger fuel_delivery_otp_auto_completion", "verified OTP drives automatic delivery completion");
  includes(pricing, "operation_record.container_mode='rental' then 'return_due' else 'completed'", "purchase and rental have separate post-verification paths");
  includes(progression, "only a verified customer OTP may move this order to return_due/completed", "driver delivery cannot directly close a Fuel order");
  includes(pricing, "can_complete_fuel_delivery_settlement", "settlement is gated by order-bound verified customer handover");
  includes(walletGate, "can_create_fuel_verified_platform_purpose_wallet", "platform revenue/liability wallets are narrowly authorized for this exact settlement");
  includes(walletGate, "'fuel-settlement:'||order_record.id::text||':revenue-wallet'", "platform wallet creation is bound to the exact Fuel order idempotency key");
  includes(pricing, "can_create_fuel_verified_settlement_wallet", "station and assigned-driver wallets are narrowly authorized for the verified order");
  includes(fuelRuntime, 'routePath === "/runtime/fuel/orders/delivery-challenge"', "customer challenge endpoint exists");
  includes(fuelRuntime, 'routePath === "/runtime/fuel/orders/verify-delivery"', "customer verification endpoint exists");
  includes(customerDetails, "/runtime/fuel/orders/delivery-challenge", "customer screen requests delivery verification");
  includes(customerDetails, "/runtime/otp/delivery", "customer screen retrieves the in-app OTP challenge");
  includes(customerDetails, "/runtime/fuel/orders/verify-delivery", "customer screen verifies the order-specific OTP");
  includes(customerDetails, "Confirm I received this fuel order", "customer must confirm the physical handover explicitly");
  excludes(customerDetails, 'stageKey: "completed"', "customer cannot directly close or settle their own order");
  includes(customerDetails, "rental container return is still open", "rental handover verification does not prematurely settle the rental");
});

Deno.test("Fuel controls are consolidated into the existing Money & Revenue dashboard", () => {
  includes(adminRevenue, "<FuelPricingControls />", "Fuel pricing is rendered inside Money & Revenue");
  includes(adminRevenue, "Fuel products, SKIMA pricing & station overrides", "the central dashboard has a single Fuel commercial control section");
  includes(adminRevenue, "set_fuel_product_status", "Admin can globally disable or enable PMS, AGO and DPK");
  includes(adminRevenue, "set_fuel_fulfillment_mode_control", "Admin controls the three fulfillment modes centrally");
  includes(adminRevenue, "configure_fuel_managed_product_price", "SKIMA Managed retail pricing is configured centrally");
  includes(adminRevenue, "configure_fuel_station_price_override", "Admin overrides station prices from the same dashboard");
  includes(adminRevenue, 'supabase.rpc("set_platform_fee_amount"', "existing platform revenue markup controls remain in the same dashboard");
});
