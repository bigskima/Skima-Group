const migration = await Deno.readTextFile(
  "supabase/migrations/20261030200000_fuel_liquid_fulfillment_foundation.sql",
);
const historyPolicy = JSON.parse(
  await Deno.readTextFile("supabase/migration-history-policy.json"),
) as {
  remoteHeadVersion: string;
  businessModuleMigrations: string[];
};

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

Deno.test("fuel foundation registers PMS, AGO and DPK independently and defaults them off", () => {
  for (const [key, code, label] of [
    ["fuel.pms", "PMS", "Petrol"],
    ["fuel.ago", "AGO", "Diesel"],
    ["fuel.dpk", "DPK", "Kerosene"],
  ] as const) {
    requireIncludes(migration, `('${key}', '${code}', '${label}', 'L'`, `${key} seed`);
  }

  requireIncludes(
    migration,
    "status text not null default 'disabled'",
    "fuel products must be disabled by default",
  );
  requireIncludes(
    migration,
    "where key = 'fuel' and status = 'active'",
    "a product cannot be enabled before the Fuel module is activated",
  );
  requireIncludes(
    migration,
    "public.set_fuel_product_status(text, text, text, text)",
    "global product controls must use the permission-checked status RPC",
  );
  requireNotIncludes(
    migration,
    "update public.business_modules",
    "the foundation migration must not overwrite an existing module's lifecycle state",
  );
});

Deno.test("liquid-fuel inventory is litre-based and isolated from LPG inventory", () => {
  for (const table of [
    "fuel_station_storage_units",
    "fuel_station_stock_movements",
    "fuel_order_stock_reservations",
  ]) {
    requireIncludes(
      migration,
      `create table if not exists public.${table} (`,
      `${table} must be created`,
    );
    requireIncludes(
      migration,
      `alter table public.${table} enable row level security;`,
      `${table} must have RLS enabled`,
    );
  }

  requireIncludes(migration, "physical_stock_litres", "physical stock uses litres");
  requireIncludes(migration, "reserved_stock_litres", "reserved stock uses litres");
  requireIncludes(migration, "safety_reserve_litres", "safety reserve uses litres");
  requireIncludes(
    migration,
    "fuel storage organization must match its station branch",
    "branch stock must be scoped to its owning organization",
  );
  requireNotIncludes(migration, "station_lpg_tanks", "fuel cannot reuse LPG tanks");
  requireNotIncludes(migration, "lpg_station_branches", "fuel cannot reference LPG-only branches");
  requireNotIncludes(migration, "normalized_stock_kg", "fuel cannot inherit LPG kilogram measurements");
});

Deno.test("container purchase and rental are separate, capacity-checked custody lifecycles", () => {
  for (const table of [
    "fuel_container_types",
    "fuel_container_profiles",
    "fuel_container_allocations",
    "fuel_container_custody_events",
  ]) {
    requireIncludes(
      migration,
      `create table if not exists public.${table} (`,
      `${table} must be created`,
    );
    requireIncludes(
      migration,
      `alter table public.${table} enable row level security;`,
      `${table} must have RLS enabled`,
    );
  }

  requireIncludes(migration, "'asset.fuel-container'", "fuel assets must have their own asset type");
  requireIncludes(migration, "supported_product_keys", "container/product compatibility is configured");
  requireIncludes(migration, "new.allocated_litres > profile_record.capacity_litres", "each allocation is capacity checked");
  requireIncludes(migration, "container allocations exceed the quoted container count or fuel quantity", "multi-container totals are bounded by the locked quote");
  requireIncludes(migration, "container product and purchase/rental mode must match the locked order quote", "allocation mode must match the locked quote");
  requireIncludes(migration, "'ownership_transferred'", "customer purchase closes through ownership transfer");
  requireIncludes(migration, "'returned_to_driver'", "rental return to the driver is recorded");
  requireIncludes(migration, "'received_at_station'", "rental return at the station is recorded");
  requireIncludes(migration, "'inspection_passed'", "container inspection is recorded before reuse");
  requireIncludes(migration, "fuel_container_allocations_one_open_container", "one container cannot have multiple open allocations");
  requireIncludes(migration, "fuel container profile requires an asset.fuel-container asset", "LPG assets cannot be silently repurposed");
});

Deno.test("fuel commercial snapshots are server-calculated and preserve refundable deposits", () => {
  requireIncludes(migration, "fuel_unit_price numeric(20,8)", "the quote stores a unit price");
  requireIncludes(
    migration,
    "abs(fuel_amount - requested_litres * fuel_unit_price) < 0.001",
    "fuel amount must reconcile to litres times unit price",
  );
  requireIncludes(
    migration,
    "grand_total = fuel_amount + container_amount + driver_amount + platform_fee_amount + tax_amount + refundable_deposit_amount",
    "the customer total must reconcile to all explicit components",
  );
  requireIncludes(
    migration,
    "refundable_deposit_amount numeric(20,8)",
    "rental deposits remain distinct from ordinary charges",
  );
  requireIncludes(migration, "component_snapshot jsonb", "the itemised commercial snapshot is persisted");
});

Deno.test("fuel event ledgers are append-only and product data is permission-scoped", () => {
  for (const table of [
    "fuel_products",
    "fuel_product_events",
    "fuel_container_custody_events",
    "fuel_station_stock_movements",
  ]) {
    requireIncludes(
      migration,
      `alter table public.${table} enable row level security;`,
      `${table} must have RLS enabled`,
    );
  }

  requireIncludes(migration, "event.fuel.product.status_changed", "product status changes have a declared domain event");
  requireIncludes(migration, "fuel events and stock movements are append-only", "append-only event guard exists");
  requireIncludes(migration, "fuel_product_events_immutable", "product history cannot be mutated");
  requireIncludes(migration, "fuel_container_custody_events_immutable", "container custody history cannot be mutated");
  requireIncludes(migration, "fuel_station_stock_movements_immutable", "stock movement history cannot be mutated");
  requireIncludes(migration, "public.can_manage_fuel_platform()", "global product administration is permission-checked");
  requireIncludes(migration, "public.can_read_fuel_order(order_id)", "fuel order data is customer/organization scoped");
});

Deno.test("fuel migration is tracked without advancing the production migration head", () => {
  if (historyPolicy.remoteHeadVersion !== "20261030142157") {
    throw new Error("The production migration head must remain at the verified live version.");
  }
  if (!historyPolicy.businessModuleMigrations.includes("20261030200000_fuel_liquid_fulfillment_foundation.sql")) {
    throw new Error("The fuel foundation migration must be tracked in migration-history-policy.json.");
  }
});
