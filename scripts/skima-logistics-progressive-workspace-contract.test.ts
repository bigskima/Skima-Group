async function read(path: string): Promise<string> {
  return await Deno.readTextFile(new URL("../" + path, import.meta.url));
}

function requireText(source: string, value: string, label: string) {
  if (!source.includes(value)) throw new Error(label + " must contain: " + value);
}

function rejectText(source: string, value: string, label: string) {
  if (source.includes(value)) throw new Error(label + " must not contain: " + value);
}

Deno.test("Logistics company application is divided into applicant-facing progressive stages", async () => {
  const panel = await read("apps/logistics-mobile/src/ui/LogisticsCompanyApplicationPanel.tsx");
  for (const section of ["details", "identity", "documents", "terms", "submit"]) {
    requireText(panel, 'activeSection === "' + section + '"', "Company application sections");
  }
  requireText(panel, "safeVerificationFallback", "Applicant-safe identity verification status");
  requireText(panel, "safeVerificationMessage", "Applicant-safe identity verification status");
  rejectText(panel.toLowerCase(), "this didit workflow requires billable credits", "Company application");
  rejectText(panel.toLowerCase(), "not enough credits", "Company application");
  requireText(panel, "CAC registration documents are optional", "Company application CAC guidance");
});

Deno.test("Logistics provider workspace groups company, application, fleet, wallet, services and coverage", async () => {
  const screen = await read("apps/logistics-mobile/src/screens/ProviderCompanyScreen.tsx");
  requireText(screen, "workspaceSections", "Provider workspace section navigator");
  for (const section of ["profile", "application", "fleet", "wallet", "services", "coverage"]) {
    requireText(screen, 'activeWorkspaceSection === "' + section + '"', "Provider workspace section " + section);
  }
  requireText(screen, "Company identity", "Provider workspace company profile group");
  requireText(screen, "Fleet & drivers", "Provider workspace fleet group");
  requireText(screen, "Operating coverage", "Provider workspace coverage group");
});

Deno.test("Bills Store uses separate Shop, Basket and Orders sections", async () => {
  const screen = await read("apps/bills-mobile/src/screens/BillsStoreScreen.tsx");
  for (const section of ["shop", "basket", "orders"]) {
    requireText(screen, 'activeSection==="' + section + '"', "Bills Store " + section + " section");
  }
  requireText(screen, "sectionNavigation", "Bills Store section navigation");
  requireText(screen, "/runtime/storefront/checkout", "Bills Store secure checkout");
  requireText(screen, "/runtime/storefront/orders/confirm-receipt", "Bills Store order lifecycle");
});

Deno.test("Logistics Store and Bills have independent progressive sections", async () => {
  const [store, bills] = await Promise.all([
    read("apps/logistics-mobile/src/screens/LogisticsStoreScreen.tsx"),
    read("apps/logistics-mobile/src/screens/QuickBillsScreen.tsx"),
  ]);
  for (const section of ["shop", "basket", "orders"]) {
    requireText(store, 'activeSection === "' + section + '"', "Logistics Store " + section + " section");
  }
  requireText(store, "sectionNavigation", "Logistics Store section navigation");
  requireText(store, "/runtime/storefront/checkout", "Logistics Store secure checkout");
  requireText(bills, 'activeSection==="overview"', "Logistics Bills overview section");
  requireText(bills, 'activeSection==="services"', "Logistics Bills services section");
});

Deno.test("Company earnings transfer is owner-bound and uses balanced idempotent ledger posting", async () => {
  const [finance, runtime, migration] = await Promise.all([
    read("apps/logistics-mobile/src/screens/CompanyFinanceScreen.tsx"),
    read("supabase/functions/logistics-runtime/index.ts"),
    read("supabase/migrations/20261110164500_logistics_company_earnings_transfer_to_owner_wallet.sql"),
  ]);
  requireText(finance, "/runtime/logistics/company/earnings/transfer-to-personal", "Company finance personal-wallet transfer");
  requireText(finance, "My SKIMA Wallet", "Company finance personal-wallet destination");
  requireText(finance, "External bank", "Company finance external-bank destination");
  requireText(finance, "Withdraw to bank", "Existing external-bank withdrawal");
  requireText(runtime, "/runtime/logistics/company/earnings/transfer-to-personal", "Logistics company transfer runtime route");
  requireText(runtime, "can_manage_logistics_company", "Company owner access check");
  requireText(runtime, '.eq("owner_entity_id", requesterUserId)', "Destination wallet owner check");
  requireText(runtime, "transfer_logistics_company_earnings_to_owner_wallet", "Server-side ledger transfer RPC");
  requireText(migration, "auth.role() <> 'service_role'", "Service-role-only database execution");
  requireText(migration, "membership.membership_type = 'owner'", "Active company-owner membership check");
  requireText(migration, "owner_entity_id = target_owner_user_id", "Personal destination wallet ownership");
  requireText(migration, "wallet_type = 'logistics_earnings'", "Settled company earnings wallet restriction");
  requireText(migration, "public.post_financial_transaction", "Append-only financial ledger posting");
  requireText(migration, "'direction', 'debit'", "Company wallet debit");
  requireText(migration, "'direction', 'credit'", "Personal wallet credit");
  requireText(migration, "target_idempotency_key", "Transfer idempotency");
  requireText(migration, "from public, anon, authenticated", "No direct client execution of transfer RPC");
  requireText(migration, "to service_role", "Trusted runtime-only transfer grant");
});

Deno.test("All four app deployment configs include a direct-navigation SPA fallback", async () => {
  const paths = [
    "apps/lpg-mobile/vercel.json",
    "apps/logistics-mobile/vercel.json",
    "apps/store-mobile/vercel.json",
    "apps/bills-mobile/vercel.json",
  ];
  const configs = await Promise.all(paths.map(read));
  for (let index = 0; index < configs.length; index++) {
    requireText(configs[index], '"destination": "/index.html"', paths[index] + " SPA route fallback");
  }
});
