const migration = await Deno.readTextFile("supabase/migrations/20261019090000_lpg_station_managed_fulfillment.sql");
const aclMigration = await Deno.readTextFile("supabase/migrations/20261020142000_lpg_station_managed_acl_hardening.sql");
const inviteDispatchMigration = await Deno.readTextFile("supabase/migrations/20261021110000_lpg_station_driver_invites_auto_dispatch.sql");
const stationDispatchAclMigration = await Deno.readTextFile("supabase/migrations/20261021170000_harden_internal_station_dispatch_functions.sql");
const driverAccessGuardFixMigration = await Deno.readTextFile("supabase/migrations/20261021160000_lpg_station_managed_driver_access_independent_profile_guard_fix.sql");
const ineligibleInviteFixMigration = driverAccessGuardFixMigration;
const driverPickupLifecycleMigration = await Deno.readTextFile("supabase/migrations/20261024020308_lpg_station_managed_driver_pickup_lifecycle.sql");
const premiumDashboard = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/PremiumDashboard.tsx");
const assistantLauncher = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/AiAssistantLauncher.tsx");
const customer = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/NewRefillScreen.tsx");
const station = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/StationManagedFulfillmentScreen.tsx");
const stationLayout = await Deno.readTextFile("apps/lpg-mobile/app/(station)/_layout.tsx");
const gateway = await Deno.readTextFile("supabase/functions/api-gateway/index.ts");
const sharedHttp = await Deno.readTextFile("supabase/functions/_shared/http.ts");
const admin = await Deno.readTextFile("apps/admin/src/admin-station-managed-fulfillment-workspace.tsx");
const adminRouter = await Deno.readTextFile("apps/admin/src/features/partners/PartnersWorkspaceRouter.tsx");
const driverScreen = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/StationManagedDriverJobsScreen.tsx");
const driverDetailRoute = await Deno.readTextFile("apps/lpg-mobile/app/(station-driver)/job/[id].tsx");
const promotionBanner = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/PromotionBanner.tsx");
const jobDetailScreen = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/JobDetailScreen.tsx");
const workspaceGate = await Deno.readTextFile("apps/lpg-mobile/src/native/navigation/WorkspaceGate.tsx");
const workspaceSwitcher = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/WorkspaceSwitcher.tsx");
const workspaceResolver = gateway.slice(gateway.indexOf("async function resolveLpgMobileWorkspaceAccess"));
const stationExternalCoverage = await Deno.readTextFile("supabase/migrations/20261025113000_lpg_station_managed_external_coverage.sql");
const stationQuotePricingHardening = await Deno.readTextFile("supabase/migrations/20261025120000_lpg_station_managed_quote_pricing_hardening.sql");
const stationVehicleReadiness = await Deno.readTextFile("supabase/migrations/20261025130000_lpg_station_managed_vehicle_readiness.sql");
const stationResourceReservation = await Deno.readTextFile("supabase/migrations/20261025131000_lpg_station_managed_resource_reservation_gate.sql");
const stationAffiliateProgram = await Deno.readTextFile("supabase/migrations/20261025140000_lpg_station_affiliate_program.sql");
const stationAffiliateReversal = await Deno.readTextFile("supabase/migrations/20261025150000_lpg_station_affiliate_reversal_recovery.sql");
const stationAffiliateWithdrawalGuard = await Deno.readTextFile("supabase/migrations/20261025160000_lpg_station_affiliate_withdrawal_recovery_guard.sql");
const affiliateAdmin = await Deno.readTextFile("apps/admin/src/features/money/FulfillmentWorkspaceV2.tsx");
const stationAdminWorkspace = await Deno.readTextFile("apps/admin/src/admin-station-managed-fulfillment-workspace.tsx");
const accountSettings = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/WorkspaceAccountSettingsScreen.tsx");
const affiliateWithdrawal = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/FinanceWithdrawalExperience.tsx");
const affiliateWithdrawalRoute = await Deno.readTextFile("apps/lpg-mobile/app/(customer)/wallet/affiliate-withdraw.tsx");
const applicationOverview = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/ApplicationOverviewScreen.tsx");
const stationVehicleScreen = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/StationManagedFulfillmentScreen.tsx");
const stationEligibilityApi = await Deno.readTextFile("apps/lpg-mobile/src/native/api/stationEligibility.ts");


function requireText(source: string, fragment: string, label: string) {
  if (!source.includes(fragment)) throw new Error(`${label}: missing required contract fragment: ${fragment}`);
}

Deno.test("Independent drivers keep workspace access without a station invite", () => {
  const start = driverAccessGuardFixMigration.indexOf("create or replace function public.read_lpg_station_managed_driver_access()");
  const end = driverAccessGuardFixMigration.indexOf("$station_driver_access$;", start);
  if (start < 0 || end < 0) throw new Error("The station-driver access function must be present in the guard-fix migration.");
  const access = driverAccessGuardFixMigration.slice(start, end);
  const inviteLookup = access.indexOf("select * into invite_record");
  const independentProfileGuard = access.indexOf("public.driver_profiles where user_id=auth.uid()");
  if (inviteLookup < 0 || independentProfileGuard < inviteLookup) {
    throw new Error("Independent-profile rejection must run only after a matching invite has been looked up.");
  }
  requireText(access, "email_confirmed_at is not null", "confirmed-email acceptance guard");
  requireText(access, "if found then", "invite-scoped acceptance guard");
});

Deno.test("Station Managed remains a fulfillment mode distinct from the channel", () => {
  requireText(migration, "fulfillment_mode text not null default 'independent_driver'", "additive mode");
  requireText(migration, "check (fulfillment_mode in ('station_managed','independent_driver','skima_fleet','partner_managed'))", "mode constraint");
  requireText(migration, "fulfillment_channel = 'skima_internal' then 'skima_fleet'", "legacy SKIMA Fleet mapping");
  requireText(migration, "fulfillment_channel<>'marketplace' or order_record.fulfillment_mode<>'station_managed'", "assignment guard");
  requireText(customer, "Independent driver", "existing independent-driver option remains available");
  requireText(customer, "SKIMA driver + SKIMA fleet vehicle", "existing SKIMA Fleet option remains available");
});

Deno.test("Station delivery pricing is snapshotted and totals are recalculated", () => {
  requireText(migration, "delivery_pricing_mode text not null default 'separate'", "pricing mode");
  requireText(migration, "where code=target_currency_code and status='enabled'", "enabled currency validation");
  requireText(migration, "new.total_amount:=new.lpg_amount+new.delivery_fee_amount+new.platform_fee_amount+new.tax_amount", "quote total");
  requireText(migration, "'station_fulfillment_pricing_locked',true", "pricing idempotency");
  requireText(customer, "metadata: { fulfillment_mode: fulfillmentMode }", "customer quote mode");
  requireText(customer, "Delivery (included)", "included delivery label");
  requireText(customer, "Delivery (free)", "free delivery label");
});

Deno.test("Station drivers remain outside SKIMA driver and payout ledgers", () => {
  requireText(migration, "create table if not exists public.lpg_station_managed_drivers", "station driver table");
  requireText(migration, "a SKIMA Managed or independent driver profile cannot also be registered", "driver identity separation");
  requireText(migration, "Station Managed drivers are paid by the station, never by SKIMA", "payout guard");
  requireText(migration, "Station drivers are compensated by their station, never by SKIMA.", "delivery trigger guard");
  requireText(migration, "lpg_station_managed_driver_payment_records", "station payment record");
  requireText(station, "SKIMA did not execute this payment.", "station payment disclaimer");
});

Deno.test("Station Managed orders bypass SKIMA dispatch automation", () => {
  requireText(migration, "if fulfillment_mode=''station_managed'' then", "reservation dispatcher guard");
  requireText(migration, "target_order.fulfillment_mode<>''station_managed''", "lifecycle worker guard");
  requireText(migration, "Station Managed orders must use station-owned driver assignment, not SKIMA dispatch", "manual dispatch guard");
  requireText(migration, "is_lpg_station_managed_order_driver", "station driver scan identity");
});

Deno.test("Station workspace and API surfaces are wired", () => {
  requireText(migration, "read_lpg_station_managed_workspace", "station workspace read API");
  requireText(station, "configure_lpg_station_managed_fulfillment", "station pricing settings");
  requireText(station, "api-gateway/runtime/station-driver-invitations", "station driver email invitation");
  requireText(station, "Automatic order dispatch", "automatic station order dispatch UI");
  requireText(station, "api-gateway/runtime/station-driver-invitations", "email invitation endpoint");
  requireText(inviteDispatchMigration, "accept_lpg_station_managed_driver_invite", "driver invitation acceptance RPC");
  requireText(inviteDispatchMigration, "trg_auto_dispatch_lpg_station_managed_order", "automatic dispatch trigger");
  requireText(stationDispatchAclMigration, "auto_dispatch_pending_station_orders_for_branch(uuid)", "internal branch dispatch helper is not publicly callable");
  requireText(stationDispatchAclMigration, "on_station_managed_dispatch_readiness_changed()", "internal dispatch trigger helper is not publicly callable");
  requireText(inviteDispatchMigration, "driver_commission_amount=0", "station-managed orders stay out of independent-driver commission accounting");
  requireText(inviteDispatchMigration, "where public.lpg_station_managed_driver_assignments.status='cancelled'", "cancelled station assignments can be automatically reassigned");
  requireText(inviteDispatchMigration, "email_confirmed_at is not null", "invitation acceptance requires a confirmed account email");
  requireText(inviteDispatchMigration, "new.status not in ('payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_verified','station_en_route')", "automatic dispatch waits for eligible paid-order states");
  requireText(inviteDispatchMigration, "status<>'matching_driver'", "waiting orders do not recursively update their status trigger");
  requireText(inviteDispatchMigration, "read_lpg_station_managed_driver_invitation_access", "pending invite workspace access");
  requireText(station, "record_lpg_station_managed_driver_agreement", "agreement records");
  requireText(station, "record_lpg_station_managed_driver_payment", "payment confirmation records");
  requireText(gateway, "fulfillment_mode,delivery_pricing_mode,station_delivery_fee_amount", "quote and order API projections");
});

Deno.test("Admin dashboard has read-only Station Managed oversight", () => {
  requireText(migration, "read_lpg_admin_station_managed_fulfillment", "admin oversight RPC");
  requireText(migration, "platform station fulfillment oversight permission is required", "admin permission guard");
  requireText(admin, "read_lpg_admin_station_managed_fulfillment", "admin dashboard data source");
  requireText(admin, "These are station-entered confirmations only. SKIMA did not execute these driver payments.", "admin payment disclaimer");
  requireText(admin, "Review drivers, assignments, agreements and payment confirmations", "admin record review");
  requireText(adminRouter, "/partners/stations/managed-fulfillment", "admin route");
});

Deno.test("Station Managed RPCs do not inherit anonymous execution", () => {
  requireText(aclMigration, "revoke all on function public.configure_lpg_station_managed_fulfillment", "anonymous configuration denied");
  requireText(aclMigration, "revoke all on function public.record_lpg_station_managed_driver_payment", "anonymous payment-record write denied");
  requireText(aclMigration, "revoke all on function public.apply_lpg_station_managed_quote_policy() from public, anon, authenticated", "quote policy trigger helper is not an API");
  requireText(aclMigration, "revoke all on function public.copy_lpg_station_fulfillment_snapshot_to_order() from public, anon, authenticated", "snapshot trigger helper is not an API");
  requireText(aclMigration, "grant execute on function public.configure_lpg_station_managed_fulfillment", "authenticated station settings RPC remains available");
});


Deno.test("An ineligible invite does not lock an independent driver out of their workspace", () => {
  const start = ineligibleInviteFixMigration.indexOf("create or replace function public.read_lpg_station_managed_driver_access()");
  const end = ineligibleInviteFixMigration.indexOf("$station_driver_access$;", start);
  if (start < 0 || end < 0) throw new Error("The invite-conflict reconciliation function must be present.");
  const access = ineligibleInviteFixMigration.slice(start, end);
  requireText(access, "status='revoked'", "ineligible invitation is consumed safely");
  requireText(access, "account_already_has_independent_driver_profile", "ineligible invitation reason is auditable");
  requireText(access, "return jsonb_build_object('enabled',false)", "workspace resolution returns normally for independent drivers");
  if (access.includes("raise exception using errcode='55000',message='an independent or SKIMA Managed driver profile cannot accept a Station Managed invitation'")) {
    throw new Error("An ineligible invitation must not abort the authenticated workspace resolver.");
  }
});

Deno.test("Station Managed drivers have a separate authenticated job workspace", () => {
  requireText(migration, "read_lpg_station_managed_driver_access", "station driver access RPC");
  requireText(migration, "Station Managed orders use station-owned refill and customer hand-over scans", "station driver scan scope");
  requireText(migration, "public.is_lpg_station_managed_order_driver(order_record.id,auth.uid())", "assigned station driver scan authorization");
  requireText(migration, "'stationDriverId',driver_record.id", "station driver workspace identity");
  requireText(migration, "lpg_station_managed_drivers_active_user_unique", "single active station identity");
  requireText(migration, "status='driver_offered'", "assigned delivery remains offered until driver acceptance");
  requireText(migration, "the station must complete refill settlement before delivery can start", "delivery cannot start before station settlement");
  requireText(migration, "quote_record.delivery_pricing_mode = ''included'' then quote_record.station_delivery_fee_amount", "included delivery excluded from LPG underfill refund");
  requireText(migration, "quote_record.delivery_pricing_mode in (''separate'',''included'') then quote_record.station_delivery_fee_amount", "station delivery fee settlement for included and separate pricing");

  requireText(migration, "read_lpg_station_managed_driver_jobs", "station driver job list");
  requireText(migration, "update_lpg_station_managed_driver_assignment_status", "station driver status RPC");
  requireText(migration, "public.process_lpg_order_action(", "standard LPG delivery lifecycle integration");
  requireText(migration, "lpg.return.start", "station driver starts only the return-delivery lifecycle");
  requireText(migration, "target_workspace not in (''station'',''driver'',''customer'',''station_driver'')", "station driver job-detail route access");
  requireText(migration, "not public.is_lpg_station_managed_order_driver(order_record.id,auth.uid())", "assigned-driver action guard");

  requireText(migration, "order_record.delivery_location_id", "canonical delivery location");
  requireText(workspaceResolver, 'key: "station_driver"', "station driver workspace resolver");
  requireText(workspaceGate, '"station_driver"', "station driver workspace gate");
  requireText(workspaceSwitcher, 'workspaces.includes("station_driver")', "station driver workspace switcher");
  requireText(driverScreen, "Accept delivery", "driver accepts station assignment");
  requireText(driverScreen, "Start return delivery", "driver starts the return leg after station release");
  requireText(driverScreen, "Open delivery details & hand-over", "driver opens customer hand-over");
  requireText(driverDetailRoute, 'workspace="station_driver"', "dedicated station driver hand-over route");
  requireText(jobDetailScreen, "Customer hand-over verified. The station remains responsible for driver compensation; SKIMA does not execute station-driver payments.", "station driver hand-over has no SKIMA payout messaging");
  requireText(jobDetailScreen, "stationManagedDriverScanTypeForStatus", "station driver uses customer hand-over scan");
  requireText(driverScreen, "station's normal safety and cylinder-verification process", "verified completion guard");
});


Deno.test("Home promotion carousel uses the available width and an expanded banner", () => {
  requireText(promotionBanner, "onLayout={(event) =>", "carousel measures the real content slot");
  requireText(promotionBanner, "carouselWidth || width - 20", "carousel width has a responsive fallback");
  requireText(promotionBanner, "Math.min(Math.max(carouselWidth || width - 20, 280), 700)", "carousel width respects compact and wide layouts");
  requireText(promotionBanner, "carousel: { gap: 10, marginHorizontal: -12 }", "promotion banner uses the wider home-section bleed");
  requireText(promotionBanner, "banner: { minHeight: 190", "promotion banner has increased height");
});


Deno.test("Station Managed driver can progress the full pickup → station → return lifecycle", () => {
  requireText(migration, "and not public.is_lpg_station_managed_order_driver(order_record.id,auth.uid())", "canonical assigned-driver action guard supports Station Managed");
  requireText(driverPickupLifecycleMigration, "public.record_lpg_cylinder_scan(uuid,text,text,numeric,numeric,numeric,jsonb,text)", "station driver cylinder scan authorization patch");
  requireText(driverPickupLifecycleMigration, "execute function_sql;", "patched cylinder-scan function is actually installed");
  if (driverPickupLifecycleMigration.includes("receipt_guard := 'if not public.can_operate_lpg_station_branch")) throw new Error("Do not add a station-operator guard inside station_receipt; assignment-scoped driver authorization handles this leg.");
  requireText(driverPickupLifecycleMigration, "function_sql := replace(", "final hand-over completion patch is anchored to the function tail");
  requireText(driverPickupLifecycleMigration, "order_status_before not in (''station_settled'',''return_en_route'')", "return route starts only after station release or settlement");
  requireText(driverPickupLifecycleMigration, "set status = ''delivered''", "verified customer hand-over closes station assignment");
  requireText(driverPickupLifecycleMigration, "Station Managed pickup and receipt scans require the order''s active station-driver assignment.", "legacy pickup scan block is retired");
  requireText(jobDetailScreen, 'if (status === "driver_accepted") return "lpg.pickup.start";', "station drivers can start pickup");
  requireText(jobDetailScreen, 'if (status === "pickup_verified") return "lpg.station.start";', "station drivers can proceed to refill station");
  requireText(jobDetailScreen, 'if (status === "pickup_en_route") return "customer_pickup";', "station drivers can scan customer pickup");
  requireText(jobDetailScreen, 'if (status === "station_en_route") return "station_receipt";', "station drivers can scan station arrival");
  requireText(driverScreen, "Open pickup & station workflow", "driver queue opens the pickup workflow before return delivery");
  requireText(driverScreen, "Continue return delivery", "driver can continue after the station has already released the cylinder");
});

Deno.test("Customer AI launcher opens as an overlay modal, not in the home layout", () => {
  requireText(premiumDashboard, "<Modal", "home AI modal");
  requireText(premiumDashboard, "transparent", "AI overlay uses a transparent modal surface");
  requireText(premiumDashboard, "styles.aiModalRoot", "AI overlay is positioned over the home screen");
  requireText(premiumDashboard, "onRequestClose={() => setShowAi(false)}", "AI modal supports native back/close");
  requireText(premiumDashboard, "<AiAssistantLauncher workspace=\"customer\" onOpen={() => setShowAi(false)} />", "AI modal closes before navigating to the full assistant");
  requireText(assistantLauncher, "onOpen?.();", "launcher dismisses its parent overlay before navigation");
});

Deno.test("Station driver invites persist before delivery and revoke failed sends", () => {
  const allowedHeaders = sharedHttp.match(/"Access-Control-Allow-Headers":\s*"([^"]+)"/)?.[1]
    ?.split(",").map((header) => header.trim().toLowerCase()) ?? [];
  if (!allowedHeaders.includes("x-skima-client")) {
    throw new Error("Gateway CORS must allow x-skima-client because the app Supabase client sends it on browser requests.");
  }

  const start = gateway.indexOf('if (routePath === "/runtime/station-driver-invitations" && request.method === "POST")');
  const end = gateway.indexOf('if (routePath === "/runtime/station-driver-invitations/accept" && request.method === "POST")', start);
  if (start < 0 || end < 0) throw new Error("Both station-driver invitation routes must be present.");
  const route = gateway.slice(start, end);
  const persistence = route.indexOf('.from("lpg_station_managed_driver_invites").upsert({');
  const emailDelivery = route.indexOf('.auth.admin.inviteUserByEmail(');
  if (persistence < 0 || emailDelivery < 0 || persistence >= emailDelivery) {
    throw new Error("The pending invitation must be committed before an invitation email can be delivered.");
  }
  requireText(route, 'const revokeUndeliveredInvitation', "failed invitation cleanup");
  requireText(route, 'status: "revoked"', "failed email sends cannot leave a misleading pending invite");
  requireText(route, 'shouldCreateUser: false', "existing SKIMA accounts use sign-in rather than duplicate account creation");
  requireText(inviteDispatchMigration, "email_confirmed_at is not null", "acceptance is bound to the authenticated confirmed email");
});


Deno.test("Station Managed app surfaces are dedicated views over the existing backend", () => {
  requireText(station, 'section === "overview"', "Station Managed overview route");
  requireText(station, 'section === "settings"', "dedicated delivery settings view");
  requireText(station, 'section === "vehicles"', "dedicated vehicle readiness view");
  requireText(station, 'section === "drivers"', "dedicated driver management view");
  requireText(station, 'section === "orders"', "dedicated automatic dispatch queue view");
  requireText(station, 'section === "payments"', "dedicated station driver agreement and payment view");
  requireText(station, 'read_lpg_station_managed_workspace', "manager views keep using the existing workspace RPC");
  requireText(station, 'read_lpg_station_managed_available_vehicles', "vehicle view uses the existing readiness RPC");
  requireText(station, 'domainQueries.stationJobs(section === "orders")', "assigned-order tracking uses the canonical station jobs queue");
  for (const route of [
    "managed-fulfillment-settings",
    "managed-fulfillment-vehicles",
    "managed-fulfillment-drivers",
    "managed-fulfillment-orders",
    "managed-fulfillment-payments",
  ]) {
    requireText(stationLayout, `"${route}"`, `${route} must not leak into station tab navigation`);
  }
  requireText(driverScreen, 'const activeJobs = (jobs.data ?? []).filter((job) => job.status !== "delivered")', "active deliveries use backend assignment state");
  requireText(driverScreen, 'const completedJobs = (jobs.data ?? []).filter((job) => job.status === "delivered")', "history uses backend-verified completion");
  requireText(driverScreen, "function orderStageLabel(status: string)", "driver cards explain canonical LPG order state");
});

Deno.test("Station Managed external coverage is an explicit admin-gated exception", () => {
  requireText(stationExternalCoverage, "outside_customer_coverage_enabled boolean not null default false", "safe default coverage policy");
  requireText(stationExternalCoverage, "configure_lpg_station_managed_coverage_policy", "admin configuration RPC");
  requireText(stationExternalCoverage, "public.has_permission('platform.dispatch.manage', null)", "coverage configuration permission gate");
  requireText(stationExternalCoverage, "station.service_radius_meters is not null and station.service_radius_meters > 0", "positive station delivery radius");
  requireText(stationExternalCoverage, "greatest(station.pickup_distance, station.return_distance) <= station.service_radius_meters", "both customer locations are within branch radius");
  requireText(stationExternalCoverage, "public.read_lpg_station_managed_eligible_stations(", "backend station eligibility");
  requireText(stationExternalCoverage, "coalesce(nullif(new.metadata->>'fulfillment_mode',''), new.fulfillment_mode, 'independent_driver') <> 'station_managed'", "exception cannot apply to other fulfilment modes");
  requireText(affiliateAdmin, "StationManagedCoveragePolicySection", "admin coverage workspace control");
  requireText(stationExternalCoverage, "change_reason", "auditable admin reason");
});

Deno.test("Station Managed quote pricing cannot be locked by client metadata", () => {
  requireText(stationQuotePricingHardening, "before insert or update on public.lpg_refill_quotes", "pricing trigger on quote creation and update");
  requireText(stationQuotePricingHardening, "- 'station_fulfillment_pricing_locked'", "client-supplied lock flag is removed");
  requireText(stationQuotePricingHardening, "settings.delivery_pricing_mode", "pricing comes from configured station settings");
  requireText(stationQuotePricingHardening, "new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(", "server-derived snapshot is written");
  requireText(stationQuotePricingHardening, "'station_fulfillment_pricing_locked',true", "server locks the derived pricing");
});

Deno.test("Station Managed dispatch requires a compliant station-owned LPG vehicle", () => {
  requireText(stationVehicleReadiness, "create table if not exists public.lpg_station_managed_vehicles", "branch vehicle assignment table");
  requireText(stationVehicleReadiness, "vehicle.organization_id=station.organization_id", "vehicle belongs to the station organization");
  requireText(stationVehicleReadiness, "vehicle.lpg-transport", "LPG transport capability is required");
  requireText(stationVehicleReadiness, "vehicle.max_load_kg>=order_record.requested_kg", "vehicle load capacity covers the refill");
  requireText(stationVehicleReadiness, "lpg_station_managed_assignments_active_vehicle_unique", "a vehicle cannot be assigned to multiple active deliveries");
  requireText(stationVehicleReadiness, "waiting_for_station_vehicle", "no-vehicle dispatch is held for later reassignment");
  requireText(stationResourceReservation, "require_lpg_station_managed_resources_before_reservation", "payment reservation readiness guard");
  requireText(stationResourceReservation, "Station Managed payment cannot be reserved: no available approved LPG vehicle can carry this refill", "payment fails closed without a compliant vehicle");
  requireText(stationVehicleScreen, "read_lpg_station_managed_available_vehicles", "station vehicle readiness API");
  requireText(stationVehicleScreen, "configure_lpg_station_managed_vehicle", "station can assign or remove its vehicle");
});

Deno.test("Customer refill only exposes the separate Station Managed fallback outside coverage", () => {
  requireText(stationEligibilityApi, "useEligibleStationManagedStations", "separate station-managed eligibility hook");
  requireText(customer, "outsideCoverageLikely", "outside-coverage state detection");
  requireText(customer, "SKIMA Managed and Independent delivery are not available for this trip", "non-Station Managed models are not enabled outside coverage");
  requireText(customer, "Station Managed delivery available", "customer sees explicitly identified Station Managed fallback");
  requireText(customer, 'selectedStation?.isStationManagedOnly && fulfillmentMode === "station_managed"', "quote is allowed only with the selected Station Managed fallback");
});

Deno.test("Station Affiliate referral and commission are governed and ledger-backed", () => {
  requireText(stationAffiliateProgram, "financial_policy_definitions", "reusable financial policy definitions");
  requireText(stationAffiliateProgram, "'commission.lpg.station_affiliate'", "stable affiliate policy key");
  requireText(stationAffiliateProgram, "new.geography_key is distinct from 'NG'", "geographic policy scope is fixed to Nigeria");
  requireText(affiliateAdmin, "create_financial_policy_version", "versioned policy lifecycle");
  requireText(affiliateAdmin, "review_financial_policy_version", "independent approval lifecycle");
  requireText(stationAffiliateProgram, "public.post_financial_transaction(", "commission posts through the financial ledger");
  requireText(stationAffiliateProgram, "on conflict(lpg_order_id) do nothing", "one affiliate earning per LPG order");
  requireText(stationAffiliateProgram, "old.submitted_at is not null or new.submitted_at is null", "referral is recorded only once at first application submission");
  requireText(stationAffiliateProgram, "You cannot use your own Station Affiliate referral code", "self-referral prevention");
  requireText(stationAffiliateProgram, "lpg_station_affiliate_commission_failures", "failed commission posting is queued for retry");
  requireText(stationAffiliateProgram, "read_lpg_station_affiliate_admin_workspace", "admin referral and earning oversight");
});

Deno.test("Customers can apply for Station Affiliate and refer a station from the application", () => {
  requireText(accountSettings, "request_lpg_station_affiliate", "customer affiliate application");
  requireText(accountSettings, "read_my_lpg_station_affiliate", "customer status and wallet view");
  requireText(accountSettings, "Copy", "referral code copy action");
  requireText(applicationOverview, "affiliateReferralCode", "station application referral capture");
  requireText(applicationOverview, "Station referral code (optional)", "referral input is visible in station onboarding");
});

Deno.test("Admins can configure the commission policy and operate the referral pipeline", () => {
  requireText(affiliateAdmin, 'key: "station-affiliates"', "admin dashboard navigation");
  requireText(affiliateAdmin, "create_financial_policy_version", "policy draft action");
  requireText(affiliateAdmin, "submit_financial_policy_version", "policy submit action");
  requireText(affiliateAdmin, "review_financial_policy_version", "policy approval action");
  requireText(affiliateAdmin, "activate_financial_policy_version", "policy activation action");
  requireText(affiliateAdmin, "review_lpg_station_affiliate", "affiliate approval and suspension controls");
  requireText(affiliateAdmin, "retry_lpg_station_affiliate_commission", "failed commission retry control");
});


Deno.test("Station Managed expansion cannot override paused or explicitly excluded areas", () => {
  requireText(stationExternalCoverage, "Station Managed cannot override an excluded, paused, or policy-blocked LPG area", "server-side denial of explicit exclusions");
  requireText(stationExternalCoverage, "pickup_resolution->>'reason' is distinct from 'SERVICE_NOT_LAUNCHED'", "pickup must fail only for an unlaunched customer-ordering area");
  requireText(stationExternalCoverage, "delivery_resolution->>'reason' is distinct from 'SERVICE_NOT_LAUNCHED'", "return location must fail only for an unlaunched customer-ordering area");
  requireText(stationVehicleReadiness, "external_launch_coverage and not coalesce(coverage_enabled,false)", "admin approval is required only for the out-of-launch exception");
  requireText(customer, 'pickupServiceability.data?.reason === "SERVICE_NOT_LAUNCHED"', "customer UI does not expose external coverage for paused/excluded locations");
  requireText(customer, '(eligibleStations.data?.length ?? 0) === 0', "Station Managed fallback appears when standard station options cannot serve the trip");
});

Deno.test("Station Managed provisional quote rows are not prematurely price-locked", () => {
  requireText(stationQuotePricingHardening, "if tg_op='INSERT' and (", "provisional quote insert detection");
  requireText(stationQuotePricingHardening, "Do not lock prices on that provisional INSERT", "wait for the commercial snapshot before applying configured delivery pricing");
  requireText(stationQuotePricingHardening, "new.financial_policy_snapshot->'settlement' is null", "commercial policy snapshot readiness guard");
});

Deno.test("Platform admins can inspect and assign approved Station Managed vehicles", () => {
  requireText(stationVehicleReadiness, "public.has_permission('platform.vehicles.manage',null)", "platform vehicle-management permission");
  requireText(stationAdminWorkspace, "StationVehicleAdminPanel", "admin Station Managed vehicle panel");
  requireText(stationAdminWorkspace, "read_lpg_station_managed_available_vehicles", "admin reads assigned and eligible station vehicles");
  requireText(stationAdminWorkspace, "configure_lpg_station_managed_vehicle", "admin can assign or remove a station vehicle");
  requireText(stationAdminWorkspace, "Register and approve the vehicle through the existing fleet and compliance workspace first", "admin cannot create or self-approve vehicle compliance");
});

Deno.test("Full LPG refunds reverse affiliate commission or queue a recovery exception", () => {
  requireText(stationAffiliateReversal, "reversal_transaction_id", "separate immutable reversal transaction reference");
  requireText(stationAffiliateReversal, "after update of status on public.lpg_refill_orders", "refund lifecycle is connected to reversal handling");
  requireText(stationAffiliateReversal, "new.status='refunded'", "only full refunded order status triggers automatic reversal");
  requireText(stationAffiliateReversal, "Affiliate wallet balance is below the commission reversal amount", "insufficient affiliate balance is recorded instead of silently dropped");
  requireText(stationAffiliateReversal, "lpg_station_affiliate_reversal_failures", "reversal recovery queue");
  requireText(affiliateAdmin, "reverse_lpg_station_affiliate_commission", "admin reversal action");
  requireText(affiliateAdmin, "retry_lpg_station_affiliate_reversal", "admin reversal recovery retry");
  requireText(stationAffiliateReversal, "read_lpg_station_affiliate_admin_workspace_base", "reversal queue extends the existing admin workspace without recursion");
});


Deno.test("Station Affiliate commission wallet uses the existing governed withdrawal flow", () => {
  requireText(accountSettings, "Withdraw affiliate earnings", "account has a withdrawal action for positive affiliate balance");
  requireText(accountSettings, "/customer/wallet/affiliate-withdraw?walletId=", "withdrawal action passes the owned commission wallet id");
  requireText(affiliateWithdrawal, "walletIdOverride", "withdrawal experience can target the explicitly supplied wallet");
  requireText(affiliateWithdrawal, "/withdrawals/preview", "withdrawal fee preview still uses existing finance API");
  requireText(affiliateWithdrawal, "/withdrawals", "withdrawal still goes through the existing policy-controlled finance API");
  requireText(affiliateWithdrawalRoute, "walletIdOverride={walletId ?? null}", "dedicated affiliate withdrawal route passes the wallet id");
});


Deno.test("Station Affiliate earnings are withdrawable through the governed finance engine", () => {
  requireText(affiliateWithdrawal, "walletIdOverride", "affiliate withdrawal targets the commission wallet selected by the backend");
  requireText(affiliateWithdrawal, "/withdrawals/preview", "withdrawal fee uses the existing fee-policy preview");
  requireText(affiliateWithdrawal, "/withdrawals", "withdrawal request uses the existing finance runtime");
  requireText(affiliateWithdrawalRoute, "FinanceWithdrawalExperience workspace=\"customer\" walletIdOverride={walletId ?? null}", "affiliate withdrawal route uses the shared withdrawal workflow");
  requireText(accountSettings, "Withdraw affiliate earnings", "affiliate account exposes cash-out for a positive commission balance");
  requireText(stationAffiliateWithdrawalGuard, "lpg_station_affiliate_reversal_failures", "pending clawbacks are checked before a withdrawal");
  requireText(stationAffiliateWithdrawalGuard, "Affiliate withdrawals are temporarily held while a refund-related commission reversal is being recovered", "withdrawal requests fail closed during unresolved clawback");
  requireText(stationAffiliateWithdrawalGuard, "new.status in ('approved','processing','succeeded')", "existing requested withdrawals cannot be newly approved during recovery");
});


Deno.test("Station Managed options require a vehicle eligible for the selected refill size", () => {
  requireText(customer, "const selectedStationManagedCandidate", "per-station vehicle candidate for the requested quantity");
  requireText(customer, "Boolean(selectedStationManagedCandidate) ?", "Station Managed UI is not offered solely because a driver exists");
  requireText(customer, '(fulfillmentMode === "station_managed" && !selectedStation?.isStationManagedOnly && !selectedStationManagedCandidate)', "quote review is blocked if the selected vehicle cannot carry this refill");
});

Deno.test("Affiliate referrals begin only after station operational readiness", () => {
  requireText(stationAffiliateProgram, "new.compliance_status<>'approved'", "compliance approval is required before activation");
  requireText(stationAffiliateProgram, "new.availability_status<>'available'", "operational availability is required before activation");
  requireText(stationAffiliateProgram, "after insert or update of approval_status,compliance_status,availability_status,metadata", "later operational activation re-evaluates referral status");
  requireText(stationAffiliateProgram, "resolve_lpg_station_affiliate_referral_application_outcome", "rejected/withdrawn applications do not stay stuck in submitted referral state");
});

Deno.test("Affiliate wallet withdrawals use existing payout checks and wait through clawback recovery", () => {
  requireText(affiliateWithdrawal, "walletIdOverride", "payout targets the affiliate's dedicated wallet");
  requireText(affiliateWithdrawal, "/withdrawals/preview", "existing governed withdrawal fee preview");
  requireText(affiliateWithdrawal, "/withdrawals", "existing withdrawal request API");
  requireText(affiliateWithdrawalRoute, "FinanceWithdrawalExperience", "affiliate withdrawal route reuses the verified payout UI");
  requireText(stationAffiliateWithdrawalGuard, "before insert or update of status on public.withdrawal_requests", "pending commission clawbacks gate withdrawal requests and approval");
  requireText(stationAffiliateWithdrawalGuard, "Affiliate withdrawal approval is held until the pending commission reversal is resolved", "withdrawal approval fails closed during unresolved reversal");
});
