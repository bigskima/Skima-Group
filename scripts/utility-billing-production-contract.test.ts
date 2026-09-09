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
const utilityProviderRuntime = await Deno.readTextFile("supabase/functions/_shared/utility-provider-runtime.ts");
const flutterwaveAdapterInstall = await Deno.readTextFile("supabase/migrations/20260909030000_flutterwave_utility_adapter_installation.sql");
const fulfillmentRuntime = await Deno.readTextFile("supabase/migrations/20260909033000_utility_financial_fulfillment_runtime.sql");
const settlementAllocation = await Deno.readTextFile("supabase/migrations/20260909033500_utility_settlement_profit_allocation.sql");
const runtimeWorker = await Deno.readTextFile("supabase/functions/runtime-worker/index.ts");
const utilityArchitecture = await Deno.readTextFile("docs/utility-billing-architecture.md");

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

Deno.test("Flutterwave is an installed plugin, not a hardcoded utility route", () => {
  assertStringIncludes(flutterwaveAdapterInstall, "'provider.utility.flutterwave'");
  assertStringIncludes(flutterwaveAdapterInstall, "'adapterKind', 'flutterwave-bills-v3'");
  assertStringIncludes(flutterwaveAdapterInstall, "'runtimeReady', false");
  assertStringIncludes(flutterwaveAdapterInstall, "'SUPABASE_SECRET:FLUTTERWAVE_SECRET_KEY'");
  assertStringIncludes(utilityProviderRuntime, 'adapterKind === "flutterwave-bills-v3"');
  assertStringIncludes(utilityProviderRuntime, "resolveUtilityAdapter(context)");
  assertStringIncludes(utilityProviderRuntime, "providerKey");
  assertStringIncludes(utilityProviderRuntime, "utility_provider_adapter_not_installed");
});

Deno.test("utility provider credentials are Edge-secret-only", () => {
  assertStringIncludes(utilityProviderRuntime, "Deno.env.get(secretName)");
  assertStringIncludes(utilityProviderRuntime, "SUPABASE_SECRET:");
  assert(!utilityProviderRuntime.includes('rpc("read_server_secret"'));
  assert(!utilityProviderRuntime.includes("vault.decrypted_secrets"));
});

Deno.test("Flutterwave adapter implements full bills provider boundary", () => {
  assertStringIncludes(utilityProviderRuntime, "top-bill-categories");
  assertStringIncludes(utilityProviderRuntime, "/billers?country=");
  assertStringIncludes(utilityProviderRuntime, "/items");
  assertStringIncludes(utilityProviderRuntime, "/validate?code=");
  assertStringIncludes(utilityProviderRuntime, "/payment");
  assertStringIncludes(utilityProviderRuntime, "?verbose=1");
  assertStringIncludes(utilityProviderRuntime, "providerBillerCode");
  assertStringIncludes(utilityProviderRuntime, "providerItemCode");
});

Deno.test("admin can test providers and sync catalog after Edge secret setup", () => {
  assertStringIncludes(gateway, '"/admin/utility-billing/providers/test"');
  assertStringIncludes(gateway, '"/admin/utility-billing/catalog-sync/run"');
  assertStringIncludes(gateway, "testUtilityProviderConnection");
  assertStringIncludes(gateway, "syncUtilityProviderCatalog");
  assertStringIncludes(adminUtility, "Test API connection");
  assertStringIncludes(adminUtility, "Sync catalogue");
});

Deno.test("customer bill flow validates provider account details before creating request", () => {
  assertStringIncludes(gateway, '"/runtime/utility-billing/validate"');
  assertStringIncludes(gateway, "read_utility_customer_validation_context");
  assertStringIncludes(customerBills, "validateCustomer");
  assertStringIncludes(customerBills, "Check details");
  assertStringIncludes(customerBills, "Confirm payment");
  assertStringIncludes(customerBills, "Customer details confirmed");
});

Deno.test("utility customer money is reserved before provider fulfillment", () => {
  assertStringIncludes(fulfillmentRuntime, "reserve_utility_payment_request");
  assertStringIncludes(fulfillmentRuntime, "insufficient available wallet balance");
  assertStringIncludes(fulfillmentRuntime, "ensure_platform_clearing_wallet");
  assertStringIncludes(fulfillmentRuntime, "subsidized_campaign_cost_amount");
  assertStringIncludes(fulfillmentRuntime, "ensure_utility_campaign_funding_wallet");
  assertStringIncludes(fulfillmentRuntime, "'payment_reserved'");
  assertStringIncludes(gateway, "reserve_utility_payment_request");
  assertStringIncludes(gateway, "utility-reserve:");
  assertStringIncludes(customerBills, "reserved from your SKIMA Wallet");
  assert(!fulfillmentRuntime.includes("insert into public.wallet_ledger_entries"));
});

Deno.test("utility worker purchases once and reconciles ambiguous provider results", () => {
  assertStringIncludes(fulfillmentRuntime, "claim_utility_payment_requests");
  assertStringIncludes(fulfillmentRuntime, "for update skip locked");
  assertStringIncludes(fulfillmentRuntime, "next_reconcile_at");
  assertStringIncludes(runtimeWorker, "processUtilityPayments");
  assertStringIncludes(runtimeWorker, "purchaseUtilityService");
  assertStringIncludes(runtimeWorker, "readUtilityPurchaseStatus");
  assertStringIncludes(runtimeWorker, 'action === "purchase"');
  assertStringIncludes(runtimeWorker, 'action === "status"');
  assertStringIncludes(runtimeWorker, "mark_utility_payment_processing");
  assertStringIncludes(runtimeWorker, "finalize_utility_payment_request");
  assertStringIncludes(utilityArchitecture, "query provider status before any new purchase attempt");
});

Deno.test("utility success settles provider cashback cost reserve and protected contribution", () => {
  assertStringIncludes(settlementAllocation, "provider_cost");
  assertStringIncludes(settlementAllocation, "utility_cost_reserve");
  assertStringIncludes(settlementAllocation, "collectionCost");
  assertStringIncludes(settlementAllocation, "operatingReserve");
  assertStringIncludes(settlementAllocation, "protected_skima_contribution");
  assertStringIncludes(settlementAllocation, "expected_cashback_amount");
  assertStringIncludes(settlementAllocation, "status='credited'");
  assertStringIncludes(settlementAllocation, "minimum_profit_amount");
  assertStringIncludes(settlementAllocation, "protected SKIMA profit floor");
  assert(!settlementAllocation.includes("insert into public.wallet_ledger_entries"));
});

Deno.test("utility definitive failure returns customer and funded campaign reservation", () => {
  assertStringIncludes(fulfillmentRuntime, "target_provider_status not in ('succeeded','failed','reversed')");
  assertStringIncludes(fulfillmentRuntime, "'refundPart','customer'");
  assertStringIncludes(fulfillmentRuntime, "'refundPart','campaign_subsidy'");
  assertStringIncludes(fulfillmentRuntime, "'utility-refund:'");
});

Deno.test("provider runtime readiness requires explicit real-money vend success", () => {
  assertStringIncludes(utilityProviderRuntime, "runUtilityProviderLivePurchaseTest");
  assertStringIncludes(utilityProviderRuntime, "checkUtilityProviderLivePurchaseTest");
  assertStringIncludes(utilityProviderRuntime, 'runtimeReady = normalizedStatus === "succeeded"');
  assertStringIncludes(gateway, '"/admin/utility-billing/providers/live-test"');
  assertStringIncludes(gateway, "confirmLiveSpend");
  assertStringIncludes(gateway, "no more than 5000 NGN");
  assertStringIncludes(adminUtility, "Run a small real-money provider test");
  assertStringIncludes(adminUtility, "the provider's funded balance may be charged");
  assertStringIncludes(adminUtility, "Check live test status");
});

Deno.test("budget-funded utility campaigns use a real segregated funding pool", () => {
  assertStringIncludes(fulfillmentRuntime, "ensure_utility_campaign_funding_wallet");
  assertStringIncludes(fulfillmentRuntime, "fund_utility_campaign_pool");
  assertStringIncludes(fulfillmentRuntime, "SKIMA revenue balance is insufficient");
  assertStringIncludes(fulfillmentRuntime, "utility campaign funding pool is insufficient");
  assertStringIncludes(gateway, '"/admin/utility-billing/campaign-pool"');
  assertStringIncludes(gateway, '"/admin/utility-billing/campaign-pool/fund"');
  assertStringIncludes(adminUtility, "Funded campaign pool");
  assertStringIncludes(adminUtility, "already-earned SKIMA revenue");
});

Deno.test("post-success provider reversal is explicitly outside initial retry semantics", () => {
  assertStringIncludes(utilityArchitecture, "post-settlement reversal/clawback policy");
  assertStringIncludes(utilityArchitecture, "must not be emulated by retrying the original purchase");
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
