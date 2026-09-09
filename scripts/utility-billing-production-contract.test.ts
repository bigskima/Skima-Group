import { assert, assertStringIncludes } from "jsr:@std/assert@1.0.18";

const migration = await Deno.readTextFile("supabase/migrations/20260906072000_utility_rewards_and_safe_admin_directory.sql");
const providerRuntime = await Deno.readTextFile("supabase/migrations/20260909013500_utility_provider_onboarding_runtime.sql");
const profitRuntime = await Deno.readTextFile("supabase/migrations/20260909022000_utility_margin_safe_campaigns_and_catalog_sync.sql");
const profitGuards = await Deno.readTextFile("supabase/migrations/20260909022500_utility_profit_guards_and_catalog_availability.sql");
const gateway = await Deno.readTextFile("supabase/functions/api-gateway/index.ts");
const adminUtility = await Deno.readTextFile("apps/admin/src/admin-utility-billing-workspace.tsx");
const stationLayout = await Deno.readTextFile("apps/lpg-mobile/app/(station)/_layout.tsx");
const dashboard = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/PremiumDashboard.tsx");
const guide = await Deno.readTextFile("apps/admin/src/admin-utility-provider-guide.tsx");
const customerBills = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/UtilityBillsScreen.tsx");

Deno.test("cashback is prepared from policy and only earned after confirmed success", () => {
  assertStringIncludes(migration, "create table if not exists public.utility_reward_policies");
  assertStringIncludes(migration, "new.status='succeeded'");
  assertStringIncludes(migration, "status='earned'");
  assertStringIncludes(migration, "status='cancelled'");
  assert(!migration.includes("insert into public.wallet_ledger_entries"));
});

Deno.test("admin provider directory never exposes provider credentials", () => {
  const safeDirectory = migration.slice(migration.indexOf("'providers'"));
  assert(!safeDirectory.includes("secret_ref"));
  assert(!safeDirectory.includes("row_to_json(item) from public.provider_adapters"));
});

Deno.test("utility provider kinds survive cross-domain provider constraint upgrades", () => {
  assertStringIncludes(providerRuntime, "'inventory'");
  assertStringIncludes(providerRuntime, "'utility'");
  assertStringIncludes(providerRuntime, "'verification'");
  assertStringIncludes(providerRuntime, "configure_utility_provider_adapter");
  assertStringIncludes(providerRuntime, "SUPABASE_SECRET:[A-Z][A-Z0-9_]");
});

Deno.test("admin can create utility providers without storing API key values", () => {
  assertStringIncludes(adminUtility, 'key: "provider"');
  assertStringIncludes(adminUtility, "Add a bill-payment provider");
  assertStringIncludes(adminUtility, "Edge secret name");
  assertStringIncludes(adminUtility, "SUPABASE_SECRET:");
  assertStringIncludes(adminUtility, 'kind: "provider"');
  assertStringIncludes(gateway, 'kind === "provider"');
  assertStringIncludes(gateway, "configure_utility_provider_adapter");
  assertStringIncludes(gateway, '"utility"');
});

Deno.test("customer routes cannot go live before provider fulfillment is ready", () => {
  assertStringIncludes(providerRuntime, "runtimeReady");
  assertStringIncludes(providerRuntime, "this provider has no live SKIMA fulfillment adapter yet");
  assertStringIncludes(adminUtility, "Not ready for customer traffic");
  assertStringIncludes(adminUtility, "providerReady");
});

Deno.test("utility provider integration stays generic and catalog sync is canonical", () => {
  assertStringIncludes(profitRuntime, "utility_provider_catalog_sync_runs");
  assertStringIncludes(profitRuntime, "utility_provider_catalog_items");
  assertStringIncludes(profitRuntime, "begin_utility_provider_catalog_sync");
  assertStringIncludes(profitRuntime, "stage_utility_provider_catalog_items");
  assertStringIncludes(profitRuntime, "publish_utility_provider_catalog_sync");
  assertStringIncludes(profitRuntime, "canonical_key");
  assertStringIncludes(profitRuntime, "provider_product_code");
  assert(!profitRuntime.includes("provider.utility.vtpass"));
  assert(!profitRuntime.includes("provider.utility.reloadly"));
  assert(!profitRuntime.includes("provider.utility.flutterwave"));
});

Deno.test("route economics protects SKIMA contribution before customer activation", () => {
  assertStringIncludes(profitRuntime, "utility_route_economics");
  assertStringIncludes(profitRuntime, "provider_discount_percent");
  assertStringIncludes(profitRuntime, "collection_cost_percent");
  assertStringIncludes(profitRuntime, "operating_reserve_percent");
  assertStringIncludes(profitRuntime, "minimum_profit_percent");
  assertStringIncludes(profitRuntime, "customer_fee_percent");
  assertStringIncludes(profitRuntime, "calculate_utility_route_economics");
  assertStringIncludes(profitGuards, "guard_utility_route_activation");
  assertStringIncludes(profitGuards, "protected SKIMA profit floor");
});

Deno.test("cashback and discount campaigns cannot silently consume protected margin", () => {
  assertStringIncludes(profitRuntime, "funding_mode");
  assertStringIncludes(profitRuntime, "'margin','marketing_budget','sponsor'");
  assertStringIncludes(profitRuntime, "preview_utility_campaign_profit");
  assertStringIncludes(profitRuntime, "configure_utility_campaign");
  assertStringIncludes(profitRuntime, "budget_reserved");
  assertStringIncludes(profitRuntime, "budget_spent");
  assertStringIncludes(profitRuntime, "margin_campaign_cost_amount");
  assertStringIncludes(profitRuntime, "subsidized_campaign_cost_amount");
  assertStringIncludes(profitRuntime, "expected_cashback_amount");
  assertStringIncludes(profitRuntime, "this campaign cannot be applied because it would reduce the protected SKIMA profit");
  assertStringIncludes(profitGuards, "guard_utility_promotion_activation");
  assertStringIncludes(profitGuards, "guard_utility_cashback_activation");
});

Deno.test("utility admin exposes catalog economics routing and profit-safe campaigns", () => {
  assertStringIncludes(adminUtility, 'key: "catalog"');
  assertStringIncludes(adminUtility, 'key: "economics"');
  assertStringIncludes(adminUtility, 'key: "campaign"');
  assertStringIncludes(adminUtility, "Provider catalogue sync");
  assertStringIncludes(adminUtility, "Set route economics");
  assertStringIncludes(adminUtility, "Create a profit-safe campaign");
  assertStringIncludes(adminUtility, "Maximum ordinary campaign spend");
  assertStringIncludes(gateway, '"/admin/utility-billing/economics"');
  assertStringIncludes(gateway, '"/admin/utility-billing/campaign-preview"');
  assertStringIncludes(gateway, '"/admin/utility-billing/catalog-sync/publish"');
});

Deno.test("customer home exposes bills while station location screens stay off the tab bar", () => {
  assertStringIncludes(dashboard, "CustomerServiceCards");
  assertStringIncludes(dashboard, 'router.push("/(customer)/bills")');
  assertStringIncludes(stationLayout, '"locations"');
  assertStringIncludes(stationLayout, '"location-editor"');
});

Deno.test("admin includes provider access guidance from official provider sites", () => {
  assertStringIncludes(guide, "https://www.vtpass.com/documentation/");
  assertStringIncludes(guide, "https://developers.reloadly.com/airtime/docs");
  assertStringIncludes(guide, "test credentials");
});

Deno.test("customer bill UI stays compact and validates configured amount limits", () => {
  assertStringIncludes(customerBills, "horizontal");
  assertStringIncludes(customerBills, "showAllProducts");
  assertStringIncludes(customerBills, '["minimum_amount", "minimumAmount"]');
  assertStringIncludes(customerBills, '["maximum_amount", "maximumAmount"]');
  assertStringIncludes(customerBills, "insufficientBalance");
  assertStringIncludes(customerBills, "amountRangeLabel");
});
