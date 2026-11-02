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
const logisticsApi = await Deno.readTextFile("apps/logistics-mobile/src/api/logistics.ts");
const session = await Deno.readTextFile("apps/logistics-mobile/src/session/SessionProvider.tsx");
const providers = await Deno.readTextFile("apps/logistics-mobile/src/providers/AppProviders.tsx");
const routes = await Deno.readTextFile("apps/logistics-mobile/app/(customer)/_layout.tsx");
const providerNavigation = await Deno.readTextFile("apps/logistics-mobile/src/navigation/ProviderTabs.tsx");
const providerDashboard = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderDashboardScreen.tsx");
const providerOpportunities = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderOpportunitiesScreen.tsx");
const providerCompany = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderCompanyScreen.tsx");
const providerTeam = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderTeamScreen.tsx");
const driverJobsScreen = await Deno.readTextFile("apps/logistics-mobile/src/screens/DriverJobsScreen.tsx");
const driverJobDetailScreen = await Deno.readTextFile("apps/logistics-mobile/src/screens/DriverJobDetailScreen.tsx");
const driverNavigation = await Deno.readTextFile("apps/logistics-mobile/src/navigation/DriverTabs.tsx");
const driverRoutes = await Deno.readTextFile("apps/logistics-mobile/app/(driver)/_layout.tsx");
const driverHomeRoute = await Deno.readTextFile("apps/logistics-mobile/app/(driver)/index.tsx");
const driverWorkRoute = await Deno.readTextFile("apps/logistics-mobile/app/(driver)/work/[id].tsx");
const providerTeamRoute = await Deno.readTextFile("apps/logistics-mobile/app/(provider)/team.tsx");
const driverScreen = await Deno.readTextFile("apps/logistics-mobile/src/screens/LogisticsDriverScreen.tsx");
const driverRoute = await Deno.readTextFile("apps/logistics-mobile/app/(provider)/driver.tsx");
const providerJobs = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderJobsScreen.tsx");
const providerBookingDetail = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderBookingDetailScreen.tsx");
const providerRoutes = await Deno.readTextFile("apps/logistics-mobile/app/(provider)/_layout.tsx");
const providerWorkRoute = await Deno.readTextFile("apps/logistics-mobile/app/(provider)/work/[id].tsx");
const providerJobRoute = await Deno.readTextFile("apps/logistics-mobile/app/(provider)/work.tsx");
const bookingFulfillmentMigration = await Deno.readTextFile("supabase/migrations/20261102114500_logistics_booking_fulfillment_and_settlement.sql");
const logisticsRuntime = await Deno.readTextFile("supabase/functions/logistics-runtime/index.ts");

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
  requireText(geography, "/runtime/logistics/geographies?countryCode=NG&search=", "Nigeria geography catalogue");
  requireText(request, "useCreateLogisticsJob", "customer job publish mutation");
  requireText(logisticsApi, 'api.post("/runtime/logistics/jobs"', "customer job publish API route");
  requireText(request, "createClientIdempotencyKey", "request submission idempotency");
  requireText(request, "[1, 2, 3].map", "three-stage progress indicator");
  requireText(request, "STEP {step} OF 3", "three-stage request progress");
  requireText(request, "Review your request", "customer review step before publishing");
  requireText(request, "step < 3", "two information stages before the final publish stage");
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

Deno.test("Customer account keeps its preferences and sign-out controls interactive", () => {
  requireText(account, "<Pressable", "interactive preference rows");
  requireText(account, "void toggle()", "working appearance toggle");
  requireText(account, "void signOut()", "working secure sign-out");
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
  requireText(providerBookingDetail, "/runtime/logistics/bookings/start", "provider start lifecycle");
  requireText(providerBookingDetail, "/runtime/logistics/bookings/delivery/submit", "provider delivery submission lifecycle");
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
  requireText(providerBookingDetail, "const fingerprint = action === \"deliver\"", "delivery payload fingerprint");
  requireText(providerBookingDetail, "recipientName.trim()", "delivery recipient part of retry identity");
  requireText(providerBookingDetail, "deliveryNote.trim()", "delivery note part of retry identity");
  requireText(providerBookingDetail, "actionKeysRef.current.get(fingerprint)", "same action retry reuses its key");
  requireText(providerBookingDetail, "actionKeysRef.current.set(fingerprint, key)", "new delivery evidence receives a new key");
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
  requireText(account, 'input.action === "decline"', "decline confirmation");
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


Deno.test("Approved Logistics drivers have a dedicated authenticated delivery workspace", () => {
  requireText(providerNavigation, '"/runtime/logistics/driver/profile"', "driver-aware workspace visibility");
  requireText(providerNavigation, 'driverProfile.data?.registered === true', "driver tab is hidden from non-drivers");
  requireText(providerNavigation, 'name="driver"', "dedicated driver tab");
  requireText(driverRoute, "LogisticsDriverScreen", "driver route");
  requireText(driverScreen, '"/runtime/logistics/driver/profile"', "self-owned driver profile");
  requireText(driverScreen, '"/runtime/logistics/driver/bookings"', "self-owned driver assignments");
  requireText(driverScreen, '"/runtime/logistics/driver/assignment/respond"', "driver accept/decline action");
  requireText(driverScreen, '"/runtime/logistics/bookings/start"', "driver start action");
  requireText(driverScreen, '"/runtime/logistics/driver/milestone"', "driver pickup and transit milestones");
  requireText(driverScreen, '"/runtime/logistics/bookings/delivery/submit"', "driver delivery hand-off submission");
  requireText(driverScreen, "verification_status", "driver approval state");
  requireText(driverScreen, "No driver profile linked to this account", "safe onboarding fallback");
  requireText(driverScreen, "Confirm pickup", "pickup milestone control");
  requireText(driverScreen, "Depart · mark in transit", "transit milestone control");
  requireText(driverScreen, "Received by", "named hand-off recipient");
  requireText(driverScreen, "createClientIdempotencyKey", "retry-safe driver operations");
  requireText(driverScreen, "actionKeys.current.get(fingerprint)", "stable action key reuse");
  requireNotText(driverScreen, "SUPABASE_SERVICE_ROLE_KEY", "no privileged database credential in driver app");
});


Deno.test("Company booking workspace assigns an eligible driver and vehicle before fulfillment starts", () => {
  requireText(providerBookingDetail, '"/runtime/logistics/company/dispatch-resources?organizationId=', "eligible company driver and vehicle catalogue");
  requireText(providerBookingDetail, '"/runtime/logistics/bookings/assign-driver"', "company dispatch assignment API");
  requireText(providerBookingDetail, "Send driver assignment", "dispatch assignment control");
  requireText(providerBookingDetail, "Choose vehicle", "company chooses driver vehicle pair");
  requireText(providerBookingDetail, "The driver must accept", "driver acceptance before start");
  requireNotText(providerBookingDetail, "Submit delivery details", "provider cannot submit delivery in place of assigned driver");
});

Deno.test("Driver has a distinct assigned-jobs workspace with accept, pickup, transit and delivery actions", () => {
  requireText(driverNavigation, 'name="index"', "driver home tab");
  requireText(driverNavigation, 'name="account"', "driver account tab");
  requireText(driverJobsScreen, '"/runtime/logistics/driver/profile"', "driver eligibility profile");
  requireText(driverJobsScreen, '"/runtime/logistics/driver/bookings"', "only assigned driver jobs are listed");
  requireText(driverJobsScreen, "Only bookings assigned to your verified driver profile are shown", "driver job privacy");
  requireText(driverJobDetailScreen, '"/runtime/logistics/driver/assignment/respond"', "driver accepts or declines assignment");
  requireText(driverJobDetailScreen, '"/runtime/logistics/bookings/start"', "driver starts accepted job");
  requireText(driverJobDetailScreen, '"/runtime/logistics/driver/milestone"', "driver pickup and transit milestones");
  requireText(driverJobDetailScreen, '"picked_up"', "driver confirms pickup");
  requireText(driverJobDetailScreen, '"in_transit"', "driver marks cargo in transit");
  requireText(driverJobDetailScreen, '"/runtime/logistics/bookings/delivery/submit"', "driver records final delivery evidence");
  requireText(driverJobDetailScreen, "Confirm pickup", "pickup action");
  requireText(driverJobDetailScreen, "Mark in transit", "transit action");
  requireText(driverJobDetailScreen, "Received by", "named delivery recipient evidence");
  requireText(driverJobDetailScreen, "Awaiting customer confirmation", "delivery remains pending customer verification");
});

Deno.test("Driver workspace is a separate authenticated route and can be opened from the account", () => {
  requireText(account, '"/runtime/logistics/driver/profile"', "driver workspace visibility check");
  requireText(account, "Open driver workspace", "customer and provider account driver switch");
  requireText(account, '"/(driver)"', "dedicated driver navigation entry");
  requireText(driverRoutes, "DriverTabs", "authenticated driver route group");
  requireText(driverHomeRoute, "DriverJobsScreen", "driver jobs home route");
  requireText(driverWorkRoute, "DriverJobDetailScreen", "driver detail route");
});
