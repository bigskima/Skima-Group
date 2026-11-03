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
const migrationCancellation = await Deno.readTextFile(
  "supabase/migrations/20261102130000_logistics_customer_prebooking_cancellation.sql",
);
const migrationTracking = await Deno.readTextFile(
  "supabase/migrations/20261102140000_logistics_driver_location_tracking.sql",
);
const migrationDispatch = await Deno.readTextFile(
  "supabase/migrations/20261103090000_logistics_driver_prestart_release.sql",
);
const migrationReplacementHandoff = await Deno.readTextFile(
  "supabase/migrations/20261103100000_logistics_safe_replacement_handoff.sql",
);
const migrationExceptions = await Deno.readTextFile(
  "supabase/migrations/20261103110000_logistics_incident_and_dispute_protection.sql",
);
const migrationCargoRecovery = await Deno.readTextFile(
  "supabase/migrations/20261103120000_logistics_cargo_recovery_dispatch.sql",
);
const migration = migrationBase + "\n" + migrationHardening + "\n" + migrationBooking + "\n" + migrationFulfillment + "\n" + migrationWalletFunding + "\n" + migrationDriver + "\n" + migrationCancellation + "\n" + migrationTracking + "\n" + migrationDispatch + "\n" + migrationReplacementHandoff + "\n" + migrationExceptions + "\n" + migrationCargoRecovery;
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
  requireText(runtime, 'serviceClient.rpc("reserve_logistics_booking_online_payment"', "atomic booking payment reservation RPC");
  requireText(migrationCancellation, "public.fund_order_from_wallet(", "shared wallet and escrow ledger inside the reservation transaction");
  requireText(migrationCancellation, "'logistics-booking:' || booking_record.id::text || ':online-wallet:v1'", "server-derived stable payment idempotency key");
  requireText(migrationCancellation, "':online-wallet:v1'", "versioned wallet payment idempotency suffix");
  requireText(migrationCancellation, "public.mark_logistics_booking_payment_reserved(", "booking and hold linkage happens inside the same database transaction");
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
  requireText(migrationDriver, "public.read_logistics_company_dispatch_resources", "company dispatch resource reader");
  requireText(migrationDriver, "membership.status = 'active'", "driver must be an active company member");
  requireText(migrationDriver, "driver.verification_status = 'approved'", "driver approval gate");
  requireText(migrationDriver, "driver.operational_status = 'available'", "driver availability gate");
  requireText(migrationDriver, "public.vehicle_assignment_compliance", "shared vehicle compliance gate");
  requireText(migrationDriver, "compliance.vehicle_documents_valid = true", "vehicle document validity gate");
  requireText(migrationDriver, "public.assign_logistics_booking_driver", "company dispatch assignment RPC");
  requireText(migrationDriver, "selected vehicle does not have enough weight capacity", "vehicle cargo weight limit");
  requireText(migrationDriver, "vehicle does not have enough cargo volume", "vehicle cargo volume limit");
  requireText(migrationDriver, "selected vehicle type is not allowed", "service-specific vehicle type gate");
  requireText(migrationDriver, "logistics_driver_one_active_booking_idx", "no concurrent active booking for one driver");
});

Deno.test("Driver assignment responses are private to the assigned driver and retry-safe", () => {
  requireText(migrationDriver, "driver_user_id = auth.uid()", "only the assigned driver can read their assignment");
  requireText(migrationDriver, "public.respond_logistics_driver_assignment", "driver accept or reject RPC");
  requireText(migrationDriver, "assignment_record.driver_user_id <> actor", "driver identity check");
  requireText(migrationDriver, "status = 'accepted'", "assignment acceptance state");
  requireText(migrationDriver, "status = 'rejected'", "assignment rejection state");
  requireText(migrationDriver, "booking_record.status <> 'provider_accepted'", "driver response only before job start");
  requireText(migrationDriver, "public.read_my_logistics_driver_bookings", "driver-owned assigned booking reader");
  requireText(runtime, '"/runtime/logistics/driver/bookings"', "driver jobs API route");
  requireText(runtime, '"/runtime/logistics/driver/assignment/respond"', "driver assignment response API route");
});

Deno.test("A Logistics driver must accept, start, confirm pickup and mark transit before delivery submission", () => {
  requireText(migrationDriver, "assigned driver must accept the job before the service can start", "driver acceptance prerequisite");
  requireText(migrationDriver, "company must assign an eligible driver before the service can start", "no unassigned provider start");
  requireText(migrationDriver, "public.update_logistics_driver_milestone", "driver milestone RPC");
  requireText(migrationDriver, "target_milestone not in ('picked_up','in_transit')", "supported milestone allow-list");
  requireText(migrationDriver, "cargo must be picked up before the driver marks it in transit", "pickup-before-transit gate");
  requireText(migrationDriver, "status = 'in_transit'", "in-transit status is required for delivery submission");
  requireText(runtime, '"/runtime/logistics/driver/milestone"', "driver milestone API route");
  requireText(runtime, '"/runtime/logistics/bookings/assign-driver"', "company driver assignment API route");
  requireText(migrationDriver, "public.read_my_logistics_driver_profile", "signed-in driver profile projection");
});

Deno.test("Driver completion remains subject to customer confirmation and the existing settlement trigger", () => {
  requireText(migrationDriver, "public.complete_logistics_driver_assignment_after_settlement", "assignment completion trigger");
  requireText(migrationDriver, "new.status in ('settled','completed_offline')", "customer-confirmed terminal booking states");
  requireText(migrationDriver, "status='completed'", "driver assignment only completes after booking settlement");
  requireText(migrationDriver, "delivery_submission_snapshot", "existing customer delivery proof is preserved");
});


Deno.test("Logistics driver dispatch resources include only verified company drivers with compliant active vehicles", () => {
  requireText(migrationDriver, "public.read_logistics_company_dispatch_resources", "company dispatch resource projection");
  requireText(migrationDriver, "public.can_manage_logistics_company(target_organization_id)", "company tenant management guard");
  requireText(migrationDriver, "public.has_permission('business.logistics.jobs.manage', target_organization_id)", "company dispatch permission");
  requireText(migrationDriver, "driver.verification_status = 'approved'", "approved driver gate");
  requireText(migrationDriver, "driver.operational_status = 'available'", "available driver gate");
  requireText(migrationDriver, "active_assignment.status in ('offered','accepted','in_progress','picked_up','in_transit')", "exclude drivers with active Logistics work");
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

Deno.test("Logistics never writes the shared driver availability field used by other SKIMA products", () => {
  requireNotText(migrationDriver, "update public.driver_profiles", "no cross-module driver profile status mutation");
  requireText(migrationDriver, "active_assignment.driver_profile_id = driver.id", "Logistics-specific active assignment exclusion");
  requireText(migrationDriver, "driver response idempotency key was used for a different action", "driver response retry protection");
  requireText(migrationDriver, "driver milestone idempotency key was used for a different action", "milestone retry protection");
});

Deno.test("Driver self-service lifecycle controls acceptance, start, pickup, transit and delivery", () => {
  requireText(migrationDriver, "public.read_my_logistics_driver_profile()", "driver self profile");
  requireText(migrationDriver, "public.read_my_logistics_driver_bookings()", "driver self assignment inbox");
  requireText(migrationDriver, "assignment_record.driver_user_id <> actor", "only assigned driver can accept/reject");
  requireText(migrationDriver, "target_decision not in ('accept','reject')", "driver accept/reject decisions");
  requireText(migrationDriver, "target_milestone not in ('picked_up','in_transit')", "supported driver milestones");
  requireText(migrationDriver, "driver must start the booking before updating pickup or transit", "milestones follow service start");
  requireText(migrationDriver, "cargo must be picked up before the driver marks it in transit", "transit follows pickup");
  requireText(migrationDriver, "where booking_id = booking_record.id and status = 'in_transit'", "delivery can only be submitted from an in-transit assignment");
  requireText(migrationDriver, "assignment_record.driver_user_id <> actor and not actor_is_company", "delivery actor must be the assigned driver or an authorised company dispatcher");
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



Deno.test("Customer may cancel a Logistics request only before a provider booking is created", () => {
  requireText(migrationCancellation, "perform offer.id", "cancellation locks provider offers before the request");
  requireText(migrationCancellation, "where offer.job_id = target_job_id", "offer lock is scoped to the request");
  requireText(migrationCancellation, "job_record.requester_user_id <> actor", "only the request owner may cancel");
  requireText(migrationCancellation, "job_record.status not in ('open', 'matching', 'offers_received')", "cancellation is restricted to pre-booking requests");
  requireText(migrationCancellation, "where booking.job_id = job_record.id", "any provider booking blocks request-only cancellation");
  requireText(migrationCancellation, "update public.logistics_job_opportunities", "matched provider opportunities are withdrawn");
  requireText(migrationCancellation, "update public.logistics_offers", "open provider offers are withdrawn");
  requireText(migrationCancellation, "logistics.job.customer_cancelled", "append-only request cancellation event");
  requireText(migrationCancellation, "existing_event.actor_user_id is distinct from actor", "cancellation idempotency is actor-bound");
  const jobCancellation = migrationCancellation.slice(
    migrationCancellation.indexOf("create or replace function public.cancel_logistics_job"),
    migrationCancellation.indexOf("create or replace function public.cancel_logistics_booking_before_payment"),
  );
  requireNotText(jobCancellation, "post_financial_transaction", "request withdrawal never posts money");
  requireNotText(jobCancellation, "fund_order_from_wallet", "request withdrawal does not touch wallets");
  requireText(runtime, '"/runtime/logistics/jobs/cancel"', "customer request cancellation runtime route");
});

Deno.test("Customer may cancel an unpaid booking but not a paid or funded booking", () => {
  requireText(migrationCancellation, "public.cancel_logistics_booking_before_payment", "unpaid booking cancellation RPC");
  requireText(migrationCancellation, "booking_record.requester_user_id <> actor", "booking owner check");
  requireText(migrationCancellation, "booking_record.status not in ('awaiting_payment', 'awaiting_offline_confirmation')", "only unpaid booking statuses are cancellable");
  requireText(migrationCancellation, "booking_record.escrow_hold_id is not null", "escrow hold blocks cancellation");
  requireText(migrationCancellation, "booking_record.payment_transaction_id is not null", "online payment blocks cancellation");
  requireText(migrationCancellation, "booking_record.offline_fee_transaction_id is not null", "offline fee transaction blocks cancellation");
  requireText(migrationCancellation, "booking_record.settlement_execution_id is not null", "settled booking cannot be cancelled");
  requireText(migrationCancellation, "from public.escrow_holds hold_record", "an unlinked escrow hold also blocks cancellation");
  requireText(migrationCancellation, "request_record.escrow_hold_id is not null", "linked service-request escrow reference blocks cancellation");
  requireText(migrationCancellation, "update public.service_requests", "shared service request is closed");
  requireText(migrationCancellation, "update public.order_records", "shared order record is closed");
  const bookingCancellation = migrationCancellation.slice(
    migrationCancellation.indexOf("create or replace function public.cancel_logistics_booking_before_payment"),
    migrationCancellation.indexOf("create or replace function public.reserve_logistics_booking_online_payment"),
  );
  requireNotText(bookingCancellation, "post_financial_transaction", "unpaid cancellation posts no ledger entry");
  requireNotText(bookingCancellation, "execute_service_request_settlement", "unpaid cancellation releases no escrow");
  requireText(runtime, '"/runtime/logistics/bookings/cancel"', "unpaid booking cancellation API route");
});

Deno.test("Online booking wallet funding and escrow reservation run in one serialized database transaction", () => {
  requireText(migrationCancellation, "public.reserve_logistics_booking_online_payment", "atomic online payment reservation RPC");
  requireText(migrationCancellation, "as $$", "valid SQL function dollar-quoted body");
  requireText(migrationCancellation, "end;\n$$;", "valid SQL function terminator");
  requireText(migrationCancellation, "from public.logistics_bookings", "booking is read in the reservation function");
  requireText(migrationCancellation, "for update", "booking lock is held during payment");
  requireText(migrationCancellation, "public.fund_order_from_wallet(", "existing double-entry wallet/escrow funding engine");
  requireText(migrationCancellation, "public.mark_logistics_booking_payment_reserved(", "booking projection is linked in the same transaction");
  const reservation = migrationCancellation.slice(
    migrationCancellation.indexOf("create or replace function public.reserve_logistics_booking_online_payment"),
    migrationCancellation.indexOf("revoke all on function public.begin_logistics_booking_online_payment"),
  );
  const lockAt = reservation.indexOf("for update");
  const fundAt = reservation.indexOf("public.fund_order_from_wallet(");
  const markAt = reservation.indexOf("public.mark_logistics_booking_payment_reserved(");
  if (lockAt < 0 || fundAt < lockAt || markAt < fundAt) {
    throw new Error("online reservation must lock the booking, fund escrow, then mark the booking in one transaction");
  }
  requireText(runtime, 'serviceClient.rpc("reserve_logistics_booking_online_payment"', "runtime uses atomic payment reservation");
  requireNotText(runtime, 'serviceClient.rpc("fund_order_from_wallet"', "Edge Function does not split wallet funding from booking reservation");
  requireNotText(runtime, 'serviceClient.rpc("mark_logistics_booking_payment_reserved"', "Edge Function does not split escrow marking into a second transaction");
});


Deno.test("Driver location sharing is opt-in and can be written only by the assigned driver during an active booking", () => {
  requireText(migrationTracking, "public.record_logistics_driver_location", "driver location recording RPC");
  requireText(migrationTracking, "auth.role() <> 'service_role'", "location writes are service-role mediated");
  requireText(migrationTracking, "booking_record.assigned_driver_user_id is distinct from target_driver_user_id", "only the assigned driver may share this route");
  requireText(migrationTracking, "booking_record.status <> 'in_progress'", "location is limited to an active delivery");
  requireText(migrationTracking, "assignment.status in ('in_progress','picked_up','in_transit')", "an active driver assignment is required");
  requireText(migrationTracking, "target_latitude < -90 or target_latitude > 90", "latitude bounds validation");
  requireText(migrationTracking, "target_longitude < -180 or target_longitude > 180", "longitude bounds validation");
  requireText(migrationTracking, "public.record_tracking_point(", "location points use shared tracking engine");
  requireText(migrationTracking, "target_idempotency_key", "location point writes are idempotent");
  requireText(runtime, '"/runtime/logistics/driver/location"', "driver location write route");
});

Deno.test("Booking tracking is visible only to the customer, provider company and assigned driver", () => {
  requireText(migrationTracking, "public.read_logistics_booking_tracking", "booking tracking read RPC");
  requireText(migrationTracking, "booking_record.requester_user_id is distinct from auth.uid()", "null-safe customer participant check");
  requireText(migrationTracking, "public.can_read_logistics_company(booking_record.provider_organization_id)", "provider tenant participant check");
  requireText(migrationTracking, "assignment.driver_user_id = auth.uid()", "assigned driver participant check");
  requireText(migrationTracking, "subject_type = 'logistics_booking'", "tracking session is bound to a Logistics booking");
  requireText(migrationTracking, "point.tracking_session_id = tracking_record.id", "only this booking's points are returned");
  requireText(runtime, '"/runtime/logistics/bookings/tracking"', "customer/provider tracking read route");
});

Deno.test("Driver tracking stops when a booking closes", () => {
  requireText(migrationTracking, "public.finish_logistics_tracking_after_booking_close()", "booking close tracking trigger");
  requireText(migrationTracking, "new.status in ('delivered','settled','completed_offline')", "successful delivery closes tracking");
  requireText(migrationTracking, "new.status in ('cancelled','refunded')", "cancelled or refunded booking closes tracking");
  requireText(migrationTracking, "update public.tracking_sessions", "shared tracking session is closed");
  requireText(migrationTracking, "insert into public.tracking_session_events", "tracking closure is event recorded");
});


Deno.test("Logistics tracking uses only shared SKIMA tracking records and no separate GPS store", () => {
  requireText(migrationTracking, "references public.tracking_sessions", "booking links to the shared tracking session");
  requireText(migrationTracking, "public.start_tracking_session(", "shared tracking session creation");
  requireText(migrationTracking, "public.record_tracking_point(", "shared immutable GPS point recording");
  requireText(migrationTracking, "public.tracking_session_events", "shared tracking event history");
  requireText(migrationTracking, "booking.tracking_session_id = session.id", "tracking session bound to one logistics booking");
  requireText(migrationTracking, "public.can_read_logistics_tracking_session", "participant-scoped tracking access");
  requireText(migrationTracking, "tracking_points_select_logistics_booking_participants", "customer/provider/driver point-read policy");
  requireText(migrationTracking, "tracking_session_events_select_logistics_booking_participants", "customer/provider/driver event-read policy");
  requireText(migrationTracking, "tracking_session.status in ('completed','cancelled')", "terminal tracking sessions are not reopened");
  requireText(runtime, '"/runtime/logistics/driver/location"', "driver location write endpoint");
  requireText(runtime, '"/runtime/logistics/bookings/tracking"', "booking tracking read endpoint");
  requireNotText(migrationTracking, "create table public.logistics_tracking_points", "no duplicate Logistics GPS store");
});


Deno.test("An accepted driver may release a booking only before service start", () => {
  requireText(migrationDispatch, "public.release_logistics_driver_assignment", "driver release RPC");
  requireText(migrationDispatch, "assignment_record.driver_user_id <> actor", "only the assigned driver may release the job");
  requireText(migrationDispatch, "booking_record.status <> 'provider_accepted'", "booking must not have entered service");
  requireText(migrationDispatch, "assignment_record.status <> 'accepted'", "only an accepted pre-start assignment may be released");
  requireText(migrationDispatch, "booking_record.assigned_driver_user_id is distinct from actor", "booking must still belong to this driver");
  requireText(migrationDispatch, "set status = 'reassigned'", "assignment returns to dispatch");
  requireText(migrationDispatch, "set assigned_driver_profile_id = null", "booking clears old driver profile");
  requireText(migrationDispatch, "assigned_vehicle_id = null", "booking clears old vehicle in the same update");
  requireText(migrationDispatch, "response_reason = btrim(target_reason)", "release reason is audited");
  requireText(migrationDispatch, "logistics.booking.driver_released", "release event is appended");
  requireText(migrationDispatch, "existing_event.metadata->>'driver_user_id' is distinct from actor::text", "idempotency replay is actor-bound");
  requireText(migrationDispatch, "existing_event.metadata->>'assignment_id' is distinct from assignment_record.id::text", "idempotency replay is assignment-bound");
  requireText(migrationDispatch, "existing_event.metadata->>'reason' is distinct from btrim(target_reason)", "idempotency replay is reason-bound");
  requireNotText(migrationDispatch, "update public.logistics_bookings set status", "release does not cancel or change booking/payment status");
  requireNotText(migrationDispatch, "post_financial_transaction", "release does not create financial postings");
  requireText(runtime, '"/runtime/logistics/driver/assignment/release"', "driver pre-start release route");
});

Deno.test("Driver release preserves booking payment and makes the booking eligible for a different driver", () => {
  const releaseFunction = migrationDispatch.slice(
    migrationDispatch.indexOf("create or replace function public.release_logistics_driver_assignment"),
    migrationDispatch.indexOf("revoke all on function public.release_logistics_driver_assignment"),
  );
  requireText(releaseFunction, "for update", "release serializes against company dispatch and service start");
  requireText(releaseFunction, "booking_record.status", "booking state is checked while locked");
  requireText(migrationDriver, "set status = 'reassigned'", "company assignment replacement closes the prior assignment");
  requireText(migrationDriver, "status = 'offered'", "replacement assignment is offered to the new driver");
  requireText(migrationDriver, "where booking_id = booking_record.id", "replacement is for the same customer booking");
  requireNotText(releaseFunction, "escrow_hold_id = null", "customer escrow is preserved");
  requireNotText(releaseFunction, "payment_transaction_id = null", "customer payment record is preserved");
});


Deno.test("Driver replacement preserves the incumbent until the replacement accepts", () => {
  requireText(migrationReplacementHandoff, "'replacement_pending'", "recoverable incumbent state");
  requireText(migrationReplacementHandoff, "'replaces_assignment_id'", "replacement-to-incumbent link");
  requireText(migrationReplacementHandoff, "reassigned_after_acceptance", "incumbent retired only after acceptance");
  requireText(migrationReplacementHandoff, "replacement_declined_by", "decline recovery audit");
  requireText(migrationReplacementHandoff, "set assigned_driver_profile_id = prior_assignment.driver_profile_id", "restore incumbent after replacement decline");
  requireText(migrationReplacementHandoff, "status in ('offered','accepted','replacement_pending','in_progress','picked_up','in_transit')", "prevent double-booking incumbent during replacement");
});


Deno.test("Logistics incidents preserve custody and block financial settlement until resolved", () => {
  requireText(migrationExceptions, "create table if not exists public.logistics_booking_incidents", "dedicated incident ledger");
  requireText(migrationExceptions, "create table if not exists public.logistics_booking_disputes", "dedicated customer dispute ledger");
  requireText(migrationExceptions, "cargo_custody_status", "explicit cargo custody state");
  requireText(migrationExceptions, "'recovery_pending'", "explicit cargo recovery state");
  requireText(migrationExceptions, "'incident_hold'", "historical driver custody remains traceable");
  requireText(migrationExceptions, "set status = 'incident_hold'", "driver actions stop at incident report time");
  requireText(migrationExceptions, "'delivery_submitted','incident_hold'", "a customer-reported delivery issue also places the assignment on hold");
  requireText(migrationExceptions, "logistics_driver_one_active_booking_idx", "incident-held drivers remain unavailable for new jobs");
  requireText(migrationExceptions, "'in_transit','incident_hold'", "incident holds remain part of the driver active-booking uniqueness gate");
  requireText(migrationExceptions, "guard_logistics_settlement_on_open_exceptions", "database settlement guard");
  requireText(migrationExceptions, "dispute.status in ('open','under_review','escalated')", "active customer disputes block settlement");
  requireText(migrationExceptions, "incident.status in ('reported','investigating','recovery_required')", "unresolved delivery incidents block settlement");
  requireText(migrationExceptions, "public.refund_escrow_hold(", "refund uses shared escrow ledger");
  requireText(migrationExceptions, "hold_record.released_amount <> 0", "full refund refuses a partially released escrow");
  requireText(migrationExceptions, "payment_mode <> 'online_wallet'", "offline disputes cannot use escrow refund");
  requireText(migrationExceptions, "platform.escrow.execute", "refund resolution requires platform escrow permission");
  requireNotText(migrationExceptions, "platform.settlement.execute", "settlement-only authority cannot issue dispute refunds");
  requireText(migrationExceptions, "hold_record.hold_amount <> booking_record.total_customer_charge", "refund escrow amount must match the original customer charge");
  requireText(migrationExceptions, "logistics_booking_incidents_no_direct_insert", "incident writes are RPC-only");
  requireText(migrationExceptions, "logistics_booking_disputes_no_direct_update", "dispute updates are RPC-only");
  requireText(migrationExceptions, "cargo recovery is required only when cargo custody is with the driver or is uncertain", "recovery decisions require custody justification");
  requireText(migrationExceptions, "must enter controlled recovery, not be closed as a failed attempt", "driver-held or unaccounted cargo cannot be marked safely failed");
  requireText(migrationExceptions, "closed_by_customer_refund", "authorized refund closes linked unresolved incident records");
  requireText(migrationExceptions, "'restore_customer_confirmation'", "submitted delivery incidents have a distinct confirmation recovery outcome");
  requireText(migrationExceptions, "incident_record.booking_status_before_incident <> 'delivered'", "delivery-stage check prevents treating an already submitted delivery as active transit");
  requireText(migrationExceptions, "set status = 'delivery_submitted'", "restored delivery returns to customer confirmation rather than payout");
  requireText(migrationExceptions, "a submitted delivery must return to customer confirmation", "a submitted delivery cannot be closed as a failed delivery");
  requireText(migrationExceptions, "recovered_delivery_submitted", "a completed recovery is a separately recognized delivery submission");
  requireText(migrationExceptions, "verified recovered delivery", "dispute resolution can restore customer confirmation after verified recovery");
  requireText(migrationExceptions, "assignment_kind' = 'recovery'", "recovered delivery confirmation uses the recovery assignment record");
  const incidentResponse = migrationExceptions.slice(
    migrationExceptions.indexOf("create or replace function public.respond_logistics_booking_incident"),
    migrationExceptions.indexOf("create or replace function public.open_logistics_booking_dispute"),
  );
  const incidentReplayAt = incidentResponse.indexOf("select * into existing_event");
  const incidentStateGuardAt = incidentResponse.indexOf("if incident_record.status not in");
  if (incidentReplayAt < 0 || incidentStateGuardAt < incidentReplayAt) {
    throw new Error("incident resolution retries must return their original result before terminal-state validation");
  }
  const openDispute = migrationExceptions.slice(
    migrationExceptions.indexOf("create or replace function public.open_logistics_booking_dispute"),
    migrationExceptions.indexOf("create or replace function public.resolve_logistics_booking_dispute"),
  );
  const disputeReplayAt = openDispute.indexOf("select * into existing_dispute");
  const disputeStateGuardAt = openDispute.indexOf("if booking_record.status not in");
  if (disputeReplayAt < 0 || disputeStateGuardAt < disputeReplayAt) {
    throw new Error("customer dispute retries must return their original result before booking-state validation");
  }
  requireText(migrationExceptions, "assignment.metadata->>'assignment_kind' = 'recovery'", "only an active recovery driver may read the incident custody record");
});

Deno.test("Logistics incident and dispute routes use authenticated runtime RPCs and RLS reads", () => {
  requireText(runtime, '"/runtime/logistics/bookings/incidents"', "incident read route");
  requireText(runtime, '"/runtime/logistics/bookings/incidents/report"', "incident report route");
  requireText(runtime, '"/runtime/logistics/bookings/incidents/respond"', "company incident response route");
  requireText(runtime, '"/runtime/logistics/bookings/disputes"', "dispute read route");
  requireText(runtime, '"/runtime/logistics/bookings/disputes/open"', "customer dispute route");
  requireText(runtime, '"/runtime/logistics/bookings/disputes/resolve"', "platform dispute resolution route");
  requireText(runtime, 'supabase.rpc("report_logistics_booking_incident"', "incident report uses a database RPC");
  requireText(runtime, 'supabase.rpc("resolve_logistics_booking_dispute"', "refund resolution uses permission-gated database RPC");
  requireText(runtime, "incident:logistics_booking_incidents(booking_status_before_incident", "admin receives the linked incident's original booking state");
});


Deno.test("Failed Logistics deliveries use a controlled recovery assignment and verified custody hand-off", () => {
  requireText(migrationCargoRecovery, "assign_logistics_booking_recovery_driver", "dedicated recovery dispatch RPC");
  requireText(migrationCargoRecovery, "booking_record.status <> 'failed_delivery'", "recovery dispatch is limited to failed deliveries");
  requireText(migrationCargoRecovery, "booking_record.cargo_custody_status <> 'recovery_pending'", "recovery dispatch requires explicit cargo custody state");
  requireText(migrationCargoRecovery, "'assignment_kind','recovery'", "recovery assignment is distinguishable from the original delivery");
  requireText(migrationCargoRecovery, "start_logistics_recovery_booking", "recovery driver must explicitly start recovery");
  requireText(migrationCargoRecovery, "set cargo_custody_status = 'driver_custody'", "physical recovery pickup transfers custody to the recovery driver");
  requireText(migrationCargoRecovery, "set cargo_custody_status = 'delivered'", "delivery hand-off closes custody state");
  requireText(migrationCargoRecovery, "logistics.booking.recovery_driver_assigned", "recovery dispatch is auditable");
  requireText(migrationCargoRecovery, "logistics.booking.recovery_started", "recovery start is auditable");
  const recoveryStart = migrationCargoRecovery.slice(
    migrationCargoRecovery.indexOf("create or replace function public.start_logistics_recovery_booking"),
    migrationCargoRecovery.indexOf("create or replace function public.submit_logistics_booking_delivery"),
  );
  const recoveryReplayAt = recoveryStart.indexOf("select * into existing_event");
  const recoveryStateGuardAt = recoveryStart.indexOf("if booking_record.status <> 'failed_delivery'");
  if (recoveryReplayAt < 0 || recoveryStateGuardAt < recoveryReplayAt) {
    throw new Error("recovery-start retries must return their original result before checking the changed booking state");
  }
  const recoveryRelease = migrationCargoRecovery.slice(
    migrationCargoRecovery.indexOf("create or replace function public.release_logistics_driver_assignment"),
    migrationCargoRecovery.indexOf("revoke all on function public.release_logistics_driver_assignment"),
  );
  requireText(recoveryRelease, "release_stage := 'before_recovery_start'", "recovery drivers can return an accepted task before starting");
  requireText(recoveryRelease, "booking_record.cargo_custody_status <> 'recovery_pending'", "recovery release preserves pending cargo custody");

  requireText(migrationCargoRecovery, "release_stage := 'before_recovery_start'", "recovery drivers can return an accepted task before starting");
  requireText(migrationCargoRecovery, "a recovery driver may return only their accepted recovery assignment before recovery starts", "recovery release cannot abandon cargo after service starts");
  requireText(providerDriver, "Return recovery task to dispatch", "recovery driver has a pre-start return control");
  requireText(migrationCargoRecovery, "status = 'incident_hold'", "original driver remains held in the audit trail");
  requireText(migrationCargoRecovery, "recovered_delivery_submitted", "successful cargo recovery closes the recovery incident");
  requireText(migrationCargoRecovery, "custody_transferred_to_recovery_assignment", "the original driver is released only after a recovery pickup is confirmed");
  requireText(migrationCargoRecovery, "status = 'reassigned'", "verified recovery pickup closes the original driver assignment");
  requireText(migrationExceptions, "incident_assignment_outcome", "failed pre-pickup and delivered attempts preserve the original driver outcome");
  requireText(migrationCargoRecovery, "'in_progress','in_progress'", "recovery job event uses the active service state");
  requireText(runtime, '"/runtime/logistics/bookings/assign-recovery-driver"', "recovery dispatch runtime route");
  requireText(runtime, '"/runtime/logistics/bookings/recovery/start"', "recovery start runtime route");
});
