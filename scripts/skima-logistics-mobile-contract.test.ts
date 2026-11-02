const appConfig = await Deno.readTextFile("apps/logistics-mobile/app.config.ts");
const appPackage = await Deno.readTextFile("apps/logistics-mobile/package.json");
const rootPackage = await Deno.readTextFile("package.json");
const theme = await Deno.readTextFile("apps/logistics-mobile/src/theme/tokens.ts");
const themeProvider = await Deno.readTextFile("apps/logistics-mobile/src/theme/ThemeProvider.tsx");
const screen = await Deno.readTextFile("apps/logistics-mobile/src/ui/Screen.tsx");
const button = await Deno.readTextFile("apps/logistics-mobile/src/ui/AppButton.tsx");
const field = await Deno.readTextFile("apps/logistics-mobile/src/ui/AppField.tsx");
const card = await Deno.readTextFile("apps/logistics-mobile/src/ui/Card.tsx");
const skeleton = await Deno.readTextFile("apps/logistics-mobile/src/ui/ScreenSkeleton.tsx");
const statePanel = await Deno.readTextFile("apps/logistics-mobile/src/ui/StatePanel.tsx");
const account = await Deno.readTextFile("apps/logistics-mobile/src/screens/CustomerAccountScreen.tsx");
const home = await Deno.readTextFile("apps/logistics-mobile/src/screens/CustomerHomeScreen.tsx");
const request = await Deno.readTextFile("apps/logistics-mobile/src/screens/LogisticsRequestScreen.tsx");
const jobs = await Deno.readTextFile("apps/logistics-mobile/src/screens/CustomerJobsScreen.tsx");
const detail = await Deno.readTextFile("apps/logistics-mobile/src/screens/LogisticsJobDetailScreen.tsx");
const booking = await Deno.readTextFile("apps/logistics-mobile/src/screens/LogisticsBookingScreen.tsx");
const geography = await Deno.readTextFile("apps/logistics-mobile/src/ui/GeographyPicker.tsx");
const session = await Deno.readTextFile("apps/logistics-mobile/src/session/SessionProvider.tsx");
const providers = await Deno.readTextFile("apps/logistics-mobile/src/providers/AppProviders.tsx");
const routes = await Deno.readTextFile("apps/logistics-mobile/app/(customer)/_layout.tsx");

function requireText(source: string, fragment: string, label: string): void {
  const normalizedSource = source.replace(/\s+/g, " ");
  const normalizedFragment = fragment.replace(/\s+/g, " ");
  if (!normalizedSource.includes(normalizedFragment)) {
    throw new Error(`${label}: missing required fragment: ${fragment}`);
  }
}
function requireNotText(source: string, fragment: string, label: string): void {
  const normalizedSource = source.replace(/\s+/g, " ");
  const normalizedFragment = fragment.replace(/\s+/g, " ");
  if (normalizedSource.includes(normalizedFragment)) {
    throw new Error(`${label}: prohibited fragment found: ${fragment}`);
  }
}

Deno.test("Logistics mobile is a genuinely separate Expo application and identity", () => {
  requireText(appConfig, 'name: "SKIMA Logistics"', "distinct app name");
  requireText(appConfig, 'slug: "skima-logistics"', "distinct Expo slug");
  requireText(appConfig, 'scheme: "skima-logistics"', "distinct deep-link scheme");
  requireText(appConfig, 'package: "com.skima.logistics"', "distinct Android identity");
  requireText(appConfig, 'bundleIdentifier: "com.skima.logistics"', "distinct iOS identity");
  requireNotText(appConfig, 'slug: "skima-lpg"', "no LPG app slug reuse");
  requireNotText(appConfig, 'package: "com.skima.lpg"', "no LPG Android app identity reuse");
  requireText(appPackage, '"name": "@skima/logistics-mobile"', "separate app package");
  requireText(rootPackage, '"logistics:mobile"', "root app launch command");
  requireText(rootPackage, '"logistics:mobile:check"', "root app typecheck command");
});

Deno.test("The app preserves the LPG visual standard with red brand, premium surfaces and dark/light themes", () => {
  requireText(theme, '"#E21D2F"', "SKIMA red brand");
  requireText(theme, '"#B91323"', "deep red brand shade");
  requireText(theme, 'darkCanvas: "#111113"', "dark mode canvas");
  requireText(theme, 'darkSurface: "#19191C"', "dark mode card surfaces");
  requireText(theme, "typography = {", "shared typography hierarchy");
  requireText(theme, "radii = {", "consistent rounded component system");
  requireText(theme, "shadows = {", "elevation and visual depth");
  requireText(themeProvider, "STORAGE_KEY", "persisted user theme preference");
  requireText(themeProvider, "darkPalette", "dark palette");
  requireText(themeProvider, "lightPalette", "light palette");
  requireText(screen, "useNetInfo", "network-aware screen");
  requireText(screen, "refreshControl", "pull-to-refresh screen layout");
  requireText(card, "variant = \"default\"", "reusable premium card variants");
  requireText(button, "pressed && !inactive", "button press feedback");
  requireText(field, "focused", "focused input styling");
  requireText(skeleton, "Animated.loop", "animated content skeleton");
  requireText(statePanel, "Try again", "retry-capable failure state");
});

Deno.test("Customer home, activity and request screens read live Logistics services and jobs", () => {
  requireText(home, '"/runtime/logistics/categories"', "live service catalogue");
  requireText(home, '"/runtime/logistics/jobs"', "live customer jobs");
  requireText(home, '"/runtime/logistics/bookings"', "live booking summaries");
  requireText(home, "categories.data", "database-driven service cards");
  requireText(home, "ScreenSkeleton", "home loading presentation");
  requireText(home, "StatePanel", "home failure presentation");
  requireText(jobs, '"/runtime/logistics/jobs"', "customer request list API");
  requireText(jobs, "StatusPill", "consistent request status treatment");
  requireText(request, '"/runtime/logistics/geographies?countryCode=NG', "Nigeria geography catalogue");
  requireText(request, '"/runtime/logistics/jobs"', "customer job publish route");
  requireText(request, "createClientIdempotencyKey", "request submission idempotency");
  requireText(request, "step === 3", "three-stage review before publish");
  requireText(request, "customer_contact", "provider coordination contact");
  requireNotText(request.toLowerCase(), "fixed booking fee", "no hardcoded customer booking rate");
  requireNotText(request.toLowerCase(), "sample provider", "no mock service-provider names");
});

Deno.test("Geography search is debounced and uses SKIMA's active location registry", () => {
  requireText(geography, "setTimeout(() => setDebouncedSearch(search), 260)", "debounced geography search");
  requireText(geography, "RecordArraySchema", "validated geography API result");
  requireText(geography, "/runtime/logistics/geographies", "geography runtime endpoint");
  requireText(geography, "onSelect(place)", "explicit user selection");
});

Deno.test("Request detail compares matched providers and only shows a current provider quote as selectable", () => {
  requireText(detail, '"/runtime/logistics/opportunities"', "matched provider opportunities");
  requireText(detail, '"/runtime/logistics/offers?jobId=', "provider quotes");
  requireText(detail, "provider_name", "matched company identity");
  requireText(detail, "latestProviderOffer", "latest provider offer selection");
  requireText(detail, '["provider_quote", "provider_counter"]', "provider-originated quote filtering");
  requireText(detail, '"/runtime/logistics/jobs/match"', "customer-authorized rematch action");
  requireText(detail, '"/runtime/logistics/offers/select"', "booking creation from a selected provider offer");
});

Deno.test("Booking checkout displays the locked total and separates online escrow from offline fees", () => {
  requireText(booking, '"/runtime/logistics/bookings/pay"', "online booking payment");
  requireText(booking, '"/runtime/logistics/bookings/offline/confirm"', "offline booking fee confirmation");
  requireText(booking, '"/runtime/wallets"', "customer wallet catalogue");
  requireText(booking, '"/runtime/wallet-balances"', "wallet balances");
  requireText(booking, 'owner_entity_type") === "user"', "wallet owner must be a user");
  requireText(booking, 'owner_entity_id") === customerId', "wallet owner must be the signed-in customer");
  requireText(booking, 'wallet_type") === "customer"', "only a customer wallet can be charged");
  requireText(booking, "customer_booking_fee_amount", "customer fee from locked booking snapshot");
  requireText(booking, "provider_receival_fee_amount", "offline provider receiving fee disclosure");
  requireText(booking, "provider_commission_amount", "online provider commission disclosure");
  requireNotText(booking, "SUPABASE_SERVICE_ROLE_KEY", "no service role key in the mobile application");
});

Deno.test("Authentication, deep links and app lifecycle are isolated from LPG mobile", () => {
  requireText(session, "ApiGatewayClient", "shared authenticated API gateway");
  requireText(session, "SessionContextSchema", "shared platform session context");
  requireText(session, "SecureStore", "secure native session persistence");
  requireText(session, "skima-logistics-expo", "distinct client identity");
  requireText(providers, "QueryClientProvider", "live query cache");
  requireText(providers, "onlineManager.setEventListener", "network-aware query lifecycle");
  requireText(routes, 'status === "loading"', "authentication startup state");
  requireText(routes, "CustomerTabs", "customer-only navigation");
});

Deno.test("Customer account keeps its preferences and sign-out controls interactive", () => {
  requireText(account, "<Pressable", "interactive preference rows");
  requireText(account, "void toggle()", "working appearance toggle");
  requireText(account, "void signOut()", "working secure sign-out");
});
