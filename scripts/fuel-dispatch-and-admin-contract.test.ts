const dispatch = await Deno.readTextFile(
  "supabase/migrations/20261030280000_fuel_dispatch_assignment_runtime.sql",
);
const permissions = await Deno.readTextFile(
  "supabase/migrations/20261030290000_fuel_platform_admin_permissions.sql",
);
const batchStatus = await Deno.readTextFile(
  "supabase/migrations/20261030291000_fuel_stock_batch_status_sync.sql",
);
const gateway = await Deno.readTextFile(
  "supabase/functions/api-gateway/index.ts",
);

function requireIncludes(source: string, fragment: string, message: string): void {
  if (!source.includes(fragment)) throw new Error(`${message}: missing "${fragment}"`);
}

Deno.test("Fuel dispatch binds the exact qualified driver vehicle and order as one operation", () => {
  requireIncludes(dispatch, "create or replace function public.assign_fuel_order_driver(", "atomic Fuel assignment RPC exists");
  requireIncludes(dispatch, "operation_record.stage_key<>'ready_for_driver'", "dispatch only starts after the complete order is prepared");
  requireIncludes(dispatch, "qualification_record.product_key", "qualification matches the exact fuel product");
  requireIncludes(dispatch, "qualification_record.maximum_load_litres>=operation_record.requested_litres", "qualification covers the full requested load");
  requireIncludes(dispatch, "qualification_record.vehicle_id", "qualification is bound to the selected vehicle");
  requireIncludes(dispatch, "station_managed_driver_id=target_driver_entity_id", "Station Managed driver identity is supported");
  requireIncludes(dispatch, "driver_profile_id=target_driver_entity_id", "independent and SKIMA Managed driver profile identity is supported");
  requireIncludes(dispatch, "public.assign_order_participant(", "existing generic order assignment is reused");
  requireIncludes(dispatch, "'vehicle_id',target_vehicle_id", "the selected vehicle is persisted on the active assignment");
  requireIncludes(dispatch, "public.record_fuel_order_stage(", "driver assignment and stage progression are one transaction");
  requireIncludes(dispatch, "A confirmed matching escrow hold", "stock reservation batch requires the funded order");
});

Deno.test("Fuel platform administration has separate read and manage roles", () => {
  requireIncludes(permissions, "'platform.fuel.read'", "read permission is defined");
  requireIncludes(permissions, "'platform.fuel.manage'", "manage permission is defined");
  requireIncludes(permissions, "'platform.super_admin','platform.module_admin','platform.operations_admin'", "platform operations roles can read Fuel settings");
  requireIncludes(permissions, "'platform.super_admin','platform.module_admin'", "global product and qualification management is restricted");
});

Deno.test("Fuel reservation batch status remains synchronized with tank reservations", () => {
  requireIncludes(batchStatus, "status in ('reserved','consumed','released','expired','cancelled')", "batch status supports final states");
  requireIncludes(batchStatus, "count(*) filter (where reservation.status in ('reserved','partially_consumed'))", "partially consumed reservations keep the batch open");
  requireIncludes(batchStatus, "bool_and(reservation.status='consumed')", "fully dispensed batch is marked consumed");
  requireIncludes(batchStatus, "fuel_stock_reservations_refresh_batch", "reservation state changes refresh their parent batch");
});

Deno.test("Fuel operational API routes require existing order and branch authorization", () => {
  requireIncludes(gateway, 'routePath === "/runtime/fuel/orders/assign-driver"', "station Fuel driver assignment endpoint exists");
  requireIncludes(gateway, 'routePath === "/runtime/fuel/orders/stock/reserve-for-order"', "station atomic stock reservation endpoint exists");
  requireIncludes(gateway, "resolveFuelOrderBranchAccess(supabase, orderId, \"business.fuel.orders.process\")", "Fuel station mutations check branch processing access");
  requireIncludes(gateway, "serviceClient.rpc(\"assign_fuel_order_driver\"", "driver assignment uses the database qualification gate");
});
