const migration = await Deno.readTextFile(
  "supabase/migrations/20261030210000_fuel_order_processing_runtime.sql",
);
const foundation = await Deno.readTextFile(
  "supabase/migrations/20261030200000_fuel_liquid_fulfillment_foundation.sql",
);

function requireIncludes(source: string, fragment: string, message: string): void {
  if (!source.includes(fragment)) {
    throw new Error(`${message}: missing "${fragment}"`);
  }
}

function requireNotIncludes(source: string, fragment: string, message: string): void {
  if (source.includes(fragment)) {
    throw new Error(`${message}: unexpected "${fragment}"`);
  }
}

Deno.test("Fuel module uses the shared order engine with its own order-processing workflow", () => {
  requireIncludes(migration, "'fuel'", "Fuel module is configured");
  requireIncludes(migration, "'workflow.fuel.station-fill-delivery'", "Fuel-specific workflow is defined");
  requireIncludes(migration, "'purpose','order_processing'", "generic order engine can resolve the Fuel workflow");
  requireIncludes(migration, "'order.acceptance.fuel.manual.v1'", "station order acceptance is manual by default");
  requireIncludes(migration, "'pricing.fuel.commercial-snapshot.v1'", "Fuel pricing uses the locked commercial snapshot");
  requireIncludes(migration, "'settlement.fuel.escrow.station-driver.v1'", "Fuel settlement is linked to its own escrow policy");
  requireIncludes(migration, "public.activate_business_module_version", "module activation remains a platform-governed operation");
  requireIncludes(migration, "status='active'", "the configured Fuel module is activated without enabling the products");
  requireIncludes(foundation, "status text not null default 'disabled'", "all products remain disabled until explicitly enabled");
});

Deno.test("Fuel order initialization requires an enabled product and validated customer order inputs", () => {
  requireIncludes(migration, "create or replace function public.initialize_fuel_order_operation()", "fuel order initializer exists");
  requireIncludes(migration, "new.order_payload ->> 'fuel_product_key'", "product key is read from the server-validated order payload");
  requireIncludes(migration, "new.order_payload ->> 'requested_litres'", "quantity is read in litres");
  requireIncludes(migration, "new.order_payload ->> 'container_mode'", "container purchase or rental choice is persisted");
  requireIncludes(migration, "new.order_payload ->> 'container_count'", "multi-container allocation is supported");
  requireIncludes(migration, "product_status is distinct from 'enabled'", "paused/disabled products cannot create new orders");
  requireIncludes(migration, "Fuel orders require a station branch", "a fuel order cannot be created without its fulfilling station");
});

Deno.test("Fuel operations timeline captures station, driver, delivery and rental return separately", () => {
  requireIncludes(migration, "create table if not exists public.fuel_order_operations", "fuel order operational read model exists");
  requireIncludes(migration, "create table if not exists public.fuel_order_operation_events", "fuel order stage history exists");
  for (const stage of [
    "awaiting_station_acceptance",
    "stock_reserved",
    "station_filling",
    "ready_for_driver",
    "driver_assigned",
    "station_handover",
    "out_for_delivery",
    "delivered",
    "return_due",
    "returned_to_driver",
    "received_at_station",
    "inspection_passed",
    "completed",
  ]) {
    requireIncludes(migration, `'${stage}'`, `${stage} is represented in the operational lifecycle`);
  }
  requireIncludes(migration, "Rental fuel containers must be returned and inspected before completion", "rental completion requires return and inspection");
  requireIncludes(migration, "Purchased container orders must reach verified delivery before completion", "purchase completion requires delivery");
  requireIncludes(migration, "fuel_order_operation_events_immutable", "operational timeline is append-only");
});

Deno.test("Fuel stage mutation is serialized, replay-safe and backend-only", () => {
  requireIncludes(migration, "create or replace function public.record_fuel_order_stage(", "controlled stage transition RPC exists");
  requireIncludes(migration, "if auth.role() <> 'service_role' then", "only the trusted SKIMA runtime mutates fuel stages");
  requireIncludes(migration, "for update;", "fuel order row is locked during a stage transition");
  requireIncludes(migration, "Fuel stage idempotency key was reused for different details", "stage event replay cannot mutate another request");
  requireIncludes(migration, "Fuel order stage transition is not allowed", "stage transitions are constrained");
  requireIncludes(migration, "revoke all on function public.record_fuel_order_stage(uuid,text,text,text,jsonb) from public,anon,authenticated", "clients cannot bypass the gateway with direct stage mutations");
  requireNotIncludes(migration, "grant execute on function public.record_fuel_order_stage(uuid,text,text,text,jsonb) to authenticated", "direct authenticated execution must remain blocked");
});

Deno.test("Fuel-specific business role permissions are included in operational reads", () => {
  requireIncludes(foundation, "'business.fuel.orders.read'", "fuel order read permission is defined");
  requireIncludes(foundation, "'business.fuel.orders.process'", "fuel order process permission is defined");
  requireIncludes(foundation, "'business.fuel.orders.manage'", "fuel order manage permission is defined");
  requireIncludes(foundation, "'business.fuel.orders.read',", "fuel order read capability is available");
  requireIncludes(
    foundation,
    "public.has_permission_for_branch(\n            'business.fuel.orders.read'",
    "fuel order read permissions are checked against the order branch",
  );
});
