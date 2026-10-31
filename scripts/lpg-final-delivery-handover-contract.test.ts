const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path: string): Promise<string> {
  return Deno.readTextFile(new URL(path, repositoryRoot));
}

function assertIncludes(value: string, expected: string): void {
  if (!value.includes(expected)) {
    throw new Error(`Expected source to include: ${expected}`);
  }
}

Deno.test("final LPG handover requires the driver cylinder scan after customer verification", async () => {
  const [jobDetail, gateway, scanMigration, payoutMigration, walletMigration, deliveryReadModelMigration] = await Promise.all([
    readRepositoryFile("apps/lpg-mobile/src/native/ui/JobDetailScreen.tsx"),
    readRepositoryFile("supabase/functions/api-gateway/index.ts"),
    readRepositoryFile("supabase/migrations/20260801040000_lpg_integrated_lifecycle_runtime.sql"),
    readRepositoryFile("supabase/migrations/20260916165126_lpg_internal_dispatch_and_settlement_runtime.sql"),
    readRepositoryFile("supabase/migrations/20261031095000_lpg_driver_self_wallet_provisioning.sql"),
    readRepositoryFile("supabase/migrations/20261031110000_lpg_job_delivery_verification_read_model.sql"),
  ]);

  const driverScanRules = jobDetail.slice(
    jobDetail.indexOf("function driverScanTypeForStatus"),
    jobDetail.indexOf("function stationScanTypeForStatus"),
  );
  assertIncludes(driverScanRules, '"delivery_verification_pending"');
  assertIncludes(driverScanRules, 'return "customer_delivery"');
  assertIncludes(jobDetail, "canDriverScan && driverScanType ?");
  assertIncludes(jobDetail, "await scan.mutateAsync({");
  assertIncludes(jobDetail, 'scanType: driverScanType');
  assertIncludes(jobDetail, "order?.deliveryChallengeVerified === true");
  assertIncludes(jobDetail, "Customer verification is complete. Scan the cylinder now");
  assertIncludes(deliveryReadModelMigration, "'deliveryChallengeVerified'");
  assertIncludes(deliveryReadModelMigration, "public.lpg_delivery_challenge_is_verified(");

  // The mobile gateway must route the physical scan through the verified,
  // order-scoped database RPC rather than setting order status from the UI.
  assertIncludes(gateway, 'if (routePath === "/lpg/scans" && request.method === "POST")');
  assertIncludes(gateway, 'supabase.rpc("record_lpg_cylinder_scan"');
  assertIncludes(scanMigration, "public.lpg_delivery_challenge_is_verified(order_record.id, delivery_challenge_id)");
  assertIncludes(scanMigration, "new_status := 'delivered'");
  assertIncludes(scanMigration, "verified LPG delivery challenge is required");

  // The delivered event is the only event that invokes the normal independent
  // driver payout path; Station Managed drivers are separately paid by station.
  assertIncludes(payoutMigration, "new.to_status<>'delivered'");
  assertIncludes(payoutMigration, "public.execute_lpg_driver_commission(");
  assertIncludes(payoutMigration, "lpg.driver_payout.auto_delivery");

  // A verified driver can create only their own driver wallet. The generic
  // platform wallet permission gate must remain active for every other owner.
  assertIncludes(walletMigration, "target_wallet_type = 'driver'");
  assertIncludes(walletMigration, "target_owner_entity_type = 'driver'");
  assertIncludes(walletMigration, "driver.user_id = auth.uid()");
  assertIncludes(walletMigration, "driver.verification_status = 'approved'");
  assertIncludes(walletMigration, "not public.has_permission('platform.wallets.manage', null)");
});
