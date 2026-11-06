const appConfig = await Deno.readTextFile("apps/logistics-mobile/app.config.ts");
const easConfigText = await Deno.readTextFile("apps/logistics-mobile/eas.json");
const vercelConfigText = await Deno.readTextFile("apps/logistics-mobile/vercel.json");
const providerWorksRoute = await Deno.readTextFile("apps/logistics-mobile/app/(provider)/works.tsx");
const storeVercelConfig = await Deno.readTextFile("apps/store-mobile/vercel.json");
const billsVercelConfig = await Deno.readTextFile("apps/bills-mobile/vercel.json");
const lpgVercelConfig = await Deno.readTextFile("apps/lpg-mobile/vercel.json");
const managedDriverCoverage = await Deno.readTextFile("apps/admin/src/admin-managed-driver-coverage-workspace.tsx");
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
const customerNavigation = await Deno.readTextFile("apps/logistics-mobile/src/navigation/CustomerTabs.tsx");
const storeScreen = await Deno.readTextFile("apps/logistics-mobile/src/screens/LogisticsStoreScreen.tsx");
const notificationScreen = await Deno.readTextFile("apps/logistics-mobile/src/screens/LogisticsNotificationsScreen.tsx");
const customerNotificationRoute = await Deno.readTextFile("apps/logistics-mobile/app/(customer)/notifications.tsx");
const providerNotificationRoute = await Deno.readTextFile("apps/logistics-mobile/app/(provider)/notifications.tsx");
const request = await Deno.readTextFile("apps/logistics-mobile/src/screens/LogisticsRequestScreen.tsx");
const jobs = await Deno.readTextFile("apps/logistics-mobile/src/screens/CustomerJobsScreen.tsx");
const detail = await Deno.readTextFile("apps/logistics-mobile/src/screens/LogisticsJobDetailScreen.tsx");
const booking = await Deno.readTextFile("apps/logistics-mobile/src/screens/LogisticsBookingScreen.tsx");
const geography = await Deno.readTextFile("apps/logistics-mobile/src/ui/GeographyPicker.tsx");
const logisticsApi = await Deno.readTextFile("apps/logistics-mobile/src/api/logistics.ts");
const logisticsAdminRoute = await Deno.readTextFile("apps/admin/src/features/logistics/LogisticsWorkspace.tsx");
const logisticsAdmin = logisticsAdminRoute;
const session = await Deno.readTextFile("apps/logistics-mobile/src/session/SessionProvider.tsx");
const providers = await Deno.readTextFile("apps/logistics-mobile/src/providers/AppProviders.tsx");
const routes = await Deno.readTextFile("apps/logistics-mobile/app/(customer)/_layout.tsx");
const providerNavigation = await Deno.readTextFile("apps/logistics-mobile/src/navigation/ProviderTabs.tsx");
const providerDashboard = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderDashboardScreen.tsx");
const providerWorkspace = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderWorkspaceScreen.tsx");
const guideProvider = await Deno.readTextFile("apps/logistics-mobile/src/onboarding/LogisticsGuideProvider.tsx");
const providerOpportunities = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderOpportunitiesScreen.tsx");
const providerCompany = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderCompanyScreen.tsx");
const providerTeam = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderTeamScreen.tsx");
const logisticsNotificationMigration = await Deno.readTextFile("supabase/migrations/20261104172000_logistics_notification_scope_and_in_app_company_invites.sql");
const providerTeamRoute = await Deno.readTextFile("apps/logistics-mobile/app/(provider)/team.tsx");
const providerDriver = await Deno.readTextFile("apps/logistics-mobile/src/screens/LogisticsDriverScreen.tsx");
const driverLocationShare = await Deno.readTextFile("apps/logistics-mobile/src/screens/LogisticsDriverLocationShare.tsx");
const providerDriverRoute = await Deno.readTextFile("apps/logistics-mobile/app/(provider)/driver.tsx");
const providerJobs = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderJobsScreen.tsx");
const providerBookingDetail = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderBookingDetailScreen.tsx");
const providerRoutes = await Deno.readTextFile("apps/logistics-mobile/app/(provider)/_layout.tsx");
const providerWorkRoute = await Deno.readTextFile("apps/logistics-mobile/app/(provider)/work/[id].tsx");
const providerJobRoute = await Deno.readTextFile("apps/logistics-mobile/app/(provider)/work.tsx");
const bookingFulfillmentMigration = await Deno.readTextFile("supabase/migrations/20261103143849_logistics_booking_fulfillment_and_settlement.sql");
const logisticsRuntime = await Deno.readTextFile("supabase/functions/logistics-runtime/index.ts");
const geographySearchMigration = await Deno.readTextFile("supabase/migrations/20261103161500_logistics_location_hierarchy_search.sql");
const companyApplication = await Deno.readTextFile("apps/logistics-mobile/src/ui/LogisticsCompanyApplicationPanel.tsx");
const companyFleet = await Deno.readTextFile("apps/logistics-mobile/src/ui/LogisticsCompanyFleetPanel.tsx");
const publicMediaPicker = await Deno.readTextFile("apps/logistics-mobile/src/ui/LogisticsMediaPicker.tsx");
const companyApplicationMigration = await Deno.readTextFile("supabase/migrations/20261103165000_logistics_company_application_documents.sql");
const publicMediaMigration = await Deno.readTextFile("supabase/migrations/20261103164500_logistics_public_company_and_vehicle_media.sql");
const companyFleetMigration = await Deno.readTextFile("supabase/migrations/20261103170000_logistics_company_managed_fleet.sql");
const companyFleetDriverMigration = await Deno.readTextFile("supabase/migrations/20261103171000_logistics_company_fleet_driver_directory.sql");

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

Deno.test("Expo APK profiles have the production Supabase and gateway configuration", () => {
  const easConfig = JSON.parse(easConfigText) as {
    readonly build?: Record<string, { readonly android?: { readonly buildType?: string }; readonly env?: Record<string, string> }>;
  };
  for (const profile of ["preview", "production"]) {
    const config = easConfig.build?.[profile];
    if (!config) throw new Error("Missing EAS build profile: " + profile);
    if (config.android?.buildType !== "apk") throw new Error(profile + " must produce an APK");
    if (config.env?.EXPO_PUBLIC_SUPABASE_URL !== "https://npgladvhpidkgpyzdwxf.supabase.co") {
      throw new Error(profile + " must use the production SKIMA Supabase URL");
    }
    if (!config.env?.EXPO_PUBLIC_SUPABASE_ANON_KEY?.startsWith("eyJ")) {
      throw new Error(profile + " must use a client-safe Supabase anon key");
    }
    if (config.env?.EXPO_PUBLIC_API_GATEWAY_URL !== "https://npgladvhpidkgpyzdwxf.supabase.co/functions/v1/api-gateway") {
      throw new Error(profile + " must use the shared Supabase API gateway");
    }
  }
  requireText(appConfig, "EXPO_PUBLIC_EAS_PROJECT_ID", "optional EAS project link");
  requireText(appConfig, "projectId: easProjectId", "EAS project identifier wiring");
});

Deno.test("Logistics Vercel app root builds the Expo web export", () => {
  const config = JSON.parse(vercelConfigText) as Record<string, unknown>;
  if (config.installCommand !== "npm install --no-audit --no-fund") throw new Error("Logistics Vercel install command mismatch");
  if (config.buildCommand !== "npm run build:web") throw new Error("Logistics Vercel build command mismatch");
  if (config.outputDirectory !== "dist") throw new Error("Logistics Vercel output directory must be dist");
  requireText(vercelConfigText, "vercel-ignore.mjs logistics", "Logistics Vercel ignore gate");
});

Deno.test("Customer and provider deep links survive browser refresh across the four Expo customer apps", () => {
  for (const [name, configText] of [
    ["Logistics", vercelConfigText],
    ["LPG", lpgVercelConfig],
    ["Store", storeVercelConfig],
    ["Bills", billsVercelConfig],
  ] as const) {
    const config = JSON.parse(configText) as { rewrites?: Array<{ source?: string; destination?: string }> };
    if (!config.rewrites?.some((rule) => rule.source === "/(.*)" && rule.destination === "/index.html")) {
      throw new Error(name + " must route direct deep links and refreshes to the Expo Router entry document");
    }
  }
  requireText(providerWorksRoute, "ProviderOpportunitiesScreen", "legacy /works route resolves to the provider opportunity inbox");
  requireText(providerWorksRoute, "Backwards-compatible route", "legacy provider deep link compatibility");
});

Deno.test("Managed Driver coverage shows all enabled geographies but blocks unsafe boundaryless dispatch assignments", () => {
  requireText(managedDriverCoverage, "const selectableAreas = serviceAreas.data ?? []", "all enabled selectable geographies remain visible");
  requireText(managedDriverCoverage, "const availableAreas = selectableAreas.filter", "all unassigned enabled areas are listed");
  requireText(managedDriverCoverage, "Map boundary required", "boundary requirement is visible to administrators");
  requireText(managedDriverCoverage, "selectedAreaCanBeAssigned", "physical driver assignment remains boundary-gated");
  requireText(managedDriverCoverage, "geography & coverage setup", "admin can navigate to boundary setup");
  requireText(managedDriverCoverage, "dispatch uses the customer’s GPS point", "explain why a verified boundary is required");
});

Deno.test("Logistics request review actions fit the mobile viewport", () => {
  requireText(request, 'backAction: { flexBasis: "30%", flexGrow: 0', "back action has bounded mobile width");
  requireText(request, "primaryActionWithBack: { flex: 1, maxWidth: 230", "publish action is capped beside Back");
  requireText(request, 'disabled={!canSubmit}', "publish action respects complete request validation");
});

Deno.test("Logistics address matching chooses the most specific geography and blocks country-only requests", () => {
  requireText(geography, "resolveMostSpecificGeography", "hierarchy-aware location resolution");
  requireText(geography, "hierarchyParts", "canonical parent/child location hierarchy");
  requireText(geography, "deepest.length === 1 ? deepest[0] : null", "ambiguous city aliases require a specific LGA choice");
  requireText(geography, "if (specificMatches.length) return resolveMostSpecificGeography(specificMatches)", "ambiguous LGA matches cannot fall through to a broader state");
  requireText(geography, "if (lgaMatches.length) return resolveMostSpecificGeography(lgaMatches)", "ambiguous LGA component matches stay unresolved");
  requireText(geography, "geography_hierarchy_path", "selected address retains its resolved hierarchy");
  requireNotText(geography, 'normalized(asString(item, "canonical_name")) === "nigeria"', "no silent country-root fallback for an unresolved street");
  requireText(request, "hasServiceGeography(pickup)", "pickup cannot publish at country-only scope");
  requireText(request, "hasServiceGeography(destination)", "destination cannot publish at country-only scope");
  requireText(request, "geography_hierarchy_path", "request snapshot stores coverage hierarchy");
});

Deno.test("Logistics publish actions are constrained and customer order details display handling notes", () => {
  requireText(request, 'backAction: { flexBasis: "30%", flexGrow: 0', "back button has a bounded share of the action row");
  requireText(request, "primaryActionWithBack: { flex: 1, maxWidth: 230", "publish button has a maximum mobile width");
  requireText(detail, "Additional instructions", "customer can read handling notes after publishing");
  requireText(detail, 'asString(job, "instructions")', "order page reads saved instructions");
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
  requireText(geography, "/runtime/logistics/geographies?countryCode=NG&search=", "Nigeria geography catalogue");
  requireText(request, "useCreateLogisticsJob", "customer job publish mutation");
  requireText(logisticsApi, 'api.post("/runtime/logistics/jobs"', "customer job publish API route");
  requireText(request, "createClientIdempotencyKey", "request submission idempotency");
  requireText(request, "[1, 2, 3, 4].map", "four-stage progress indicator");
  requireText(request, "STEP {step} OF 4", "four-stage request progress");
  requireText(request, "Review your request", "customer review step before publishing");
  requireText(request, "step < 4", "three information stages before the final publish stage");
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
  requireText(detail, "/runtime/logistics/offers?jobId=", "provider quotes");
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

Deno.test("Customer account keeps preferences and browser/native sign-out interactive", () => {
  requireText(account, "<Pressable", "interactive preference rows");
  requireText(account, "void toggle()", "working appearance toggle");
  requireText(account, "setLogoutOpen(true)", "cross-platform sign-out confirmation");
  requireText(account, "await signOut()", "awaited secure sign-out");
  requireText(account, "client.clear()", "clear cached user data after sign-out");
  requireText(session, 'signOut({ scope: "local" })', "revoke the current device session");
  requireText(account, 'router.replace("/(auth)/sign-in"', "return to the signed-out route");
});

Deno.test("Provider workspace has separate company, opportunities and jobs routes", () => {
  requireText(providerNavigation, 'name="opportunities"', "provider opportunity tab");
  requireText(providerNavigation, 'name="work"', "provider job management tab");
  requireText(providerNavigation, 'name="services"', "provider company and service setup tab");
  requireText(providerDashboard, "ProviderDashboardScreen", "provider company overview");
  requireText(providerOpportunities, "/runtime/logistics/opportunities", "matched provider inbox");
  requireText(providerCompany, "/runtime/logistics/company/services", "service configuration route");
  requireText(providerCompany, "/runtime/logistics/company/coverage", "coverage configuration route");
  requireText(providerCompany, 'coverageMode === "route"', "route corridor coverage mode");
  requireText(providerJobs, "/runtime/logistics/bookings?providerOrganizationId=", "provider-owned booking list");
  requireText(providerBookingDetail, "/runtime/logistics/bookings/accept", "provider accept lifecycle");
  requireText(providerDriver, "/runtime/logistics/bookings/start", "assigned driver start lifecycle");
  requireText(providerDriver, "/runtime/logistics/bookings/delivery/submit", "assigned driver delivery submission lifecycle");
  requireText(providerRoutes, "ProviderTabs", "provider tab route layout");
  requireText(providerJobRoute, "ProviderJobsScreen", "provider jobs route");
  requireText(providerWorkRoute, "ProviderBookingDetailScreen", "provider booking detail route");
});

Deno.test("Provider matched opportunities are free and enable customer contact and quote negotiation", () => {
  requireText(providerOpportunities, "customer_contact_snapshot", "matched provider customer contact");
  requireText(providerOpportunities, "Linking.openURL", "call/email customer actions");
  requireText(providerOpportunities, "createClientIdempotencyKey", "retry-safe provider offer submission");
  requireText(providerOpportunities, '"/runtime/logistics/offers"', "provider quote submission");
  requireText(providerOpportunities, '"/runtime/logistics/offers/counter"', "provider counteroffer response");
  requireText(providerOpportunities, "There is no lead unlock fee", "free opportunity access");
});

Deno.test("Provider booking actions preserve idempotency on retries and changed delivery evidence", () => {
  requireText(providerBookingDetail, "actionKeysRef", "provider action idempotency cache");
  requireText(providerBookingDetail, "assign:", "driver-and-vehicle assignment retry fingerprint");
  requireText(providerBookingDetail, "selectedDriverProfileId", "company assignment identity includes its driver");
  requireText(providerBookingDetail, "selectedVehicleId", "company assignment identity includes its vehicle");
  requireText(providerBookingDetail, "actionKeysRef.current.get(fingerprint)", "same company assignment retry reuses its key");
  requireText(providerBookingDetail, "actionKeysRef.current.set(fingerprint, key)", "new company assignment receives a new key");
  requireText(providerDriver, "const evidence = input.kind === \"deliver\"", "delivery evidence is fingerprinted separately");
  requireText(providerDriver, "input.recipientName?.trim()", "delivery recipient part of retry identity");
  requireText(providerDriver, "input.deliveryNote?.trim()", "delivery note part of retry identity");
  requireText(providerDriver, "actionKeys.current.get(fingerprint)", "same driver action retry reuses its key");
  requireText(providerDriver, "actionKeys.current.set(fingerprint, idempotencyKey)", "changed driver evidence receives a new key");
});

Deno.test("Customer can counter a matched provider quote before booking", () => {
  requireText(detail, '"/runtime/logistics/offers/counter"', "customer counteroffer API");
  requireText(detail, "Make a counteroffer", "customer negotiation sheet");
  requireText(detail, "Send counteroffer", "counteroffer submission control");
  requireText(detail, "toMinorUnits", "currency minor-unit conversion");
  requireText(detail, "counterAttemptRef", "network retry idempotency");
  requireText(detail, "estimatedDurationMinutes", "optional proposed delivery duration");
  requireText(detail, "Additional terms", "customer negotiation terms");
  requireText(logisticsRuntime, 'supabase.rpc("counter_logistics_offer"', "shared counteroffer lifecycle");
});

Deno.test("Provider delivery payload is normalized to the database contract", () => {
  requireText(logisticsRuntime, "deliverySubmission.recipientName ?? deliverySubmission.recipient_name", "camelCase recipient compatibility");
  requireText(logisticsRuntime, "recipient_name: recipientName", "database recipient payload key");
  requireText(logisticsRuntime, "delivery_note: deliveryNote ?? null", "database delivery note payload key");
  requireText(bookingFulfillmentMigration, "recipient_name text", "required delivery recipient");
});

Deno.test("Provider company can view and fund its receivables wallet without bypassing the shared ledger", () => {
  requireText(providerCompany, "Company wallet", "provider wallet balance panel");
  requireText(providerCompany, "/runtime/wallets", "owner-visible wallet catalogue");
  requireText(providerCompany, "/runtime/wallet-balances", "live company wallet balance");
  requireText(providerCompany, "personalWallets", "funding source is the owner's personal customer wallet");
  requireText(providerCompany, "/runtime/logistics/company/wallet/fund", "secure company wallet funding route");
  requireText(providerCompany, "Move funds to company wallet", "interactive owner funding action");
  requireText(providerCompany, "createClientIdempotencyKey", "funding retry idempotency");
  requireNotText(providerCompany, "SUPABASE_SERVICE_ROLE_KEY", "no privileged database credential in the app");
});

Deno.test("Customer confirmation triggers online settlement but never double-charges offline completion", () => {
  requireText(booking, "/runtime/logistics/bookings/delivery/confirm", "customer completion action");
  requireText(booking, "Confirm delivery received", "customer delivery confirmation");
  requireText(bookingFulfillmentMigration, "execute_service_request_settlement", "online settlement is customer-confirmed");
  requireText(bookingFulfillmentMigration, "current_status := 'completed_offline'", "offline completion state");
  requireText(bookingFulfillmentMigration, "booking_record.customer_booking_fee_amount + booking_record.provider_receival_fee_amount", "offline fees are checked only when configured");
  requireText(bookingFulfillmentMigration, "configured offline booking fees must be confirmed", "zero-fee offline booking can complete");
});


Deno.test("Logistics company team uses existing tenant-scoped staff governance with limited roles", () => {
  requireText(providerNavigation, 'name="team"', "provider team tab");
  requireText(providerTeamRoute, "ProviderTeamScreen", "dedicated team route");
  requireText(providerTeam, '"/runtime/organization-staff/directory?organizationId="', "tenant-scoped staff directory");
  requireText(providerTeam, '"/runtime/organization-invitations"', "company invitation list");
  requireText(providerTeam, '"/runtime/organization-roles"', "governed company role creation");
  requireText(providerTeam, '"/runtime/organization-staff/status"', "staff access suspension and restoration");
  requireText(providerTeam, 'membershipType: "member"', "invitees never receive company-owner membership");
  requireText(providerTeam, '"business.logistics.jobs.manage"', "operational role permissions");
  requireText(providerTeam, '"business.logistics.offers.manage"', "quote management role permissions");
  requireText(providerTeam, '"business.logistics.finance.read"', "finance is read-only");
  requireText(providerTeam, '"logistics.company.driver"', "least-privilege driver invitation role");
  requireText(providerTeam, "SKIMA-approved driver profile", "driver role requires existing SKIMA driver approval");
  requireText(providerTeam, "active, compliant vehicle", "driver role explains vehicle eligibility");

  requireText(providerTeam, "canManage", "company-owner/staff-administrator gate");
  requireText(providerTeam, "expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)", "bounded seven-day invitation expiry");
  requireNotText(providerTeam, 'membershipType: "owner"', "no owner privilege is granted through staff invitations");
});


Deno.test("Logistics invitees can discover, accept and decline only their own Logistics invitations", () => {
  requireText(account, '"/runtime/organization-invitations"', "invitee-visible invitation inbox");
  requireText(account, '"/runtime/organization-invitations/" + input.action', "shared accept and decline actions");
  requireText(account, 'metadata.module === "logistics_network"', "isolate Logistics invitations from other SKIMA modules");
  requireText(account, 'asString(item, "invited_email")', "match invitation to signed-in email");
  requireText(account, 'asString(item, "invited_user_id")', "match invitation to signed-in profile");
  requireText(account, 'asString(item, "status") === "pending"', "only pending invitations may be actioned");
  requireText(account, 'input.action === "accept"', "acceptance confirmation");
  requireText(account, 'action: "accept" | "decline"', "both invitation responses are supported");
  requireText(account, 'respondToInvitation.mutate({ invitationId, action: "decline" })', "decline confirmation action");
  requireText(account, "Company invitation declined.", "decline result is shown to the invitee");
  requireText(account, "Company invitation accepted", "post-accept company workspace guidance");
  requireText(account, "You can now open the company workspace", "accepted company access next step");
});


Deno.test("Invited Logistics staff can accept or decline from their own account", () => {
  requireText(account, '"/runtime/organization-invitations"', "recipient-visible invitation query");
  requireText(account, 'metadata.module === "logistics_network"', "only Logistics invitations are shown");
  requireText(account, '"/runtime/organization-invitations/" + input.action', "shared invitation accept/decline lifecycle");
  requireText(account, 'action: "accept" | "decline"', "both invitation responses");
  requireText(account, "Accept invitation", "accept invitation control");
  requireText(account, "Decline invitation", "decline invitation confirmation");
  requireText(account, "Open company workspace", "workspace entry after acceptance");
  requireText(account, "invitations.refetch()", "invitation state refresh");
  requireText(account, "context?.organizations.find", "accepted company membership can be labelled");
  requireNotText(account, "invitationId + \":\" + String(Date.now())", "stable invitation idempotency across retries");
});


Deno.test("Company booking workspace assigns an eligible driver and vehicle before fulfillment starts", () => {
  requireText(providerBookingDetail, "/runtime/logistics/company/dispatch-resources?organizationId=", "eligible company driver and vehicle catalogue");
  requireText(providerBookingDetail, '"/runtime/logistics/bookings/assign-driver"', "company dispatch assignment API");
  requireText(providerBookingDetail, "Send driver assignment", "dispatch assignment control");
  requireText(providerBookingDetail, "Choose vehicle", "company chooses driver vehicle pair");
  requireText(providerBookingDetail, "The driver must accept", "driver acceptance before start");
  requireNotText(providerBookingDetail, "Submit delivery details", "provider cannot submit delivery in place of assigned driver");
});



Deno.test("Logistics marketplace administration is permission-gated and uses the existing governance APIs", () => {
  requireNotText(account, 'router.push("/logistics-admin"', "platform administration is not exposed in the Logistics app");
  requireNotText(account, "Open Logistics administration", "no platform-admin entry in customer/provider workspace");
  requireText(logisticsAdminRoute, "export function LogisticsWorkspace", "existing SKIMA Admin V2 workspace");
  requireText(logisticsAdmin, '"logistics.marketplace.manage"', "admin screen permission gate");
  requireText(logisticsAdmin, '"/runtime/logistics/company"', "provider register uses RLS-protected provider list");
  requireText(logisticsAdmin, '"/runtime/logistics/categories"', "database-driven service catalogue");
  requireText(logisticsAdmin, '"/runtime/logistics/admin/providers/verification"', "provider verification lifecycle");
  requireText(logisticsAdmin, '"/runtime/logistics/company/status"', "provider operational controls");
  requireText(logisticsAdmin, '"/runtime/logistics/admin/categories"', "service category upsert API");
  requireText(logisticsAdmin, 'decision: "verified"', "provider approval decision");
  requireText(logisticsAdmin, 'decision: "rejected"', "provider rejection decision");
  requireText(logisticsAdmin, 'status: "paused"', "provider pause control");
  requireText(logisticsAdmin, 'status: "active"', "provider reactivation control");
  requireText(logisticsAdmin, "parentKey", "hierarchical category management");
  requireText(logisticsAdmin, "sortOrder", "category ordering");
  requireNotText(logisticsAdmin, "SUPABASE_SERVICE_ROLE_KEY", "no privileged database credential in admin app");
});


Deno.test("Customers can withdraw a Logistics request only before booking", () => {
  requireText(detail, '"/runtime/logistics/jobs/cancel"', "pre-booking customer cancellation endpoint");
  requireText(detail, '["open", "matching", "offers_received"].includes(status)', "customer cancellation eligibility states");
  requireText(detail, "Cancel this request", "customer cancellation control");
  requireText(detail, "No provider booking has been created", "pre-booking cancellation explanation");
  requireText(detail, "cancelJob.isPending", "cancellation action is protected while pending");
  requireText(detail, "Alert.alert", "cancellation requires customer confirmation");
  requireText(detail, "createClientIdempotencyKey(\"logistics.job.cancel\"", "retry-safe cancellation key");
  requireText(detail, "router.replace(\"/(customer)/jobs\"", "return to customer request activity after cancellation");
  requireNotText(detail, "Cancel paid booking", "no unsupported paid booking cancellation control");
});


Deno.test("Customers can cancel only an unpaid Logistics booking from checkout", () => {
  requireText(booking, '"/runtime/logistics/bookings/cancel"', "pre-payment booking cancellation endpoint");
  requireText(booking, 'status === "awaiting_payment"', "online unpaid booking eligibility");
  requireText(booking, 'status === "awaiting_offline_confirmation"', "offline unpaid booking eligibility");
  requireText(booking, "Cancel booking", "customer cancellation control");
  requireText(booking, "No wallet debit, refund or provider payout will be created", "no misleading financial outcome");
  requireText(booking, "cancelBooking.isPending", "cancel button pending state");
  requireText(booking, "createClientIdempotencyKey(\"logistics.booking.cancel\"", "retry-safe booking cancellation key");
  requireText(booking, 'status === "cancelled"', "cancelled booking confirmation state");
  requireText(booking, 'Alert.alert( "Cancel this booking?"', "cancellation requires explicit confirmation");
});


Deno.test("Driver workspace is reachable only for a registered driver and shows assigned work", () => {
  requireText(providerNavigation, 'name="driver"', "dedicated driver navigation tab");
  requireText(providerWorkspace, "driverProfile.data?.registered === true", "company workspace shows the driver entry only for a registered driver profile");
  requireText(providerWorkspace, 'router.push("/(provider)/driver" as never)', "registered driver opens the dedicated workspace");
  requireText(providerWorkspace, '"/runtime/logistics/driver/profile"', "workspace resolves registered driver profile");
  requireText(providerDriverRoute, "LogisticsDriverScreen", "dedicated authenticated provider driver route");
  requireText(providerDriver, '"/runtime/logistics/driver/profile"', "driver profile and verification check");
  requireText(providerDriver, '"/runtime/logistics/driver/bookings"', "driver-owned assigned booking inbox");
  requireText(providerDriver, '"/runtime/logistics/driver/assignment/respond"', "driver accepts or rejects a company assignment");
  requireText(providerDriver, '"/runtime/logistics/bookings/start"', "assigned driver starts the job");
  requireText(providerDriver, '"/runtime/logistics/driver/milestone"', "driver pickup and transit milestone API");
  requireText(providerDriver, '"/runtime/logistics/bookings/delivery/submit"', "driver submits final delivery details");
  requireText(providerDriver, "Confirm pickup", "pickup stage action");
  requireText(providerDriver, "Mark in transit", "transit stage action");
  requireText(providerDriver, "Received by", "named delivery recipient proof");
  requireText(providerDriver, "Awaiting customer confirmation", "customer remains final delivery confirmer");
  requireText(account, 'router.replace("/(provider)/driver" as never)', "customer/provider account opens the authenticated driver workspace");
});


Deno.test("An interrupted online booking payment can only be retried with its original customer wallet", () => {
  requireText(booking, 'asString(booking, "payment_attempt_wallet_id")', "payment attempt wallet returned from the server");
  requireText(booking, 'status === "payment_processing"', "recoverable payment attempt state");
  requireText(booking, "Payment attempt in progress", "customer sees the payment recovery state");
  requireText(booking, "original wallet is locked to this attempt", "customer is not offered a different wallet");
  requireText(booking, "Continue payment confirmation", "customer can retry the atomic reservation");
  requireText(booking, 'status !== "payment_processing" && !enoughBalance', "retry does not incorrectly require the wallet to retain the already-debited balance");
  requireText(booking, '"/runtime/logistics/bookings/cancel"', "payment retry and cancellation remain distinct operations");
});


Deno.test("Foreground GPS sharing is explicit and visible only during an active Logistics driver job", () => {
  requireText(appPackage, '"expo-location": "~57.0.18"', "Expo foreground location dependency");
  requireText(appConfig, '"expo-location"', "Expo location config plugin");
  requireText(appConfig, "locationWhenInUsePermission", "foreground-only location permission disclosure");
  requireText(driverLocationShare, "Location.requestForegroundPermissionsAsync()", "driver explicitly grants foreground location access");
  requireText(driverLocationShare, "Location.watchPositionAsync", "driver location watch");
  requireText(driverLocationShare, "timeInterval: 15_000", "bounded 15-second foreground update cadence");
  requireText(driverLocationShare, "distanceInterval: 25", "distance-gated foreground updates");
  requireText(driverLocationShare, '"/runtime/logistics/driver/location"', "driver GPS write route");
  requireText(driverLocationShare, "useFocusEffect", "sharing lifecycle follows driver screen focus");
  requireText(driverLocationShare, "sharingEnabled.current = false", "stop and blur disable further location writes");
  requireText(providerDriver, "LogisticsDriverLocationShare", "driver job screen owns the tracking control");
  requireText(providerDriver, '["in_progress", "picked_up", "in_transit"]', "location sharing is available only after work starts");
  requireText(booking, '"/runtime/logistics/bookings/tracking?bookingId="', "customer booking tracking read");
  requireText(booking, "15_000", "customer sees fresh driver location without manual reload");
  requireText(booking, "Open location in Maps", "customer can open the latest GPS position");
  requireText(booking, "tracking.refetch()", "customer pull-to-refresh also refreshes tracking");
  requireNotText(appConfig, "locationAlwaysAndWhenInUsePermission", "no implicit background location permission");
});


Deno.test("An accepted driver can return an unstarted Logistics booking to company dispatch", () => {
  requireText(providerDriver, '"release"', "driver release action type");
  requireText(providerDriver, '"/runtime/logistics/driver/assignment/release"', "release endpoint");
  requireText(providerDriver, "I can't start this job", "pre-start unavailability control");
  requireText(providerDriver, "Return this job to dispatch?", "driver release confirmation");
  requireText(providerDriver, "Reason you cannot start", "driver supplies an operational release reason");
  requireText(providerDriver, "releaseReason.trim().length < 5", "driver cannot release without a useful reason");
  requireText(providerDriver, "reason: releaseReason", "driver's actual reason is sent to dispatch");

  requireText(providerDriver, "The customer booking and payment remain unchanged", "release does not imply booking cancellation");
  requireText(providerDriver, 'status === "accepted"', "release control exists only before service start");
});

Deno.test("Company dispatch can replace an offered or accepted pre-start driver", () => {
  requireText(providerBookingDetail, "isReplacingAssignment", "explicit company replacement state");
  requireText(providerBookingDetail, 'label="Replace assigned driver"', "replace current driver control");
  requireText(providerBookingDetail, "dispatchResources.refetch()", "eligible replacement resources refresh");
  requireText(providerBookingDetail, "Keep current assignment", "replacement can be abandoned safely");
  requireText(providerBookingDetail, "Previous driver update", "company sees prior driver release or rejection context");
  requireText(providerBookingDetail, "response_reason", "the driver's reason is displayed to dispatch");
  requireText(providerBookingDetail, "Replace the current driver?", "replacement requires dispatcher confirmation");
  requireText(providerBookingDetail, "Confirm replacement", "dispatcher explicitly confirms reassignment");
  requireText(providerBookingDetail, "Send replacement assignment", "replacement action is clearly labelled");

  requireText(providerBookingDetail, '"/runtime/logistics/bookings/assign-driver"', "replacement uses the existing tenant-guarded assignment function");
});


Deno.test("Driver incidents stop normal delivery controls until dispatch resolves cargo custody", () => {
  requireText(providerDriver, '"/runtime/logistics/bookings/incidents/report"', "driver incident report endpoint");
  requireText(providerDriver, "Report a delivery incident", "driver incident entry point");
  requireText(providerDriver, "Vehicle breakdown", "breakdown incident type");
  requireText(providerDriver, "Cargo damaged", "cargo damage incident type");
  requireText(providerDriver, "Cargo missing", "missing cargo incident type");
  requireText(providerDriver, "cargoCustodyStatus", "driver submits explicit custody state");
  requireText(providerDriver, "bookingOnHold", "active exception blocks normal driver controls");
  requireText(providerDriver, "Delivery exception under review", "driver sees dispatch hold instructions");
  requireText(providerDriver, "!bookingOnHold", "GPS and delivery milestones stop while the booking is on hold");
});

Deno.test("Customer can raise a delivery dispute and see the protected payment outcome", () => {
  requireText(booking, '"/runtime/logistics/bookings/disputes/open"', "customer dispute endpoint");
  requireText(booking, "Report a delivery problem", "customer complaint entry point");
  requireText(booking, "Not received", "non-delivery reason");
  requireText(booking, "Partial delivery", "partial delivery reason");
  requireText(booking, "Cargo damaged", "damaged cargo reason");
  requireText(booking, "original escrow remains frozen", "online disputed funds stay protected");
  requireText(booking, "manual finance review", "offline payment complaint does not promise an automatic refund");
});

Deno.test("Company dispatch can resolve an incident or send a distinct cargo recovery driver", () => {
  requireText(providerBookingDetail, '"/runtime/logistics/bookings/incidents/respond"', "company incident response endpoint");
  requireText(providerBookingDetail, "Require cargo recovery", "company can require recovery");
  requireText(providerBookingDetail, "Restore customer delivery confirmation", "submitted delivery incidents restore the customer receipt step");
  requireText(providerBookingDetail, "incidentBookingStatus === \"in_progress\"", "same-driver resume is only offered for active transit");
  requireText(providerBookingDetail, "incidentBookingStatus === \"delivered\"", "confirmation restoration is reserved for a submitted delivery");
  requireText(providerBookingDetail, "Resume delivery with current driver", "safe same-driver resume path");
  requireText(providerBookingDetail, "Cargo recovery dispatch", "recovery dispatch workspace");
  requireText(providerBookingDetail, '"/runtime/logistics/bookings/assign-recovery-driver"', "dedicated recovery assignment route");
  requireText(providerDriver, '"/runtime/logistics/bookings/recovery/start"', "recovery driver start route");
  requireText(providerDriver, "Start cargo recovery", "recovery driver start control");
});

Deno.test("Platform Logistics administration can review disputes with finance-authorized outcomes", () => {
  requireText(logisticsAdmin, '"/runtime/logistics/bookings/disputes"', "admin dispute register");
  requireText(logisticsAdmin, "Customer dispute review", "admin dispute queue");
  requireText(logisticsAdmin, "platform.escrow.execute", "refund authority is permission-gated");
  requireText(logisticsAdmin, "Refund full escrow", "full escrow refund action");
  requireText(logisticsAdmin, "Send to finance review", "offline dispute escalation");
  requireText(logisticsAdmin, "Close review", "offline review closure");
  requireText(logisticsAdmin, "recoveredDeliverySubmitted", "admin can recognize verified recovered delivery");
  requireText(logisticsAdmin, "recovered_delivery_submitted", "customer confirmation remains available after recovered delivery");
});


Deno.test("Logistics address search is Nigeria-scoped, detailed and supports manual full-address entry", () => {
  requireText(geography, '"/lpg/maps/autocomplete"', "server-side LocationIQ address autocomplete");
  requireText(geography, "/runtime/logistics/geographies?countryCode=NG&search=", "complete Nigeria geography hierarchy");
  requireText(geography, "address_components", "full address components retained");
  requireText(geography, "location: location,", "address coordinates retained in the selected place payload");
  requireText(geography, "Use typed address instead", "manual entry is available alongside suggestions");
  requireText(geography, "manualBase", "manual address linked to nearest known geography");
  requireText(geography, "state_district", "LGA/district hierarchy matching");
  requireText(logisticsRuntime, 'routePath === "/runtime/logistics/geographies"', "searchable canonical geography runtime");
  requireText(logisticsRuntime, 'supabase.rpc("search_logistics_geographies"', "canonical geography search uses the dedicated RPC");
  requireText(geographySearchMigration, "jsonb_array_elements_text", "configured geography aliases are searchable");
  requireText(geographySearchMigration, "match_rank", "geography results prioritize precise matches");
  requireText(request, "address_snapshot: locationSnapshot(pickup)", "pickup address details retained on request");
  requireText(request, "address_snapshot: locationSnapshot(destination)", "destination address details retained on request");
});

Deno.test("Unregistered Logistics companies can apply and submit optional private evidence for SKIMA review", () => {
  requireText(companyApplicationMigration, "'application.logistics.company'", "Logistics company application type");
  requireText(companyApplicationMigration, "'logistics.company.registration'", "optional business registration evidence requirement");
  requireText(companyApplicationMigration, "false", "company registration evidence is not mandatory");
  requireText(companyApplicationMigration, "optional_for_unregistered_company", "unregistered applicants may continue");
  requireText(companyApplicationMigration, "'workflow.application.review.default'", "existing review workflow");
  requireText(companyApplication, "registrationEvidenceOptional", "application captures unregistered status");
  requireText(companyApplication, "Start company application", "company can initiate application");
  requireText(companyApplication, '"/runtime/media/upload-sessions"', "protected company evidence upload session");
  requireText(companyApplication, '"/runtime/documents"', "document submission uses shared verification registry");
  requireText(companyApplication, '"skima-platform-documents"', "private document storage bucket");
  requireText(companyApplication, "platformReviewRequired: true", "SKIMA retains final approval authority");
});

Deno.test("Logistics public company, driver and vehicle photos use the protected media registry", () => {
  requireText(publicMediaPicker, '"/runtime/media/upload-sessions"', "protected image upload session");
  requireText(publicMediaPicker, '"/runtime/media/assets"', "media registry asset registration");
  requireText(publicMediaPicker, '"/runtime/media/entity-links"', "public entity-media link");
  requireText(publicMediaPicker, '"/runtime/media/read-sessions"', "protected media preview");
  requireText(publicMediaMigration, "'logistics_company'", "company public-media entity support");
  requireText(publicMediaMigration, "'logistics_vehicle'", "company vehicle public-media entity support");
  requireText(publicMediaMigration, "'logistics.company.logo.public'", "company logo role");
  requireText(publicMediaMigration, "'logistics.company.photo.public'", "company accountability photo role");
  requireText(publicMediaMigration, "'logistics.vehicle.photo.public'", "vehicle public photo role");
  requireText(publicMediaMigration, "PRIVATE_KYC", "private KYC media cannot be published");
  requireText(providerCompany, "Public company identity", "company logo and public photo controls");
  requireText(providerDriver, "Your public driver photo", "driver portrait is customer-facing");
});

Deno.test("Company-managed fleet bypasses SKIMA vehicle approval but preserves driver and expiry safeguards", () => {
  requireText(companyFleet, '"/runtime/logistics/company/vehicles"', "company-managed vehicle registration");
  requireText(companyFleet, '"/runtime/logistics/company/vehicles/assign-driver"', "company-owned driver/vehicle assignment");
  requireText(companyFleet, "SKIMA does not need to approve the vehicle or its licensing", "no platform vehicle-approval step");
  requireText(companyFleet, "insurance_expires_at", "company-managed insurance expiry display");
  requireText(companyFleet, "Assign a company driver", "company can manage vehicle assignment");
  requireText(companyFleetMigration, "ownership_relationship", "company ownership is explicit");
  requireText(companyFleetMigration, "'business_owned'", "company-owned vehicle type");
  requireText(companyFleetMigration, "'active'", "company-managed vehicle is immediately active");
  requireText(companyFleetMigration, "company_attested_ownership", "company ownership is audited");
  requireText(companyFleetMigration, "licensing_responsibility", "company retains licensing responsibility");
  requireText(companyFleetMigration, "verification_status = 'approved'", "driver identity approval remains required");
  requireText(companyFleetMigration, "assign_logistics_company_vehicle_to_driver", "dedicated company assignment RPC");
  requireText(companyFleetDriverMigration, "read_logistics_company_fleet_drivers", "tenant-scoped company driver directory");
  requireText(logisticsRuntime, "register_logistics_company_vehicle", "vehicle API uses database lifecycle");
  requireText(logisticsRuntime, "assign_logistics_company_vehicle_to_driver", "driver assignment API uses database lifecycle");
  requireText(logisticsRuntime, "read_logistics_company_fleet_drivers", "company driver directory endpoint");
});


Deno.test("Customer and company workspaces keep phone, tablet and desktop responsive layouts", () => {
  requireText(screen, "const compact = width < 600", "compact phone header breakpoint");
  requireText(screen, "width >= 1440 ? 1160 : width >= 900 ? 960 : 780", "responsive content widths");
  requireText(customerNavigation, "useWindowDimensions().width >= 900", "customer desktop navigation breakpoint");
  requireText(providerNavigation, "useWindowDimensions().width >= 900", "company desktop navigation breakpoint");
  requireText(customerNavigation, 'tabBarPosition: desktop ? "left" : "bottom"', "customer desktop side navigation");
  requireText(providerNavigation, 'tabBarPosition: desktop ? "left" : "bottom"', "company desktop side navigation");
  requireText(providerWorkspace, "const desktop = width >= 720", "company workspace tablet card layout");
  requireText(home, 'width: width >= 1120 ? "31.5%" : width >= 680 ? "48.5%" : "48.5%"', "responsive customer service cards");
  requireText(storeScreen, 'width >= 1100 ? "23.5%" : width >= 700 ? "31.5%" : "48.5%"', "responsive Store product grid");
});

Deno.test("Logistics notification inbox is Store/Logistics-scoped and company invites are accepted in app", () => {
  requireText(home, 'router.push("/(customer)/notifications" as never)', "customer notification bell route");
  requireText(providerDashboard, 'router.push("/(provider)/notifications" as never)', "company notification bell route");
  requireText(customerNavigation, 'name="notifications"', "customer notification route registration");
  requireText(providerNavigation, 'name="notifications"', "company notification route registration");
  requireText(customerNotificationRoute, "LogisticsNotificationsScreen", "customer notification screen route");
  requireText(providerNotificationRoute, "LogisticsNotificationsScreen", "company notification screen route");
  requireText(notificationScreen, 'rpc("read_logistics_notification_center"', "Store/Logistics-only notification feed");
  requireText(notificationScreen, 'rpc("mark_all_logistics_notifications_read"', "mark only Logistics notifications read");
  requireText(notificationScreen, '"/runtime/organization-invitations/accept"', "accept a company invitation in app");
  requireText(notificationScreen, '"/runtime/organization-invitations/decline"', "decline a company invitation in app");
  requireText(notificationScreen, "Company workspace invitation", "Logistics-specific invitation card");
  requireText(notificationScreen, "logistics_network", "show only Logistics company invitations");
  requireNotText(notificationScreen, 'rpc("read_notification_center"', "no unscoped shared notification feed");
  requireNotText(notificationScreen, 'rpc("mark_all_notifications_read"', "do not mark LPG notifications read");
  requireText(providerTeam, "no email is sent", "invite recipient inside the app rather than email");
  requireText(providerTeam, "Send in-app invitation", "company team sends in-app invitation");
  requireText(logisticsNotificationMigration, "public.is_logistics_app_notification", "notification module scope");
  requireText(logisticsNotificationMigration, "'store.%'", "include Store updates");
  requireText(logisticsNotificationMigration, "'logistics.%'", "include Logistics updates");
  requireText(logisticsNotificationMigration, "'in_app'", "company invitation is in-app only");
  requireText(logisticsNotificationMigration, "recipient_address,", "notification does not address an outbound email");
});


Deno.test("Logistics visual tours normalize routes and resolve customer/company targets", () => {
  requireText(guideProvider, "normalizeGuideRoute", "Expo route group and index normalization");
  requireText(guideProvider, "routeGroup", "customer/company workspace detection");
  requireText(guideProvider, "requiredRoute=normalizeGuideRoute(step.route)", "route-aligned spotlight lookup");
  requireText(guideProvider, "measureInWindow", "actual control highlight measurement");
  requireText(guideProvider, "Remind me later", "tour snooze action");
  requireText(guideProvider, "7 days", "tour reminder period");
  requireText(guideProvider, "customer-home-request", "customer request highlight");
  requireText(guideProvider, "company-workspace-finance", "company finance highlight");
});
