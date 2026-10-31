Deno.test("Station Managed drivers get a continuous scan tab while SKIMA Internal keeps supplier verification", async () => {
  const [screen, route, tabs, list, internal, detail, migration] = await Promise.all([
    read("apps/lpg-mobile/src/native/ui/StationManagedDriverScanScreen.tsx"),
    read("apps/lpg-mobile/app/(station-driver)/scan.tsx"),
    read("apps/lpg-mobile/src/native/navigation/WorkspaceTabs.tsx"),
    read("apps/lpg-mobile/src/native/ui/StationManagedDriverJobsScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/InternalDriverJobDetailScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/JobDetailScreen.tsx"),
    read("supabase/migrations/20261031090000_lpg_simple_batch_operations_runtime.sql"),
  ]);
  assertIncludes(screen, "read_lpg_station_managed_driver_jobs");
  assertIncludes(screen, 'workspace="driver"');
  assertIncludes(route, "StationManagedDriverScanScreen");
  assertIncludes(tabs, '{ name: "scan", title: "Scan", icon: QrCode }');
  assertIncludes(list, 'router.push("/(station-driver)/scan"');
  assertIncludes(internal, "continuousScan.mutateAsync");
  assertIncludes(internal, 'workspace: "driver"');
  assertIncludes(internal, 'source: "skima.lpg.continuous"');
  assertIncludes(migration, "order_status = 'pickup_verified'");
  assertIncludes(migration, "'lpg.station.start'");
  assertIncludes(detail, "station staff scan it at reception");
  assertIncludes(migration, "fulfillment_channel = 'skima_internal'");
});

Deno.test("continuous LPG cylinder scanning matches only the signed-in actor's active assigned order", async () => {
  const [migration, gateway, scanScreen, scanner, jobDetail] = await Promise.all([
    read("supabase/migrations/20261031090000_lpg_simple_batch_operations_runtime.sql"),
    read("supabase/functions/api-gateway/index.ts"),
    read("apps/lpg-mobile/src/native/ui/ScanWorkspaceScreen.tsx"),
    read("apps/lpg-mobile/src/native/device/Scanner.tsx"),
    read("apps/lpg-mobile/src/native/ui/JobDetailScreen.tsx"),
  ]);
  assertIncludes(migration, "public.record_lpg_cylinder_scan_for_active_job");
  assertIncludes(migration, "auth.uid()");
  assertIncludes(migration, "public.user_can_operate_lpg_station_branch");
  assertIncludes(migration, "public.is_lpg_station_managed_order_driver");
  assertIncludes(migration, "public.hash_lpg_cylinder_tag_credential");
  assertIncludes(migration, "legacyCylinderIdentifiers");
  assertIncludes(migration, "public.record_lpg_cylinder_scan(");
  assertIncludes(migration, "public.process_lpg_order_action(");
  assertIncludes(migration, "'lpg.pickup.start'");
  assertIncludes(migration, "'lpg.station.start'");
  assertIncludes(gateway, '"/lpg/scans/continuous"');
  assertIncludes(gateway, 'supabase.rpc("record_lpg_cylinder_scan_for_active_job"');
  assertIncludes(scanScreen, 'path: "/lpg/scans/continuous"');
  assertIncludes(scanScreen, "Scan next cylinder");
  assertIncludes(scanScreen, "automatically finds the matching active order");
  assertIncludes(scanner, "continuous?: boolean");
  assertIncludes(scanner, "setTimeout(() => setLocked(false), 1100)");
  assertIncludes(scanner, "Scan the same cylinder again");
  assertIncludes(jobDetail, "continuousScan.mutateAsync");
  assertIncludes(jobDetail, "station staff scan it at reception");
  assertIncludes(migration, "'lpg.station.start'");
  const driverScanRules = jobDetail.slice(
    jobDetail.indexOf("function driverScanTypeForStatus"),
    jobDetail.indexOf("function stationScanTypeForStatus"),
  );
  const stationScanRules = jobDetail.slice(
    jobDetail.indexOf("function stationScanTypeForStatus"),
    jobDetail.indexOf("function driverActionForStatus"),
  );
  assertNotIncludes(driverScanRules, 'return "station_receipt"');
  assertIncludes(stationScanRules, 'return "station_receipt"');
  assertIncludes(migration, "order_row.fulfillment_channel = 'skima_internal'");
});

Deno.test("station quick operations preserve per-cylinder safety and per-order refill settlement", async () => {
  const [migration, panel, jobs] = await Promise.all([
    read("supabase/migrations/20261031090000_lpg_simple_batch_operations_runtime.sql"),
    read("apps/lpg-mobile/src/native/ui/StationBatchOperationsPanel.tsx"),
    read("apps/lpg-mobile/src/native/ui/JobListScreen.tsx"),
  ]);
  assertIncludes(migration, "'latestInspectionResult'");
  assertIncludes(migration, "'fulfillmentChannel'");
  assertIncludes(migration, "case when resolved.queue_name in ('driver','station','admin') then resolved.fulfillment_channel else null end");
  assertIncludes(migration, "latest_inspection.result");
  assertIncludes(panel, 'path: "/lpg/inspections"');
  assertIncludes(panel, 'result,');
  assertIncludes(panel, 'result === "safe"');
  assertIncludes(panel, '"safe" | "manual_review"');
  assertIncludes(panel, "for (const row of enteredRows)");
  assertIncludes(panel, 'actionKey: "lpg.refill.start"');
  assertIncludes(panel, 'path: "/lpg/refills/confirm"');
  assertIncludes(panel, 'permissions.has("lpg.stations.scan")');
  assertIncludes(panel, "Station release requires an authorised scanner on this branch.");
  assertIncludes(panel, "An authorised station scanner or pump operator must receive these cylinders.");
  assertIncludes(panel, "Each order is confirmed separately. One failed order does not block the other entered refills.");
  assertIncludes(panel, "failures.push");
  assertIncludes(jobs, "StationBatchOperationsPanel");
});

Deno.test("driver job final delivery uses the assigned-cylinder resolver and reflects customer OTP verification", async () => {
  const [detail, internal, projection, payoutAuthorization] = await Promise.all([
    read("apps/lpg-mobile/src/native/ui/JobDetailScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/InternalDriverJobDetailScreen.tsx"),
    read("supabase/migrations/20261031103000_lpg_job_details_delivery_challenge_verification_state.sql"),
    read("supabase/migrations/20261031100500_lpg_driver_self_wallet_payout_authorization.sql"),
  ]);
  const driverScan = detail.slice(
    detail.indexOf("const submitDriverScan"),
    detail.indexOf("const submitStationScan"),
  );
  const internalScan = internal.slice(
    internal.indexOf("const submitScan"),
    internal.indexOf("const confirmInternalRefill"),
  );
  assertIncludes(driverScan, "continuousScan.mutateAsync");
  assertIncludes(driverScan, 'workspace: "driver"');
  assertIncludes(driverScan, "token: token.trim()");
  assertNotIncludes(driverScan, "scan.mutateAsync");
  assertIncludes(internalScan, "continuousScan.mutateAsync");
  assertIncludes(internalScan, 'workspace: "driver"');
  assertIncludes(detail, "deliveryChallengeVerified");
  assertIncludes(detail, "Customer delivery verification is complete.");
  assertIncludes(internal, "Customer delivery verification is complete.");
  assertIncludes(projection, "deliveryChallengeVerified");
  assertIncludes(projection, "public.lpg_delivery_challenge_is_verified");
  assertIncludes(payoutAuthorization, "can_create_driver_wallet");
  assertIncludes(payoutAuthorization, "driver.user_id = auth.uid()");
  assertIncludes(payoutAuthorization, "driver.verification_status = 'approved'");
  assertIncludes(payoutAuthorization, "platform.wallets.manage");
});

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
  assertIncludes(screen, 'eyebrow="FULFILLMENT"');
});

Deno.test("layered fulfillment stays aligned with SKIMA-owned fleet requirements", async () => {
  const [screen, orders, gateway, helper, alignment, sameDriverReadiness] = await Promise.all([
    read("apps/lpg-mobile/src/native/ui/NewRefillScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/CustomerOrdersScreen.tsx"),
    read("apps/lpg-mobile/src/native/api/gateway.ts"),
    read("apps/lpg-mobile/src/native/api/lpgFulfillment.ts"),
    read("supabase/migrations/20260918121500_lpg_internal_fulfillment_fleet_alignment.sql"),
    read("supabase/migrations/20260918121800_lpg_internal_fulfillment_same_driver_readiness.sql"),
  ]);
  assertIncludes(helper, "SKIMA_INTERNAL_FULFILLMENT_ID");
  assertIncludes(gateway, "SKIMA_INTERNAL_FULFILLMENT_ID");
  assertIncludes(screen, "isSkimaInternalFulfillmentId");
  assertIncludes(screen, "SKIMA MANAGED");
  assertNotIncludes(screen, "Finding eligible stations…");
  assertIncludes(orders, "isSkimaInternalFulfillmentChannel");
  assertIncludes(orders, "SKIMA-managed fulfillment");
  assertIncludes(alignment, "vehicle.platform_owned");
  assertIncludes(alignment, "relationship_type='fleet_owned'");
  assertIncludes(alignment, "read_lpg_internal_launch_readiness");
  assertIncludes(alignment, "dispatch_lpg_internal_order");
  assertIncludes(sameDriverReadiness, "fullyReadyDriverCount");
  assertIncludes(sameDriverReadiness, "relationship_type='fleet_owned'");
  assertIncludes(sameDriverReadiness, "vehicle.platform_owned");
  assertIncludes(sameDriverReadiness, "operational_coverage_assignments");
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

Deno.test("driver geography save continues without turning a successful persistence into a refresh error", async () => {
  const screen = await read("apps/lpg-mobile/src/native/ui/DriverApplicationEntryScreen.tsx");
  assertIncludes(screen, "continueAfterSave");
  assertIncludes(screen, "setContinueAfterSave(true)");
  assertIncludes(screen, "void applications.refetch()");
  assertIncludes(screen, "geographyComplete || continueAfterSave");
  assertNotIncludes(screen, "const refreshedApplications = await applications.refetch()");
});

Deno.test("detected driver location cannot retain a stale mapped area from another state", async () => {
  const [screen, repair, guard] = await Promise.all([
    read("apps/lpg-mobile/src/native/ui/DriverApplicationEntryScreen.tsx"),
    read("supabase/migrations/20260908204716_reconcile_cross_state_driver_application_coverage.sql"),
    read("supabase/migrations/20260908204807_partner_application_cross_state_coverage_guard.sql"),
  ]);

  assertIncludes(screen, "readMatchedGeographyId");
  assertIncludes(screen, "setSelectedIds([])");
  assertIncludes(screen, "setCandidateCoverage(null)");
  assertIncludes(screen, "matchedGeographyId");

  assertIncludes(repair, "application.lpg.driver.phase-one");
  assertIncludes(repair, "'RADIUS'");
  assertIncludes(repair, "'universal_candidate_coverage'");

  assertIncludes(guard, "normalize_partner_application_coverage_for_location");
  assertIncludes(guard, "before insert or update of payload");
  assertIncludes(guard, "application.lpg.station.phase-one");
  assertIncludes(guard, "'RADIUS'");
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

Deno.test("wallet top up keeps native return links out of Paystack callback_url", async () => {
  const [topUp, gateway] = await Promise.all([
    read("apps/lpg-mobile/src/native/ui/TopUpScreen.tsx"),
    read("supabase/functions/api-gateway/index.ts"),
  ]);
  assertNotIncludes(topUp, 'callbackUrl: Linking.createURL("payment-return")');
  assertIncludes(topUp, 'returnUrl: Linking.createURL("payment-return")');
  assertIncludes(gateway, "isHttpsUrl(requestedCallbackUrl)");
  assertIncludes(gateway, 'Deno.env.get("SKIMA_PAYSTACK_CALLBACK_URL")');
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

Deno.test("station scanner includes incoming receipt and shows visible confirmation feedback", async () => {
  const [scanner, jobDetail, migration] = await Promise.all([
    read("apps/lpg-mobile/src/native/ui/ScanWorkspaceScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/JobDetailScreen.tsx"),
    read("supabase/migrations/20261031074200_lpg_station_operator_arrival_verification.sql"),
  ]);
  assertIncludes(scanner, '["station_en_route", "refill_confirmed", "station_settled"]');
  assertIncludes(scanner, "stationArrivalStage");
  assertIncludes(scanner, "Scan each arriving or refilled cylinder once.");
  assertNotIncludes(scanner, "Nothing ready for release");
  assertIncludes(jobDetail, 'if (status === "station_en_route") return "station_receipt";');
  assertIncludes(jobDetail, "Enter Cylinder ID (e.g. M6D48)");
  assertIncludes(jobDetail, "Cylinder arrival verified at this station.");
  assertIncludes(jobDetail, "Station receipt verified. SKIMA matched the driver's scanned cylinder to this order.");
  assertIncludes(jobDetail, 'accessibilityLiveRegion="polite"');
  assertIncludes(jobDetail, '["public_reference", "publicReference", "reference"]');
  assertIncludes(migration, "'lpg.stations.scan'");
  assertIncludes(migration, "'lpg.stations.pump'");
  assertIncludes(migration, "authorized station operator is required for station receipt scan");
});

Deno.test("all LPG order read models expose the short Cylinder ID consistently", async () => {
  const migration = await read(
    "supabase/migrations/20261031073100_lpg_short_cylinder_order_read_models.sql",
  );
  assertIncludes(migration, "'cylinderReference',cylinder.cylinder_identifier");
  assertIncludes(migration, "'cylinderIdentifier',cylinder.cylinder_identifier");
  assertIncludes(migration, "'cylinderRegistryReference',cylinder.public_reference");
  assertIncludes(migration, "'publicReference', cylinder.cylinder_identifier");
  assertIncludes(migration, "'legacyRegistryReference', cylinder.public_reference");
  assertIncludes(migration, "'cylinderReference', cylinder.cylinder_identifier");
});

Deno.test("LPG permanent Cylinder IDs are unique five-character alphanumeric codes with legacy scan aliases", async () => {
  const [migration, scan, identity, detail] = await Promise.all([
    read("supabase/migrations/20261031073000_lpg_short_cylinder_verification_ids.sql"),
    read("apps/lpg-mobile/src/native/ui/ScanWorkspaceScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/CylinderIdentityScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/CylinderDetailScreen.tsx"),
  ]);
  assertIncludes(migration, "for index_value in 1..5 loop");
  assertIncludes(migration, "candidate ~ '[A-HJ-NP-Z]'");
  assertIncludes(migration, "candidate ~ '[2-9]'");
  assertIncludes(migration, "lpg_cylinders_cylinder_identifier_global_unique");
  assertIncludes(migration, "legacyCylinderIdentifiers");
  assertIncludes(migration, "verifiedCylinderReference', cylinder_record.cylinder_identifier");
  assertIncludes(scan, "five-character Cylinder ID");
  assertIncludes(scan, "Example: A7KQ4");
  assertNotIncludes(scan, "SKIMA-CYL-");
  assertNotIncludes(scan, "CYL-000000");
  assertNotIncludes(identity, "Registry ref ·");
  assertNotIncludes(detail, "Registry ref ·");
});

Deno.test("nearby station query coordinates parse URL strings before validation", async () => {
  const gateway = await read("supabase/functions/api-gateway/index.ts");
  assertIncludes(gateway, 'requireNumberQuery(url.searchParams.get("latitude"), "latitude")');
  assertIncludes(gateway, 'requireNumberQuery(url.searchParams.get("longitude"), "longitude")');
  assertIncludes(gateway, 'optionalNumberQuery(url.searchParams.get("radiusMeters"), "radiusMeters")');
  assertIncludes(gateway, "const parsed = Number(value);");
  assertIncludes(gateway, "Number.isFinite(parsed)");
});

Deno.test("approved LPG application evidence is projected into entity dispatch compliance", async () => {
  const migration = await read(
    "supabase/migrations/20261031055130_lpg_application_compliance_evidence_projection.sql",
  );
  assertIncludes(migration, "create or replace function public.sync_application_compliance_evidence(");
  assertIncludes(migration, "requirement_record.key = 'driver.lpg_approval'");
  assertIncludes(migration, "document.status = 'approved'");
  assertIncludes(migration, "sourceApplicationId");
  assertIncludes(migration, "application_records_sync_dispatch_compliance");
  assertIncludes(migration, "document_submissions_sync_dispatch_compliance");
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
  assertIncludes(stationsScreen, 'useEntityMediaLinks("station", id)');
  assertIncludes(stationsScreen, '"station.logo.public"');
  assertIncludes(stationsScreen, "RuntimeMediaImage");
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

Deno.test("LPG dispatch decision snapshot conflict target is unambiguous", async () => {
  const migration = await read("supabase/migrations/20261029122600_lpg_dispatch_decision_snapshot_conflict_fix.sql");
  assertIncludes(migration, "dispatch_location_decision_snapshots_dispatch_request_id_key");
  assertIncludes(migration, "ON CONFLICT ON CONSTRAINT");
  assertNotIncludes(migration, "ON CONFLICT(dispatch_request_id) DO NOTHING");
});

Deno.test("SKIMA Managed LPG reference-price save avoids ambiguous module_id binding", async () => {
  const migration = await read("supabase/migrations/20261029132000_lpg_internal_reference_price_ambiguity_fix.sql");
  assertIncludes(migration, "resolved_module_id uuid;");
  assertIncludes(migration, "version.module_id=resolved_module_id");
  assertNotIncludes(migration, "version.module_id=module_id");
});

Deno.test("explicit driver availability synchronizes dispatch status only on a user action", async () => {
  const [migration, screen] = await Promise.all([
    read("supabase/migrations/20261029132100_sync_explicit_driver_availability.sql"),
    read("apps/lpg-mobile/src/native/ui/DriverAvailabilityScreen.tsx"),
  ]);
  assertIncludes(migration, "driverAvailabilityAction");
  assertIncludes(migration, "update public.driver_profiles");
  assertIncludes(migration, "when 'online' then 'available'");
  assertIncludes(migration, "when 'busy' then 'busy'");
  assertIncludes(screen, "metadata: { driverAvailabilityAction: true }");
  assertIncludes(screen, "await startDriverTracking");
});

Deno.test("admin application feed returns activation state used by Live access", async () => {
  const gateway = await read("supabase/functions/api-gateway/index.ts");
  const start = gateway.indexOf("async function applicationsResponse(");
  assertIncludes(gateway, "async function applicationsResponse(");
  const section = gateway.slice(start, start + 1800);
  assertIncludes(section, "operational_status");
  assertIncludes(section, "activated_at");
  assertIncludes(section, "activated_by");
});

Deno.test("Nigeria location enablement stays separate from physical LPG fulfilment readiness", async () => {
  const [migration, admin, partnerCoverage, refillScreen, serviceability] = await Promise.all([
    read("supabase/migrations/20261029182549_nigeria_location_enablement_fulfilment_gates.sql"),
    read("apps/admin/src/admin-service-coverage-workspace.tsx"),
    read("apps/admin/src/features/operations/CoveragePartnerScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/NewRefillScreen.tsx"),
    read("apps/lpg-mobile/src/native/api/serviceability.ts"),
  ]);

  assertIncludes(migration, "addressHierarchyMatch");
  assertIncludes(migration, "'notFulfilmentGuarantee',true");
  assertIncludes(migration, "'skima_managed_fulfillment'");
  assertIncludes(migration, "public.lpg_independent_live_driver_available_at");
  assertIncludes(migration, "delivery_record.latitude");
  assertIncludes(migration, "delivery_record.longitude");
  assertIncludes(migration, "service_radius_meters");

  assertIncludes(admin, 'selectedLevel?.key === "custom_zone"');
  assertIncludes(admin, "Country, State, LGA, city and town rules can be saved by name without drawing a line.");
  assertIncludes(admin, "Physical refill availability is checked separately");
  assertIncludes(partnerCoverage, "area.has_boundary === true");

  assertIncludes(refillScreen, "Location enabled — checking live fulfilment");
  assertIncludes(refillScreen, "No active refill team in this location yet");
  assertIncludes(refillScreen, "No order or wallet reservation is created just because the location is enabled.");
  assertIncludes(serviceability, "skimaManagedEnabled: z.boolean().optional()");
});

Deno.test("admin location and coverage workflows keep physical dispatch gates intact", async () => {
  const [locationMigration, adminMigration, driverCutoverMigration, coverageWorkspace, managedDriverWorkspace, geometryEditor, vercelConfig] = await Promise.all([
    read("supabase/migrations/20261029182549_nigeria_location_enablement_fulfilment_gates.sql"),
    read("supabase/migrations/20261030131328_admin_coverage_refresh_reject_map_tile_and_driver_fixes.sql"),
    read("supabase/migrations/20261030134717_managed_driver_coverage_universal_assignment_cutover.sql"),
    read("apps/admin/src/features/operations/CoverageWorkspaceV2.tsx"),
    read("apps/admin/src/admin-managed-driver-coverage-workspace.tsx"),
    read("apps/admin/src/admin-geometry-editor.tsx"),
    read("apps/admin/vercel.json"),
  ]);

  assertIncludes(locationMigration, "addressHierarchyMatch");
  assertIncludes(coverageWorkspace, 'const isCustomZone = selectedLevel?.key === "custom_zone"');
  assertIncludes(coverageWorkspace, "No polygon required for this administrative area");
  assertIncludes(coverageWorkspace, "Continue with this area name");
  assertIncludes(coverageWorkspace, "p_boundary_geojson: boundary");

  assertIncludes(geometryEditor, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  assertIncludes(geometryEditor, "© OpenStreetMap contributors");
  assertIncludes(geometryEditor, 'const SAFE_TILE_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"');

  assertIncludes(managedDriverWorkspace, 'context?.permissions.includes("platform.drivers.manage")');
  assertIncludes(managedDriverWorkspace, "Driver service areas unavailable");

  const adminRoutes = JSON.parse(vercelConfig) as { rewrites?: unknown[]; routes?: unknown[] };
  if (!Array.isArray(adminRoutes.rewrites) || adminRoutes.rewrites.length === 0) {
    throw new Error("Admin Vercel configuration must rewrite direct SPA routes to the root entrypoint.");
  }
  if (adminRoutes.routes) {
    throw new Error("Legacy Vercel routes fallback must not shadow the admin SPA rewrite.");
  }
  const rewriteDestination = (adminRoutes.rewrites[0] as { destination?: string }).destination;
  if (rewriteDestination !== "/") {
    throw new Error("Admin SPA rewrite must target / when cleanUrls is enabled.");
  }

  const rejectDecisionIndex = adminMigration.indexOf("if p_decision = 'APPROVED' then");
  const activationGuardIndex = adminMigration.indexOf("driver application must be activated before coverage approval");
  if (rejectDecisionIndex < 0 || activationGuardIndex < rejectDecisionIndex) {
    throw new Error("Activation checks must be inside the APPROVED-only coverage branch so rejection remains possible.");
  }
  assertIncludes(adminMigration, "public.can_manage_lpg_operations()");
  assertIncludes(adminMigration, "effective_reason");
  assertIncludes(adminMigration, "platform.drivers.manage");
  assertIncludes(adminMigration, "geography.boundary_geometry is not null");
  assertIncludes(adminMigration, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  assertNotIncludes(adminMigration, "basemaps.cartocdn.com");

  assertIncludes(driverCutoverMigration, "public.configure_operational_coverage_assignment(");
  assertIncludes(driverCutoverMigration, "managedDriverServiceAreaKey");
  assertIncludes(driverCutoverMigration, "public.operational_coverage_assignments");
  assertNotIncludes(driverCutoverMigration, "insert into public.driver_service_areas");
  assertNotIncludes(driverCutoverMigration, "update public.driver_service_areas");
  assertNotIncludes(driverCutoverMigration, "from public.driver_service_areas");
});



Deno.test("verified LPG customer hand-over advances the order and invokes the existing payout trigger", async () => {
  const migration = await read("supabase/migrations/20261031120000_lpg_delivery_otp_completion_and_payout_bridge.sql");
  const verification = await read("apps/lpg-mobile/src/native/ui/DeliveryVerificationScreen.tsx");
  assertIncludes(migration, "order_record.delivery_challenge_id is distinct from target_challenge_id");
  assertIncludes(migration, "set status = 'delivered'");
  assertIncludes(migration, "'lpg.delivery.completed'");
  assertIncludes(migration, "target_idempotency_key || ':delivery-completed'");
  assertIncludes(migration, "public.lpg_delivery_challenge_is_verified");
  assertIncludes(migration, "previously_verified_customer_otp");
  assertIncludes(migration, "station_settlement_execution_id is not null");
  assertIncludes(migration, "for update");
  assertIncludes(migration, "lpg-delivery-otp-completion-backfill:");
  assertIncludes(migration, "verified_order.fulfillment_mode = 'independent_driver'");
  assertIncludes(migration, "verified_order.fulfillment_channel = 'marketplace'");
  assertNotIncludes(migration, "set driver_commission_amount");
  assertIncludes(verification, "const refreshed = await details.refetch()");
  assertIncludes(verification, '["delivered", "completed"].includes(finalStatus ?? "")');
  assertIncludes(verification, "deliveryChallengeVerified");
});

Deno.test("customer live tracking renders the current driver marker separately from the chronological route", async () => {
  const tracking = await read("apps/lpg-mobile/src/native/ui/LiveTrackingScreen.tsx");
  const webMap = await read("apps/lpg-mobile/src/native/maps/OperationalMap.web.tsx");
  const nativeMap = await read("apps/lpg-mobile/src/native/maps/OperationalMap.native.tsx");
  assertIncludes(tracking, "const latestDriver = driverPath.at(-1)");
  assertIncludes(tracking, "useMapsGatewayAdapter()");
  assertIncludes(tracking, "mapsGateway.routeEstimate.mutateAsync");
  assertIncludes(tracking, "readRouteCoordinates(estimate.routeGeometry)");
  assertIncludes(tracking, "routeCoordinates={roadRoute?.coordinates ?? driverPath}");
  assertIncludes(tracking, "customer-live-road-route");
  assertIncludes(tracking, "const mapped = [...(latestDriver ? [latestDriver] : [])");
  assertIncludes(tracking, "!Number.isFinite(recordedAt)");
  assertIncludes(webMap, "routeCoordinates?: readonly");
  assertIncludes(nativeMap, "routeCoordinates?: readonly");
  assertIncludes(webMap, "Open full-screen map");
  assertIncludes(nativeMap, "Open full-screen map");
  assertNotIncludes(webMap, "Map tiles are temporarily unavailable");
  assertNotIncludes(webMap, "tileFailure");
});

Deno.test("driver job detail is progressive rather than one long single-page workflow", async () => {
  const job = await read("apps/lpg-mobile/src/native/ui/JobDetailScreen.tsx");
  assertIncludes(job, 'useState<"overview" | "route" | "actions" | "details">("overview")');
  assertIncludes(job, 'driverSection === "overview"');
  assertIncludes(job, 'driverSection === "route"');
  assertIncludes(job, 'driverSection === "actions"');
  assertIncludes(job, 'driverSection === "details"');
  assertIncludes(job, 'accessibilityRole="tablist"');
  assertIncludes(job, "Open route and navigation");
});



Deno.test("verified OTP orders can resume delivery completion without requesting a second code", async () => {
  const verification = await read("apps/lpg-mobile/src/native/ui/DeliveryVerificationScreen.tsx");
  const feedback = await read("apps/lpg-mobile/src/native/ui/OrderFeedbackScreen.tsx");
  const mapRuntime = await read("apps/lpg-mobile/src/native/domains/maps/index.ts");
  const rendererHook = await read("apps/lpg-mobile/src/native/domains/maps/useMapsRendererConfiguration.ts");
  const nativeMap = await read("apps/lpg-mobile/src/native/maps/OperationalMap.native.tsx");
  const webMap = await read("apps/lpg-mobile/src/native/maps/OperationalMap.web.tsx");

  assertIncludes(verification, '["deliveryChallengeId", "delivery_challenge_id"]');
  assertIncludes(verification, "currentChallengeVerified");
  assertIncludes(verification, "delivery-finalize-verified");
  assertIncludes(verification, 'canFinalizeVerifiedChallenge ? "0000" : code.trim()');
  assertIncludes(verification, 'label={canFinalizeVerifiedChallenge ? "Finish delivery" : "Confirm delivery"}');
  assertIncludes(feedback, "Finish delivery confirmation");
  assertIncludes(feedback, "orders/\${orderId}/verify");
  assertIncludes(mapRuntime, "clamp(Math.round(tileMaxZoom), 1, 19)");
  assertIncludes(rendererHook, "Math.min(configuration.max_zoom ?? runtimeTile.maxZoom, runtimeTile.maxZoom, 19)");
  assertIncludes(nativeMap, "maxzoom: 19");
  assertIncludes(nativeMap, "TransformRequestManager.addHeader");
  assertIncludes(nativeMap, "SKIMA-LPG/1.0");
  assertIncludes(webMap, "Math.min(maxZoom ?? providerTileMaxZoom, providerTileMaxZoom, 19)");
});


Deno.test("SKIMA Managed driver detail is split into progressive workflow sections", async () => {
  const internal = await read("apps/lpg-mobile/src/native/ui/InternalDriverJobDetailScreen.tsx");
  assertIncludes(internal, 'useState<"overview" | "route" | "actions" | "refill" | "details">("overview")');
  assertIncludes(internal, 'accessibilityRole="tablist"');
  assertIncludes(internal, 'section === "overview"');
  assertIncludes(internal, 'section === "route"');
  assertIncludes(internal, 'section === "actions"');
  assertIncludes(internal, 'section === "refill"');
  assertIncludes(internal, 'section === "details"');
  assertIncludes(internal, "draftStore.load");
  assertIncludes(internal, "draftStore.save");
  assertIncludes(internal, "confirmInternalRefill");
  assertIncludes(internal, "submitScan");
});


Deno.test("independent driver earnings are split into gross, SKIMA commission and net without mixing fulfilment ownership", async () => {
  const payout = await read("supabase/migrations/20261031113000_lpg_independent_driver_payout_commission_split.sql");
  const delivery = await read("supabase/migrations/20261031120000_lpg_delivery_otp_completion_and_payout_bridge.sql");
  const admin = await read("apps/admin/src/admin-delivery-pricing-workspace.tsx");
  const driverJob = await read("apps/lpg-mobile/src/native/ui/JobDetailScreen.tsx");

  // The accepted quote must distinguish gross earning, the platform deduction,
  // the net payout and any separate logistics margin.
  assertIncludes(payout, "platform_commission_percent");
  assertIncludes(payout, "payout_basis");
  assertIncludes(payout, "gross_driver_payout := customer_delivery_fee");
  assertIncludes(payout, "platform_driver_commission := round(gross_driver_payout * platform_commission_percent / 100, 2)");
  assertIncludes(payout, "driver_payout := round(gross_driver_payout - platform_driver_commission, 2)");
  assertIncludes(payout, "logistics_margin := round(customer_delivery_fee - gross_driver_payout, 2)");
  assertIncludes(payout, "'revenue_stream', 'driver_commission'");
  assertIncludes(payout, "'driver_commission', independent_driver_commission_amount");

  // Only independent marketplace fulfilment receives this percentage split.
  assertIncludes(payout, "order_record.fulfillment_mode = 'independent_driver'");
  assertIncludes(payout, "order_record.fulfillment_channel = 'marketplace'");
  assertIncludes(payout, "Station Managed drivers are paid by their station");
  assertIncludes(payout, "SKIMA Fleet/Managed work uses its own payout/settlement policy");

  // A legacy zero-rate order is corrected from previously classified SKIMA
  // revenue as a separate, auditable adjustment; snapshots are not rewritten.
  assertIncludes(payout, "legacy_zero_payout_correction");
  assertIncludes(payout, "driver_payout_correction");
  assertIncludes(payout, "gross_driver_earning_amount");
  assertIncludes(delivery, "target_source = 'lpg.wallet_engine'");
  assertIncludes(delivery, "verified_order.id::text = target_metadata ->> 'lpg_order_id'");
  assertIncludes(delivery, "verified_order.metadata ->> 'platform_revenue_classification_transaction_id' is not null");
  assertIncludes(delivery, "public.lpg_delivery_challenge_is_verified");

  // Admin configuration and the Driver screen both expose the policy-driven
  // split; client code reads amounts, it never invents a commission.
  assertIncludes(admin, "platform_commission_percent");
  assertIncludes(admin, "payout_basis");
  assertIncludes(admin, "SKIMA commission from independent-driver gross earnings (%)");
  assertIncludes(driverJob, "Gross delivery earning");
  assertIncludes(driverJob, "SKIMA commission (");
  assertIncludes(driverJob, "Your net driver payout");
  assertIncludes(driverJob, 'payoutFulfillmentMode === "independent_driver"');
});



Deno.test("Admin maps integration exposes the active geocoder and road router independently", async () => {
  const adminLocation = await read("apps/admin/src/features/platform/PlatformLocationIntegrationScreen.tsx");
  assertIncludes(adminLocation, "activeGeocoderKey");
  assertIncludes(adminLocation, "activeRouterKey");
  assertIncludes(adminLocation, 'label="Active geocoder"');
  assertIncludes(adminLocation, 'label="Active road router"');
  assertIncludes(adminLocation, "/admin/maps/location/status");
});

