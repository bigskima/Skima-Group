const migration = await Deno.readTextFile(
  "supabase/migrations/20261102110000_logistics_marketplace_domain_foundation.sql",
);
const runtime = await Deno.readTextFile("supabase/functions/logistics-runtime/index.ts");
const supabaseConfig = await Deno.readTextFile("supabase/config.toml");
const moduleRouter = await Deno.readTextFile("supabase/migrations/20261102005600_fuel_module_runtime_router_and_security.sql");

function requireText(source: string, fragment: string, label: string): void {
  if (!source.includes(fragment)) throw new Error(`${label}: missing required fragment: ${fragment}`);
}
function requireNotText(source: string, fragment: string, label: string): void {
  if (source.includes(fragment)) throw new Error(`${label}: prohibited fragment found: ${fragment}`);
}

const domainTables = [
  "logistics_service_categories",
  "logistics_provider_profiles",
  "logistics_provider_services",
  "logistics_provider_coverage",
  "logistics_job_requests",
  "logistics_job_opportunities",
  "logistics_offers",
  "logistics_negotiation_messages",
  "logistics_job_events",
] as const;

Deno.test("Logistics has a separate module, route namespace and deployment target", () => {
  requireText(migration, "'logistics_network'", "module registry key");
  requireText(migration, "'/runtime/logistics'", "module-owned API prefix");
  requireText(migration, "'logistics-runtime'", "module runtime handler");
  requireText(runtime, '"/runtime/logistics/', "runtime route namespace");
  requireText(supabaseConfig, "[functions.logistics-runtime]", "separate Edge Function config");
  requireText(supabaseConfig, "[functions.logistics-runtime]\nverify_jwt = true", "JWT verification");
  requireText(moduleRouter, "resolve_business_module_runtime_route", "existing module router is reused");
});

Deno.test("Every Logistics domain table enables RLS and denies direct authenticated writes", () => {
  for (const table of domainTables) {
    requireText(migration, `alter table public.${table} enable row level security`, `${table} RLS`);
    requireText(migration, `on public.${table} for insert to authenticated with check (false)`, `${table} direct insert denial`);
    requireText(migration, `on public.${table} for update to authenticated using (false) with check (false)`, `${table} direct update denial`);
    requireText(migration, `on public.${table} for delete to authenticated using (false)`, `${table} direct delete denial`);
  }
});

Deno.test("Provider opportunities reveal full contact details only to the matched provider tenant", () => {
  requireText(migration, "customer_contact_snapshot jsonb", "matched opportunity contact snapshot");
  requireText(migration, "public.can_read_logistics_company(organization_id)", "provider opportunity tenant read policy");
  requireText(migration, "logistics_opportunities_read_matched_company", "company-scoped opportunity policy");
  requireText(migration, "requester_user_id = auth.uid()", "customer-only source job read");
  requireText(migration, "create policy logistics_jobs_read_customer_or_admin", "private customer job policy");
  requireText(migration, "jsonb_strip_nulls(jsonb_build_object(", "contact snapshot field allow-list");
  requireText(migration, "'contact_instructions'", "customer contact instructions preserved for matched provider");
});

Deno.test("Company registration provisions an organisation-scoped owner, never a platform role", () => {
  requireText(migration, "public.organization_memberships", "existing organisation membership engine");
  requireText(migration, "'logistics.company.owner'", "company owner role");
  requireText(migration, "public.role_permissions", "existing role-permission engine");
  requireText(migration, "public.user_roles", "existing user-role assignment engine");
  requireText(migration, "business.logistics.company.manage", "company-scoped permissions");
  requireText(migration, "public.can_manage_logistics_company", "server-side tenant management guard");
  requireNotText(migration, "platform.logistics.owner", "no new platform superuser role");
});

Deno.test("Matching is capability, cargo, coverage, verification and capacity constrained", () => {
  requireText(migration, "provider.verification_status = 'verified'", "provider verification gate");
  requireText(migration, "provider.operational_status = 'active'", "provider operating-status gate");
  requireText(migration, "service.availability_enabled = true", "service availability gate");
  requireText(migration, "origin.coverage_mode", "pickup coverage gate");
  requireText(migration, "destination.coverage_mode", "drop-off coverage gate");
  requireText(migration, "service.maximum_weight_kg", "cargo weight capacity gate");
  requireText(migration, "service.maximum_volume_m3", "cargo volume capacity gate");
  requireText(migration, "service.vehicle_type_keys", "vehicle-type requirements gate");
  requireText(migration, "service.cargo_type_keys", "cargo-type requirements gate");
});

Deno.test("Offers, counteroffers and messages are limited to the customer or matched provider", () => {
  requireText(migration, "public.can_manage_logistics_company(opportunity.organization_id)", "provider offer actor guard");
  requireText(migration, "only the customer or matched provider may negotiate this offer", "counteroffer actor guard");
  requireText(migration, "only the job customer may select a provider offer", "offer selection actor guard");
  requireText(migration, "only the customer and matched provider may send negotiation messages", "message participant guard");
  requireText(migration, "unique (created_by, idempotency_key)", "offer idempotency constraint");
  requireText(migration, "unique (sender_user_id, idempotency_key)", "message idempotency constraint");
});

Deno.test("Selecting an offer is not treated as paid booking confirmation", () => {
  requireText(migration, "set status = 'booking_pending'", "selection enters booking pending");
  requireText(migration, "'next_step', 'complete_booking_terms_and_payment'", "payment is a separate next step");
  requireNotText(migration, "post_financial_transaction", "offer selection does not post money");
  requireNotText(migration, "fund_order_from_wallet", "offer selection does not debit a customer wallet");
  requireNotText(migration, "create escrow hold", "offer selection does not pretend to fund escrow");
});

Deno.test("Runtime authenticates the user and uses the caller's RLS context", () => {
  requireText(runtime, "requireAuthenticatedUser", "authenticated request");
  requireText(runtime, "createRequestSupabaseClient", "caller-scoped database client");
  requireText(runtime, "check_rate_limit", "authenticated rate limit");
  requireText(runtime, "supabase.rpc(", "server-side lifecycle RPCs");
  requireNotText(runtime, "SUPABASE_SERVICE_ROLE_KEY", "no service role credential in request runtime");
});

Deno.test("Free provider opportunity access has no lead unlock charge", () => {
  requireText(migration, "logistics_job_opportunities", "provider opportunities are materialized");
  requireNotText(migration.toLowerCase(), "lead_unlock_fee", "no lead unlock fee");
  requireNotText(migration.toLowerCase(), "opportunity_unlock_payment", "no paid opportunity unlock");
  requireNotText(runtime.toLowerCase(), "unlock fee", "runtime does not charge to view opportunities");
});
