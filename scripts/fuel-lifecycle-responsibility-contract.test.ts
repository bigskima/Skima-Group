const migration = await Deno.readTextFile(
  "supabase/migrations/20261108122000_fuel_lifecycle_pricing_readiness.sql",
);
const runtime = await Deno.readTextFile("supabase/functions/fuel-runtime/index.ts");
const admin = await Deno.readTextFile("apps/admin/src/features/services/FuelAdminWorkspace.tsx");
const station = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelStationOperationsScreen.tsx");
const customer = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelOrderScreen.tsx");

function includes(source: string, fragment: string, message: string): void {
  if (!source.includes(fragment)) throw new Error(`${message}: missing "${fragment}"`);
}
function excludes(source: string, fragment: string, message: string): void {
  if (source.includes(fragment)) throw new Error(`${message}: unexpected "${fragment}"`);
}

Deno.test("Fuel markup policies have one audited source and are visible to Fuel admins and customer quotes", () => {
  includes(migration, "public.read_fuel_product_fee_schedule()", "authenticated customers and admin workspaces read a shared fee schedule");
  includes(migration, "public.set_fuel_product_fee(", "Fuel admins update fees through an audited policy-version RPC");
  includes(migration, "public.can_manage_fuel_platform()", "only authorized Fuel platform administrators can change markups");
  includes(migration, "public.configure_fuel_admin_branch_product_offer(", "full commercial offer editing has a platform-only guard");
  includes(migration, "Platform Fuel management permission is required for administrator branch-offer changes", "station managers cannot use the admin commercial offer endpoint");
  for (const productKey of ["fuel.pms", "fuel.ago", "fuel.dpk"]) {
    includes(migration, productKey, `${productKey} remains independently configured`);
  }
  includes(runtime, 'routePath === "/runtime/fuel/platform-fees"', "Fuel fee schedule and setter have a runtime route");
  includes(runtime, "read_fuel_product_fee_schedule", "runtime uses the canonical fee schedule");
  includes(runtime, "set_fuel_product_fee", "runtime writes the canonical fee policy");
  includes(admin, '"/runtime/fuel/platform-fees"', "Fuel admin reads the per-product fee schedule");
  includes(admin, "SKIMA markup per litre", "Fuel admin shows an explicit per-litre markup section");
  includes(admin, "saveFuelFee.mutateAsync", "Fuel markup editor persists changes");
  includes(customer, 'path: "/runtime/fuel/platform-fees"', "customer checkout reads the same fee schedule");
  includes(customer, "platformFeePerLitre", "customer estimate has a distinct per-litre markup value");
  includes(customer, "estimatedProductMarkup", "customer estimate includes the SKIMA per-litre amount");
  includes(customer, 'label="SKIMA fuel markup"', "final quote breakdown identifies the Fuel markup separately");
});

Deno.test("station offer editing cannot overwrite platform-owned commercial settings", () => {
  includes(runtime, 'routePath === "/runtime/fuel/offers"', "station offer endpoint remains available");
  includes(runtime, "configure_fuel_station_product_offer", "station updates use the permission-scoped station RPC");
  includes(runtime, 'routePath === "/runtime/fuel/admin-pricing/branch-offer"', "admin commercial offer setup has a distinct endpoint");
  includes(runtime, "configure_fuel_admin_branch_product_offer", "admin branch offer uses the full validated platform-only commercial RPC");
  includes(admin, '"/runtime/fuel/admin-pricing/branch-offer"', "admin UI uses the admin-only commercial route");
  includes(station, 'path: "/runtime/fuel/offers"', "station UI stays on the restricted station route");
  includes(station, "Station price per litre", "station edits its own supply/selling price");
  includes(station, "setOfferMaximumLitres", "station maintains its own litre limits");
  excludes(station, "platformFeeAmount:", "station does not submit or overwrite SKIMA's global fixed fee");
});

Deno.test("station tank setup, receipts and corrections have audited stock workflows", () => {
  includes(runtime, 'routePath === "/runtime/fuel/storage"', "Fuel tank configuration route exists");
  includes(runtime, 'routePath === "/runtime/fuel/storage/receive"', "Fuel stock receipt route exists");
  includes(runtime, 'routePath === "/runtime/fuel/storage/adjust"', "Fuel stock adjustment route exists");
  includes(station, 'path: "/runtime/fuel/storage"', "station can configure its tank");
  includes(station, 'path: "/runtime/fuel/storage/receive"', "station can record supplier receipts");
  includes(station, 'path: "/runtime/fuel/storage/adjust"', "station can reconcile physical stock");
  includes(station, "createStationTank", "station tank creation validates branch, product, capacity and reserve");
  includes(station, "recordStockReceipt", "station receipts require a positive quantity and receipt reference");
  includes(station, "recordStockAdjustment", "station adjustments require a signed quantity and explanation");
  includes(migration, "public.read_fuel_customer_stock_availability()", "customer availability is a separate safe read model");
  includes(migration, "does not currently have enough recorded fuel stock", "backend rejects a new order without sufficient recorded stock");
  includes(customer, 'path: "/runtime/fuel/customer-stock-availability"', "customer checkout reads recorded station stock");
  includes(customer, "requestedLitres > availableStockLitres", "customer checkout blocks orders above available tank stock");
});

Deno.test("Fuel resolves the LPG station profile ID to the canonical organization branch ID", () => {
  includes(migration, "public.read_fuel_station_branch_context(", "authorized station branch resolver exists");
  includes(migration, "public.can_read_lpg_station_inventory(target_station_profile_id)", "branch resolver preserves the existing station-inventory access check");
  includes(migration, "branch.id=station.branch_id", "branch resolver returns organization_branches.id rather than the LPG profile ID");
  includes(runtime, 'routePath === "/runtime/fuel/station-context"', "Fuel runtime exposes the station context resolver");
  includes(runtime, "read_fuel_station_branch_context", "runtime invokes the authorized database resolver");
  includes(station, 'path: `/runtime/fuel/station-context?stationProfileId=${encodeURIComponent(stationProfileId)}`', "station uses the LPG profile ID only as the resolver input");
  includes(station, 'firstString(resolvedStationContext, ["branch_id"])', "Fuel reads the canonical organization branch ID from the resolver");
  excludes(station, 'firstString(station, ["stationBranchId", "station_branch_id", "branchId", "branch_id"])', "Fuel does not use the LPG profile ID as an organization branch ID");
});

Deno.test("missing global fulfilment settings are not misrepresented as disabled", () => {
  includes(station, "globalModeControlsUnavailable", "station detects missing global control data");
  includes(station, "modeControls.error", "station checks the mode-control request error");
  includes(station, "No mode has been assumed disabled", "station distinguishes an unavailable control read from an admin decision");
  includes(station, '!globalKnown ? "Unavailable" : !globallyEnabled ? "Globally off"', "an unreturned control is not labelled Globally Off");
});
