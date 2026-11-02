const migrationBase = await Deno.readTextFile(
  "supabase/migrations/20261102110000_logistics_marketplace_domain_foundation.sql",
);
const migrationHardening = await Deno.readTextFile(
  "supabase/migrations/20261102111500_logistics_marketplace_tenant_and_matching_hardening.sql",
);
const migrationBooking = await Deno.readTextFile(
  "supabase/migrations/20261102113000_logistics_booking_and_payment_modes.sql",
);
const migrationFulfillment = await Deno.readTextFile(
  "supabase/migrations/20261102114500_logistics_booking_fulfillment_and_settlement.sql",
);
const migrationWalletFunding = await Deno.readTextFile(
  "supabase/migrations/20261102115000_logistics_provider_wallet_funding.sql",
);
const migrationDriver = await Deno.readTextFile(
  "supabase/migrations/20261102120000_logistics_company_driver_fulfillment.sql",
);
const migration = migrationBase + "\n" + migrationHardening + "\n" + migrationBooking + "\n" + migrationFulfillment + "\n" + migrationWalletFunding + "\n" + migrationDriver;
const runtime = await Deno.readTextFile("supabase/functions/logistics-runtime/index.ts");
const apiGateway = await Deno.readTextFile("supabase/functions/api-gateway/index.ts");
const supabaseConfig = await Deno.readTextFile("supabase/config.toml");
const moduleRouter = await Deno.readTextFile("supabase/migrations/20261102005600_fuel_module_runtime_router_and_security.sql");

function requireText(source: string, fragment: string, label: string): void {
  const normalizedSource = source.replace(/\s+/g, " ");
  const normalizedFragment = fragment.replace(/\s+/g, " ");
  if (!normalizedSource.includes(normalizedFragment)) {
    throw new Error(`${label}: missing required fragment: ${fragment}`);
  }
}
function requireNotText(source: string, fragment: string, label: string): void {
  const normalizedSource = source.replace(/\s+/g, " ");
  const normalizedFragment = fragment.replace(/\s+/g, " ");
  if (normalizedSource.includes(normalizedFragment)) {
    throw new Error(`${label}: prohibited fragment found: ${fragment}`);
  }
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
  "logistics_bookings",
  "logistics_booking_events",
  "logistics_booking_driver_assignments",
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
  requireText(migration, "logistics_opportunities_read_customer_or_matched_company", "customer and company-scoped opportunity policy");
  requireText(migration, "public.can_read_logistics_job(job_id)", "customer reads only their job opportunities");
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

Deno.test("Customer category requests match all eligible provider services in that category", () => {
  requireText(migration, "where service.category_id = category_id", "customer category match");
  requireText(migration, "where service.category_id = job.category_id", "rematch category scope");
  requireNotText(
    migration.slice(
      migration.indexOf("create or replace function public.create_logistics_job"),
      migration.indexOf("create or replace function public.refresh_logistics_job_matches"),
    ),
    "and service.service_key = request_service_key",
    "customer job matching does not require knowing a provider's internal service key",
  );
});

Deno.test("LGA and state coverage includes eligible descendant locations", () => {
  requireText(migration, "public.logistics_geography_is_covered", "geography hierarchy matching helper");
  requireText(migration, "with recursive requested_ancestors", "requested geography ancestor traversal");
  requireText(migration, "public.logistics_geography_is_covered(origin.geography_id", "hierarchical pickup coverage");
  requireText(migration, "public.logistics_geography_is_covered(destination.geography_id", "hierarchical destination coverage");
});

Deno.test("Customer-authorized rematching can discover newly eligible providers", () => {
  requireText(migration, "public.refresh_logistics_job_matches", "rematch RPC");
  requireText(migration, "only the job customer or marketplace administrator may refresh matching", "rematch actor guard");
  requireText(migration, "on conflict (job_id, organization_id) do nothing", "one opportunity per job and provider");
  requireText(runtime, '"/runtime/logistics/jobs/match"', "rematch API route");
});

Deno.test("Offers, counteroffers and messages are limited to the customer or matched provider", () => {
  requireText(migration, "public.can_manage_logistics_company(opportunity.organization_id)", "provider offer actor guard");
  requireText(migration, "only the customer or matched provider may negotiate this offer", "counteroffer actor guard");
  requireText(migration, "only the job customer may select a provider offer", "offer selection actor guard");
  requireText(migration, "only the latest open offer can be negotiated", "no stale parent offer can be countered");
  requireText(migration, "only the latest open offer may be selected", "no stale countered offer can be selected");
  requireText(migration, "the provider cannot counter their own latest offer", "provider counteroffer alternation");
  requireText(migration, "the customer cannot counter their own latest offer", "customer counteroffer alternation");
  requireText(migration, "idempotency key was reused with different counteroffer details", "counteroffer replay protection");
  requireText(migration, "idempotency key was reused to select a different offer", "offer selection replay protection");
  requireText(migration, "only the customer and matched provider may send negotiation messages", "message participant guard");
  requireText(migration, "unique (created_by, idempotency_key)", "offer idempotency constraint");
  requireText(migration, "unique (sender_user_id, idempotency_key)", "message idempotency constraint");
});

Deno.test("Only a provider quote or provider counteroffer can be selected by a customer", () => {
  requireText(migration, "only an active provider offer may be selected", "provider-only selectable offer types");
  requireText(migration, "selected_offer.offer_type not in ('provider_quote', 'provider_counter')", "customer counteroffers cannot be selected as provider offers");
});

const offerSelectionFunction = migrationHardening.slice(
  migrationHardening.indexOf("create or replace function public.select_logistics_offer"),
  migrationHardening.indexOf("create or replace function public.", migrationHardening.indexOf("create or replace function public.select_logistics_offer") + 60),
);

Deno.test("Selecting an offer is not treated as paid booking confirmation", () => {
  requireText(offerSelectionFunction, "set status = 'booking_pending'", "selection enters booking pending");
  requireText(offerSelectionFunction, "'next_step', 'complete_booking_terms_and_payment'", "payment is a separate next step");
  requireNotText(offerSelectionFunction, "post_financial_transaction", "offer selection does not post money");
  requireNotText(offerSelectionFunction, "fund_order_from_wallet", "offer selection does not debit a customer wallet");
  requireNotText(offerSelectionFunction, "create escrow hold", "offer selection does not pretend to fund escrow");
});

Deno.test("Runtime authenticates the user and uses the caller's RLS context", () => {
  requireText(runtime, "requireAuthenticatedUser", "authenticated request");
  requireText(runtime, "createRequestSupabaseClient", "caller-scoped database client");
  requireText(runtime, "check_rate_limit", "authenticated rate limit");
  requireText(runtime, "supabase.rpc(", "server-side lifecycle RPCs");
  requireText(runtime, 'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")', "server-only service role environment");
  requireText(runtime, "createServiceClient(supabaseUrl, serviceRoleKey)", "server-only privileged database client");
  requireNotText(runtime, "JSON.stringify(serviceRoleKey", "service role credential is not serialized");
});

Deno.test("Customer directory search exposes verified providers without private support contacts", () => {
  requireText(migration, "public.search_logistics_providers", "provider directory search RPC");
  requireText(migration, "provider.verification_status = 'verified'", "directory verification gate");
  requireText(migration, "provider.operational_status = 'active'", "directory operating gate");
  requireText(runtime, '"/runtime/logistics/providers/search"', "provider search route");
  requireNotText(
    migration.slice(migration.indexOf("create or replace function public.search_logistics_providers"), migration.indexOf("$;", migration.indexOf("create or replace function public.search_logistics_providers")) + 3),
    "support_contact",
    "public directory does not return private provider contact",
  );
});

Deno.test("Provider and rematch controls are permission-gated and the internal event writer is not client-callable", () => {
  requireText(migration, "public.update_logistics_provider_profile", "company profile management");
  requireText(migration, "public.set_logistics_provider_operational_status", "company operating controls");
  requireText(migration, "revoke all on function public.record_logistics_job_event", "event writer privilege revocation");
  requireText(migration, "from public, anon, authenticated", "event writer is not directly executable by client roles");
  requireText(migration, "to service_role", "event writer is internal only");
  requireText(migration, "platform.super_admin", "platform super admin receives marketplace management permission");
  requireText(migration, "platform.company_admin", "company admin receives marketplace management permission");
});

Deno.test("Booking creates locked customer/provider fee snapshots from approved financial policies", () => {
  requireText(migrationBooking, "'fees.logistics.customer_booking'", "customer booking fee policy definition");
  requireText(migrationBooking, "'fees.logistics.provider_receival'", "offline provider receival fee definition");
  requireText(migrationBooking, "'commission.logistics.provider'", "online provider commission definition");
  requireText(migrationBooking, "public.resolve_financial_policy(", "universal financial policy resolver");
  requireText(migrationBooking, "policy_snapshots", "immutable booking policy snapshots");
  requireText(migrationBooking, "target_payment_mode", "payment-mode-specific policy resolution");
  requireText(migrationBooking, "'logistics_network'", "policy module scoping");
  requireText(migrationBooking, "offer_record.organization_id", "policy provider-tenant scoping");
  requireNotText(migrationBooking, "insert into public.financial_policy_versions", "no guessed/active fee amounts are seeded");
});

Deno.test("Offline and online fee paths are exclusive and cannot double-charge providers", () => {
  requireText(migrationBooking, "target_payment_mode = 'offline'", "offline path gate");
  requireText(migrationBooking, "target_payment_mode = 'online_wallet'", "online path gate");
  requireText(migrationBooking, "provider_receival_fee_amount = 0", "online has no receival fee");
  requireText(migrationBooking, "provider_commission_amount = 0", "offline has no commission");
  requireText(migrationBooking, "provider_receival_policy", "offline receival policy");
  requireText(migrationBooking, "provider_commission_policy", "online commission policy");
  requireText(migrationBooking, "total_customer_charge = delivery_amount + customer_booking_fee_amount", "customer booking fee is charged in both modes");
});

Deno.test("Online payment reserves one escrow hold from the customer's own wallet", () => {
  requireText(runtime, '"/runtime/logistics/bookings/pay"', "online payment API route");
  requireText(runtime, '.eq("owner_entity_id", requesterUserId)', "wallet owner is the authenticated requester");
  requireText(runtime, '.eq("wallet_type", "customer")', "customer wallet type check");
  requireText(runtime, 'createServiceClient(supabaseUrl, serviceRoleKey)', "server-side financial client");
  requireText(runtime, 'serviceClient.rpc("fund_order_from_wallet"', "shared escrow funding engine");
  requireText(runtime, 'logistics-booking:', "server-derived stable payment idempotency key");
  requireText(runtime, 'online-wallet:v1', "versioned wallet payment idempotency suffix");
  requireText(runtime, 'serviceClient.rpc("mark_logistics_booking_payment_reserved"', "booking/hold linkage");
  requireText(migrationBooking, "hold_record.hold_amount <> booking_record.total_customer_charge", "escrow amount must equal locked customer charge");
});

Deno.test("Offline payment debits only the two configured fees and returns a retry-safe result", () => {
  requireText(runtime, '"/runtime/logistics/bookings/offline/confirm"', "offline confirmation API route");
  requireText(runtime, 'serviceClient.rpc("confirm_logistics_offline_booking_payment"', "server-side offline fee collection");
  requireText(runtime, 'bookingResult.data.status === "offline_payment_confirmed"', "already confirmed offline booking retry");
  requireText(migrationBooking, "public.post_financial_transaction(", "existing immutable double-entry ledger");
  requireText(migrationBooking, "'customer_booking_fee'", "customer booking fee debit");
  requireText(migrationBooking, "'provider_offline_receival_fee'", "provider receival debit");
  requireText(migrationBooking, "'logistics_marketplace_fee_revenue'", "platform fee revenue credit");
  requireText(migrationBooking, "'fee_transaction_id'", "structured offline confirmation result");
});

Deno.test("Booking and payment routes do not expose the service-role credential", () => {
  requireText(runtime, 'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")', "server-only service-role environment");
  requireNotText(runtime, "serviceRoleKey: serviceRoleKey", "service-role key is not copied into response data");
  requireNotText(runtime, "JSON.stringify(serviceRoleKey", "service-role key is not serialized in a response");
  requireText(migrationBooking, "from public,anon,authenticated", "payment confirmation RPC is service-role only");
});

Deno.test("Provider acceptance is blocked until the selected booking payment mode is satisfied", () => {
  requireText(migrationFulfillment, "booking_record.payment_mode = 'online_wallet'", "online provider acceptance payment mode");
  requireText(migrationFulfillment, "booking_record.status <> 'payment_reserved'", "online escrow must exist before provider acceptance");
  requireText(migrationFulfillment, "booking_record.payment_mode = 'offline'", "offline provider acceptance payment mode");
  requireText(migrationFulfillment, "booking_record.status <> 'offline_payment_confirmed'", "offline fees must be confirmed before provider acceptance");
  requireText(runtime, '"/runtime/logistics/bookings/accept"', "provider accept API route");
});

Deno.test("Provider fulfilment requires acceptance, work start and a named delivery recipient", () => {
  requireText(migrationFulfillment, "public.start_logistics_booking", "provider work-start lifecycle function");
  requireText(migrationFulfillment, "public.submit_logistics_booking_delivery", "provider delivery submission function");
  requireText(migrationFulfillment, "recipient_name", "delivery recipient evidence");
  requireText(migrationFulfillment, "booking_record.status <> 'provider_accepted'", "work cannot start before provider acceptance");
  requireText(migrationFulfillment, "booking_record.status <> 'in_progress'", "delivery cannot be submitted before work starts");
  requireText(runtime, '"/runtime/logistics/bookings/start"', "provider start API route");
  requireText(runtime, '"/runtime/logistics/bookings/delivery/submit"', "provider delivery submission API route");
});

Deno.test("Online customer delivery confirmation settles escrow to provider net and platform fees", () => {
  requireText(migrationFulfillment, "public.execute_service_request_settlement(", "existing universal escrow settlement engine");
  requireText(migrationFulfillment, "'logistics_provider_net'", "provider receives locked net delivery proceeds");
  requireText(migrationFulfillment, "'logistics_platform_revenue'", "platform receives booking fee and online commission");
  requireText(migrationFulfillment, "provider_net_amount + platform_revenue_amount <> booking_record.total_customer_charge", "split distribution equals escrowed total");
  requireText(runtime, 'serviceClient.rpc("confirm_logistics_booking_delivery"', "service-role customer confirmation route");
  requireText(migrationFulfillment, "'logistics-booking:' || booking_record.id::text || ':settlement:v1'", "server-side settlement idempotency");
});

Deno.test("Offline delivery completion never runs online commission or escrow settlement again", () => {
  requireText(migrationFulfillment, "booking_record.payment_mode = 'offline'", "offline completion branch");
  requireText(migrationFulfillment, "offline_fee_transaction_id is null", "offline booking fees were confirmed earlier");
  requireText(migrationFulfillment, "current_status := 'completed_offline'", "offline terminal booking status");
  requireNotText(
    migrationFulfillment.slice(
      migrationFulfillment.indexOf("elsif booking_record.payment_mode = 'offline'"),
      migrationFulfillment.indexOf("else\n    raise exception 'booking payment mode", migrationFulfillment.indexOf("elsif booking_record.payment_mode = 'offline'")),
    ),
    "execute_service_request_settlement",
    "offline delivery has no online settlement/commission debit",
  );
});

Deno.test("Company-owner funding transfers into the shared partner wallet through the immutable ledger", () => {
  requireText(migrationWalletFunding, "auth.role() <> 'service_role'", "wallet funding is service-role only");
  requireText(migrationWalletFunding, "membership.membership_type = 'owner'", "only an active company owner can fund the company wallet");
  requireText(migrationWalletFunding, "wallet_type = 'customer'", "funding source is a customer wallet");
  requireText(migrationWalletFunding, "owner_entity_type = 'user'", "funding source must be user-owned");
  requireText(migrationWalletFunding, "owner_entity_id = target_customer_user_id", "funding source must belong to the acting owner");
  requireText(migrationWalletFunding, "target_amount <> trunc(target_amount, currency_decimals)", "wallet funding follows currency decimal precision");
  requireText(migrationWalletFunding, "public.ensure_wallet_account(", "company uses the shared wallet-account engine");
  requireText(migrationWalletFunding, "public.post_financial_transaction(", "funding uses the immutable double-entry ledger");
  requireText(migrationWalletFunding, "'platform.logistics.provider_wallet_funding'", "dedicated funding idempotency scope");
  requireText(migrationWalletFunding, "'direction', 'debit'", "owner wallet debit");
  requireText(migrationWalletFunding, "'direction', 'credit'", "company wallet credit");
  requireText(migrationWalletFunding, "from public, anon, authenticated", "no direct client execution of provider funding RPC");
  requireText(migrationWalletFunding, "to service_role", "server-only execution grant");
  requireText(runtime, '"/runtime/logistics/company/wallet/fund"', "provider wallet funding API route");
  requireText(runtime, 'supabase.rpc("can_manage_logistics_company"', "caller tenant-management permission check");
  requireText(runtime, 'serviceClient.rpc("fund_logistics_provider_wallet_from_customer_wallet"', "service-side balanced transfer");
  requireText(runtime, '.eq("owner_entity_id", requesterUserId)', "funding source wallet belongs to authenticated user");
});

Deno.test("Offline receival fee collection and company-wallet funding serialize wallet balance changes", () => {
  requireText(migrationFulfillment, "order by wallet.id", "stable wallet lock ordering for offline fee collection");
  requireText(migrationFulfillment, "for update", "wallet row locks during offline fee collection");
  requireText(migrationWalletFunding, "order by wallet.id", "stable wallet lock ordering for funding");
  requireText(migrationWalletFunding, "for update", "wallet row locks during provider funding");
});
Deno.test("Wallet balance runtime never returns balances for wallet accounts hidden by RLS", () => {
  requireText(apiGateway, "const walletsById = new Map<string, unknown>()", "RLS-visible wallet account index");
  requireText(apiGateway, "const visibleBalances = balances.filter", "aggregate balance filtering");
  requireText(apiGateway, "walletId !== null && walletsById.has(walletId)", "only RLS-visible account balances");
  requireText(apiGateway, "const data = visibleBalances.map", "serialize only authorised wallet balances");
  requireNotText(apiGateway, "const data = balances.map", "no unfiltered balance serialization");
});

Deno.test("Free provider opportunity access has no lead unlock charge", () => {
  requireText(migration, "logistics_job_opportunities", "provider opportunities are materialized");
  requireNotText(migration.toLowerCase(), "lead_unlock_fee", "no lead unlock fee");
  requireNotText(migration.toLowerCase(), "opportunity_unlock_payment", "no paid opportunity unlock");
  requireNotText(runtime.toLowerCase(), "unlock fee", "runtime does not charge to view opportunities");
});


Deno.test("Logistics dispatch assigns only an approved, available company member with a compliant linked vehicle", () => {
  requireText(migrationDriverFulfillment, "public.read_logistics_company_dispatch_resources", "company dispatch resource reader");
  requireText(migrationDriverFulfillment, "membership.status = 'active'", "driver must be an active company member");
  requireText(migrationDriverFulfillment, "driver.verification_status = 'approved'", "driver approval gate");
  requireText(migrationDriverFulfillment, "driver.operational_status = 'available'", "driver availability gate");
  requireText(migrationDriverFulfillment, "public.vehicle_assignment_compliance", "shared vehicle compliance gate");
  requireText(migrationDriverFulfillment, "compliance.vehicle_documents_valid = true", "vehicle document validity gate");
  requireText(migrationDriverFulfillment, "public.assign_logistics_booking_driver", "company dispatch assignment RPC");
  requireText(migrationDriverFulfillment, "selected vehicle does not have enough weight capacity", "vehicle cargo weight limit");
  requireText(migrationDriverFulfillment, "vehicle does not have enough cargo volume", "vehicle cargo volume limit");
  requireText(migrationDriverFulfillment, "selected vehicle type is not allowed", "service-specific vehicle type gate");
  requireText(migrationDriverFulfillment, "logistics_driver_one_active_booking_idx", "no concurrent active booking for one driver");
});

Deno.test("Driver assignment responses are private to the assigned driver and retry-safe", () => {
  requireText(migrationDriverFulfillment, "driver_user_id = auth.uid()", "only the assigned driver can read their assignment");
  requireText(migrationDriverFulfillment, "public.respond_logistics_driver_assignment", "driver accept or reject RPC");
  requireText(migrationDriverFulfillment, "assignment_record.driver_user_id <> actor", "driver identity check");
  requireText(migrationDriverFulfillment, "status = 'accepted'", "assignment acceptance state");
  requireText(migrationDriverFulfillment, "status = 'rejected'", "assignment rejection state");
  requireText(migrationDriverFulfillment, "booking_record.status <> 'provider_accepted'", "driver response only before job start");
  requireText(migrationDriverFulfillment, "public.read_my_logistics_driver_bookings", "driver-owned assigned booking reader");
  requireText(runtime, '"/runtime/logistics/driver/bookings"', "driver jobs API route");
  requireText(runtime, '"/runtime/logistics/driver/assignment/respond"', "driver assignment response API route");
});

Deno.test("A Logistics driver must accept, start, confirm pickup and mark transit before delivery submission", () => {
  requireText(migrationDriverFulfillment, "assigned driver must accept the job before the service can start", "driver acceptance prerequisite");
  requireText(migrationDriverFulfillment, "company must assign an eligible driver before the service can start", "no unassigned provider start");
  requireText(migrationDriverFulfillment, "public.update_logistics_driver_milestone", "driver milestone RPC");
  requireText(migrationDriverFulfillment, "target_milestone not in ('picked_up','in_transit')", "supported milestone allow-list");
  requireText(migrationDriverFulfillment, "cargo must be picked up before the driver marks it in transit", "pickup-before-transit gate");
  requireText(migrationDriverFulfillment, "status = 'in_transit'", "in-transit status is required for delivery submission");
  requireText(runtime, '"/runtime/logistics/driver/milestone"', "driver milestone API route");
  requireText(runtime, '"/runtime/logistics/bookings/assign-driver"', "company driver assignment API route");
  requireText(migrationDriverFulfillment, "public.read_my_logistics_driver_profile", "signed-in driver profile projection");
});

Deno.test("Driver completion remains subject to customer confirmation and the existing settlement trigger", () => {
  requireText(migrationDriverFulfillment, "public.complete_logistics_driver_assignment_after_settlement", "assignment completion trigger");
  requireText(migrationDriverFulfillment, "new.status in ('settled','completed_offline')", "customer-confirmed terminal booking states");
  requireText(migrationDriverFulfillment, "status='completed'", "driver assignment only completes after booking settlement");
  requireText(migrationDriverFulfillment, "delivery_submission_snapshot", "existing customer delivery proof is preserved");
});


Deno.test("Logistics driver dispatch resources include only verified company drivers with compliant active vehicles", () => {
  requireText(migrationDriver, "public.read_logistics_company_dispatch_resources", "company dispatch resource projection");
  requireText(migrationDriver, "public.can_manage_logistics_company(target_organization_id)", "company tenant management guard");
  requireText(migrationDriver, "public.has_permission('business.logistics.jobs.manage', target_organization_id)", "company dispatch permission");
  requireText(migrationDriver, "driver.verification_status = 'approved'", "approved driver gate");
  requireText(migrationDriver, "driver.operational_status = 'available'", "available driver gate");
  requireText(migrationDriver, "membership.status = 'active'", "active company staff membership gate");
  requireText(migrationDriver, "compliance.driver_approved = true", "driver compliance gate");
  requireText(migrationDriver, "compliance.vehicle_approved = true", "vehicle approval gate");
  requireText(migrationDriver, "compliance.vehicle_documents_valid = true", "valid vehicle document gate");
  requireText(runtime, '"/runtime/logistics/company/dispatch-resources"', "company dispatch resource API route");
});

Deno.test("Logistics driver assignment is tenant-scoped, capacity-checked and single-active", () => {
  requireText(migrationDriver, "create table if not exists public.logistics_booking_driver_assignments", "separate Logistics driver assignment ledger");
  requireText(migrationDriver, "logistics_booking_one_active_driver_assignment_idx", "one active driver per booking");
  requireText(migrationDriver, "logistics_driver_one_active_booking_idx", "one active booking per driver");
  requireText(migrationDriver, "alter table public.logistics_booking_driver_assignments enable row level security", "assignment table RLS");
  requireText(migrationDriver, "driver_user_id = auth.uid()", "driver sees their own assignments");
  requireText(migrationDriver, "public.can_read_logistics_company(provider_organization_id)", "company sees only its assignments");
  requireText(migrationDriver, "with check (false)", "no direct authenticated assignment writes");
  requireText(migrationDriver, "booking_record.status <> 'provider_accepted'", "company must accept booking first");
  requireText(migrationDriver, "driver_record.verification_status <> 'approved'", "unapproved drivers cannot be assigned");
  requireText(migrationDriver, "driver_record.operational_status <> 'available'", "busy/offline drivers cannot be assigned");
  requireText(migrationDriver, "driver must be an active member of this provider company", "driver must belong to provider tenant");
  requireText(migrationDriver, "vehicle_record.max_load_kg < cargo_weight", "vehicle weight capacity gate");
  requireText(migrationDriver, "vehicle_record.cargo_volume_m3 < cargo_volume", "vehicle volume capacity gate");
  requireText(migrationDriver, "vehicle_type_key = any(service_record.vehicle_type_keys)", "service vehicle type gate");
  requireText(runtime, '"/runtime/logistics/bookings/assign-driver"', "company driver assignment API route");
});

Deno.test("Driver self-service lifecycle controls acceptance, start, pickup, transit and delivery", () => {
  requireText(migrationDriver, "public.read_my_logistics_driver_profile()", "driver self profile");
  requireText(migrationDriver, "public.read_my_logistics_driver_bookings()", "driver self assignment inbox");
  requireText(migrationDriver, "assignment_record.driver_user_id <> actor", "only assigned driver can accept/reject");
  requireText(migrationDriver, "target_decision not in ('accept','reject')", "driver accept/reject decisions");
  requireText(migrationDriver, "target_milestone not in ('picked_up','in_transit')", "supported driver milestones");
  requireText(migrationDriver, "driver must start the booking before updating pickup or transit", "milestones follow service start");
  requireText(migrationDriver, "cargo must be picked up before the driver marks it in transit", "transit follows pickup");
  requireText(migrationDriver, "where booking_id = booking_record.id and driver_user_id = actor and status = 'in_transit'", "delivery can only be submitted from transit");
  requireText(migrationDriver, "the name of the person receiving the delivery is required", "recipient evidence is mandatory");
  requireText(migrationDriver, "public.complete_logistics_driver_assignment_after_settlement()", "assignment follows booking settlement");
  requireText(migrationDriver, "set status='completed'", "completed settlement closes driver assignment");
  requireText(runtime, '"/runtime/logistics/driver/profile"', "driver profile endpoint");
  requireText(runtime, '"/runtime/logistics/driver/bookings"', "driver bookings endpoint");
  requireText(runtime, '"/runtime/logistics/driver/assignment/respond"', "driver decision endpoint");
  requireText(runtime, '"/runtime/logistics/driver/milestone"', "driver milestone endpoint");
  if (migrationDriver.includes("\nas $\ndeclare")) {
    throw new Error("driver profile migration: invalid standalone SQL dollar delimiter");
  }
});
