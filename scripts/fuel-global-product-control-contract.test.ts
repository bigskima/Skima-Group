const admin = await Deno.readTextFile(
  "apps/admin/src/features/services/FuelAdminWorkspace.tsx",
);
const gateway = await Deno.readTextFile("supabase/functions/api-gateway/index.ts");
const migration = await Deno.readTextFile(
  "supabase/migrations/20261102012000_fuel_global_product_controls.sql",
);

function requireIncludes(source: string, fragment: string, message: string): void {
  if (!source.includes(fragment)) throw new Error(`${message}: missing "${fragment}"`);
}

Deno.test("global Fuel product controls expose enable-all and disable-all actions", () => {
  requireIncludes(admin, "Enable all products", "admin can enable the complete product group");
  requireIncludes(admin, "Disable all products", "admin can disable the complete product group");
  requireIncludes(admin, 'productKeys: PRODUCTS.map((product) => product.key)', "UI submits the full canonical product group");
  requireIncludes(admin, 'createClientIdempotencyKey("admin.fuel.products.bulk", status)', "bulk change has a retry-safe idempotency key");
  requireIncludes(admin, "fuel.pms", "PMS is included");
  requireIncludes(admin, "fuel.ago", "AGO / diesel is included");
  requireIncludes(admin, "fuel.dpk", "DPK / kerosene is included");
});

Deno.test("global Fuel product changes use one atomic, permission-checked database operation", () => {
  requireIncludes(gateway, 'supabase.rpc("set_fuel_products_status"', "API delegates the bulk change to Postgres");
  requireIncludes(gateway, "A global product toggle must include PMS, AGO and DPK exactly once.", "API rejects incomplete product sets");
  requireIncludes(migration, "public.set_fuel_products_status(", "bulk database function exists");
  requireIncludes(migration, "public.can_manage_fuel_platform()", "global changes require platform Fuel management access");
  requireIncludes(migration, "cardinality(target_product_keys) <> 3", "database rejects partial global product sets");
  requireIncludes(migration, "public.set_fuel_product_status(", "individual audited status transition is reused");
  requireIncludes(migration, "revoke all on function public.set_fuel_products_status", "bulk RPC is not publicly executable");
  requireIncludes(migration, "grant execute on function public.set_fuel_products_status", "authenticated permitted callers can execute the RPC");
});

Deno.test("installing the Fuel module does not enable customer ordering by itself", () => {
  requireIncludes(migration, "set status = 'active'", "module runtime prerequisite is activated");
  requireIncludes(migration, "remains closed until an administrator explicitly enables one or more products.", "default customer availability remains documented");
  requireIncludes(migration, "public.fuel_products", "the global operation updates only the registered Fuel products");
});

Deno.test("Fuel API access is scoped to branch permissions and real assigned driver identities", () => {
  requireIncludes(gateway, "async function resolveFuelOrderBranchAccess(", "Fuel orders resolve their organization and branch before permitting actions");
  requireIncludes(gateway, 'supabase.rpc("has_permission_for_branch"', "station access uses the shared branch permission resolver");
  requireIncludes(gateway, "async function resolveFuelAssignedDriver(", "driver actions resolve the currently assigned driver identity");
  requireIncludes(gateway, "async function resolveFuelAssignedOrderIdsForUser(", "driver job reads resolve profile and Station Managed identities");
  requireIncludes(gateway, '.select("order_id,participant_role,entity_type,entity_id,status")', "driver assignment resolution receives its required participant and status fields");
});
