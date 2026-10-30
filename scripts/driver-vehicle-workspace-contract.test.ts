const root = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

Deno.test("independent driver vehicle workspace retries every read independently", async () => {
  const screen = await read("apps/lpg-mobile/src/native/ui/VehicleWorkflowScreen.tsx");
  assertIncludes(screen, "const retryWorkspace = async () =>");
  for (const query of [
    "vehicles.refetch()",
    "compliance.refetch()",
    "myVehicle.refetch()",
    "vehicleTypes.refetch()",
    "applicationTypes.refetch()",
    "applications.refetch()",
    "requirements.refetch()",
    "documents.refetch()",
    "drivers.refetch()",
  ]) {
    assertIncludes(screen, query);
  }
  assertIncludes(screen, "Some vehicle information is temporarily unavailable");
  assertNotIncludes(screen, "Vehicles could not be loaded");
  assertIncludes(screen, "vehicles.error ? (");
  assertIncludes(screen, "myVehicle.error ? (");
});

Deno.test("independent driver vehicle applications use backend ownership values", async () => {
  const screen = await read("apps/lpg-mobile/src/native/ui/VehicleWorkflowScreen.tsx");
  assertIncludes(screen, 'useState("driver_owned")');
  assertIncludes(screen, 'savedOwnership === "owned" ? "driver_owned" : savedOwnership');
  assertIncludes(screen, '["driver_owned", "leased", "rented"]');
  assertIncludes(screen, "ownershipType: ownership");
  assertIncludes(screen, "driverProfileId: driverId");
  assertIncludes(screen, 'applicationTypeKey: firstString(applicationType, ["key"])');
  assertIncludes(screen, "await create.mutateAsync");
  assertIncludes(screen, "await update.mutateAsync");
  assertIncludes(screen, "await submit.mutateAsync");
});

Deno.test("vehicle approval automatically links an applicant's approved driver", async () => {
  const activation = await read(
    "supabase/migrations/20260822120000_fleet_production_governance.sql",
  );
  assertIncludes(activation, "create or replace function public.sync_driver_vehicle_link_from_approved_vehicle()");
  assertIncludes(activation, "driver.user_id = application_record.applicant_user_id");
  assertIncludes(activation, "driver.verification_status = 'approved'");
  assertIncludes(activation, "insert into public.driver_vehicle_links");
  assertIncludes(activation, "'active'");
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
