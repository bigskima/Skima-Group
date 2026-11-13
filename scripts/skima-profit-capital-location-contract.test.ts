import { assert, assertNotMatch, assertStringIncludes } from "jsr:@std/assert@1.0.18";

const migration = await Deno.readTextFile(
  "supabase/migrations/20261113100000_platform_profit_capital_allocation_and_location_defaults.sql",
);
const migrationPolicy = await Deno.readTextFile("supabase/migration-history-policy.json");
const gateway = await Deno.readTextFile("supabase/functions/api-gateway/index.ts");
const adminWorkspace = await Deno.readTextFile("apps/admin/src/admin-profit-capital-workspace.tsx");
const moneyRouter = await Deno.readTextFile("apps/admin/src/features/money/MoneyWorkspaceRouter.tsx");
const moneyNavigation = await Deno.readTextFile("apps/admin/src/app/admin-v2-navigation.ts");
const savedLocations = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/SavedLocationsScreen.tsx");
const refillOrder = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/NewRefillScreen.tsx");
const logisticsPicker = await Deno.readTextFile("apps/logistics-mobile/src/ui/GeographyPicker.tsx");
const logisticsRequest = await Deno.readTextFile("apps/logistics-mobile/src/screens/LogisticsRequestScreen.tsx");
const storeScreen = await Deno.readTextFile("apps/store-mobile/src/screens/StoreShopScreen.tsx");
const logisticsStoreScreen = await Deno.readTextFile("apps/logistics-mobile/src/screens/LogisticsStoreScreen.tsx");

Deno.test("Profit allocation templates require all six configured buckets to total exactly 100 percent", () => {
  const template = migration.slice(
    migration.indexOf("create or replace function public.save_platform_profit_allocation_template("),
    migration.indexOf("create or replace function public.activate_platform_profit_allocation_template("),
  );
  assert(template.length > 0, "Template-save RPC must exist");
  for (const category of [
    "platform_expenses",
    "vehicle_repayment",
    "skima_savings",
    "daily_expenses",
    "staff_payment",
    "investment_savings",
  ]) {
    assertStringIncludes(template, "'" + category + "'");
  }
  assertStringIncludes(template, "row_count <> 6 or total_percent <> 100");
  assertStringIncludes(template, "Each allocation category can appear only once");
  assertStringIncludes(migration, "create unique index if not exists platform_profit_allocation_one_active_per_currency");
});

Deno.test("Profit participation is contractual and is bounded by each approved funding category", () => {
  assertStringIncludes(migration, "create table if not exists public.platform_profit_participants");
  assertStringIncludes(migration, "profit_share_percent numeric(9,6)");
  assertStringIncludes(migration, "Contractual profit-participation beneficiaries. This register does not issue legal company shares or confer voting rights.");
  const distribution = migration.slice(
    migration.indexOf("create or replace function public.create_platform_profit_distribution("),
    migration.indexOf("create or replace function public.approve_platform_profit_distribution("),
  );
  assertStringIncludes(distribution, "round(target_distributable_profit * participant.profit_share_percent / 100, decimals)");
  assertStringIncludes(distribution, "Active profit participation percentages exceed 100%");
  assertStringIncludes(distribution, "Profit participation exceeds the available amount in its configured funding category");
});

Deno.test("Vehicle capital agreements carry zero interest and repayment cannot exceed unpaid principal", () => {
  assertStringIncludes(migration, "interest_rate_percent numeric(7,4) not null default 0 check (interest_rate_percent = 0)");
  assertStringIncludes(migration, "principal_repaid numeric(28,8) not null default 0");
  assertStringIncludes(migration, "check (principal_repaid <= principal_amount)");
  const projection = migration.slice(
    migration.indexOf("with eligible_agreements as ("),
    migration.indexOf("update public.platform_profit_distribution_allocations allocation", migration.indexOf("with eligible_agreements as (")),
  );
  assertStringIncludes(projection, "trunc(");
  assertStringIncludes(projection, "projected_repayments as");
  assertStringIncludes(projection, "where projected.repayment_amount > 0");
  const repaymentFilter = projection.slice(projection.indexOf("where projected.repayment_amount > 0"));
  assertNotMatch(repaymentFilter, /over\s*\(/i, "Window functions must be projected before filtering");
  const payment = migration.slice(
    migration.indexOf("create or replace function public.record_platform_vehicle_capital_repayment("),
    migration.indexOf("revoke all on function public.read_platform_profit_capital_workspace"),
  );
  assertStringIncludes(payment, "transaction_record.status <> 'posted'");
  assertStringIncludes(payment, "transaction_record.currency_code <> distribution.currency_code");
  assertStringIncludes(payment, "transaction_record.total_amount <> target_amount");
  assertStringIncludes(payment, "target_amount > agreement.principal_amount - agreement.principal_repaid");
  assertStringIncludes(payment, "status = case when new_repaid >= principal_amount then 'fully_repaid' else status end");
  assertStringIncludes(payment, "remainingPrincipal");
});

Deno.test("Profit and capital database operations are permission-gated and read through the Admin Money workspace", () => {
  assertStringIncludes(migration, "'platform.profit_capital.read'");
  assertStringIncludes(migration, "'platform.profit_capital.manage'");
  assertStringIncludes(migration, "enable row level security");
  assertStringIncludes(migration, "public.has_permission('platform.profit_capital.manage', null)");
  assertStringIncludes(migration, "public.read_platform_profit_capital_workspace");
  assertStringIncludes(adminWorkspace, "read_platform_profit_capital_workspace");
  assertStringIncludes(adminWorkspace, "save_platform_profit_allocation_template");
  assertStringIncludes(adminWorkspace, "save_platform_profit_participant");
  assertStringIncludes(adminWorkspace, "save_platform_vehicle_capital_agreement");
  assertStringIncludes(adminWorkspace, "create_platform_profit_distribution");
  assertStringIncludes(adminWorkspace, "record_platform_profit_participant_payment");
  assertStringIncludes(adminWorkspace, "record_platform_vehicle_capital_repayment");
  assertStringIncludes(moneyRouter, 'props.route === "/money/profit-capital"');
  assertStringIncludes(moneyNavigation, 'href: "/money/profit-capital"');
});

Deno.test("Saved customer locations expose one persistent preferred address across Refill and Store", () => {
  assertStringIncludes(migration, "add column if not exists is_default boolean not null default false");
  assertStringIncludes(migration, "lpg_customer_locations_one_default_per_owner");
  assertStringIncludes(migration, "public.set_lpg_customer_location_default");
  assertStringIncludes(migration, "where id = target_location_id");
  assertStringIncludes(gateway, "provider_place_id,metadata,created_at,updated_at");
  const getLocationProjection = gateway.slice(
    gateway.indexOf('if (routePath === "/lpg/locations")'),
    gateway.indexOf('if (routePath === "/lpg/cylinders")'),
  );
  assertStringIncludes(getLocationProjection, "is_default");
  assertStringIncludes(savedLocations, "set_lpg_customer_location_default");
  assertStringIncludes(savedLocations, "Set preferred");
  assertStringIncludes(refillOrder, "location.is_default === true");
  assertStringIncludes(storeScreen, "l.is_default===true");
  assertStringIncludes(logisticsStoreScreen, "location.is_default===true");
});

Deno.test("Logistics manual address entry geocodes street text and keeps coordinates in the booking snapshot", () => {
  assertStringIncludes(logisticsPicker, 'api.post(\n        "/lpg/maps/geocode"');
  assertStringIncludes(logisticsPicker, "address: lookupText");
  assertStringIncludes(logisticsPicker, "address_components: resolved.addressComponents");
  assertStringIncludes(logisticsPicker, "location: resolved.location");
  assertStringIncludes(logisticsRequest, "coordinates: place.location");
  assertStringIncludes(logisticsRequest, "Your saved addresses");
  assertStringIncludes(logisticsRequest, "Use as pickup");
  assertStringIncludes(logisticsRequest, "Use as destination");
  assertStringIncludes(gateway, 'if (routePath === "/lpg/maps/geocode" && request.method === "POST")');
  assertStringIncludes(gateway, "async function handleMapsGeocodeRequest");
});

Deno.test("The migration is registered for repository migration-history verification", () => {
  assertStringIncludes(migrationPolicy, "20261113100000_platform_profit_capital_allocation_and_location_defaults.sql");
});
