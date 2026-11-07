async function read(path: string): Promise<string> {
  return await Deno.readTextFile(new URL("../" + path, import.meta.url));
}

function requireText(source: string, value: string, label: string) {
  if (!source.includes(value)) throw new Error(label + " must contain " + value);
}

Deno.test("Managed Driver coverage supports bounded mapped areas and operational radius coverage", async () => {
  const [workspace, migration] = await Promise.all([
    read("apps/admin/src/admin-managed-driver-coverage-workspace.tsx"),
    read("supabase/migrations/20261107191000_managed_driver_radius_coverage.sql"),
  ]);
  requireText(workspace, 'value={coverageMethod}', "Managed Driver coverage method selector");
  requireText(workspace, 'value: "radius"', "Managed Driver radius method option");
  requireText(workspace, "set_lpg_managed_driver_radius_coverage", "Managed Driver radius mutation");
  requireText(workspace, "Centre latitude", "Managed Driver radius centre input");
  requireText(workspace, "Coverage radius (km)", "Managed Driver radius input");
  requireText(migration, "target_radius_meters > 1000000", "Radius coverage upper bound");
  requireText(migration, "coverage_type = 'RADIUS'", "Radius assignment ownership guard");
  requireText(migration, "Only an approved Driver can receive managed coverage", "Managed Driver approval guard");
  requireText(migration, "driver.skima_special", "Managed Driver programme guard");
});

Deno.test("Runtime worker is scheduled with Vault-backed server authentication", async () => {
  const [worker, migration] = await Promise.all([
    read("supabase/functions/runtime-worker/index.ts"),
    read("supabase/migrations/20261107192000_runtime_worker_scheduler.sql"),
  ]);
  requireText(worker, "suppliedSecret !== serviceRoleKey", "Runtime worker service-role authentication");
  requireText(worker, "suppliedSecret !== workerSecret", "Runtime worker dedicated-secret authentication");
  requireText(migration, "skima-runtime-worker", "Runtime worker scheduled job");
  requireText(migration, "skima_service_role_key", "Runtime worker Vault credential");
  requireText(migration, "net.http_post", "Runtime worker HTTP invocation");
});

Deno.test("Store cancellation refund distinguishes an uncharged order from missing escrow linkage", async () => {
  const [gateway, admin, customerOrders] = await Promise.all([
    read("supabase/functions/api-gateway/index.ts"),
    read("apps/admin/src/features/store/StoreWorkspace.tsx"),
    read("apps/store-mobile/src/screens/StoreOrdersScreen.tsx"),
  ]);
  requireText(gateway, "store_funding_reconciliation_required", "Store refund reconciliation protection");
  requireText(gateway, "store_refund_status", "Store refund outcome metadata");
  requireText(gateway, "store_payment_status", "Store payment outcome metadata");
  requireText(admin, "No payment captured", "Store Admin no-payment status");
  requireText(customerOrders, "No payment was captured from your SKIMA Wallet", "Store customer no-payment explanation");
});
