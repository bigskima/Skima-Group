const migration = await Deno.readTextFile(
  "supabase/migrations/20261102013000_fuel_driver_workflow_fees_and_mode_controls.sql",
);
const runtime = await Deno.readTextFile("supabase/functions/fuel-runtime/index.ts");
const driver = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelDriverJobsScreen.tsx");
const station = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelStationOperationsScreen.tsx");
const adminFuel = await Deno.readTextFile("apps/admin/src/features/services/FuelAdminWorkspace.tsx");
const adminRevenue = await Deno.readTextFile("apps/admin/src/admin-revenue-workspace.tsx");

function includes(source: string, fragment: string, message: string): void {
  if (!source.includes(fragment)) throw new Error(`${message}: missing "${fragment}"`);
}
function excludes(source: string, fragment: string, message: string): void {
  if (source.includes(fragment)) throw new Error(`${message}: unexpected "${fragment}"`);
}

Deno.test("PMS, AGO and DPK have independent global fee controls in the shared revenue editor", () => {
  for (const [key, control] of [
    ["pricing.fuel.pms.platform_fee_per_litre", "fuel_pms_fee_per_litre"],
    ["pricing.fuel.ago.platform_fee_per_litre", "fuel_ago_fee_per_litre"],
    ["pricing.fuel.dpk.platform_fee_per_litre", "fuel_dpk_fee_per_litre"],
  ]) {
    includes(migration, key, `${key} is a distinct financial policy`);
    includes(migration, control, `${control} is exposed in platform fee controls`);
  }
  includes(migration, "'amount_per_litre'", "Fuel fee is configured per litre");
  includes(migration, "from public.currency_definitions", "fee baselines are seeded from the registered currency catalogue");
  includes(migration, "and status='enabled'", "disabled currencies are not given fee versions");
  includes(migration, "'NGN'", "the Nigeria launch fee configuration is supported");
  includes(migration, "row_number() over(partition by policy_definition_id order by currency_code)", "currency versions have unique sequential numbers per policy");
  includes(migration, "admin_product_fee_amount:=round(operation_record.requested_litres*admin_fee_per_litre,currency_decimals)", "the product fee is calculated from ordered litres");
  includes(migration, "admin_product_fee_policy_version_id", "the accepted quote locks its financial policy version");
  includes(migration, "platform_fee_amount:=round(offer_record.platform_fee_amount+admin_product_fee_amount,currency_decimals)", "station fee and platform fee are reconciled into the quote");
  includes(adminRevenue, 'supabase.rpc("read_platform_fee_controls"', "Money & Revenue reads configured fee controls dynamically");
  includes(adminRevenue, 'supabase.rpc("set_platform_fee_amount"', "Super Admin fee editor saves through the audited shared fee RPC");
});

Deno.test("station, Independent Driver and SKIMA Managed qualifications are mutually exclusive", () => {
  includes(migration, "add column if not exists fulfillment_mode text not null default 'independent_driver'", "qualification records carry the selected delivery mode");
  includes(migration, "fuel_driver_product_qualification_mode_identity_check", "identity columns are constrained by delivery mode");
  includes(migration, "target_fulfillment_mode='station_managed'", "Station Managed has its own validation branch");
  includes(migration, "target_fulfillment_mode='independent_driver'", "Independent Driver has its own validation branch");
  includes(migration, "target_fulfillment_mode='skima_managed'", "SKIMA Managed has its own validation branch");
  includes(migration, "membership.program_key='driver.independent'", "Independent Driver requires an active independent membership");
  includes(migration, "vehicle.platform_owned is true", "Independent Driver cannot receive a SKIMA fleet vehicle");
  includes(migration, "link.relationship_type='fleet_owned'", "SKIMA Managed requires a fleet-owned vehicle relationship");
  includes(migration, "vehicle.platform_owned is true", "SKIMA Managed requires a platform-owned vehicle");
  includes(migration, "fulfillment_mode=operation_record.fulfillment_mode", "order assignment rechecks the exact selected mode");
  includes(migration, "Driver profile, participation type and vehicle ownership must match the ordered Fuel fulfilment mode", "driver dispatch rejects a mode/vehicle mismatch");
  includes(runtime, "target_fulfillment_mode: fulfillmentMode", "API passes the explicit fulfilment mode to the qualification RPC");
  includes(runtime, '.eq("fulfillment_mode", operationData.fulfillment_mode)', "dispatch query filters qualification to the order's mode");
  includes(adminFuel, "Independent Driver · independent provider + own vehicle", "Admin labels Independent Driver separately");
  includes(adminFuel, "SKIMA Managed · internal driver + SKIMA fleet", "Admin labels SKIMA Managed separately");
  includes(adminFuel, "Station Managed · station driver + branch vehicle", "Admin labels Station Managed separately");
});

Deno.test("customer delivery and rental returns are confirmed once per order, not once per container", () => {
  includes(migration, "public.confirm_fuel_customer_delivery(", "atomic customer delivery RPC exists");
  includes(migration, "public.confirm_fuel_rental_container_return(", "atomic rental return RPC exists");
  includes(migration, "Every filled container must be with the assigned driver", "delivery requires the full prepared container set");
  includes(migration, "Only the driver assigned to this Fuel order can confirm its delivery", "only the assigned driver can confirm delivery");
  includes(migration, "order_level_delivery_confirmation", "each container event is recorded in the atomic order transaction");
  includes(migration, "customer_returned_to_driver", "customer rental return is a defined order-level action");
  includes(migration, "driver_returned_to_station", "driver station return is a defined order-level action");
  includes(migration, "revoke all on function public.confirm_fuel_customer_delivery", "direct client execution is blocked");
  includes(runtime, 'routePath === "/runtime/fuel/orders/confirm-delivery"', "driver delivery is one endpoint");
  includes(runtime, 'routePath === "/runtime/fuel/orders/confirm-rental-return"', "rental return is one endpoint");
  includes(driver, 'path: "/runtime/fuel/orders/confirm-delivery"', "driver screen uses one delivery confirmation endpoint");
  includes(driver, 'path: "/runtime/fuel/orders/confirm-rental-return"', "driver screen uses one rental return endpoint");
  excludes(driver, 'path: "/runtime/fuel/containers/handover"', "driver screen no longer sends one request for every container");
  excludes(driver, "recordHandover.mutateAsync", "driver no longer submits repeated per-container handover mutations");
  excludes(driver, "for (const allocation of withDriver)", "driver does not loop and reconfirm each container");
  includes(station, 'stageKey: "out_for_delivery"', "station handover starts delivery without a second driver start tap");
});

Deno.test("driver guidance is explicit for every current operational stage and fulfilment mode", () => {
  for (const stage of [
    "driver_assigned",
    "station_handover",
    "out_for_delivery",
    "delivered",
    "return_due",
    "returned_to_driver",
    "received_at_station",
    "inspection_passed",
    "completed",
    "exception",
  ]) {
    includes(driver, `${stage}:`, `${stage} has an explicit driver instruction`);
  }
  includes(driver, "describeDriverMode", "driver sees the meaning of the assigned mode");
  includes(driver, "You are the station's own registered driver", "Station Managed guidance is explicit");
  includes(driver, "not a station employee and not a SKIMA staff driver", "Independent Driver is clearly distinct");
  includes(driver, "internal SKIMA driver", "SKIMA Managed is clearly distinct");
  includes(driver, "you do not need to scan each container a second time", "driver is told the full set is confirmed together");
});

Deno.test("station direct dispatch is restricted to Station Managed; platform dispatch handles the other two", () => {
  includes(station, 'focusedFulfillmentMode === "station_managed"', "station driver selector is Station Managed only");
  includes(station, 'focusedFulfillmentMode === "independent_driver"', "station explains Independent Driver dispatch");
  includes(station, 'focusedFulfillmentMode === "skima_managed"', "station explains SKIMA Managed dispatch");
  includes(adminFuel, '"/runtime/fuel/orders/operations?stage=ready_for_driver"', "Admin has a Fuel dispatch queue");
  includes(adminFuel, '"/runtime/fuel/orders/assign-driver"', "Admin dispatches a qualified mode-matched driver");
  includes(adminFuel, '["independent_driver", "skima_managed"]', "the SKIMA dispatch queue excludes Station Managed orders");
  includes(adminFuel, "not a station employee", "station and independent roles are not conflated");
  includes(adminFuel, "SKIMA-owned fleet vehicle", "SKIMA Managed fleet ownership is explicit");
});
