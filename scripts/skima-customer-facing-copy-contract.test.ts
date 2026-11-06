async function read(path: string): Promise<string> {
  return await Deno.readTextFile(new URL("../" + path, import.meta.url));
}

function requireText(source: string, value: string, file: string) {
  if (!source.includes(value)) throw new Error(file + " must contain " + value);
}

function rejectText(source: string, value: string, file: string) {
  if (source.includes(value)) throw new Error(file + " must not contain " + value);
}

Deno.test("Public landing page uses customer language rather than release notes", async () => {
  const site = await read("apps/website/index.html");
  for (const phrase of [
    "Bills and Store are now available as dedicated SKIMA experiences",
    "Provider, product and stock availability is shown inside each app",
    "operational availability",
    "One connected platform. Dedicated experiences for every service.",
    "One SKIMA platform",
  ]) rejectText(site, phrase, "Public landing page");
  rejectText(site, 'class="status-group"', "Public landing page release-status badges");
  requireText(site, "What you can order or book depends on your location", "Public landing page service guidance");
  requireText(site, "Check your account details when needed", "Public Bills description");
  requireText(site, "check prices and availability", "Public Store description");
});

Deno.test("Bills pages and tour avoid internal configuration and catalogue language", async () => {
  const [home, store, wallet, guide] = await Promise.all([
    read("apps/bills-mobile/src/screens/BillsHomeScreen.tsx"),
    read("apps/bills-mobile/src/screens/BillsStoreScreen.tsx"),
    read("apps/bills-mobile/src/screens/BillsWalletScreens.tsx"),
    read("apps/bills-mobile/src/onboarding/BillsGuideProvider.tsx"),
  ]);
  for (const phrase of [
    "Available offers configured by SKIMA",
    "Only services activated by SKIMA Admin",
    "active SKIMA utility catalogue",
    "shared customer wallet",
  ]) rejectText(home + store + wallet, phrase, "Bills customer screens");
  for (const phrase of [
    "live utility catalogue",
    "validate the account when the provider supports it",
    "shared catalogue",
    "separate service flows",
  ]) rejectText(guide, phrase, "Bills guided tour");
  requireText(home, "Special offers for your bill payments", "Bills offers copy");
  requireText(store, "Browse products from participating sellers", "Bills Store copy");
  requireText(wallet, "Add money to your SKIMA Wallet", "Bills wallet copy");
});

Deno.test("Store pages avoid internal runtime, checkout and wallet architecture copy", async () => {
  const [shop, orders, wallet, guide] = await Promise.all([
    read("apps/store-mobile/src/screens/StoreShopScreen.tsx"),
    read("apps/store-mobile/src/screens/StoreOrdersScreen.tsx"),
    read("apps/store-mobile/src/screens/StoreWalletScreens.tsx"),
    read("apps/store-mobile/src/onboarding/StoreGuideProvider.tsx"),
  ]);
  for (const phrase of [
    "platform administrator enables it",
    "shared Store configuration",
    "shared catalogue",
    "SKIMA checkout escrow",
    "finance runtime",
    "separate balance",
    "Using your shared SKIMA customer wallet across all apps",
    "Your shared customer wallet is not active yet",
  ]) rejectText(shop + orders + wallet, phrase, "Store customer screens");
  for (const phrase of [
    "catalogue shows active products",
    "complete its settlement",
  ]) rejectText(guide, phrase, "Store guided tour");
  requireText(shop, "Browse products from participating sellers", "Store shopping copy");
  requireText(shop, "Payment is held securely until the order is completed", "Store checkout explanation");
  requireText(orders, "confirm receipt when your items arrive", "Store order guidance");
});

Deno.test("Logistics customer screens explain bookings without internal system labels", async () => {
  const [home, jobs, account, wallet, signIn, request, bills, store, guide, locations] = await Promise.all([
    read("apps/logistics-mobile/src/screens/CustomerHomeScreen.tsx"),
    read("apps/logistics-mobile/src/screens/CustomerJobsScreen.tsx"),
    read("apps/logistics-mobile/src/screens/CustomerAccountScreen.tsx"),
    read("apps/logistics-mobile/src/screens/CustomerWalletScreen.tsx"),
    read("apps/logistics-mobile/src/auth/SignInScreen.tsx"),
    read("apps/logistics-mobile/src/screens/LogisticsRequestScreen.tsx"),
    read("apps/logistics-mobile/src/screens/QuickBillsScreen.tsx"),
    read("apps/logistics-mobile/src/screens/LogisticsStoreScreen.tsx"),
    read("apps/logistics-mobile/src/onboarding/LogisticsGuideProvider.tsx"),
    read("apps/logistics-mobile/src/ui/GeographyPicker.tsx"),
  ]);
  for (const phrase of [
    "Your account is secured through SKIMA authentication",
    "shared across LPG, Logistics and SKIMA Store",
    "the platform enables it",
    "Live services configured by SKIMA Admin",
    "location catalogue or address service",
    "No exact result in SKIMA's catalogue",
    "Your city.",
    "secure sign-in",
  ]) rejectText(home + jobs + account + wallet + signIn + request + bills + store + locations, phrase, "Logistics customer screens");
  for (const phrase of [
    "services enabled for your area",
    "Your shared SKIMA wallet",
    "catalogued goods",
  ]) rejectText(guide, phrase, "Logistics customer tour");
  requireText(home, "Compare offers for your route", "Logistics home");
  requireText(wallet, "Use your SKIMA Wallet to pay for eligible bookings and services.", "Logistics wallet");
});

Deno.test("LPG and Refill customer pages avoid internal delivery workflow language", async () => {
  const [refill, orders, stations, entry, dashboard, store, orderDetails, account] = await Promise.all([
    read("apps/lpg-mobile/src/native/ui/NewRefillScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/CustomerOrdersScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/StationsScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/CustomerRefillEntryScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/PremiumDashboard.tsx"),
    read("apps/lpg-mobile/app/(customer)/store.tsx"),
    read("apps/lpg-mobile/src/native/ui/StoreOrderDetailsScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/WorkspaceAccountSettingsScreen.tsx"),
  ]);
  for (const phrase of [
    "general delivery coverage",
    "general customer-ordering launch coverage",
    "configured delivery radius",
    "Station Managed workflow",
    "dispatch readiness",
    "eligible driver and vehicle",
    "SKIMA Managed / SKIMA Fleet and Independent Managed delivery coverage",
    "outside SKIMA Managed and Independent delivery coverage",
    "SKIMA-managed fulfillment",
    "Notify me when SKIMA launches here",
    "launch notification request",
    "Launch notification saved",
    "one trusted view",
    "Gathering your SKIMA activity",
    "notion page is only an external fallback",
  ]) rejectText(refill + orders + stations + entry + dashboard + store + orderDetails + account, phrase, "LPG customer-facing copy");
  requireText(refill, "Refills aren’t available at this address yet", "Refill availability notice");
  requireText(refill, "Checking this address does not place an order or charge your wallet.", "Refill availability/payment explanation");
  requireText(refill, "Choose an independent delivery partner", "Refill delivery choices");
  requireText(orders, "Review your refills, fuel deliveries, bill payments and Store orders.", "LPG order history");
  requireText(store, "Delivery availability is confirmed after checkout.", "Store delivery condition");
});
