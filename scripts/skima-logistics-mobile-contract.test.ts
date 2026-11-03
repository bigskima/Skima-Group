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
const logisticsAdminRoute = await Deno.readTextFile("apps/logistics-mobile/app/logistics-admin.tsx");
const logisticsAdmin = await Deno.readTextFile("apps/logistics-mobile/src/screens/LogisticsAdminScreen.tsx");
const session = await Deno.readTextFile("apps/logistics-mobile/src/session/SessionProvider.tsx");
const providers = await Deno.readTextFile("apps/logistics-mobile/src/providers/AppProviders.tsx");
const routes = await Deno.readTextFile("apps/logistics-mobile/app/(customer)/_layout.tsx");
const providerNavigation = await Deno.readTextFile("apps/logistics-mobile/src/navigation/ProviderTabs.tsx");
const providerDashboard = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderDashboardScreen.tsx");
const providerOpportunities = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderOpportunitiesScreen.tsx");
const providerCompany = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderCompanyScreen.tsx");
const providerTeam = await Deno.readTextFile("apps/logistics-mobile/src/screens/ProviderTeamScreen.tsx");
const providerTeamRoute = await Deno.readTextFile("apps/logistics-mobile/app/(provider)/team.tsx");
const providerDriver = await Deno.readTextFile("apps/logistics-mobile/src/screens/LogisticsDriverScreen.tsx");
const driverLocationShare = await Deno.readTextFile("apps/logistics-mobile/src/screens/LogisticsDriverLocationShare.tsx");
const providerDriverRoute = await Deno.readTextFile("apps/logistics-mobile/app/(provider)/driver.tsx");
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
  requireText(account, '"logistics.marketplace.manage"', "admin navigation permission");
  requireText(account, 'router.push("/logistics-admin"', "admin account entry");
  requireText(logisticsAdminRoute, "LogisticsAdminScreen", "dedicated admin route");
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
  requireText(providerNavigation, 'driverProfile.data?.registered === true', "driver tab requires a registered driver profile");
  requireText(providerNavigation, '"/runtime/logistics/driver/profile"', "navigation resolves driver registration");
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
  requireText(logisticsAdmin, "Customer disputes & refund review", "admin dispute queue");
  requireText(logisticsAdmin, "platform.escrow.execute", "refund authority is permission-gated");
  requireText(logisticsAdmin, "Refund full escrow", "full escrow refund action");
  requireText(logisticsAdmin, "Send to finance review", "offline dispute escalation");
  requireText(logisticsAdmin, "Close finance review", "offline review closure");
});
