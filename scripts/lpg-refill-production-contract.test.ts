const root = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

Deno.test("refill UI preserves amount-mode drafts and limits long station lists", async () => {
  const screen = await read("apps/lpg-mobile/src/native/ui/NewRefillScreen.tsx");
  assertIncludes(screen, "setRequestedAmount(String(draft.values.requestedAmount");
  assertIncludes(screen, 'setPurchaseMode(draft.values.purchaseMode === "amount"');
  assertIncludes(screen, "requestedAmount,");
  assertIncludes(screen, "purchaseMode,");
  assertIncludes(screen, "STATION_PREVIEW_LIMIT = 4");
  assertIncludes(screen, "stations.slice(0, STATION_PREVIEW_LIMIT)");
  assertIncludes(screen, ": !validPurchase");
  assertIncludes(screen, 'eyebrow="REFILL AMOUNT"');
  assertIncludes(screen, 'eyebrow="STATION"');
});

Deno.test("amount-mode station eligibility remains database authoritative", async () => {
  const [migration, hook, screen] = await Promise.all([
    read("supabase/migrations/20260906023000_lpg_amount_station_eligibility.sql"),
    read("apps/lpg-mobile/src/native/api/stationEligibility.ts"),
    read("apps/lpg-mobile/src/native/ui/NewRefillScreen.tsx"),
  ]);
  assertIncludes(migration, "read_lpg_eligible_stations_for_amount");
  assertIncludes(migration, "floor((target_requested_amount / catalog_price.amount) * 1000) / 1000");
  assertIncludes(migration, "station.refill_capacity_kg");
  assertIncludes(hook, 'session.supabase.rpc("read_lpg_eligible_stations_for_amount"');
  assertNotIncludes(screen, "stationDiscoveryKg");
});

Deno.test("commercial quotes never use straight-line route pricing", async () => {
  const gateway = await read("supabase/functions/api-gateway/index.ts");
  const commercialLeg = gateway.slice(
    gateway.indexOf("async function estimateCommercialRouteLeg"),
    gateway.indexOf("async function handleMapsAutocompleteRequest"),
  );
  assertNotIncludes(commercialLeg, 'provider: "geodesic_fallback"');
  assertIncludes(commercialLeg, "missingMapsSecretResponse");
});

Deno.test("all LPG workspaces retain module safety evidence", async () => {
  const support = await read("apps/lpg-mobile/src/native/ui/SupportScreen.tsx");
  assertIncludes(support, "await mutation.mutateAsync");
  assertIncludes(support, 'firstString(order, ["lpgOrderId", "lpg_order_id", "id"])');
  assertNotIncludes(support, 'if (workspace === "customer")');
});

Deno.test("customer location save uses an unambiguous module record identifier", async () => {
  const repair = await read(
    "supabase/migrations/20260906060000_customer_location_ambiguous_identifier_repair.sql",
  );
  assertIncludes(repair, "module_location_id uuid");
  assertIncludes(repair, "mapping.legacy_id = module_location_id");
  assertNotIncludes(repair, "mapping.legacy_id = legacy_id");
  assertNotIncludes(repair, "mapping.module_location_id");
});

Deno.test("payment reservation and automatic dispatch are one transaction", async () => {
  const gateway = await read("supabase/functions/api-gateway/index.ts");
  const migration = await read("supabase/migrations/20260907010000_atomic_refill_dispatch_and_station_access.sql");
  assertIncludes(gateway, 'serviceClient.rpc("reserve_and_dispatch_lpg_refill_order"');
  assertIncludes(migration, "public.reserve_lpg_refill_order_payment(");
  assertIncludes(migration, "public.dispatch_lpg_order(");
  assertIncludes(migration, "Your wallet was not charged");
});


Deno.test("live dispatch retry accepts PostGIS driver-position coordinate types", async () => {
  const [remediation, operations] = await Promise.all([
    read("supabase/migrations/20260908193000_live_lpg_runtime_admin_reconciliation.sql"),
    read("apps/admin/src/admin-operations-workspace.tsx"),
  ]);
  assertIncludes(remediation, "origin_latitude numeric");
  assertIncludes(remediation, "target_latitude double precision");
  assertIncludes(remediation, "origin_latitude double precision");
  assertIncludes(remediation, "target_latitude::numeric");
  assertIncludes(operations, "Retry driver matching");
  assertIncludes(operations, '"/lpg/orders/dispatch"');
});

Deno.test("quality admin queue has one unambiguous production RPC shape", async () => {
  const [remediation, quality] = await Promise.all([
    read("supabase/migrations/20260908193000_live_lpg_runtime_admin_reconciliation.sql"),
    read("apps/admin/src/admin-quality-workspace.tsx"),
  ]);
  assertIncludes(remediation, "drop function if exists public.read_lpg_quality_admin_queue(text, integer)");
  assertIncludes(quality, "target_severity: null");
});

Deno.test("first-time driver geography save continues into application progress", async () => {
  const screen = await read("apps/lpg-mobile/src/native/ui/DriverApplicationEntryScreen.tsx");
  assertIncludes(screen, "continueAfterSave");
  assertIncludes(screen, "setContinueAfterSave(true)");
  assertIncludes(screen, "const refreshedApplications = await applications.refetch()");
  assertIncludes(screen, "geographyComplete || continueAfterSave");
});

Deno.test("customer home keeps independent services visible in every refill state", async () => {
  const dashboard = await read("apps/lpg-mobile/src/native/ui/PremiumDashboard.tsx");
  assertIncludes(dashboard, "function CustomerBillsCard()");
  assertIncludes(dashboard, "<CustomerBillsCard />");
  assertIncludes(dashboard, 'selectWorkspaceWallet(wallets.data ?? [], "customer")');
  assertIncludes(dashboard, "customerPrimaryStack");
  assertIncludes(await read("apps/lpg-mobile/src/native/api/domains.ts"), 'path: "/lpg/orders?scope=customer"');
});

Deno.test("customer reads remain user-scoped even when the same account has station roles", async () => {
  const [gateway, assistant] = await Promise.all([
    read("supabase/functions/api-gateway/index.ts"),
    read("apps/lpg-mobile/src/native/ui/AiAssistantScreen.tsx"),
  ]);
  const customerOrderScopeMatches =
    gateway.match(/\.eq\("customer_user_id", authResult\.user\.id\)/g) ?? [];
  if (customerOrderScopeMatches.length < 3) {
    throw new Error(
      "Customer orders, active orders and deposit history must explicitly scope to the signed-in customer.",
    );
  }
  assertIncludes(gateway, '.eq("owner_user_id", authResult.user.id)');
  assertIncludes(gateway, '.eq("created_by", authResult.user.id)');
  assertIncludes(gateway, 'routePath === "/runtime/payments/deposits/preview"');
  assertIncludes(assistant, 'path: "/lpg/orders?scope=customer"');
});

Deno.test("customer wallet top up uses the canonical gateway runtime", async () => {
  const topUp = await read("apps/lpg-mobile/src/native/ui/TopUpScreen.tsx");
  assertIncludes(topUp, 'useGatewayMutation');
  assertIncludes(topUp, 'path: "/runtime/payments/deposits/preview"');
  assertIncludes(topUp, 'path: "/runtime/payments/deposits"');
  assertNotIncludes(topUp, 'useFinanceMutation');
});

Deno.test("customer wallet activity stays compact as history grows", async () => {
  const [topUp, transactions] = await Promise.all([
    read("apps/lpg-mobile/src/native/ui/TopUpScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/CustomerFinanceActivityScreen.tsx"),
  ]);
  assertIncludes(topUp, "availableBalance");
  assertIncludes(topUp, "[2000, 5000, 10000, 20000]");
  assertIncludes(transactions, "const PAGE_SIZE = 8");
  assertIncludes(transactions, "filteredRows.slice(0, visibleCount)");
  assertIncludes(transactions, "Show");
  assertIncludes(transactions, "older transactions");
});

Deno.test("awaiting-payment orders remain resumable without creating duplicate refills", async () => {
  const [payment, orders, customerLayout] = await Promise.all([
    read("apps/lpg-mobile/src/native/ui/CustomerOrderPaymentScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/CustomerOrdersScreen.tsx"),
    read("apps/lpg-mobile/app/(customer)/_layout.tsx"),
  ]);

  assertIncludes(payment, 'path: "/lpg/orders/reserve-payment"');
  assertIncludes(payment, 'source: "skima.lpg.mobile.resume-payment"');
  assertIncludes(payment, 'idempotencyKey("reserve-order-payment", orderId)');
  assertIncludes(payment, "domainQueries.orders()");
  assertNotIncludes(payment, "useJobDetails");
  assertNotIncludes(payment, "create_lpg_refill_order");
  assertNotIncludes(payment, "reserve.reset()");
  assertIncludes(orders, '"Continue payment"');
  assertIncludes(orders, 'orders/${id}/payment');
  assertIncludes(orders, "const ORDER_PAGE_SIZE = 8");
  assertIncludes(orders, "filteredOrders.slice(0, visibleCount)");
  assertIncludes(orders, "jobOrder ?? savedOrder");
  assertIncludes(customerLayout, '"orders/[id]/payment"');
});

Deno.test("station, driver and customer operation queues avoid unbounded long screens", async () => {
  const [inventory, jobs, orders] = await Promise.all([
    read("apps/lpg-mobile/src/native/ui/StationInventoryScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/JobListScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/CustomerOrdersScreen.tsx"),
  ]);

  assertIncludes(inventory, 'type InventorySection = "overview" | "stock" | "operations" | "sources" | "activity"');
  assertIncludes(inventory, "InventorySectionSwitcher");
  assertIncludes(inventory, 'section === "stock"');
  assertIncludes(inventory, 'section === "operations"');
  assertIncludes(inventory, 'section === "sources"');
  assertIncludes(inventory, 'section === "activity"');
  assertIncludes(inventory, "LayerShortcut");
  assertIncludes(jobs, "const JOB_PAGE_SIZE = 8");
  assertIncludes(jobs, "matchingJobs.slice(0, visibleCount)");
  assertIncludes(jobs, "Show ${Math.min(JOB_PAGE_SIZE");
  assertIncludes(orders, "const ORDER_PAGE_SIZE = 8");
});

Deno.test("nearby station discovery is location and service-radius authoritative", async () => {
  const [migration, gateway, domains, stationsScreen] = await Promise.all([
    read("supabase/migrations/20260907104500_lpg_customer_nearby_station_public_media.sql"),
    read("supabase/functions/api-gateway/index.ts"),
    read("apps/lpg-mobile/src/native/api/domains.ts"),
    read("apps/lpg-mobile/src/native/ui/StationsScreen.tsx"),
  ]);
  assertIncludes(migration, "create or replace function public.read_nearby_lpg_stations");
  assertIncludes(migration, "least(resolved_radius, station.service_radius_meters)");
  assertIncludes(migration, "public.lpg_distance_meters(");
  assertIncludes(migration, "station.approval_status = 'approved'");
  assertIncludes(migration, "station.compliance_status = 'approved'");
  assertIncludes(gateway, 'routePath === "/lpg/stations/nearby"');
  assertIncludes(gateway, 'supabase.rpc("read_nearby_lpg_stations"');
  const stationDetail = await read("apps/lpg-mobile/src/native/ui/StationDetailScreen.tsx");
  assertIncludes(domains, "nearbyStations:");
  assertIncludes(stationsScreen, "domainQueries.nearbyStations(latitude, longitude)");
  assertNotIncludes(stationsScreen, "domainQueries.stations()");
  assertIncludes(stationDetail, "domainQueries.nearbyStations(deliveryLatitude, deliveryLongitude)");
  assertIncludes(stationDetail, 'useEntityMediaLinks("station", station ? id : null)');
  assertNotIncludes(stationDetail, "domainQueries.stations()");
});

Deno.test("refill cylinder chooser uses presentation media without oversized placeholder copy", async () => {
  const [refill, mediaImage] = await Promise.all([
    read("apps/lpg-mobile/src/native/ui/NewRefillScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/RuntimeMediaImage.tsx"),
  ]);
  assertIncludes(refill, 'useEntityMediaLinks("lpg_cylinder", cylinderId)');
  assertIncludes(refill, "presentationId ?? originalId");
  assertIncludes(refill, '"SKIMA display image"');
  assertIncludes(mediaImage, 'variant === "thumbnail"');
  assertIncludes(mediaImage, '"No photo"');
  assertIncludes(mediaImage, "thumbnailLabel");
});

Deno.test("cylinder presentation generation does not require an uploaded source photo", async () => {
  const registration = await read("apps/lpg-mobile/src/native/ui/CylinderRegistrationScreen.tsx");
  assertIncludes(registration, "if (cylinderId) {");
  assertIncludes(registration, 'generationMode: assetId ? "source_guided" : "text_to_image"');
  assertIncludes(registration, '...(assetId ? { sourceMediaAssetId: assetId } : {})');
  assertNotIncludes(registration, "if (assetId && cylinderId)");
});

Deno.test("station activation publishes only public-safe premises media", async () => {
  const [migration, onboarding, detail] = await Promise.all([
    read("supabase/migrations/20260907104500_lpg_customer_nearby_station_public_media.sql"),
    read("apps/lpg-mobile/src/native/application/MultiPhotoRequirement.tsx"),
    read("apps/lpg-mobile/src/native/ui/StationDetailScreen.tsx"),
  ]);
  assertIncludes(migration, "publish_station_profile_media_for_application");
  assertIncludes(migration, "application_records_publish_station_media");
  assertIncludes(migration, "'PUBLIC_PROFILE_CANDIDATE'");
  assertIncludes(migration, "'PUBLIC_APPROVED'");
  for (const privateClass of ["'PRIVATE_KYC'", "'PRIVATE_VERIFICATION'", "'INTERNAL_ONLY'"]) {
    assertIncludes(migration, privateClass);
  }
  assertIncludes(migration, "'station.photo.public'");
  assertIncludes(onboarding, "five or more premises photos");
  assertIncludes(onboarding, "Public-safe premises photos go live automatically when your station is activated.");
  assertIncludes(detail, "Station photos");
  assertIncludes(detail, 'role === "station.photo.public"');
});

function assertIncludes(value: string, expected: string) {
  if (!value.includes(expected)) throw new Error(`Expected source to include: ${expected}`);
}

function assertNotIncludes(value: string, expected: string) {
  if (value.includes(expected)) throw new Error(`Expected source not to include: ${expected}`);
}
