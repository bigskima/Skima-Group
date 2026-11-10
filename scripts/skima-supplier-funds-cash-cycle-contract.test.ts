const migration = await Deno.readTextFile(
  "supabase/migrations/20261110193000_skima_managed_supplier_funds_cash_cycle.sql",
);
const lpgSettlement = await Deno.readTextFile(
  "supabase/migrations/20260916165126_lpg_internal_dispatch_and_settlement_runtime.sql",
);
const lpgSupplierPayments = await Deno.readTextFile(
  "supabase/migrations/20261101162500_platform_financial_analytics_and_fleet_supplier_payments.sql",
);
const workspace = await Deno.readTextFile("apps/admin/src/admin-financial-analytics-workspace.tsx");

function includes(source: string, fragment: string, message: string): void {
  if (!source.includes(fragment)) throw new Error(`${message}: missing "${fragment}"`);
}
function excludes(source: string, fragment: string, message: string): void {
  if (source.includes(fragment)) throw new Error(`${message}: unexpected "${fragment}"`);
}

Deno.test("supplier fund and cash float accounts remain separate from platform revenue", () => {
  includes(migration, "lpg_fleet_operating_funds", "existing LPG procurement fund remains the LPG supplier fund");
  includes(migration, "lpg_supplier_cash_on_hand", "LPG has a separate physical cash float");
  includes(migration, "fuel_supplier_funds", "Fuel has a dedicated supplier fund");
  includes(migration, "fuel_supplier_cash_on_hand", "Fuel has a separate physical cash float");
  includes(migration, "wallet_type_value:=case when target_account_kind='supplier_disbursements' then 'platform' else 'platform_clearing' end", "supplier fund and cash accounts are operating/clearing accounts, not revenue wallets");
  includes(migration, "'withdrawal_allowed',false", "supplier funds cannot be treated as user-withdrawable earnings");
  includes(workspace, "Supplier Fund · not revenue", "Finance UI identifies supplier principal as non-revenue");
  includes(workspace, "Cash On Hand · ready for station", "Finance UI distinguishes the physical float");
});

Deno.test("supplier cash movement records are immutable, audited and inaccessible through direct authenticated table access", () => {
  includes(migration, "create table if not exists public.platform_supplier_cash_movements", "cash movement history exists");
  includes(migration, "movement_type in ('cash_withdrawal','station_cash_payment')", "only the two cash-cycle movements are recognized");
  includes(migration, "alter table public.platform_supplier_cash_movements enable row level security", "cash movement table enables RLS");
  includes(migration, "revoke all on table public.platform_supplier_cash_movements from public,anon,authenticated", "direct API access to cash movements is revoked");
  includes(migration, "using(false) with check(false)", "authenticated direct table policy is deny-all");
  includes(migration, "execute function public.record_table_audit()", "cash movements are audited");
  includes(migration, "unique(module_key,idempotency_key)", "movement posting is idempotent per app");
});

Deno.test("LPG customer procurement settlement credits the supplier fund, not shared clearing or revenue", () => {
  includes(lpgSettlement, "'role','internal_lpg_cost_recovery'", "legacy LPG settlement identifies the procurement principal");
  includes(migration, "public.ensure_skima_supplier_wallet(\n    'lpg',order_record.currency_code,'supplier_fund'\n  )", "LPG procurement principal moves to its dedicated supplier fund");
  includes(migration, "public.record_platform_supplier_cash_withdrawal", "LPG cash withdrawals have a separate Finance operation");
  includes(migration, "public.record_platform_legacy_lpg_fund_reclassification", "old LPG supplier funds can be reclassified only through an explicit Finance operation");
  includes(migration, "reclassifiable_amount", "legacy reclassification is capped by supplier allocations and actual clearing balance");
  includes(migration, "legacy_lpg_supplier_fund_reclassified", "legacy reclassification is traceable in the ledger");
  includes(workspace, "Legacy LPG supplier funds · reconciliation before use", "legacy supplier pool is visible in Finance");
  includes(workspace, "Reclassify verified legacy funds", "legacy pool reclassification requires an explicit Finance action");
  includes(workspace, "unreconciledDifference", "legacy pool shows any clearing mismatch");

  includes(migration, "public.ensure_skima_supplier_wallet(\n    'lpg',order_record.currency_code,'cash_on_hand'\n  )", "LPG station payment uses physical cash on hand");
  const patchStart = migration.indexOf("-- Preserve the LPG supplier-payment record");
  const lpgPaymentStart = migration.indexOf("do $patch$", patchStart);
  const lpgPaymentEnd = migration.indexOf("-- Fuel cash movements", lpgPaymentStart);
  const lpgPatch = migration.slice(lpgPaymentStart, lpgPaymentEnd);
  includes(lpgPatch, "cash_wallet_id", "LPG payment uses the dedicated cash wallet");
  includes(lpgPatch, "wallet.id=cash_wallet_id", "available cash balance is checked");
  includes(lpgPatch, "'role','skima_lpg_cash_paid_to_supplier'", "LPG payment debit is identified as cash paid");
  includes(lpgPatch, "target_payment_method<>'cash'", "new LPG supplier payments must be cash");
  includes(lpgSupplierPayments, "existing_payment", "historical supplier-payment records remain idempotently replayable");
  includes(lpgSupplierPayments, "public.record_lpg_internal_supplier_payment", "legacy supplier payment record remains the accounting source");
});

Deno.test("cash withdrawal moves value from Supplier Fund to Cash On Hand and cannot overdraw", () => {
  includes(migration, "public.record_platform_supplier_cash_withdrawal", "cash withdrawal RPC exists");
  includes(migration, "public.ensure_skima_supplier_wallet(target_module_key,currency_value,'supplier_fund')", "withdrawal debits the app-specific Supplier Fund");
  includes(migration, "public.ensure_skima_supplier_wallet(target_module_key,currency_value,'cash_on_hand')", "withdrawal credits the app-specific physical cash float");
  includes(migration, "if not found or available_balance<round(target_amount,2) then", "insufficient Supplier Fund withdrawals are rejected");
  includes(migration, "'role','supplier_fund_cash_withdrawal'", "Supplier Fund debit is recorded");
  includes(migration, "'role','supplier_cash_on_hand_funding'", "Cash On Hand credit is recorded");
  includes(migration, "withdrawal_reference", "the actual bank withdrawal/teller reference is retained");
  includes(migration, "idempotency key was reused with different details", "a reused withdrawal idempotency key cannot alter an existing movement");
});

Deno.test("only completed and settled SKIMA Managed Fuel orders can consume the Fuel cash float", () => {
  includes(migration, "public.record_fuel_supplier_cash_payment", "Fuel station cash payment RPC exists");
  includes(migration, "operation.fulfillment_mode<>'skima_managed'", "Station Managed and Independent Driver are excluded");
  includes(migration, "operation.stage_key<>'completed'", "Fuel must be completed");
  includes(migration, "operation.settled_at is null", "Fuel customer settlement must be posted");
  includes(migration, "hold.status not in ('held','partially_released','released')", "payment must trace to a customer-funded escrow hold");
  includes(migration, "quote.component_snapshot->>'station_supply_amount'", "station payment uses supplier price, not SKIMA retail price");
  includes(migration, "round(target_amount,2)>remaining_amount", "partial payments cannot exceed outstanding supplier principal");
  includes(migration, "public.ensure_skima_supplier_wallet('fuel',order_record.currency_code,'cash_on_hand')", "Fuel station payment draws from Fuel cash on hand");
  includes(migration, "if not found or available_balance<round(target_amount,2) then", "Fuel station payment cannot overdraw the cash float");
  includes(migration, "'role','skima_fuel_cash_paid_to_station'", "Fuel cash payment is an operating disbursement");
  includes(migration, "operation.stage_key='completed'", "the Finance read model only displays settled, funded Fuel payables");
});

Deno.test("SKIMA Managed Fuel settlement credits Supplier Fund while other modes retain station settlement", () => {
  includes(migration, "if operation_record.fulfillment_mode='skima_managed' then", "Fuel settlement branches on fulfillment mode");
  includes(migration, "supplier_funds_wallet_id:=public.ensure_skima_supplier_wallet", "SKIMA Managed settlement initializes the Fuel Supplier Fund");
  includes(migration, "'role','fuel_supplier_fund'", "station supply principal is credited to the Fuel Supplier Fund");
  includes(migration, "if operation_record.fulfillment_mode<>'skima_managed' then", "ordinary station settlement statements remain for non-SKIMA modes");
  includes(migration, "station_wallet_id := public.ensure_wallet_account", "Station Managed and Independent Driver keep the existing station wallet route");
  includes(migration, "'supplier_fund_amount'", "settlement exposes the managed supplier liability separately from station payout");
  includes(migration, "v_settlement_statement_id:=null", "SKIMA Managed supplier principal is not misreported as a station settlement statement");
});

Deno.test("Finance workspace exposes the withdrawal and physical station cash cycle for LPG and Fuel", () => {
  includes(workspace, "read_platform_supplier_funds_workspace", "Finance reads balances from the supplier-funds RPC");
  includes(workspace, "record_platform_supplier_cash_withdrawal", "Finance can record a cash withdrawal");
  includes(workspace, "record_fuel_supplier_cash_payment", "Finance can record a Fuel station cash payment");
  includes(workspace, "Record cash withdrawal to Cash On Hand", "cash withdrawal is a distinct Finance action");
  includes(workspace, "Record Fuel station cash payment", "Fuel payment is a distinct Finance action");
  includes(workspace, "Record a physical cash payment SKIMA has already made to the LPG supplier", "LPG station cash payment help text reflects the real process");
  includes(workspace, "Fuel supplier payables", "Finance can reconcile Fuel supplier amounts by order");
  includes(workspace, "Supplier fund withdrawals and station cash payments", "cash movement history is visible to Finance");
  includes(workspace, "media.fuel.supplier_payment_evidence", "Fuel supplier cash receipts are registered as private media evidence");
  includes(workspace, "Upload Fuel payment evidence", "Finance can upload signed Fuel station payment evidence");
  includes(workspace, "target_evidence_media_asset_id: fuelEvidenceMediaAssetId", "Fuel cash payment attaches its uploaded evidence asset");

  includes(workspace, "value=\"cash\"", "LPG station payment is cash-only");
});
