import {
  applicationRequirementApplies,
  applicationRequirementIsRequired,
} from "../apps/lpg-mobile/src/native/api/documentRequirements.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

Deno.test("vehicle document submission returns to the driver workspace route", async () => {
  const screen = await read("apps/lpg-mobile/src/native/ui/DocumentWorkflowScreen.tsx");
  assertIncludes(screen, 'workspace === "vehicle"');
  assertIncludes(screen, '"/(driver)/vehicles"');
  assertIncludes(screen, "router.replace(postSubmissionRoute as never)");
  assertNotIncludes(screen, 'router.replace(`/(customer)/${workspace}-application` as never)');
});

Deno.test("vehicle evidence requirements match the applicant's ownership type", () => {
  const ownershipAuthorization = {
    is_required: true,
    metadata: {
      required_when: {
        path: "vehicle.ownershipType",
        operator: "not_equals",
        value: "driver_owned",
      },
    },
  };

  const driverOwned = { vehicle: { ownershipType: "driver_owned" } };
  const leased = { vehicle: { ownershipType: "leased" } };
  const rented = { vehicle: { ownershipType: "rented" } };
  const fleetAssigned = { vehicle: { ownershipType: "fleet_assigned" } };

  if (applicationRequirementIsRequired(ownershipAuthorization, driverOwned)) {
    throw new Error("Driver-owned vehicles should not require a separate authorization upload.");
  }
  for (const payload of [leased, rented, fleetAssigned]) {
    if (!applicationRequirementIsRequired(ownershipAuthorization, payload)) {
      throw new Error("Non-driver-owned vehicles must provide ownership/use authorization.");
    }
  }
  if (!applicationRequirementApplies(ownershipAuthorization, leased)) {
    throw new Error("The conditional authorization requirement should apply to leased vehicles.");
  }
});

Deno.test("routine independent-driver evidence is reduced to four required uploads", async () => {
  const migration = await read(
    "supabase/migrations/20261030211531_simplify_independent_driver_vehicle_evidence_requirements.sql",
  );
  const helper = await read("apps/lpg-mobile/src/native/api/documentRequirements.ts");
  const workflow = await read("apps/lpg-mobile/src/native/ui/DocumentWorkflowScreen.tsx");
  const vehicleScreen = await read("apps/lpg-mobile/src/native/ui/VehicleWorkflowScreen.tsx");

  assertIncludes(migration, "when 'vehicle.inspection' then false");
  assertIncludes(migration, "when 'vehicle.lpg-transport' then false");
  assertIncludes(migration, "'operator', 'not_equals'");
  assertIncludes(migration, "'value', 'driver_owned'");
  assertIncludes(migration, "when 'vehicle.photo' then 1");
  assertIncludes(migration, "when 'vehicle.ownership-authorization' then 1");

  for (const key of [
    "vehicle.registration",
    "vehicle.insurance",
    "vehicle.roadworthiness",
    "vehicle.photo",
  ]) {
    assertIncludes(migration, key);
  }

  assertIncludes(helper, "applicationRequirementApplies");
  assertIncludes(helper, "applicationRequirementIsRequired");
  assertIncludes(workflow, "applicationRequirementIsRequired(requirement, applicationPayload)");
  assertIncludes(vehicleScreen, "applicationRequirementIsRequired(item, currentApplicationPayload)");
});

Deno.test("conditional vehicle evidence is enforced consistently in the app and database", async () => {
  const database = await read(
    "supabase/migrations/20261030211531_simplify_independent_driver_vehicle_evidence_requirements.sql",
  );
  const submitFunction = await read(
    "supabase/migrations/20260907070000_automatic_partner_verification_engine.sql",
  );
  assertIncludes(database, "required_when");
  assertIncludes(database, "vehicle.ownershipType");
  assertIncludes(submitFunction, "public.application_requirement_applies(requirement.metadata, application_payload)");
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
