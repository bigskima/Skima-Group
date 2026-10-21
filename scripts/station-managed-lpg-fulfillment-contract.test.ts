const migration = await Deno.readTextFile("supabase/migrations/20261019090000_lpg_station_managed_fulfillment.sql");
const aclMigration = await Deno.readTextFile("supabase/migrations/20261020142000_lpg_station_managed_acl_hardening.sql");
const inviteDispatchMigration = await Deno.readTextFile("supabase/migrations/20261021110000_lpg_station_driver_invites_auto_dispatch.sql");
const stationDispatchAclMigration = await Deno.readTextFile("supabase/migrations/20261021170000_harden_internal_station_dispatch_functions.sql");
const driverAccessGuardFixMigration = await Deno.readTextFile("supabase/migrations/20261021160000_lpg_station_managed_driver_access_independent_profile_guard_fix.sql");
const ineligibleInviteFixMigration = driverAccessGuardFixMigration;
const customer = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/NewRefillScreen.tsx");
const station = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/StationManagedFulfillmentScreen.tsx");
const gateway = await Deno.readTextFile("supabase/functions/api-gateway/index.ts");
const admin = await Deno.readTextFile("apps/admin/src/admin-station-managed-fulfillment-workspace.tsx");
const adminRouter = await Deno.readTextFile("apps/admin/src/features/partners/PartnersWorkspaceRouter.tsx");
const driverScreen = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/StationManagedDriverJobsScreen.tsx");
const driverDetailRoute = await Deno.readTextFile("apps/lpg-mobile/app/(station-driver)/job/[id].tsx");
const promotionBanner = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/PromotionBanner.tsx");
const jobDetailScreen = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/JobDetailScreen.tsx");
const workspaceGate = await Deno.readTextFile("apps/lpg-mobile/src/native/navigation/WorkspaceGate.tsx");
const workspaceSwitcher = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/WorkspaceSwitcher.tsx");
const workspaceResolver = gateway.slice(gateway.indexOf("async function resolveLpgMobileWorkspaceAccess"));

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
  requireText(driverScreen, "Start delivery", "driver starts assigned route");
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
  requireText(promotionBanner, "carousel: { gap: 10, marginHorizontal: -8 }", "promotion banner uses the wider home-section bleed");
  requireText(promotionBanner, "banner: { minHeight: 190", "promotion banner has increased height");
});
