async function read(path: string): Promise<string> {
  return await Deno.readTextFile(new URL("../" + path, import.meta.url));
}
function requireText(source: string, fragment: string, label: string): void {
  if (!source.includes(fragment)) throw new Error(label + " must contain " + fragment);
}
function rejectText(source: string, fragment: string, label: string): void {
  if (source.includes(fragment)) throw new Error(label + " must not contain " + fragment);
}

Deno.test("Refill and Logistics host the complete Bills and Store applications respectively", async () => {
  const [refillRoute, logisticsRoute, billsHost, storeHost, billsApp, storeApp] = await Promise.all([
    read("apps/lpg-mobile/app/(customer)/bills.tsx"),
    read("apps/logistics-mobile/app/(customer)/store.tsx"),
    read("apps/lpg-mobile/src/native/ui/EmbeddedBillsWorkspace.tsx"),
    read("apps/logistics-mobile/src/screens/EmbeddedStoreWorkspace.tsx"),
    read("apps/bills-mobile/src/screens/BillsApp.tsx"),
    read("apps/store-mobile/src/screens/StoreApp.tsx"),
  ]);
  requireText(refillRoute, "EmbeddedBillsWorkspace", "Refill Bills route");
  requireText(logisticsRoute, "EmbeddedStoreWorkspace", "Logistics Store route");
  requireText(billsHost, "BillsHostedAppProviders", "Refill hosted Bills workspace");
  requireText(billsHost, "<BillsApp onExit={exit}", "Refill full Bills app");
  requireText(storeHost, "StoreHostedAppProviders", "Logistics hosted Store workspace");
  requireText(storeHost, "<StoreApp onExit={exit}", "Logistics full Store app");
  for (const screen of ["BillsHomeScreen", "BillsActivityScreen", "BillsWalletScreen", "BillsNotificationsScreen", "BillsBeneficiariesScreen", "BillsReceiptScreen"]) {
    requireText(billsApp, screen, "Full Bills app navigation");
  }
  for (const screen of ["StoreShopScreen", "StoreOrdersScreen", "StoreWalletScreen", "StoreAccountScreen", "StoreNotificationsScreen", "StoreManagementScreen"]) {
    requireText(storeApp, screen, "Full Store app navigation");
  }
  requireText(billsApp, "initialRoute", "Bills in-module deep linking");
  requireText(storeApp, "initialRoute", "Store in-module deep linking");
});

Deno.test("Hosted service modules reuse the parent app session and query client", async () => {
  const [billsProvider, storeProvider, billsSession, storeSession, refillHost, logisticsHost] = await Promise.all([
    read("apps/bills-mobile/src/providers/HostedAppProviders.tsx"),
    read("apps/store-mobile/src/providers/HostedAppProviders.tsx"),
    read("apps/bills-mobile/src/session/SessionProvider.tsx"),
    read("apps/store-mobile/src/session/SessionProvider.tsx"),
    read("apps/lpg-mobile/src/native/ui/EmbeddedBillsWorkspace.tsx"),
    read("apps/logistics-mobile/src/screens/EmbeddedStoreWorkspace.tsx"),
  ]);
  for (const [source, label] of [[billsProvider, "Bills"], [storeProvider, "Store"]] as const) {
    requireText(source, "SessionValueProvider", label + " injected session provider");
    requireText(source, "PolicyConsentGate", label + " independent policy consent");
    rejectText(source, "<QueryClientProvider", label + " must inherit its host query client");
    rejectText(source, "<SessionProvider", label + " must not create a second auth session");
  }
  requireText(billsSession, "export function SessionValueProvider", "Bills session injection");
  requireText(storeSession, "export function SessionValueProvider", "Store session injection");
  requireText(refillHost, "host.signUp", "Bills host-auth delegation");
  requireText(refillHost, "host.requestPasswordReset", "Bills host-auth delegation");
  requireText(storeHost, "host.signUp", "Store host-auth delegation");
  requireText(storeHost, "host.signOut", "Store host-auth delegation");
});

Deno.test("Module navigation has explicit, independent return controls and validates push routes", async () => {
  const [storeApp, billsApp, storeRoutes, billsRoutes, logisticsPush, refillPush, storePush, billsPush] = await Promise.all([
    read("apps/store-mobile/src/screens/StoreApp.tsx"),
    read("apps/bills-mobile/src/screens/BillsApp.tsx"),
    read("apps/store-mobile/src/navigation/storeNavigation.ts"),
    read("apps/bills-mobile/src/navigation/billsNavigation.ts"),
    read("apps/logistics-mobile/src/notifications/LogisticsNotificationLifecycle.tsx"),
    read("apps/lpg-mobile/src/native/notifications/useNotificationLifecycle.native.ts"),
    read("apps/store-mobile/src/notifications/StoreNotificationLifecycle.tsx"),
    read("apps/bills-mobile/src/notifications/BillsNotificationLifecycle.tsx"),
  ]);
  requireText(storeApp, "Back to Logistics", "Store return control");
  requireText(billsApp, "Back to Refill", "Bills return control");
  requireText(storeRoutes, "route.startsWith(\"//\")", "Store deep-link allowlist");
  requireText(billsRoutes, "route.startsWith(\"//\")", "Bills deep-link allowlist");
  requireText(logisticsPush, 'data.app === "store"', "Logistics Store push routing");
  requireText(refillPush, 'data.app === "bills"', "Refill Bills push routing");
  requireText(storePush, "navigateStoreRoute(route)", "Store module push deep links");
  requireText(billsPush, "navigateBillsRoute(route)", "Bills module push deep links");
});

Deno.test("All four complete web applications and their production web projects remain independent", async () => {
  const paths = [
    "apps/lpg-mobile/app.config.ts", "apps/logistics-mobile/app.config.ts",
    "apps/bills-mobile/app.config.ts", "apps/store-mobile/app.config.ts",
    "apps/lpg-mobile/vercel.json", "apps/logistics-mobile/vercel.json",
    "apps/bills-mobile/vercel.json", "apps/store-mobile/vercel.json",
  ];
  const sources = await Promise.all(paths.map(read));
  for (let i = 0; i < 4; i++) {
    const config = sources[i];
    requireText(config, "output", paths[i] + " web export");
    requireText(config, "single", paths[i] + " single-page web router");
  }
  for (let i = 4; i < paths.length; i++) {
    requireText(sources[i], "buildCommand", paths[i] + " independent Vercel project");
  }
  const [billsManifest, storeManifest, website] = await Promise.all([
    read("apps/bills-mobile/package.json"),
    read("apps/store-mobile/package.json"),
    read("apps/website/index.html"),
  ]);
  requireText(billsManifest, "build:web", "Bills independent web build");
  requireText(storeManifest, "build:web", "Store independent web build");
  for (const url of [
    "https://refill.skima.online/",
    "https://logistics.skima.online/",
    "https://bills.skima.online/",
    "https://store.skima.online/",
  ]) {
    requireText(website, url, "Public website service destination");
  }
  requireText(website, "Two mobile apps.", "Two-app download heading");
  requireText(website, 'const known=new Set(["refill","logistics"]);', "Two-app mobile download filter");
  rejectText(website, "refills.skima.online", "Canonical Refill production hostname");
});

Deno.test("The website exposes two mobile downloads without removing Bills or Store web services", async () => {
  const website = await read("apps/website/index.html");
  requireText(website, "Bills and Store remain complete, independently accessible web apps.", "Mobile download explanation");
  requireText(website, 'const ordered=["refill","logistics"]', "Mobile app download list");
  requireText(website, 'href="https://bills.skima.online/"', "Bills service card");
  requireText(website, 'href="https://store.skima.online/"', "Store service card");
  requireText(website, 'https://bills.skima.online/', "Bills web service");
  requireText(website, 'https://store.skima.online/', "Store web service");
});

Deno.test("Admin remains a separate product with four separate operational workflows", async () => {
  const [adminStore, docs] = await Promise.all([
    read("apps/admin/src/features/store/StoreWorkspace.tsx"),
    read("docs/53-skima-two-mobile-app-shells.md"),
  ]);
  requireText(adminStore, "/runtime/storefront/products", "Independent Store Admin workflow");
  requireText(docs, "Administration and backend boundaries", "Admin separation architecture");
  requireText(docs, "permissions", "Separate product permissions");
  requireText(docs, "ledger", "Separate financial controls");
});
