const root = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

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
  assertNotIncludes(support, 'if (workspace === "customer")');
});

function assertIncludes(value: string, expected: string) {
  if (!value.includes(expected)) throw new Error(`Expected source to include: ${expected}`);
}

function assertNotIncludes(value: string, expected: string) {
  if (value.includes(expected)) throw new Error(`Expected source not to include: ${expected}`);
}
