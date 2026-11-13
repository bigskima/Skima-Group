import { assert, assertNotMatch, assertStringIncludes } from "jsr:@std/assert@1.0.18";

const migration = await Deno.readTextFile(
  "supabase/migrations/20261113100000_platform_profit_capital_allocation_and_location_defaults.sql",
);
const migrationPolicy = await Deno.readTextFile("supabase/migration-history-policy.json");
const executionMigration = await Deno.readTextFile(
  "supabase/migrations/20261113150000_platform_profit_capital_period_closing_scheduling_and_funding.sql",
);
const runtimeWorker = await Deno.readTextFile("supabase/functions/runtime-worker/index.ts");
const streetMap = await Deno.readTextFile("packages/mobile-experience/src/StreetMapPreview.tsx");
const refillLocations = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/LocationsScreen.tsx");
const stationLocations = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/StationLocationScreens.tsx");
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
  assertStringIncludes(template, "target_idempotency_key text");
  assertStringIncludes(template, "where idempotency_key = target_idempotency_key");
  assertStringIncludes(migration, "create unique index if not exists platform_profit_allocation_one_active_per_currency");
});

Deno.test("Profit participation is contractual and is bounded by each approved funding category", () => {
  assertStringIncludes(migration, "create table if not exists public.platform_profit_participants");
  assertStringIncludes(migration, "profit_share_percent numeric(9,6)");
  assertStringIncludes(migration, "Contractual profit-participation beneficiaries. This register does not issue legal company shares or confer voting rights.");
  const participant = migration.slice(
    migration.indexOf("create or replace function public.save_platform_profit_participant("),
    migration.indexOf("create or replace function public.save_platform_vehicle_capital_agreement("),
  );
  assertStringIncludes(participant, "existing_participant.id is not null");
  assertStringIncludes(participant, "where idempotency_key = target_idempotency_key");
  const agreement = migration.slice(
    migration.indexOf("create or replace function public.save_platform_vehicle_capital_agreement("),
    migration.indexOf("create or replace function public.create_platform_profit_distribution("),
  );
  assertStringIncludes(agreement, "existing_agreement.id is not null");
  assertStringIncludes(agreement, "where idempotency_key = target_idempotency_key");
  const distribution = migration.slice(
    migration.indexOf("create or replace function public.create_platform_profit_distribution("),
    migration.indexOf("create or replace function public.approve_platform_profit_distribution("),
  );
  assertStringIncludes(distribution, "round(target_distributable_profit * participant.profit_share_percent / 100, decimals)");
  assertStringIncludes(distribution, "nullif(btrim(target_notes), '') is null");
  assertStringIncludes(distribution, "Active profit participation percentages exceed 100%");
  assertStringIncludes(distribution, "Profit participation exceeds the available amount in its configured funding category");
  assertStringIncludes(distribution, "greatest(0, allocation.allocated_amount - allocation.committed_amount)");
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
  assertStringIncludes(payment, "platform_profit_capital_transaction_claims");
  assertStringIncludes(payment, "on conflict (financial_transaction_id) do nothing");
  assertStringIncludes(payment, "where financial_transaction_id = target_financial_transaction_id");
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
  assertStringIncludes(adminWorkspace, "pay_platform_profit_participant_entitlement_to_wallet");
  assertStringIncludes(adminWorkspace, "pay_platform_vehicle_capital_repayment_to_wallet");
  assertStringIncludes(adminWorkspace, "link_platform_profit_participant_profile");
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
  assertStringIncludes(storeScreen, "addressEditorOpen");
  assertStringIncludes(storeScreen, 'session.api.post("/lpg/maps/autocomplete"');
  assertStringIncludes(storeScreen, 'session.api.post("/lpg/maps/geocode"');
  assertStringIncludes(storeScreen, 'session.api.post("/lpg/locations"');
  assertStringIncludes(storeScreen, 'captureSource:"GEOCODED"');
  assertStringIncludes(storeScreen, "Set as my preferred saved address");
  assertStringIncludes(storeScreen, "addressSaveKey");
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


Deno.test("Period close uses posted SKIMA platform revenue and protects customer, supplier and escrow funds", () => {
  assertStringIncludes(executionMigration, "create table if not exists public.platform_profit_period_closings");
  assertStringIncludes(executionMigration, "generated always as");
  assertStringIncludes(executionMigration, "net_platform_revenue");
  assertStringIncludes(executionMigration, "operating_expenses");
  assertStringIncludes(executionMigration, "refund_chargeback_reserve");
  assertStringIncludes(executionMigration, "tax_and_statutory_reserve");
  assertStringIncludes(executionMigration, "other_reserves");
  assertStringIncludes(executionMigration, "wallet.wallet_type = 'platform_revenue'");
  assertStringIncludes(executionMigration, "transaction_record.status = 'posted'");
  assertStringIncludes(executionMigration, "excluded_customer_collections");
  assertStringIncludes(executionMigration, "excluded_supplier_pass_through");
  assertStringIncludes(executionMigration, "excluded_escrow_and_unsettled_funds");
  assertStringIncludes(executionMigration, "A different Finance Admin must approve the period close that you prepared");
});

Deno.test("Distribution creation requires an approved period close and recurring runs stay as drafts", () => {
  const fromClose = executionMigration.slice(
    executionMigration.indexOf("create or replace function public.create_platform_profit_distribution_from_close("),
    executionMigration.indexOf("create or replace function public.fund_platform_profit_distribution("),
  );
  assertStringIncludes(fromClose, "close_record.status <> 'approved'");
  assertStringIncludes(fromClose, "close_record.distributable_profit");
  assertStringIncludes(fromClose, "public.create_platform_profit_distribution(");
  assertStringIncludes(executionMigration, "revoke execute on function public.create_platform_profit_distribution(uuid,text,date,date,numeric,text,text)");
  const worker = executionMigration.slice(
    executionMigration.indexOf("create or replace function public.process_due_platform_profit_distribution_schedules("),
    executionMigration.indexOf("create or replace function public.require_funded_platform_profit_capital_payment()"),
  );
  assertStringIncludes(worker, "coalesce(auth.role(), '') <> 'service_role'");
  assertStringIncludes(worker, "public.create_platform_profit_distribution_from_close");
  assertStringIncludes(worker, "createdDrafts");
  assertStringIncludes(worker, "Waiting for Finance to approve the matching period close");
  assertStringIncludes(runtimeWorker, 'supabase.rpc("process_due_platform_profit_distribution_schedules"');
});

Deno.test("Funding and payouts move value using balanced posted ledger transfers", () => {
  const funding = executionMigration.slice(
    executionMigration.indexOf("create or replace function public.fund_platform_profit_distribution("),
    executionMigration.indexOf("create or replace function public.ensure_platform_profit_beneficiary_wallet("),
  );
  assertStringIncludes(funding, "wallet_type = 'platform_revenue'");
  assertStringIncludes(funding, "public.ensure_platform_profit_category_wallet");
  assertStringIncludes(funding, "public.post_financial_transaction(");
  assertStringIncludes(funding, "'direction', 'debit'");
  assertStringIncludes(funding, "'direction', 'credit'");
  assertStringIncludes(funding, "'platform_profit_distribution'");
  assertStringIncludes(funding, "execution_status = 'funded'");
  const profitPay = executionMigration.slice(
    executionMigration.indexOf("create or replace function public.pay_platform_profit_participant_entitlement_to_wallet("),
    executionMigration.indexOf("create or replace function public.pay_platform_vehicle_capital_repayment_to_wallet("),
  );
  assertStringIncludes(profitPay, "distribution.execution_status <> 'funded'");
  assertStringIncludes(profitPay, "public.post_financial_transaction(");
  assertStringIncludes(profitPay, "public.record_platform_profit_participant_payment(");
  const vehiclePay = executionMigration.slice(
    executionMigration.indexOf("create or replace function public.pay_platform_vehicle_capital_repayment_to_wallet("),
    executionMigration.indexOf("create or replace function public.read_platform_profit_capital_execution_workspace("),
  );
  assertStringIncludes(vehiclePay, "distribution.execution_status <> 'funded'");
  assertStringIncludes(vehiclePay, "'interestRatePercent', 0");
  assertStringIncludes(vehiclePay, "public.record_platform_vehicle_capital_repayment(");
  const payoutGuard = executionMigration.slice(
    executionMigration.indexOf("create or replace function public.require_funded_platform_profit_capital_payment()"),
    executionMigration.indexOf("drop trigger if exists platform_profit_participant_payment_requires_funding"),
  );
  assertStringIncludes(payoutGuard, "transaction_record.source <> 'platform.profit_capital.payout'");
  assertStringIncludes(payoutGuard, "transaction_record.subject_id <> expected_subject_id");
  assertStringIncludes(payoutGuard, "debit_entry.wallet_id = source_category_wallet_id");
  assertStringIncludes(payoutGuard, "beneficiary_wallet.owner_entity_id = target_profile_id");
  assertStringIncludes(executionMigration, "platform_profit_category_accounts");
});

Deno.test("Admin exposes close approval, recurring schedules, category funding and linked-wallet payouts", () => {
  assertStringIncludes(adminWorkspace, "read_platform_profit_capital_execution_workspace");
  assertStringIncludes(adminWorkspace, "save_platform_profit_period_close");
  assertStringIncludes(adminWorkspace, "approve_platform_profit_period_close");
  assertStringIncludes(adminWorkspace, "save_platform_profit_distribution_schedule");
  assertStringIncludes(runtimeWorker, "process_due_platform_profit_distribution_schedules");
  assertStringIncludes(adminWorkspace, "create_platform_profit_distribution_from_close");
  assertStringIncludes(adminWorkspace, "fund_platform_profit_distribution");
  assertStringIncludes(adminWorkspace, "pay_platform_profit_participant_entitlement_to_wallet");
  assertStringIncludes(adminWorkspace, "pay_platform_vehicle_capital_repayment_to_wallet");
  assertStringIncludes(adminWorkspace, "Linked SKIMA profile UUID");
  assertStringIncludes(adminWorkspace, "Fund six category wallets");
});

Deno.test("Street search retains full provider address while resolving an LGA parent separately", () => {
  assertStringIncludes(logisticsPicker, "const lgaCandidates");
  assertStringIncludes(logisticsPicker, "for (const candidate of lgaCandidates)");
  assertStringIncludes(logisticsPicker, "for (const candidate of localityCandidates)");
  assertStringIncludes(logisticsPicker, "const addressContextSearch");
  assertStringIncludes(logisticsPicker, "address-parent-geography");
  assertStringIncludes(logisticsPicker, "canonical_name: description");
  assertStringIncludes(logisticsPicker, "formatted_address:");
  assertStringIncludes(logisticsPicker, "street_line: streetLine || street || null");
  assertStringIncludes(logisticsPicker, "location: location");
  assertStringIncludes(logisticsPicker, "coordinates: place.location");
});

Deno.test("Keyless map preview renders OSM tiles in all customer address workflows", () => {
  assertStringIncludes(streetMap, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  assertStringIncludes(streetMap, '"User-Agent": "SKIMA-MobileMaps/1.0 (+https://skima.online)"');
  assertStringIncludes(streetMap, "© OpenStreetMap contributors");
  assertStringIncludes(streetMap, "cachePolicy=\"memory-disk\"");
  assertStringIncludes(logisticsPicker, 'import { StreetMapPreview } from "@skima/mobile-experience/StreetMapPreview"');
  assertStringIncludes(storeScreen, 'import { StreetMapPreview } from "@skima/mobile-experience/StreetMapPreview"');
  assertStringIncludes(refillLocations, "<StreetMapPreview");
  assertStringIncludes(stationLocations, "<StreetMapPreview");
  assertStringIncludes(storeScreen, "<StreetMapPreview");
});
