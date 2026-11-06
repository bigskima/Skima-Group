const read = (path: string) => Deno.readTextFile(path);

function requireText(source: string, fragment: string, label: string) {
  const normalized = source.replace(/\s+/g, " ");
  const expected = fragment.replace(/\s+/g, " ");
  if (!normalized.includes(expected)) throw new Error(label + ": missing " + fragment);
}

function rejectText(source: string, fragment: string, label: string) {
  const normalized = source.replace(/\s+/g, " ");
  const expected = fragment.replace(/\s+/g, " ");
  if (normalized.includes(expected)) throw new Error(label + ": unexpected " + fragment);
}

Deno.test("Coverage administration can add named service areas without map coordinates", async () => {
  const [coverage, geographyMigration, managedMigration, managedAdmin] = await Promise.all([
    read("apps/admin/src/features/operations/CoverageWorkspaceV2.tsx"),
    read("supabase/migrations/20261029182549_nigeria_location_enablement_fulfilment_gates.sql"),
    read("supabase/migrations/20261106120000_lpg_named_geography_service_area_runtime.sql"),
    read("apps/admin/src/admin-managed-driver-coverage-workspace.tsx"),
  ]);
  requireText(coverage, "Add service area", "coverage overview quick action");
  requireText(coverage, "skima_managed_fulfillment", "SKIMA Managed coverage rule");
  requireText(coverage, "p_boundary_geojson: boundary", "optional map boundary submission");
  requireText(geographyMigration, "new.status = 'active' and new.boundary_geometry is null and child_level.key = 'custom_zone'", "optional boundary for administrative areas");
  requireText(managedMigration, "'geography:'||geography.id::text", "stable service-area key for new geographies");
  requireText(managedMigration, "target_service_area_key", "Managed Driver area assignment");
  requireText(managedMigration, "'geography:'||matched_geography_id::text", "Managed price policy resolves new geography key");
  requireText(managedAdmin, "const selectableAreas = serviceAreas.data ?? []", "all active named locations are selectable");
  requireText(managedAdmin, "const availableAreas = selectableAreas.filter", "already assigned locations are excluded without hiding other areas");
  requireText(managedAdmin, "selectedAreaCanBeAssigned = selectedArea?.hasBoundary === true", "physical Driver assignment still requires a verified map boundary");
  requireText(managedAdmin, "All enabled locations are now visible here", "administrator sees the reason an area cannot yet be dispatched");
});

Deno.test("Managed availability and routing use the same named geography policy", async () => {
  const [coverage, availabilityResolver, internalReference, priority, workspace] = await Promise.all([
    read("apps/admin/src/features/operations/CoverageWorkspaceV2.tsx"),
    read("supabase/migrations/20261029182549_nigeria_location_enablement_fulfilment_gates.sql"),
    read("supabase/migrations/20261106120000_lpg_named_geography_service_area_runtime.sql"),
    read("apps/admin/src/admin-fulfillment-priority-control.tsx"),
    read("apps/admin/src/features/money/FulfillmentWorkspaceV2.tsx"),
  ]);
  requireText(coverage, "skima_managed_fulfillment", "Managed area policy");
  requireText(availabilityResolver, "'skima_managed_fulfillment'", "live refill serviceability resolver");
  requireText(internalReference, "resolve_lpg_location_capability", "Managed pricing availability check");
  requireText(internalReference, "geography_key:='geography:'||matched_geography_id::text", "Managed geography price lookup");
  requireText(priority, "SKIMA Managed first", "Managed routing priority wording");
  requireText(workspace, "Partner Network + SKIMA Managed", "consistent network availability wording");
});

Deno.test("Logistics companies can use automatic identity approval or upload evidence for manual review", async () => {
  const [application, admin, migration] = await Promise.all([
    read("apps/logistics-mobile/src/ui/LogisticsCompanyApplicationPanel.tsx"),
    read("apps/admin/src/features/logistics/LogisticsWorkspace.tsx"),
    read("supabase/migrations/20261106100000_customer_service_discovery_and_logistics_admin_fixes.sql"),
  ]);
  requireText(application, "identityPassed || identityEvidenceUploaded", "automatic or manual identity evidence");
  requireText(application, "Complete the secure identity check or upload the applicant's identity document for manual review", "manual-review alternative");
  requireText(application, "uploadDocument", "manual document upload path");
  requireText(admin, "Enter at least 5 characters to enable Verify or Reject", "visible approval reason requirement");
  requireText(migration, "not public.is_platform_super_admin() and not public.has_permission('logistics.marketplace.manage', null)", "database Super Admin approval permission");
});

Deno.test("Store delivery setup follows nationwide flat-fee policy with optional geocoded origin coordinates", async () => {
  const [workspace, migration] = await Promise.all([
    read("apps/admin/src/features/store/StoreWorkspace.tsx"),
    read("supabase/migrations/20261104120000_storefront_nationwide_catalog_admin.sql"),
  ]);
  requireText(workspace, 'api.post("/lpg/maps/geocode"', "Store dispatch origin can use the shared geocoding gateway");
  requireText(workspace, "setDeliveryOriginLatitude(String(result.location.latitude))", "geocoded latitude is retained");
  requireText(workspace, "setDeliveryOriginLongitude(String(result.location.longitude))", "geocoded longitude is retained");
  requireText(workspace, "parsedOriginLatitude === null) !== (parsedOriginLongitude === null", "coordinate inputs must be supplied together when used");
  requireText(workspace, "deliveryOriginLatitude: parsedOriginLatitude", "Store saves optional origin latitude");
  requireText(workspace, "deliveryOriginLongitude: parsedOriginLongitude", "Store saves optional origin longitude");
  requireText(workspace, "deliveryRadiusKm: null", "nationwide checkout is not radius-gated");
  requireText(workspace, "Delivery radius does not restrict checkout", "admin copy explains nationwide delivery");
  requireText(migration, "delivery_radius_km = null", "database ignores legacy radius for Store nationwide delivery");
  requireText(migration, "Optional Store coordinates must be supplied together", "database validates optional coordinate pairs");
});

Deno.test("All four customer apps share the database-driven service catalogue", async () => {
  const [migration, refill, bills, store, logistics] = await Promise.all([
    read("supabase/migrations/20261106100000_customer_service_discovery_and_logistics_admin_fixes.sql"),
    read("apps/lpg-mobile/src/native/ui/ServiceDiscoveryModal.tsx"),
    read("apps/bills-mobile/src/screens/ServiceDiscoveryModal.tsx"),
    read("apps/store-mobile/src/screens/ServiceDiscoveryModal.tsx"),
    read("apps/logistics-mobile/src/ui/ServiceDiscoveryModal.tsx"),
  ]);
  requireText(migration, "create table if not exists public.customer_service_discovery_links", "shared customer service links table");
  for (const key of ["'refill'","'logistics'","'store'","'bills'"]) requireText(migration, key, "seeded product URL");
  for (const component of [refill,bills,store,logistics]) {
    requireText(component, "customer_service_discovery_links", "database-driven service URL");
    requireText(component, "android_store_url", "future Android store URL");
    requireText(component, "ios_store_url", "future iOS store URL");
    requireText(component, "Linking.openURL(destination)", "working customer service CTA");
  }
});

Deno.test("Thank-you prompts wait for final server-confirmed completion", async () => {
  const [refill, bills, store, logistics] = await Promise.all([
    read("apps/lpg-mobile/src/native/ui/DeliveryVerificationScreen.tsx"),
    read("apps/bills-mobile/src/screens/BillsReceiptScreen.tsx"),
    read("apps/store-mobile/src/screens/StoreOrdersScreen.tsx"),
    read("apps/logistics-mobile/src/screens/LogisticsBookingScreen.tsx"),
  ]);
  requireText(refill, "verifiedOrder", "refill final order read");
  requireText(refill, "setThankYouVisible(true)", "refill successful handover prompt");
  requireText(bills, '"succeeded"', "bills provider-confirmed terminal state");
  requireText(bills, "paymentSuccessful", "bills success gating");
  requireText(store, "const refreshed = await orders.refetch()", "Store completion read after customer action");
  requireText(store, '=== "completed"', "Store completed state");
  requireText(logistics, '["settled", "completed_offline"]', "Logistics final settled state");
  requireText(logistics, "setThankYouVisible(true)", "Logistics successful delivery prompt");
  for (const source of [refill,bills,store,logistics]) requireText(source, "Thanks for choosing SKIMA!", "customer thank-you message");
});

Deno.test("Refill unavailability offers other SKIMA services from a customer-facing action", async () => {
  const refill = await read("apps/lpg-mobile/src/native/ui/NewRefillScreen.tsx");
  requireText(refill, "Explore other SKIMA services", "other service CTA");
  requireText(refill, "Refill delivery is not currently available at this location", "clear location-unavailable explanation");
  rejectText(refill, "developer-only", "no developer-only copy in customer unavailable message");
});
