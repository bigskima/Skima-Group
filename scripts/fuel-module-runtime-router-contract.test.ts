const gateway = await Deno.readTextFile("supabase/functions/api-gateway/index.ts");
const moduleRuntime = await Deno.readTextFile("supabase/functions/fuel-runtime/index.ts");
const migration = await Deno.readTextFile(
  "supabase/migrations/20261102010000_fuel_module_runtime_router_and_security.sql",
);

function requireIncludes(source: string, fragment: string, message: string): void {
  if (!source.includes(fragment)) throw new Error(`${message}: missing "${fragment}"`);
}
function requireNotIncludes(source: string, fragment: string, message: string): void {
  if (source.includes(fragment)) throw new Error(`${message}: unexpected "${fragment}"`);
}

Deno.test("shared gateway dispatches active module routes without business-specific branches", () => {
  requireIncludes(gateway, "dispatchBusinessModuleRuntimeRoute(", "generic module dispatcher is installed");
  requireIncludes(gateway, 'supabase.rpc("resolve_business_module_runtime_route"', "route lookup is database driven");
  requireIncludes(gateway, 'new URL(`/functions/v1/${edgeFunction}`, supabaseUrl)', "handler destination is selected from the route registry");
  requireIncludes(gateway, 'supabase.rpc("list_active_business_module_runtime_routes")', "runtime catalog includes configured modules");
  requireNotIncludes(gateway, "/runtime/fuel/", "the platform gateway must not define Fuel routes");
  requireNotIncludes(gateway, "resolveFuelOrderBranchAccess", "Fuel authorization helpers must live with the Fuel module");
});

Deno.test("Fuel handler owns Fuel route logic and reuses authenticated platform services", () => {
  requireIncludes(moduleRuntime, 'routePath === "/runtime/fuel/products"', "Fuel product registry route is implemented");
  requireIncludes(moduleRuntime, "resolveFuelOrderBranchAccess", "Fuel route permissions are checked at the module boundary");
  requireIncludes(moduleRuntime, "resolveFuelAssignedDriver", "driver identity resolution remains with the module workflow");
  requireIncludes(moduleRuntime, "requireAuthenticatedUser(request, id)", "module endpoint validates the user JWT");
  requireIncludes(moduleRuntime, 'target_policy_key: "api.gateway.authenticated.default"', "module endpoint applies the authenticated request rate limit");
  requireIncludes(moduleRuntime, "SUPABASE_SERVICE_ROLE_KEY", "trusted mutations use the server-side service credential");
  requireNotIncludes(moduleRuntime, "x-skima-runtime-path ??", "module route path cannot be inferred from an untrusted fallback");
});

Deno.test("module runtime registration is active-module scoped and validates handler slugs", () => {
  requireIncludes(migration, "'/runtime/fuel'", "Fuel route prefix is registered in module metadata");
  requireIncludes(migration, "'fuel-runtime'", "Fuel handler name is registered in module metadata");
  requireIncludes(migration, "module_record.status = 'active'", "inactive modules cannot receive runtime dispatch");
  requireIncludes(migration, "^[a-z][a-z0-9-]{1,62}$", "registered handler names are constrained");
  requireIncludes(migration, "resolve_business_module_runtime_route", "generic route resolver is deployed");
  requireIncludes(migration, "list_active_business_module_runtime_routes", "generic runtime catalog resolver is deployed");
});

Deno.test("trigger-only Fuel functions are no longer exposed as client-callable RPCs", () => {
  for (const signature of [
    "public.initialize_fuel_order_operation()",
    "public.validate_fuel_container_allocation()",
    "public.validate_fuel_container_asset()",
    "public.validate_fuel_station_storage_scope()",
    "public.prevent_fuel_event_mutation()",
  ]) {
    requireIncludes(
      migration,
      `revoke all on function ${signature} from public, anon, authenticated`,
      `${signature} must not be callable through PostgREST`,
    );
  }
  requireIncludes(migration, "alter function public.prevent_fuel_event_mutation() set search_path = public", "trigger search_path is fixed");
  requireIncludes(migration, "revoke all on function public.can_manage_fuel_platform() from public, anon", "platform permission boolean is not anonymously exposed");
});
