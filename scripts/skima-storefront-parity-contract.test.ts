const read = (path: string) => Deno.readTextFile(path);
function assertIncludes(source: string, value: string, label: string) {
  if (!source.includes(value)) throw new Error(`${label}: missing "${value}"`);
}
function assertNotIncludes(source: string, value: string, label: string) {
  if (source.includes(value)) throw new Error(`${label}: unexpected "${value}"`);
}

Deno.test("all four Store experiences share one detail sheet and storefront primitives", async () => {
  const paths = [
    "apps/store-mobile/src/screens/StoreShopScreen.tsx",
    "apps/lpg-mobile/app/(customer)/store.tsx",
    "apps/logistics-mobile/src/screens/LogisticsStoreScreen.tsx",
    "apps/bills-mobile/src/screens/BillsStoreScreen.tsx",
  ];
  for (const path of paths) {
    const source = await read(path);
    assertIncludes(source, "StorefrontDetailSheet", path);
    assertIncludes(source, "StorefrontHero", path);
    assertIncludes(source, "StorefrontProductCard", path);
    assertIncludes(source, "StorefrontBasketLine", path);
  }
});

Deno.test("shared detail sheet owns the same Back to Store navigation on every app", async () => {
  const source = await read("packages/mobile-experience/src/StorefrontParity.tsx");
  for (const component of [
    "StorefrontHero",
    "StorefrontProductCard",
    "StorefrontBasketLine",
    "StorefrontCategoryChip",
    "StorefrontDetailSheet",
  ]) assertIncludes(source, `export function ${component}`, "shared storefront module");
  assertIncludes(source, "Back to Store", "shared detail sheet");
  assertIncludes(source, "onRequestClose={onClose}", "shared detail sheet");
});

Deno.test("Store admin displays the order destination and warns before blind dispatch", async () => {
  const source = await read("apps/admin/src/features/store/StoreWorkspace.tsx");
  assertIncludes(source, "Delivery / pickup address", "Store admin order table");
  assertIncludes(source, "Delivery address missing", "Store admin missing-address warning");
  assertIncludes(source, "Pickup location missing", "Store admin missing-pickup warning");
  assertIncludes(source, "contactPhone", "Store admin order contact");
  assertIncludes(source, "deliveryInstructions", "Store admin order instructions");
});

Deno.test("LPG order read model and customer/station/driver workspaces expose order-specific contacts", async () => {
  const migration = await read("supabase/migrations/20261109102000_order_contact_and_storefront_read_models.sql");
  const customer = await read("apps/lpg-mobile/src/native/ui/CustomerOrdersScreen.tsx");
  const job = await read("apps/lpg-mobile/src/native/ui/JobDetailScreen.tsx");
  const internal = await read("apps/lpg-mobile/src/native/ui/InternalDriverJobDetailScreen.tsx");
  assertIncludes(migration, "'contactPhone', delivery.contact_phone", "LPG delivery-location read model");
  assertIncludes(migration, "'phone', station_driver.phone", "LPG station-driver phone read model");
  assertIncludes(customer, "Your contact phone", "LPG customer order detail");
  assertIncludes(job, "workspace === \"station\"", "LPG station order contacts");
  assertIncludes(job, "Call customer", "LPG driver/station contact action");
  assertIncludes(internal, "CUSTOMER CONTACT", "LPG internal driver job detail");
  assertIncludes(internal, "Call customer", "LPG internal driver contact action");
});

Deno.test("Fuel order contacts are permission checked and returned to customer, driver and station branch lists", async () => {
  const migration = await read("supabase/migrations/20261109102000_order_contact_and_storefront_read_models.sql");
  const runtime = await read("supabase/functions/fuel-runtime/index.ts");
  const customer = await read("apps/lpg-mobile/src/native/ui/FuelOrderDetailsScreen.tsx");
  const driver = await read("apps/lpg-mobile/src/native/ui/FuelDriverJobsScreen.tsx");
  const station = await read("apps/lpg-mobile/src/native/ui/FuelStationOperationsScreen.tsx");
  const fuelAdmin = await read("apps/admin/src/features/services/FuelAdminWorkspace.tsx");
  assertIncludes(migration, "public.can_read_fuel_order(target_order_id)", "Fuel contact read permission");
  assertIncludes(migration, "assignment.status = 'active'", "Fuel assigned-driver access check");
  assertIncludes(runtime, "scope === \"driver\"", "Fuel driver order scope");
  assertIncludes(runtime, "SUPABASE_SERVICE_ROLE_KEY", "Fuel driver assignment lookup service client");
  assertIncludes(runtime, "query.in(\"order_id\", driverOrderIds)", "Fuel driver operations restricted to active assigned order IDs");
  assertIncludes(runtime, "branchId || stage || scope === \"customer\"", "Fuel station branch contact enrichment");
  assertIncludes(runtime, "read_fuel_order_contact_details", "Fuel runtime contact read model");
  assertIncludes(customer, "Contact and delivery details", "Fuel customer order detail");
  assertIncludes(driver, "Customer delivery address", "Fuel driver order detail");
  assertIncludes(driver, "Call customer", "Fuel driver contact action");
  assertIncludes(station, "CUSTOMER DELIVERY DETAILS", "Fuel station selected order contact");
  assertIncludes(station, "Delivery address not recorded", "Fuel station missing-address state");
  assertIncludes(station, "Call customer", "Fuel station customer contact action");
  assertIncludes(fuelAdmin, "Deliver to: {customerAddress}", "Fuel admin dispatch customer address");
  assertIncludes(fuelAdmin, "Customer: {customerName}", "Fuel admin dispatch contact name and phone");
});

Deno.test("LPG and Logistics Store card JSX has no stale closing wrapper from the shared-card conversion", async () => {
  const lpg = await read("apps/lpg-mobile/app/(customer)/store.tsx");
  const logistics = await read("apps/logistics-mobile/src/screens/LogisticsStoreScreen.tsx");
  assertNotIncludes(lpg, ");                    </Pressable>", "LPG Store product card");
  assertNotIncludes(logistics, ");                    </View>", "Logistics Store product card");
});
