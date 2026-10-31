const root = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

Deno.test("vehicle application location supplement only appends version-bound evidence", async () => {
  const migration = await read(
    "supabase/migrations/20261030221000_lpg_vehicle_application_location_evidence.sql",
  );
  assertIncludes(migration, "create or replace function public.update_lpg_vehicle_application_location(");
  assertIncludes(migration, "application_type_record.application_category <> 'vehicle'");
  assertIncludes(migration, "application_record.applicant_user_id <> auth.uid()");
  assertIncludes(migration, "application_record.status not in (");
  assertIncludes(migration, "'submitted',");
  assertIncludes(migration, "'under_review'");
  assertIncludes(migration, "current_version.payload");
  assertIncludes(migration, "'{location}'");
  assertIncludes(migration, "public.sync_application_geography_for_version(next_version_id)");
  assertIncludes(migration, "set active_version = next_version");
  assertNotIncludes(migration, "locked_at = null");
  assertIncludes(migration, "grant execute on function public.update_lpg_vehicle_application_location");
  assertNotIncludes(migration, "target_payload jsonb");
  assertNotIncludes(migration, "update public.vehicles");
});

Deno.test("canonical location evidence casts accuracy and service key to the policy signature", async () => {
  const migration = await read(
    "supabase/migrations/20261031051436_fix_canonical_location_quality_argument_types.sql",
  );
  assertIncludes(migration, "new.accuracy_meters::numeric");
  assertIncludes(migration, "null::text");
  assertIncludes(migration, "public.evaluate_location_quality(");
  assertIncludes(migration, "add column if not exists change_summary text");
});

Deno.test("vehicle approval requires verified location but inherits driver coverage", async () => {
  const migration = await read(
    "supabase/migrations/20261030221000_lpg_vehicle_application_location_evidence.sql",
  );
  assertIncludes(migration, "verification.location_purpose = location_purpose_key");
  assertIncludes(migration, "verification.status = 'verified'");
  assertIncludes(migration, "Verify the vehicle operating location in Admin Location Review before approving this application.");
  assertIncludes(migration, "if workspace_key = 'driver'");
  assertIncludes(migration, "and application_type_record.application_category = 'driver' then");
  assertIncludes(migration, "Choose at least one driver service geography before approving this application.");
});

Deno.test("vehicle location supplement is routed through the authenticated API gateway", async () => {
  const gateway = await read("supabase/functions/api-gateway/index.ts");
  assertIncludes(gateway, '"/runtime/applications/location"');
  assertIncludes(gateway, 'routePath === "/runtime/applications/location" && request.method === "POST"');
  assertIncludes(gateway, 'supabase.rpc("update_lpg_vehicle_application_location"');
  assertIncludes(gateway, 'target_location: requireRecord(payload.location, "location")');
  assertIncludes(gateway, 'target_application_id: requireUuid(payload.applicationId, "applicationId")');
});

Deno.test("independent driver can detect and submit location from the existing vehicle workspace", async () => {
  const screen = await read("apps/lpg-mobile/src/native/ui/VehicleWorkflowScreen.tsx");
  assertIncludes(screen, "readOperationalLocation");
  assertIncludes(screen, "useMapsGatewayAdapter");
  assertIncludes(screen, "const detectOperatingLocation = async () =>");
  assertIncludes(screen, "const saveOperatingLocation = async () =>");
  assertIncludes(screen, 'path: "/runtime/applications/location"');
  assertIncludes(screen, "Operating location for vehicle approval");
  assertIncludes(screen, "Submit operating location for review");
  assertIncludes(screen, "vehicleRequirementsConfigured");
  assertIncludes(screen, "operatingLocation");
  assertIncludes(screen, "values: { typeKey, manufacturer, model, year, registration, colour, ownership, capacity, operatingLocation }");
  assertIncludes(screen, 'setOperatingLocation(operationalLocationFromRecord(draft.values.operatingLocation)');
  assertIncludes(screen, "Location submitted. SKIMA must verify it in Admin Location Review");
});

Deno.test("Admin location review identifies vehicle applications separately", async () => {
  const admin = await read("apps/admin/src/admin-partner-location-review-workspace.tsx");
  assertIncludes(admin, 'record.application_type_key.includes(".vehicle.")');
  assertIncludes(admin, '"Vehicle application"');
  assertIncludes(admin, "driver, vehicle or station application");
});

function assertIncludes(value: string, expected: string) {
  if (!value.includes(expected)) {
    throw new Error(`Expected source to include: ${expected}`);
  }
}

function assertNotIncludes(value: string, unexpected: string) {
  if (value.includes(unexpected)) {
    throw new Error(`Expected source not to include: ${unexpected}`);
  }
}
