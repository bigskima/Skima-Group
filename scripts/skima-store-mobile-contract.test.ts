async function read(path: string): Promise<string> {
  return await Deno.readTextFile(new URL("../" + path, import.meta.url));
}
function requireText(source: string, value: string, file: string) {
  if (!source.includes(value)) throw new Error(file + " must contain " + value);
}
function rejectText(source: string, value: string, file: string) {
  if (source.includes(value)) throw new Error(file + " must not contain " + value);
}

Deno.test("Store is a standalone Expo app with a separate native identity and configurable origin", async () => {
  const [manifest, config, docs] = await Promise.all([
    read("apps/store-mobile/package.json"), read("apps/store-mobile/app.config.ts"), read("apps/store-mobile/README.md"),
  ]);
  requireText(manifest, "@skima/store-mobile", "Store package manifest");
  requireText(config, 'slug: "skima-store"', "Store Expo config");
  requireText(config, 'scheme: "skima-store"', "Store Expo config");
  requireText(config, "com.skima.store", "Store Expo config");
  requireText(config, "EXPO_PUBLIC_STORE_EAS_PROJECT_ID", "Store Expo config");
  requireText(docs, "EXPO_PUBLIC_SKIMA_STORE_BASE_URL", "Store deployment documentation");
  rejectText(config, "store.skima.online", "Store Expo config must not hard-code its production hostname");
});

Deno.test("Store uses the existing SKIMA customer authentication identity", async () => {
  const session = await read("apps/store-mobile/src/session/SessionProvider.tsx");
  requireText(session, "EXPO_PUBLIC_SUPABASE_URL", "Store session provider");
  requireText(session, "EXPO_PUBLIC_SUPABASE_ANON_KEY", "Store session provider");
  requireText(session, "skima-store-expo", "Store API client identity");
  requireText(session, "skima.store.mobile", "Store signup source");
  rejectText(session, "stopDriverTracking", "Store session provider");
});

Deno.test("Store reads canonical catalogue, pricing, stock and media", async () => {
  const api = await read("apps/store-mobile/src/api/store.ts");
  const shop = await read("apps/store-mobile/src/screens/StoreShopScreen.tsx");
  for (const route of ["/runtime/catalog/categories", "/runtime/catalog/items", "/runtime/catalog/variants", "/runtime/catalog/prices", "/runtime/catalog/availability", "/runtime/catalog/media"]) {
    requireText(api, route, "Store catalogue API");
  }
  requireText(shop, 'sales_channel!=="skima_store"', "Store sales-channel filter");
  requireText(shop, "/runtime/media/read-sessions", "Store private media access");
});

Deno.test("Store checkout uses the existing customer wallet and escrow flow", async () => {
  const shop = await read("apps/store-mobile/src/screens/StoreShopScreen.tsx");
  requireText(shop, "/runtime/storefront/checkout", "Store checkout");
  requireText(shop, "customerWalletId", "Store checkout wallet linkage");
  requireText(shop, "idempotencyKey:checkoutKey", "Store checkout idempotency");
  requireText(shop, "Payment is held securely until the order is completed.", "Store customer payment explanation");
  requireText(shop, "/runtime/wallets", "Store shared customer wallet");
  requireText(shop, "/runtime/wallet-balances", "Store wallet balance");
});

Deno.test("Store funding and withdrawal reuse finance-runtime rather than a separate Store wallet", async () => {
  const finance = await read("apps/store-mobile/src/api/finance.ts");
  const wallet = await read("apps/store-mobile/src/screens/StoreWalletScreens.tsx");
  requireText(finance, "/functions/v1/finance-runtime", "Store finance client");
  for (const route of ["/deposits/preview", "/deposits", "/beneficiaries", "/withdrawals/preview", "/withdrawals"]) {
    requireText(wallet, route, "Store wallet");
  }
  requireText(wallet, 'target_wallet_type:"customer"', "Store shared wallet funding");
  rejectText(wallet, 'target_wallet_type:"store"', "Store wallet must not create another balance");
});

Deno.test("Store has order history and canonical receipt confirmation", async () => {
  const orders = await read("apps/store-mobile/src/screens/StoreOrdersScreen.tsx");
  requireText(orders, "/runtime/storefront/orders", "Store order history");
  requireText(orders, "/runtime/storefront/orders/confirm-receipt", "Store receipt confirmation");
  requireText(orders, "fulfillment_method", "Store order fulfilment details");
});

Deno.test("Store app provides role-gated first-party marketplace and order operations", async () => {
  const [app, account, management, admin] = await Promise.all([
    read("apps/store-mobile/src/screens/StoreApp.tsx"),
    read("apps/store-mobile/src/screens/StoreAccountScreen.tsx"),
    read("apps/store-mobile/src/screens/StoreManagementScreen.tsx"),
    read("apps/admin/src/features/store/StoreWorkspace.tsx"),
  ]);
  requireText(app, 'session.context.permissions.includes("platform.store.manage")', "Store platform manager navigation gate");
  requireText(account, 'session.context.permissions.includes("platform.store.manage")', "Store account manager link gate");
  requireText(management, 'session.context.permissions.includes("platform.store.manage")', "Store management screen permission gate");
  requireText(management, 'session.context?.platformAdmin', "Store management platform-admin restriction");
  for (const route of ["/runtime/storefront/products", "/runtime/orders/actions", "/runtime/storefront/orders/refund"]) {
    requireText(management, route, "Store app marketplace management");
  }
  requireText(management, "Confirm hand-off / dispatch", "Store order fulfilment action");
  requireText(admin, 'title="Cancel Store order"', "Existing Admin cancellation workflow remains available");
  requireText(admin, '/runtime/storefront/products', "Existing Admin product management remains available");
});

Deno.test("Store customers see explicit cancellation reasons and wallet refund state", async () => {
  const orders = await read("apps/store-mobile/src/screens/StoreOrdersScreen.tsx");
  const gateway = await read("supabase/functions/api-gateway/index.ts");
  requireText(orders, "Why SKIMA cancelled this order", "Customer-facing Store cancellation reason");
  requireText(orders, "Your refund was sent to your SKIMA Wallet on ", "Customer-facing Store refund confirmation");
  requireText(orders, "wallet refund has not yet been marked as completed", "Customer-facing pending refund state");
  requireText(gateway, "events:order_events(id,event_type_key,from_status,to_status,metadata,created_at)", "Store customer orders include cancellation event reasons");
});

Deno.test("Store account, notifications and navigation are independent of Bills routing", async () => {
  const app = await read("apps/store-mobile/src/screens/StoreApp.tsx");
  const notifications = await read("apps/store-mobile/src/screens/StoreNotificationsScreen.tsx");
  const navigation = await read("apps/store-mobile/src/navigation/storeNavigation.ts");
  requireText(app, "StoreShopScreen", "Store app navigation");
  requireText(app, "StoreOrdersScreen", "Store app navigation");
  requireText(app, "StoreWalletScreen", "Store app navigation");
  requireText(app, "StoreAccountScreen", "Store app navigation");
  requireText(notifications, "read_notification_center", "Store in-app inbox");
  requireText(notifications, "mark_all_notifications_read", "Store in-app inbox");
  requireText(navigation, '"/orders": "orders"', "Store deep-link routing");
});

Deno.test("Existing Admin, Refill and Logistics Store experiences retain the canonical storefront", async () => {
  const admin = await read("apps/admin/src/features/store/StoreWorkspace.tsx");
  const lpg = await read("apps/lpg-mobile/app/(customer)/store.tsx");
  const logistics = await read("apps/logistics-mobile/src/screens/LogisticsStoreScreen.tsx");
  requireText(admin, "/runtime/storefront/products", "Store Admin product management");
  requireText(admin, "/runtime/storefront/orders/refund", "Store Admin refund controls");
  requireText(lpg, "/runtime/storefront/checkout", "Existing Refill Store checkout");
  requireText(logistics, "/runtime/storefront/checkout", "Existing Logistics Store checkout");
});

Deno.test("Store reuses the two existing production schema migrations", async () => {
  const [foundation, delivery] = await Promise.all([
    read("supabase/migrations/20261102112220_skima_store_foundation.sql"),
    read("supabase/migrations/20261103131401_skima_store_checkout_delivery.sql"),
  ]);
  requireText(foundation, "workflow.skima-store.order-processing", "Store order workflow foundation");
  requireText(foundation, "storefront_settings", "Store storefront configuration");
  requireText(delivery, "delivery_base_fee_amount", "Store delivery fee configuration");
  requireText(delivery, "minimum_order_amount", "Store minimum-order configuration");
});

Deno.test("Store authentication screen displays Store branding instead of Bills branding", async () => {
  const auth = await read("apps/store-mobile/src/screens/StoreAuthScreen.tsx");
  requireText(auth, "Welcome to SKIMA Store", "Store login screen");
  requireText(auth, "StoreBrandMark", "Store primary brand mark");
  rejectText(auth, ">BILLS</Text>", "Store login brand label");
});

Deno.test("Store brand fallback matches the Refill wordmark layout", async () => {
  const brand = await read("apps/store-mobile/src/ui/BrandMark.tsx");
  requireText(brand, "wordmarkText", "Store Refill-style wordmark");
  requireText(brand, "wordmarkDot", "Store Refill-style brand dot");
  requireText(brand, "resizeMode", "Store remote logo uses contain layout");
});


Deno.test("Store auth startup ignores a stale getSession snapshot after a newer auth event", async () => {
  const session = await read("apps/store-mobile/src/session/SessionProvider.tsx");
  const subscription = session.indexOf("supabase.auth.onAuthStateChange");
  const initialRead = session.indexOf("supabase.auth.getSession");
  if (subscription < 0 || initialRead < 0 || subscription > initialRead) {
    throw new Error("Store must subscribe to auth changes before loading the initial session");
  }
  requireText(session, "authEventVersion === initialAuthEventVersion", "Store auth startup race guard");
  requireText(session, "mounted = false", "Store auth startup cleanup");
});

Deno.test("Store guided tour maps first-run steps to real Store controls", async () => {
  const [guide, providers, app, shop, orders, wallet, account, auth] = await Promise.all([
    read("apps/store-mobile/src/onboarding/StoreGuideProvider.tsx"),
    read("apps/store-mobile/src/providers/AppProviders.tsx"),
    read("apps/store-mobile/src/screens/StoreApp.tsx"),
    read("apps/store-mobile/src/screens/StoreShopScreen.tsx"),
    read("apps/store-mobile/src/screens/StoreOrdersScreen.tsx"),
    read("apps/store-mobile/src/screens/StoreWalletScreens.tsx"),
    read("apps/store-mobile/src/screens/StoreAccountScreen.tsx"),
    read("apps/store-mobile/src/screens/StoreAuthScreen.tsx"),
  ]);
  requireText(providers, "<StoreGuideProvider>", "Store guide provider");
  requireText(guide, "measureInWindow", "Store spotlight measurement");
  requireText(guide, 'position: "absolute"', "Store full-screen tour overlay style");
  for (const key of [
    "store.shop.hero", "store.shop.categories", "store.shop.basket",
    "store.orders.history", "store.wallet.balance", "store.account.profile",
  ]) requireText(guide, 'targetKey: "' + key + '"', "Store guide step mapping");
  for (const [source, target] of [
    [shop, "store.shop.hero"], [shop, "store.shop.categories"], [shop, "store.shop.basket"],
    [orders, "store.orders.history"], [wallet, "store.wallet.balance"], [account, "store.account.profile"],
  ]) requireText(source, target, "Store visible guide target");
  requireText(account, "GuideLaunchLink", "Store replay-tour entry");
  requireText(app, "guide.setCurrentPage(allowedPage)", "Store tour navigation synchronization and permission-safe routing");
  requireText(guide, "AsyncStorage.getItem", "Store per-customer tour eligibility");
  requireText(guide, "Remind me in 7 days", "Store tour snooze control");
  rejectText(auth, "Secure payments · Shared SKIMA wallet · One customer account", "Store authentication reference footer");
  rejectText(auth, "in one secure place", "Store authentication filler copy");
  rejectText(auth, "One SKIMA account across your services", "Store authentication cross-app tagline");
});
