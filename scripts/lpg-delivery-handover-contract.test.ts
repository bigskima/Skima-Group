const repositoryRoot = new URL("../", import.meta.url);

Deno.test("customer delivery verification is visible to the assigned driver before final cylinder scan", async () => {
  const migration = await readRepositoryFile("supabase/migrations/20261031100000_lpg_delivery_challenge_driver_read_model.sql");
  const screen = await readRepositoryFile("apps/lpg-mobile/src/native/ui/JobDetailScreen.tsx");
  const errors = await readRepositoryFile("apps/lpg-mobile/src/native/utilities/friendlyError.ts");
  const walletMigration = await readRepositoryFile("supabase/migrations/20261031100500_lpg_driver_self_wallet_payout_authorization.sql");

  assertIncludes(migration, "public.lpg_delivery_challenge_is_verified(target_order.id, target_order.delivery_challenge_id)");
  assertIncludes(screen, "order?.deliveryChallengeVerified === true");
  assertIncludes(screen, "Customer delivery verification is complete. Scan the same SKIMA cylinder now");
  assertIncludes(screen, "driverStageDescription(status, deliveryChallengeVerified)");
  assertIncludes(errors, "verified lpg delivery challenge is required");
  assertIncludes(errors, "complete the in-app verification, then scan the same cylinder again");
  assertIncludes(walletMigration, "can_create_driver_wallet");
  assertIncludes(walletMigration, "driver.user_id = auth.uid()");
  assertIncludes(walletMigration, "driver.verification_status = 'approved'");
  assertIncludes(walletMigration, "and not can_create_driver_wallet then");
  assertNotIncludes(walletMigration, "grant execute on function public.ensure_wallet_account");
});

Deno.test("web operational map uses the Admin-safe OpenStreetMap fallback and supports drag panning", async () => {
  const rendererHook = await readRepositoryFile("apps/lpg-mobile/src/native/domains/maps/useMapsRendererConfiguration.ts");
  const webMap = await readRepositoryFile("apps/lpg-mobile/src/native/maps/OperationalMap.web.tsx");
  const mapRuntimeTest = await readRepositoryFile("scripts/locationiq-maps-runtime.test.ts");

  assertIncludes(rendererHook, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  assertIncludes(webMap, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  assertIncludes(webMap, "PanResponder.create");
  assertIncludes(webMap, "onPanResponderMove");
  assertIncludes(webMap, "setTilesUnavailable(true)");
  assertNotIncludes(webMap, "basemaps.cartocdn.com");
  assertIncludes(mapRuntimeTest, "PanResponder.create");
});

async function readRepositoryFile(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path.replaceAll("\\", "/"), repositoryRoot));
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
