import { assert, assertStringIncludes, assertNotMatch } from "jsr:@std/assert@1.0.18";

const migration = await Deno.readTextFile("supabase/migrations/20261101162500_platform_financial_analytics_and_fleet_supplier_payments.sql");
const workspace = await Deno.readTextFile("apps/admin/src/admin-financial-analytics-workspace.tsx");
const router = await Deno.readTextFile("apps/admin/src/features/money/MoneyWorkspaceRouter.tsx");
const navigation = await Deno.readTextFile("apps/admin/src/app/admin-v2-navigation.ts");
const migrationPolicy = await Deno.readTextFile("supabase/migration-history-policy.json");

Deno.test("Fleet supplier disbursements are separate from customer settlement", () => {
  assertStringIncludes(migration, "create table if not exists public.lpg_internal_supplier_payments");
  assertStringIncludes(migration, "'cash','bank_transfer'");
  assertStringIncludes(migration, "public.record_lpg_internal_supplier_payment");
  assertStringIncludes(migration, "public.post_financial_transaction");
  assertStringIncludes(migration, "'lpg.internal_supplier_payment'");
  assertStringIncludes(migration, "'skima_fleet_funds_disbursed_to_supplier'");
  assertStringIncludes(migration, "'skima_fleet_supplier_disbursement'");
  assertStringIncludes(migration, "wallet_type='platform_clearing'");
  assertStringIncludes(migration, "wallet_type='platform_supplier'");
  assertStringIncludes(migration, "platform financial management permission is required");
  assertStringIncludes(migration, "bank transfer reference is required");
  assertStringIncludes(migration, "existing_payment.paid_at is distinct from coalesce(target_paid_at,timezone('utc',now()))");
  assertStringIncludes(migration, "existing_payment.note is distinct from nullif(btrim(coalesce(target_note,'')),'')");
  assertStringIncludes(migration, "payment exceeds the remaining supplier balance");
});

Deno.test("Supplier payment posting cannot credit a station wallet or a driver wallet", () => {
  const start = migration.indexOf("create or replace function public.record_lpg_internal_supplier_payment");
  const end = migration.indexOf("$function$;", start);
  assert(start >= 0 && end > start, "Supplier payment RPC must be present");
  const supplierPosting = migration.slice(start, end);
  assertStringIncludes(supplierPosting, "'platform_supplier'");
  assertStringIncludes(supplierPosting, "'platform_clearing'");
  assertNotMatch(supplierPosting, /wallet_type\s*=\s*'partner'/);
  assertNotMatch(supplierPosting, /wallet_type\s*=\s*'driver'/);
});

Deno.test("Financial analytics keeps Finance and Revenue permission boundaries separate", () => {
  assertStringIncludes(migration, "can_read_finance:=auth.role()='service_role'");
  assertStringIncludes(migration, "can_read_revenue:=auth.role()='service_role'");
  assertStringIncludes(migration, "'fleet',case when can_read_finance then jsonb_build_object(");
  assertStringIncludes(migration, "'walletBalances',case when can_read_finance then coalesce((");
  assertStringIncludes(migration, "'recentLedgerEntries',case when can_read_finance then coalesce((");
  assertStringIncludes(migration, "case when can_read_revenue then revenue_summary else null end");
});

Deno.test("Fleet analytics separates customer collection, procurement, explicit markup and procurement spread", () => {
  assertStringIncludes(migration, "'customerCollections'");
  assertStringIncludes(migration, "'customerLpgPrincipal'");
  assertStringIncludes(migration, "'procurementCost'");
  assertStringIncludes(migration, "'procurementSpread'");
  assertStringIncludes(migration, "'platformMarkupCollected'");
  assertStringIncludes(migration, "'supplierPaid'");
  assertStringIncludes(migration, "'supplierOutstanding'");
  assertStringIncludes(migration, "'driverPaidToWallet'");
  assertStringIncludes(migration, "'driverUnpaidEarnings'");
  assertStringIncludes(migration, "'driverPayouts'");
  assertStringIncludes(migration, "'earningRecords'");
});

Deno.test("Admin analytics distinguishes supplier cash or bank payments and Driver wallet payouts", () => {
  assertStringIncludes(workspace, "The customer payment is held in SKIMA-controlled escrow");
  assertStringIncludes(workspace, "How SKIMA paid the station");
  assertStringIncludes(workspace, "Bank transfer reference (required)");
  assertStringIncludes(workspace, "Actual supplier payment date and time");
  assertStringIncludes(workspace, "Paid into Driver Wallets");
  assertStringIncludes(workspace, "externally withdrawn are different states");
  assertStringIncludes(workspace, "Cumulative supplier disbursements in expense ledger");
  assertStringIncludes(workspace, "Procurement spread held in clearing");
});

Deno.test("The combined Fleet and Finance migration is classified as a business-module migration", () => {
  assertStringIncludes(migrationPolicy, "20261101162500_platform_financial_analytics_and_fleet_supplier_payments.sql");
});

Deno.test("Admin supplier payments attach registered media evidence without changing ordinary order receipt rules", () => {
  assertStringIncludes(workspace, '"/runtime/media/upload-sessions"');
  assertStringIncludes(workspace, '"/runtime/media/assets"');
  assertStringIncludes(workspace, 'assetTypeKey: "media.lpg.supplier_payment_evidence"');
  assertStringIncludes(workspace, "target_evidence_media_asset_id: evidenceMediaAssetId");
  assertStringIncludes(workspace, "Payment evidence file (optional)");
  assertStringIncludes(workspace, "Admin-recorded declarations");
  assertStringIncludes(workspace, "supplierPaymentIdempotencyKey ?? createClientIdempotencyKey");
  assertStringIncludes(workspace, "target_idempotency_key: paymentIdempotencyKey");
});

Deno.test("Finance analytics includes settlement statements, adjustments and open reconciliation evidence", () => {
  assertStringIncludes(migration, "'settlementStatements'");
  assertStringIncludes(migration, "'financialAdjustments'");
  assertStringIncludes(migration, "'reconciliationFindings'");
  assertStringIncludes(migration, "public.read_ai_finance_reconciliation_findings('info'");
  assertStringIncludes(workspace, "Settlement statement records");
  assertStringIncludes(workspace, "LPG financial adjustments");
  assertStringIncludes(workspace, "Finance reconciliation findings");
  assertStringIncludes(workspace, "Advisory only · no funds moved or ledger posted");
});

Deno.test("Financial analytics is linked from the existing Money workspace", () => {
  assertStringIncludes(router, 'props.route === "/money/analytics"');
  assertStringIncludes(router, "AdminFinancialAnalyticsWorkspace");
  assertStringIncludes(router, 'href: "/money/analytics"');
  assertStringIncludes(navigation, 'label: "Financial analytics", href: "/money/analytics"');
  assertStringIncludes(navigation, '"/money/analytics": "Financial analytics"');
});
