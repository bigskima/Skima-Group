import {
  createLocationIqMapsAdapter,
  LocationProviderError,
} from "../supabase/functions/_shared/locationiq-maps-adapter.ts";

const repositoryRoot = new URL("../", import.meta.url);
const testSecret = "test-locationiq-token-not-for-production";

Deno.test("LocationIQ autocomplete is normalized and never returns the access token", async () => {
  const request: { url?: URL } = {};
  const adapter = testAdapter((input) => {
    request.url = requestUrl(input);
    return Promise.resolve(jsonResponse([{
      address: {
        city: "Awka",
        country: "Nigeria",
        country_code: "ng",
        county: "Awka South",
        neighbourhood: "Ifite",
        road: "Zik Avenue",
        state: "Anambra State",
      },
      display_address: "Awka South, Anambra State, Nigeria",
      display_name: "Zik Avenue, Ifite, Awka, Anambra State, Nigeria",
      display_place: "Zik Avenue",
      lat: "6.2100",
      lon: "7.0700",
      osm_id: "1234",
      osm_type: "way",
      place_id: "5678",
    }]));
  });

  const result = await adapter.autocomplete("Zik Avenue");
  assertEquals(request.url?.hostname, "api.locationiq.com");
  assertEquals(request.url?.searchParams.get("countrycodes"), "ng");
  assertEquals(request.url?.searchParams.get("normalizecity"), "1");
  assertEquals(result.data.provider, "locationiq");
  assertEquals(result.data.predictions.length, 1);
  const prediction = result.data.predictions[0];
  assertEquals(prediction.location, { latitude: 6.21, longitude: 7.07 });
  assertNotIncludes(JSON.stringify(result.data), testSecret);
});

Deno.test("LocationIQ reverse geocoding preserves structured Nigerian geography", async () => {
  const adapter = testAdapter(() =>
    Promise.resolve(jsonResponse({
      address: {
        city: "Awka",
        country: "Nigeria",
        country_code: "ng",
        county: "Awka South",
        house_number: "10",
        neighbourhood: "Ifite",
        road: "Zik Avenue",
        state: "Anambra State",
        state_code: "AN",
        town: "Amawbia",
      },
      display_name: "10 Zik Avenue, Ifite, Awka, Anambra State, Nigeria",
      lat: "6.2100",
      lon: "7.0700",
      place_id: "5678",
      type: "house",
    }))
  );

  const result = await adapter.reverseGeocode({ latitude: 6.21, longitude: 7.07 });
  assertEquals(result.data.addressComponents.houseNumber, "10");
  assertEquals(result.data.addressComponents.neighbourhood, "Ifite");
  assertEquals(result.data.addressComponents.lga, "Awka South");
  assertEquals(result.data.addressComponents.state, "Anambra State");
  assertEquals(result.data.addressComponents.stateCode, "AN");
  assertEquals(result.data.addressComponents.town, "Amawbia");
  assertEquals(result.data.placeId, "locationiq:5678");
});

Deno.test("LocationIQ routing sends longitude before latitude and returns GeoJSON", async () => {
  const request: { url?: URL } = {};
  const adapter = testAdapter((input) => {
    request.url = requestUrl(input);
    return Promise.resolve(jsonResponse({
      code: "Ok",
      routes: [{
        distance: 1250.4,
        duration: 185.6,
        geometry: {
          coordinates: [[7.07, 6.21], [7.09, 6.22]],
          type: "LineString",
        },
        legs: [{ summary: "Zik Avenue" }],
      }],
    }));
  });

  const result = await adapter.routeEstimate(
    { latitude: 6.21, longitude: 7.07 },
    { latitude: 6.22, longitude: 7.09 },
  );
  assertIncludes(request.url?.pathname ?? "", "/7.07,6.21;7.09,6.22");
  assertEquals(request.url?.searchParams.get("geometries"), "geojson");
  assertEquals(result.data.distanceMeters, 1250);
  assertEquals(result.data.duration, "186s");
  assertEquals(result.data.routeGeometry?.type, "LineString");
});

Deno.test("LocationIQ adapter rejects invalid coordinates without spending provider quota", async () => {
  let calls = 0;
  const adapter = testAdapter(() => {
    calls += 1;
    return Promise.resolve(jsonResponse({}));
  });

  const error = await captureError(() =>
    adapter.reverseGeocode({ latitude: 190, longitude: 7.07 })
  );
  assert(
    error instanceof LocationProviderError,
    "invalid coordinates must use the safe provider error",
  );
  assertEquals((error as LocationProviderError).code, "invalid_request");
  assertEquals(calls, 0);
});

Deno.test("LocationIQ authentication failures are normalized without leaking provider details", async () => {
  const adapter = testAdapter(
    () => Promise.resolve(jsonResponse({ error: `Invalid key ${testSecret}` }, 401)),
  );
  const error = await captureError(() => adapter.geocode("Awka"));
  assert(error instanceof LocationProviderError, "authentication failures must be normalized");
  assertEquals((error as LocationProviderError).code, "provider_authentication_failed");
  assertNotIncludes((error as Error).message, testSecret);
});

Deno.test("LocationIQ not-found, quota, and invalid responses use stable SKIMA errors", async () => {
  const cases = [
    { status: 404, body: { error: "Unable to geocode" }, code: "not_found" },
    { status: 429, body: { error: "Rate Limited" }, code: "provider_rate_limited" },
  ] as const;
  for (const item of cases) {
    const adapter = testAdapter(() => Promise.resolve(jsonResponse(item.body, item.status)));
    const error = await captureError(() => adapter.geocode("Awka"));
    assert(error instanceof LocationProviderError, `${item.status} must be normalized`);
    assertEquals((error as LocationProviderError).code, item.code);
  }

  const invalid = testAdapter(() => Promise.resolve(new Response("not-json", { status: 200 })));
  const invalidError = await captureError(() => invalid.geocode("Awka"));
  assert(invalidError instanceof LocationProviderError, "invalid JSON must be normalized");
  assertEquals((invalidError as LocationProviderError).code, "provider_response_invalid");
});

Deno.test("LocationIQ requests time out without blocking app fallback", async () => {
  const adapter = testAdapter((_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    })
  );
  const error = await captureError(() => adapter.geocode("Awka"));
  assert(error instanceof LocationProviderError, "timeouts must use the safe provider error");
  assertEquals((error as LocationProviderError).code, "provider_timeout");
});

Deno.test("LocationIQ retries a temporary provider failure within the configured bound", async () => {
  let calls = 0;
  const adapter = testAdapter(() => {
    calls += 1;
    if (calls === 1) return Promise.resolve(jsonResponse({ error: "temporary" }, 503));
    return Promise.resolve(jsonResponse([{
      address: { city: "Awka", country: "Nigeria", country_code: "ng" },
      display_name: "Awka, Nigeria",
      lat: "6.21",
      lon: "7.07",
      place_id: "retry-success",
    }]));
  }, 1);

  const result = await adapter.geocode("Awka");
  assertEquals(calls, 2);
  assertEquals(result.data.location, { latitude: 6.21, longitude: 7.07 });
});

Deno.test("LocationIQ runtime stays provider-neutral, governed, and Admin synchronized", async () => {
  const [
    migration,
    moduleMigration,
    gateway,
    adminConfig,
    adminReview,
    mobileGateway,
    driverTracking,
    geographyRepair,
    geographyCutover,
    adminCoverage,
    adminGeometry,
    customerLocationSave,
    partnerApplication,
    driverApplication,
    driverWorkspaceApplication,
    partnerGeographyReconciliation,
    stationCoverageLifecycle,
    driverCoverageProfile,
    partnerReviewReadModel,
    partnerOnboardingCutover,
    candidateCoverageRuntime,
  ] =
    await Promise.all([
      readRepositoryFile("supabase/migrations/20260901204813_locationiq_maps_provider_runtime.sql"),
      readRepositoryFile(
        "supabase/migrations/20260904162247_lpg_locationiq_maps_runtime_sync.sql",
      ),
      readRepositoryFile("supabase/functions/api-gateway/index.ts"),
      readRepositoryFile("apps/admin/src/admin-resource-config.ts"),
      readRepositoryFile("apps/admin/src/admin-partner-location-review-workspace.tsx"),
      readRepositoryFile("apps/lpg-mobile/src/native/domains/maps/gateway.ts"),
      readRepositoryFile("apps/lpg-mobile/src/native/device/driverTracking.ts"),
      readRepositoryFile(
        "supabase/migrations/20260905011955_repair_geography_admin_setup_and_map_renderer.sql",
      ),
      readRepositoryFile(
        "supabase/migrations/20260905013500_complete_geography_cutover_review_workflow.sql",
      ),
      readRepositoryFile("apps/admin/src/admin-service-coverage-workspace.tsx"),
      readRepositoryFile("apps/admin/src/admin-geometry-editor.tsx"),
      readRepositoryFile("apps/lpg-mobile/src/native/ui/locationSave.ts"),
      readRepositoryFile("apps/lpg-mobile/src/native/ui/ApplicationOverviewScreen.tsx"),
      readRepositoryFile("apps/lpg-mobile/src/native/ui/DriverApplicationEntryScreen.tsx"),
      readRepositoryFile("apps/lpg-mobile/src/native/ui/DriverApplicationScreen.tsx"),
      readRepositoryFile(
        "supabase/migrations/20260905014400_universal_partner_application_geography_reconciliation.sql",
      ),
      readRepositoryFile(
        "supabase/migrations/20260905014900_station_universal_coverage_lifecycle_sync.sql",
      ),
      readRepositoryFile(
        "supabase/migrations/20260905015200_driver_universal_coverage_profile_reconciliation.sql",
      ),
      readRepositoryFile(
        "supabase/migrations/20260905015500_partner_location_review_universal_coverage_read_model.sql",
      ),
      readRepositoryFile(
        "supabase/migrations/20260905015800_partner_onboarding_policy_cutover.sql",
      ),
      readRepositoryFile(
        "supabase/migrations/20260905020200_universal_partner_candidate_coverage_runtime.sql",
      ),
    ]);

  for (const route of ["autocomplete", "geocode", "reverse-geocode", "route-estimate"]) {
    assertIncludes(gateway, `/lpg/maps/${route}`);
  }
  assertIncludes(gateway, 'Deno.env.get("LOCATIONIQ_ACCESS_TOKEN")');
  assertNotIncludes(mobileGateway, "LOCATIONIQ_ACCESS_TOKEN");
  assertNotIncludes(driverTracking, "reverse-geocode");
  assertNotIncludes(driverTracking, "useMapsGatewayAdapter");

  assertIncludes(migration, "'provider.maps.locationiq'");
  assertIncludes(migration, "'SUPABASE_SECRET:LOCATIONIQ_ACCESS_TOKEN'");
  assertIncludes(migration, "automatic_paid_fallback', false");
  assertIncludes(migration, "where provider_kind = 'maps';");
  assertIncludes(migration, "create or replace function public.configure_maps_provider(");
  assertIncludes(migration, "create or replace function public.read_maps_location_status()");
  assertNotIncludes(migration, "lpg_operation_policies");
  assertIncludes(
    moduleMigration,
    "create or replace function public.read_partner_application_location_reviews_v2()",
  );
  assertIncludes(moduleMigration, "create trigger configuration_entries_sync_lpg_maps_provider");
  assertIncludes(moduleMigration, "create or replace function public.sync_lpg_maps_provider_selection()");
  assertNotIncludes(migration.toLowerCase(), "drop table");
  assertNotIncludes(migration.toLowerCase(), " cascade");
  assertNotIncludes(moduleMigration.toLowerCase(), "drop table");
  assertNotIncludes(moduleMigration.toLowerCase(), " cascade");

  assertIncludes(adminConfig, 'label: "Maps & Location"');
  assertIncludes(adminConfig, '"Change active location provider"');
  assertIncludes(adminReview, 'supabase.rpc("read_partner_application_location_reviews_v2")');
  assertIncludes(adminReview, '{ label: "State"');
  assertIncludes(adminReview, '{ label: "LGA"');
  assertIncludes(adminReview, '{ label: "Service zone"');

  // Geography setup must be driven by the repaired backend contract rather
  // than several RLS-sensitive direct table reads.
  assertIncludes(geographyRepair, "create or replace function public.read_geography_admin_setup()");
  assertIncludes(geographyRepair, "create or replace function public.read_maps_renderer_configuration()");
  assertIncludes(adminCoverage, 'supabase.rpc("read_geography_admin_setup")');
  assertNotIncludes(adminCoverage, 'supabase.from("geography_levels")');
  assertIncludes(adminCoverage, 'supabase.rpc("import_legacy_spatial_geographies")');
  assertIncludes(adminCoverage, 'supabase.rpc("link_geography_migration_mapping"');
  assertIncludes(adminCoverage, 'supabase.rpc("verify_geography_migration_mapping"');
  assertIncludes(adminCoverage, 'supabase.rpc("set_universal_geography_authority"');
  assertIncludes(geographyCutover, "create or replace function public.link_geography_migration_mapping(");
  assertIncludes(geographyCutover, "admin_linked_canonical_boundary");
  assertIncludes(geographyCutover, "create or replace function public.verify_geography_migration_mapping(");
  assertIncludes(geographyCutover, "migration_status = 'verified'");
  assertIncludes(geographyCutover, "VERIFIED_BY_ADMIN");
  assertIncludes(
    geographyCutover,
    "create or replace function public.migrate_verified_legacy_lpg_coverage_policies()",
  );

  // Admin rendering must not require an env-only basemap to be usable.
  assertIncludes(adminGeometry, 'supabase.rpc("read_maps_renderer_configuration")');
  assertIncludes(adminGeometry, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  assertNotIncludes(
    adminGeometry,
    "Configure VITE_MAP_TILE_URL_TEMPLATE for the provider basemap",
  );

  // Customer and partner saves must preserve normalized location data and
  // must not erase geography written by another onboarding step.
  assertIncludes(customerLocationSave, "prepareLocationSave");
  assertIncludes(customerLocationSave, "formattedAddress");
  assertIncludes(partnerApplication, "...basePayload");
  assertIncludes(partnerApplication, "location: lastLocation ?? existingLocation ?? null");
  assertIncludes(driverApplication, "...existingService");
  assertIncludes(driverWorkspaceApplication, "...basePayload");
  assertIncludes(driverWorkspaceApplication, "...existingService");
  assertIncludes(adminCoverage, 'supabase.rpc("migrate_verified_operational_coverage")');
  assertIncludes(partnerGeographyReconciliation, "'service.coverageRequests'");
  assertIncludes(partnerGeographyReconciliation, "'service.serviceAreaIds'");
  assertIncludes(partnerGeographyReconciliation, "application_operational_coverage_requests");
  assertIncludes(
    partnerGeographyReconciliation,
    "create or replace function public.enforce_lpg_partner_location_before_approval()",
  );
  assertIncludes(
    partnerGeographyReconciliation,
    "create or replace function public.review_application_coverage_request(",
  );
  assertIncludes(
    partnerGeographyReconciliation,
    "create or replace function public.migrate_verified_operational_coverage()",
  );
  assertIncludes(partnerGeographyReconciliation, "public.is_platform_super_admin()");

  // Approved station coverage must stay universal after the one-time backfill,
  // and driver-facing service zones must come from universal assignments.
  assertIncludes(
    stationCoverageLifecycle,
    "create or replace function public.sync_lpg_station_universal_coverage()",
  );
  assertIncludes(stationCoverageLifecycle, "'station_branch_lifecycle'");
  assertIncludes(stationCoverageLifecycle, "approval_status = 'approved'");
  assertIncludes(
    driverCoverageProfile,
    "create or replace function public.backfill_universal_driver_coverage_requests_from_legacy(",
  );
  assertIncludes(
    driverCoverageProfile,
    "drop trigger if exists application_records_project_driver_service_areas",
  );
  assertIncludes(
    driverCoverageProfile,
    "create or replace function public.refresh_driver_universal_service_profile(",
  );
  assertIncludes(driverCoverageProfile, "'coverageRuntime', 'universal'");

  // Admin review and partner expansion must use the same universal request
  // model, while candidate areas remain separate from customer service launch.
  assertIncludes(partnerReviewReadModel, "application_operational_coverage_requests");
  assertIncludes(partnerReviewReadModel, "universal_coverage.service_areas");
  assertIncludes(partnerOnboardingCutover, "'driver_onboarding'");
  assertIncludes(partnerOnboardingCutover, "'station_onboarding'");
  assertIncludes(partnerOnboardingCutover, "service_areas.partnerSelectable");
  assertIncludes(
    candidateCoverageRuntime,
    "create or replace function public.resolve_lpg_partner_candidate_coverage(",
  );
  assertIncludes(
    candidateCoverageRuntime,
    "'universal_candidate_coverage'",
  );
  assertIncludes(candidateCoverageRuntime, "'UNCONFIGURED_CANDIDATE_AREA'");
  assertIncludes(candidateCoverageRuntime, "'AREA_EXCLUDED'");
  assertIncludes(candidateCoverageRuntime, "'customer_ordering'");
  assertIncludes(driverApplication, "resolve_lpg_partner_candidate_coverage");
  assertIncludes(driverApplication, "Candidate operating area");
  assertIncludes(driverWorkspaceApplication, "resolve_lpg_partner_candidate_coverage");
  assertIncludes(driverWorkspaceApplication, "candidateCoverage");
});

function testAdapter(fetcher: typeof fetch, retryCount = 0) {
  return createLocationIqMapsAdapter({
    accessToken: testSecret,
    attribution: "LocationIQ; OpenStreetMap contributors",
    autocompleteBaseUrl: "https://api.locationiq.com/v1",
    autocompleteResultLimit: 6,
    countryCodes: ["ng"],
    fetcher,
    geocodingBaseUrl: "https://eu1.locationiq.com/v1",
    language: "en",
    retryCount,
    routingBaseUrl: "https://eu1.locationiq.com/v1",
    timeoutMs: 1_000,
  });
}

function requestUrl(input: Request | URL | string): URL {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

async function captureError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
    throw new Error("expected action to fail");
  } catch (error) {
    return error;
  }
}

async function readRepositoryFile(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path.replaceAll("\\", "/"), repositoryRoot));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(source: string, expected: string): void {
  if (!source.includes(expected)) {
    throw new Error(`expected source to contain ${JSON.stringify(expected)}`);
  }
}

function assertNotIncludes(source: string, unexpected: string): void {
  if (source.includes(unexpected)) {
    throw new Error(`source unexpectedly contained ${JSON.stringify(unexpected)}`);
  }
}
