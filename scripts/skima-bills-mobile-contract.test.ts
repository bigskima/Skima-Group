async function read(path: string): Promise<string> {
  return await Deno.readTextFile(new URL("../" + path, import.meta.url));
}
function requireText(source: string, value: string, file: string) {
  if (!source.includes(value)) throw new Error(file + " must contain " + value);
}

Deno.test("Bills has its own Expo and native application identity", async () => {
  const [manifest, config, assets] = await Promise.all([
    read("apps/bills-mobile/package.json"),
    read("apps/bills-mobile/app.config.ts"),
    read("apps/bills-mobile/README.md"),
  ]);
  requireText(manifest, "@skima/bills-mobile", "Bills package manifest");
  requireText(config, 'slug:"skima-bills"', "Bills Expo config");
  requireText(config, 'scheme:"skima-bills"', "Bills Expo config");
  requireText(config, "com.skima.bills", "Bills Expo config");
  requireText(config, "EXPO_PUBLIC_BILLS_EAS_PROJECT_ID", "Bills Expo config");
  requireText(assets, "EXPO_PUBLIC_SKIMA_BILLS_BASE_URL", "Bills deployment documentation");
});

Deno.test("Bills reuses the existing SKIMA authenticated customer identity", async () => {
  const session = await read("apps/bills-mobile/src/session/SessionProvider.tsx");
  requireText(session, "EXPO_PUBLIC_SUPABASE_URL", "Bills session provider");
  requireText(session, "EXPO_PUBLIC_SUPABASE_ANON_KEY", "Bills session provider");
  requireText(session, "skima-bills-expo", "Bills session provider");
  requireText(session, "skima.bills.mobile", "Bills session provider");
  if (session.includes("stopDriverTracking")) throw new Error("Bills session must not depend on LPG driver tracking.");
});

Deno.test("Bills uses the canonical utility billing catalogue, validation and payment runtime", async () => {
  const home = await read("apps/bills-mobile/src/screens/BillsHomeScreen.tsx");
  requireText(home, "/runtime/utility-billing/catalog", "Bills home");
  requireText(home, "/runtime/utility-billing/validate", "Bills home");
  requireText(home, "/runtime/utility-billing/requests", "Bills home");
  requireText(home, "customerValidated:true", "Bills payment metadata");
  requireText(home, "idempotencyKey:paymentKey", "Bills stable payment idempotency");
  requireText(home, "walletId", "Bills payment payload");
});

Deno.test("Bills funding and withdrawal go through shared finance runtime wallet services", async () => {
  const finance = await read("apps/bills-mobile/src/api/finance.ts");
  const wallet = await read("apps/bills-mobile/src/screens/BillsWalletScreens.tsx");
  requireText(finance, "/functions/v1/finance-runtime", "Bills finance client");
  for (const route of ["/deposits/preview", "/deposits", "/beneficiaries", "/withdrawals/preview", "/withdrawals"]) {
    requireText(wallet, route, "Bills wallet screens");
  }
  requireText(wallet, "ensure_wallet_account", "Bills shared wallet funding");
  requireText(wallet, "idempotencyKey:depositKey", "Bills stable deposit idempotency");
  requireText(wallet, "idempotencyKey:withdrawalKey", "Bills stable withdrawal idempotency");
  requireText(wallet, "accountNumberValid=/^\\d{10}$/.test", "Bills 10-digit NUBAN validation");
  requireText(wallet, "verifiedBeneficiaries", "Bills wallet-scoped verified withdrawal beneficiary");
  requireText(wallet, 'target_wallet_type:"customer"', "Bills shared wallet funding");
});

Deno.test("Bills Store uses the shared catalogue, stock and canonical checkout", async () => {
  const api = await read("apps/bills-mobile/src/api/bills.ts");
  const store = await read("apps/bills-mobile/src/screens/BillsStoreScreen.tsx");
  for (const route of ["/runtime/catalog/categories", "/runtime/catalog/items", "/runtime/catalog/variants", "/runtime/catalog/prices", "/runtime/catalog/availability", "/runtime/catalog/media"]) {
    requireText(api, route, "Bills Store API");
  }
  requireText(store, 'sales_channel!=="skima_store"', "Bills Store catalogue filter");
  requireText(store, "/runtime/storefront/checkout", "Bills Store checkout");
  requireText(store, "customerWalletId", "Bills Store checkout");
  requireText(store, "idempotencyKey:checkoutKey", "Bills stable Store checkout idempotency");
  requireText(store, "/runtime/storefront/orders/confirm-receipt", "Bills Store order lifecycle");
});

Deno.test("Saved billers are owner scoped with row-level security", async () => {
  const migration = await read("supabase/migrations/20261104180000_skima_bills_saved_beneficiaries.sql");
  const screen = await read("apps/bills-mobile/src/screens/BillsBeneficiariesScreen.tsx");
  requireText(migration, "enable row level security", "Saved biller migration");
  requireText(migration, "customer_user_id = auth.uid()", "Saved biller policies");
  requireText(migration, "references public.utility_products", "Saved biller product relation");
  requireText(screen, "utility_saved_beneficiaries", "Saved biller screen");
});

Deno.test("Refill and Logistics keep existing customer journeys with Bills entry points", async () => {
  const refill = await read("apps/lpg-mobile/src/native/ui/PremiumDashboard.tsx");
  const refillBills = await read("apps/lpg-mobile/src/native/ui/UtilityBillsScreen.tsx");
  const logistics = await read("apps/logistics-mobile/src/screens/CustomerHomeScreen.tsx");
  const logisticsRoute = await read("apps/logistics-mobile/app/(customer)/bills.tsx");
  requireText(refill, 'label="Pay bills"', "Refill customer dashboard");
  requireText(refillBills, "openDedicatedBillsApp", "Refill Bills entry");
  requireText(logistics, 'router.push("/(customer)/bills"', "Logistics customer dashboard");
  requireText(logisticsRoute, "QuickBillsScreen", "Logistics Bills route");
});

Deno.test("Bills inbox uses the canonical shared notification center", async () => {
  const notifications = await read("apps/bills-mobile/src/screens/BillsNotificationsScreen.tsx");
  requireText(notifications, "read_notification_center", "Bills notifications");
  requireText(notifications, "mark_notification_read", "Bills notifications");
  requireText(notifications, "mark_all_notifications_read", "Bills notifications");
  requireText(notifications, "Remote push still requires provider credentials", "Bills push readiness notice");
});
