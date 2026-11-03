import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.9";
import { createRequestSupabaseClient, requireAuthenticatedUser } from "../_shared/supabase-auth.ts";
import { jsonResponse, optionsResponse, requestId } from "../_shared/http.ts";

type JsonRecord = Readonly<Record<string, unknown>>;
type BodyResult = { readonly value: JsonRecord } | { readonly response: Response };

class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return optionsResponse();

  const id = requestId(request);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
    }

    const authResult = await requireAuthenticatedUser(request, id);
    if ("response" in authResult) return authResult.response;

    const supabase = createRequestSupabaseClient(request, supabaseUrl, anonKey);
    const limit = await supabase.rpc("check_rate_limit", {
      target_increment: 1,
      target_policy_key: "api.gateway.authenticated.default",
      target_subject: authResult.user.id,
    });
    if (limit.error) return databaseError(limit.error, id);
    if (isRateLimited(limit.data)) {
      return jsonResponse({ ok: false, error: "rate_limited", requestId: id }, 429);
    }

    let routePath: string | null = null;
    let url = new URL(request.url);
    let moduleRequest = request;

    if (request.headers.get("x-skima-runtime-envelope") === "true") {
      let envelope: JsonRecord;
      try {
        const parsed: unknown = await request.json();
        if (!isRecord(parsed)) {
          return jsonResponse({ ok: false, error: "invalid_module_runtime_request", requestId: id }, 400);
        }
        envelope = parsed;
      } catch {
        return jsonResponse({ ok: false, error: "invalid_module_runtime_request", requestId: id }, 400);
      }

      const method = envelope.method;
      const search = envelope.search;
      const rawBody = envelope.rawBody;
      routePath = typeof envelope.routePath === "string" ? envelope.routePath : null;

      if (
        (method !== "GET" && method !== "POST")
        || typeof search !== "string"
        || search.length > 4096
        || (rawBody !== null && typeof rawBody !== "string")
      ) {
        return jsonResponse({ ok: false, error: "invalid_module_runtime_request", requestId: id }, 400);
      }

      url.search = search;
      const headers = new Headers(request.headers);
      headers.delete("x-skima-runtime-envelope");
      moduleRequest = new Request(url, {
        method,
        headers,
        body: method === "GET" ? undefined : rawBody as string | null,
      });
    } else {
      routePath = url.pathname;
    }

    if (
      !routePath ||
      !/^\/runtime\/logistics\/[a-zA-Z0-9/_-]+$/.test(routePath) ||
      routePath.includes("..")
    ) {
      return jsonResponse({ ok: false, error: "route_not_found", requestId: id }, 404);
    }

    return await handleLogisticsRequest(
      moduleRequest,
      id,
      supabase,
      routePath,
      url,
      supabaseUrl,
      authResult.user.id,
    );
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return jsonResponse({
        ok: false,
        error: "invalid_request",
        message: error.message,
        requestId: id,
      }, 400);
    }
    console.error(JSON.stringify({
      severity: "error",
      source: "logistics-runtime",
      requestId: id,
      message: error instanceof Error ? error.message : "unknown error",
    }));
    return jsonResponse({ ok: false, error: "internal_error", requestId: id }, 500);
  }
});

async function handleLogisticsRequest(
  request: Request,
  id: string,
  supabase: SupabaseClient,
  routePath: string,
  url: URL,
  supabaseUrl: string,
  requesterUserId: string,
): Promise<Response> {
  if (routePath === "/runtime/logistics/providers/search" && request.method === "GET") {
    const pickupGeographyId = requireUuid(url.searchParams.get("pickupGeographyId"), "pickupGeographyId");
    const destinationGeographyId = requireUuid(url.searchParams.get("destinationGeographyId"), "destinationGeographyId");
    const weightKg = optionalNumber(url.searchParams.get("weightKg") === null ? undefined : Number(url.searchParams.get("weightKg")), "weightKg");
    const volumeM3 = optionalNumber(url.searchParams.get("volumeM3") === null ? undefined : Number(url.searchParams.get("volumeM3")), "volumeM3");
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? 30 : requireInteger(Number(rawLimit), "limit");
    if (weightKg !== undefined && weightKg < 0) {
      throw new RequestValidationError("weightKg must not be negative.");
    }
    if (volumeM3 !== undefined && volumeM3 < 0) {
      throw new RequestValidationError("volumeM3 must not be negative.");
    }
    if (limit < 1 || limit > 100) {
      throw new RequestValidationError("limit must be between 1 and 100.");
    }
    return rpcResponse(supabase.rpc("search_logistics_providers", {
      target_pickup_geography_id: pickupGeographyId,
      target_destination_geography_id: destinationGeographyId,
      target_category_key: optionalString(url.searchParams.get("categoryKey")),
      target_service_key: optionalString(url.searchParams.get("serviceKey")),
      target_cargo_type_keys: [],
      target_vehicle_type_keys: [],
      target_capability_keys: [],
      target_weight_kg: weightKg ?? null,
      target_volume_m3: volumeM3 ?? null,
      target_search: optionalString(url.searchParams.get("search")) ?? null,
      target_limit: limit,
    }), id);
  }

  if (routePath === "/runtime/logistics/categories" && request.method === "GET") {
    return selectResponse(
      supabase.from("logistics_service_categories")
        .select("id,parent_category_id,key,display_name,description,status,sort_order,metadata")
        .order("sort_order", { ascending: true })
        .order("display_name", { ascending: true }),
      id,
    );
  }

  if (routePath === "/runtime/logistics/company" && request.method === "GET") {
    return selectResponse(
      supabase.from("logistics_provider_profiles")
        .select("id,organization_id,owner_user_id,verification_status,operational_status,public_name,about,support_contact,metadata,verified_at,verification_reason,created_at,updated_at,organization:organizations(id,slug,display_name,legal_name,status)")
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/runtime/logistics/company" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("register_logistics_company", {
      target_display_name: requireString(p.displayName, "displayName"),
      target_legal_name: optionalString(p.legalName) ?? null,
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
      target_metadata: optionalRecord(p.metadata) ?? {},
    }), id);
  }

  if (routePath === "/runtime/logistics/geographies" && request.method === "GET") {
    let query = supabase.from("geographies")
      .select("id,parent_id,canonical_name,country_code,geography_level_id,aliases,status")
      .eq("status", "active")
      .order("canonical_name", { ascending: true })
      .limit(50);
    const search = optionalString(url.searchParams.get("search"));
    const countryCode = optionalString(url.searchParams.get("countryCode"));
    const parentId = optionalUuid(url.searchParams.get("parentId"), "parentId");
    if (search) query = query.ilike("canonical_name", `%${search}%`);
    if (countryCode) query = query.eq("country_code", countryCode.toUpperCase());
    if (parentId) query = query.eq("parent_id", parentId);
    return selectResponse(query, id);
  }

  if (routePath === "/runtime/logistics/company/wallet/fund" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    const organizationId = requireUuid(p.organizationId, "organizationId");
    const customerWalletId = requireUuid(p.customerWalletId, "customerWalletId");
    const amount = optionalNumber(p.amount, "amount") ?? 0;
    const idempotencyKey = requireString(p.idempotencyKey, "idempotencyKey");
    if (amount <= 0) throw new RequestValidationError("amount must be greater than zero.");

    const companyPermission = await supabase.rpc("can_manage_logistics_company", {
      target_organization_id: organizationId,
    });
    if (companyPermission.error) return databaseError(companyPermission.error, id);
    if (companyPermission.data !== true) {
      return jsonResponse({ ok: false, error: "company_wallet_access_denied", requestId: id }, 403);
    }

    const customerWallet = await supabase.from("wallet_accounts")
      .select("id,currency_code")
      .eq("id", customerWalletId)
      .eq("wallet_type", "customer")
      .eq("owner_entity_type", "user")
      .eq("owner_entity_id", requesterUserId)
      .eq("status", "active")
      .maybeSingle();
    if (customerWallet.error) return databaseError(customerWallet.error, id);
    if (!customerWallet.data) {
      return jsonResponse({
        ok: false,
        error: "customer_wallet_required",
        message: "Choose your own active customer wallet to fund the company wallet.",
        requestId: id,
      }, 403);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 503);
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    const result = await serviceClient.rpc("fund_logistics_provider_wallet_from_customer_wallet", {
      target_organization_id: organizationId,
      target_customer_user_id: requesterUserId,
      target_customer_wallet_id: customerWalletId,
      target_amount: amount,
      target_idempotency_key: idempotencyKey,
    });
    if (result.error) return databaseError(result.error, id);
    return jsonResponse({ ok: true, data: result.data, requestId: id });
  }

  if (routePath === "/runtime/logistics/company/profile" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("update_logistics_provider_profile", {
      target_organization_id: requireUuid(p.organizationId, "organizationId"),
      target_about: optionalString(p.about),
      target_support_contact: optionalRecord(p.supportContact) ?? {},
      target_metadata: optionalRecord(p.metadata) ?? {},
    }), id);
  }

  if (routePath === "/runtime/logistics/company/status" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("set_logistics_provider_operational_status", {
      target_organization_id: requireUuid(p.organizationId, "organizationId"),
      target_status: requireString(p.status, "status"),
      target_reason: requireString(p.reason, "reason"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/company/services" && request.method === "GET") {
    let query = supabase.from("logistics_provider_services")
      .select("id,organization_id,category_id,service_key,display_name,description,pricing_mode,capability_keys,cargo_type_keys,vehicle_type_keys,maximum_weight_kg,maximum_volume_m3,availability_enabled,status,metadata,created_at,updated_at")
      .order("updated_at", { ascending: false });
    const organizationId = optionalUuid(url.searchParams.get("organizationId"), "organizationId");
    const serviceKey = optionalString(url.searchParams.get("serviceKey"));
    if (organizationId) query = query.eq("organization_id", organizationId);
    if (serviceKey) query = query.eq("service_key", serviceKey);
    return selectResponse(query, id);
  }

  if (routePath === "/runtime/logistics/company/services" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("configure_logistics_provider_service", {
      target_organization_id: requireUuid(p.organizationId, "organizationId"),
      target_category_key: requireString(p.categoryKey, "categoryKey"),
      target_service_key: requireString(p.serviceKey, "serviceKey"),
      target_display_name: requireString(p.displayName, "displayName"),
      target_description: optionalString(p.description) ?? null,
      target_pricing_mode: requireString(p.pricingMode, "pricingMode"),
      target_capability_keys: optionalStringArray(p.capabilityKeys),
      target_cargo_type_keys: optionalStringArray(p.cargoTypeKeys),
      target_vehicle_type_keys: optionalStringArray(p.vehicleTypeKeys),
      target_maximum_weight_kg: optionalNumber(p.maximumWeightKg, "maximumWeightKg"),
      target_maximum_volume_m3: optionalNumber(p.maximumVolumeM3, "maximumVolumeM3"),
      target_availability_enabled: optionalBoolean(p.availabilityEnabled) ?? true,
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
      target_metadata: optionalRecord(p.metadata) ?? {},
    }), id);
  }

  if (routePath === "/runtime/logistics/company/coverage" && request.method === "GET") {
    let query = supabase.from("logistics_provider_coverage")
      .select("id,organization_id,provider_service_id,coverage_mode,geography_id,destination_geography_id,status,metadata,created_at,updated_at,service:logistics_provider_services(service_key,display_name),geography:geographies(id,canonical_name,country_code),destination:geographies(id,canonical_name,country_code)")
      .order("created_at", { ascending: false });
    const organizationId = optionalUuid(url.searchParams.get("organizationId"), "organizationId");
    const serviceId = optionalUuid(url.searchParams.get("providerServiceId"), "providerServiceId");
    if (organizationId) query = query.eq("organization_id", organizationId);
    if (serviceId) query = query.eq("provider_service_id", serviceId);
    return selectResponse(query, id);
  }

  if (routePath === "/runtime/logistics/company/coverage" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("configure_logistics_provider_coverage", {
      target_organization_id: requireUuid(p.organizationId, "organizationId"),
      target_service_key: requireString(p.serviceKey, "serviceKey"),
      target_coverage_mode: requireString(p.coverageMode, "coverageMode"),
      target_geography_id: requireUuid(p.geographyId, "geographyId"),
      target_destination_geography_id: optionalUuid(p.destinationGeographyId, "destinationGeographyId"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
      target_metadata: optionalRecord(p.metadata) ?? {},
    }), id);
  }

  if (routePath === "/runtime/logistics/company/dispatch-resources" && request.method === "GET") {
    return rpcResponse(supabase.rpc("read_logistics_company_dispatch_resources", {
      target_organization_id: requireUuid(url.searchParams.get("organizationId"), "organizationId"),
    }), id);
  }

  if (routePath === "/runtime/logistics/jobs" && request.method === "GET") {
    let query = supabase.from("logistics_job_requests")
      .select("id,requester_user_id,category_id,service_key,title,description,pickup_geography_id,destination_geography_id,pickup_location,destination_location,cargo_snapshot,instructions,requested_pickup_at,status,published_at,expires_at,metadata,created_at,updated_at")
      .order("created_at", { ascending: false });
    const status = optionalString(url.searchParams.get("status"));
    if (status) query = query.eq("status", status);
    return selectResponse(query, id);
  }

  if (routePath === "/runtime/logistics/jobs" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("create_logistics_job", {
      target_payload: requireRecord(p.payload, "payload"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/jobs/cancel" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("cancel_logistics_job", {
      target_job_id: requireUuid(p.jobId, "jobId"),
      target_reason: requireString(p.reason, "reason"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/jobs/match" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("refresh_logistics_job_matches", {
      target_job_id: requireUuid(p.jobId, "jobId"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/opportunities" && request.method === "GET") {
    let query = supabase.from("logistics_job_opportunities")
      .select("id,job_id,organization_id,provider_service_id,status,match_reasons,job_snapshot,customer_contact_snapshot,viewed_at,created_at,updated_at")
      .order("created_at", { ascending: false });
    const status = optionalString(url.searchParams.get("status"));
    const organizationId = optionalUuid(url.searchParams.get("organizationId"), "organizationId");
    if (status) query = query.eq("status", status);
    if (organizationId) query = query.eq("organization_id", organizationId);
    return selectResponse(query, id);
  }

  if (routePath === "/runtime/logistics/offers" && request.method === "GET") {
    let query = supabase.from("logistics_offers")
      .select("id,job_id,opportunity_id,organization_id,parent_offer_id,offer_type,currency_code,delivery_price_minor,estimated_duration_minutes,terms,status,expires_at,created_by,created_at")
      .order("created_at", { ascending: true });
    const jobId = optionalUuid(url.searchParams.get("jobId"), "jobId");
    const opportunityId = optionalUuid(url.searchParams.get("opportunityId"), "opportunityId");
    if (jobId) query = query.eq("job_id", jobId);
    if (opportunityId) query = query.eq("opportunity_id", opportunityId);
    return selectResponse(query, id);
  }

  if (routePath === "/runtime/logistics/offers" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("create_logistics_offer", {
      target_opportunity_id: requireUuid(p.opportunityId, "opportunityId"),
      target_currency_code: requireString(p.currencyCode, "currencyCode"),
      target_delivery_price_minor: requireInteger(p.deliveryPriceMinor, "deliveryPriceMinor"),
      target_estimated_duration_minutes: optionalInteger(p.estimatedDurationMinutes, "estimatedDurationMinutes") ?? null,
      target_terms: optionalRecord(p.terms) ?? {},
      target_expires_at: optionalString(p.expiresAt) ?? null,
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/offers/counter" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("counter_logistics_offer", {
      target_parent_offer_id: requireUuid(p.parentOfferId, "parentOfferId"),
      target_currency_code: requireString(p.currencyCode, "currencyCode"),
      target_delivery_price_minor: requireInteger(p.deliveryPriceMinor, "deliveryPriceMinor"),
      target_estimated_duration_minutes: optionalInteger(p.estimatedDurationMinutes, "estimatedDurationMinutes") ?? null,
      target_terms: optionalRecord(p.terms) ?? {},
      target_expires_at: optionalString(p.expiresAt) ?? null,
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/offers/select" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("create_logistics_booking_for_offer", {
      target_offer_id: requireUuid(p.offerId, "offerId"),
      target_payment_mode: requireString(p.paymentMode, "paymentMode"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/bookings" && request.method === "GET") {
    let query = supabase.from("logistics_bookings")
      .select("id,job_id,offer_id,requester_user_id,provider_organization_id,assigned_driver_profile_id,assigned_driver_user_id,assigned_vehicle_id,driver_assigned_at,payment_mode,status,cargo_custody_status,delivery_exception_reason,currency_code,delivery_amount,customer_booking_fee_amount,provider_receival_fee_amount,provider_commission_amount,provider_net_amount,total_customer_charge,policy_snapshots,service_request_id,order_id,escrow_hold_id,payment_transaction_id,offline_fee_transaction_id,payment_attempt_wallet_id,payment_attempt_idempotency_key,settlement_execution_id,provider_accepted_at,service_started_at,delivery_submitted_at,delivery_submitted_by,delivery_submission_snapshot,delivery_verified_at,delivery_verified_by,delivery_verification_snapshot,created_at,updated_at,job:logistics_job_requests(title,pickup_location,destination_location),assignments:logistics_booking_driver_assignments(id,status,driver_profile_id,driver_user_id,vehicle_id,offered_at,responded_at,started_at,picked_up_at,in_transit_at,delivery_submitted_at,response_reason,driver:driver_profiles(driver_display_name,public_driver_id),vehicle:vehicles(registration_number,manufacturer,model)),offer:logistics_offers(delivery_price_minor,estimated_duration_minutes,terms,opportunity:logistics_job_opportunities(customer_contact_snapshot,job_snapshot))")
      .order("created_at", { ascending: false });
    const status = optionalString(url.searchParams.get("status"));
    const providerOrganizationId = optionalUuid(url.searchParams.get("providerOrganizationId"), "providerOrganizationId");
    if (status) query = query.eq("status", status);
    if (providerOrganizationId) query = query.eq("provider_organization_id", providerOrganizationId);
    return selectResponse(query, id);
  }

  if (routePath === "/runtime/logistics/bookings/incidents" && request.method === "GET") {
    let query = supabase.from("logistics_booking_incidents")
      .select("id,booking_id,job_id,provider_organization_id,assignment_id,reporter_user_id,reporter_role,incident_type,severity,description,cargo_custody_status,booking_status_before_incident,assignment_status_before_incident,location_snapshot,status,resolution_code,resolution_note,resolved_by,resolved_at,created_at,updated_at")
      .order("created_at", { ascending: false });
    const bookingId = optionalUuid(url.searchParams.get("bookingId"), "bookingId");
    if (bookingId) query = query.eq("booking_id", bookingId);
    return selectResponse(query, id);
  }

  if (routePath === "/runtime/logistics/bookings/incidents/report" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("report_logistics_booking_incident", {
      target_booking_id: requireUuid(p.bookingId, "bookingId"),
      target_incident_type: requireString(p.incidentType, "incidentType"),
      target_severity: requireString(p.severity, "severity"),
      target_description: requireString(p.description, "description"),
      target_cargo_custody_status: requireString(p.cargoCustodyStatus, "cargoCustodyStatus"),
      target_location_snapshot: optionalRecord(p.locationSnapshot) ?? {},
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/bookings/incidents/respond" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("respond_logistics_booking_incident", {
      target_incident_id: requireUuid(p.incidentId, "incidentId"),
      target_decision: requireString(p.decision, "decision"),
      target_resolution_note: requireString(p.resolutionNote, "resolutionNote"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/bookings/disputes" && request.method === "GET") {
    let query = supabase.from("logistics_booking_disputes")
      .select("id,booking_id,job_id,provider_organization_id,requester_user_id,incident_id,reason,details,booking_status_before_dispute,status,resolution_code,resolution_note,resolved_by,resolved_at,refund_transaction_id,metadata,created_at,updated_at,incident:logistics_booking_incidents(status,resolution_code,booking_status_before_incident,assignment_status_before_incident,cargo_custody_status)")
      .order("created_at", { ascending: false });
    const bookingId = optionalUuid(url.searchParams.get("bookingId"), "bookingId");
    if (bookingId) query = query.eq("booking_id", bookingId);
    return selectResponse(query, id);
  }

  if (routePath === "/runtime/logistics/bookings/disputes/open" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("open_logistics_booking_dispute", {
      target_booking_id: requireUuid(p.bookingId, "bookingId"),
      target_reason: requireString(p.reason, "reason"),
      target_details: requireString(p.details, "details"),
      target_incident_id: optionalUuid(p.incidentId, "incidentId") ?? null,
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/bookings/disputes/resolve" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("resolve_logistics_booking_dispute", {
      target_dispute_id: requireUuid(p.disputeId, "disputeId"),
      target_decision: requireString(p.decision, "decision"),
      target_resolution_note: requireString(p.resolutionNote, "resolutionNote"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/bookings/assign-recovery-driver" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("assign_logistics_booking_recovery_driver", {
      target_booking_id: requireUuid(p.bookingId, "bookingId"),
      target_driver_profile_id: requireUuid(p.driverProfileId, "driverProfileId"),
      target_vehicle_id: requireUuid(p.vehicleId, "vehicleId"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/bookings/assign-driver" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("assign_logistics_booking_driver", {
      target_booking_id: requireUuid(p.bookingId, "bookingId"),
      target_driver_profile_id: requireUuid(p.driverProfileId, "driverProfileId"),
      target_vehicle_id: requireUuid(p.vehicleId, "vehicleId"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/driver/profile" && request.method === "GET") {
    return rpcResponse(supabase.rpc("read_my_logistics_driver_profile"), id);
  }

  if (routePath === "/runtime/logistics/driver/bookings" && request.method === "GET") {
    return rpcResponse(supabase.rpc("read_my_logistics_driver_bookings"), id);
  }

  if (routePath === "/runtime/logistics/driver/assignment/respond" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("respond_logistics_driver_assignment", {
      target_assignment_id: requireUuid(p.assignmentId, "assignmentId"),
      target_decision: requireString(p.decision, "decision"),
      target_reason: optionalString(p.reason),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/driver/assignment/release" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("release_logistics_driver_assignment", {
      target_assignment_id: requireUuid(p.assignmentId, "assignmentId"),
      target_reason: requireString(p.reason, "reason"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/driver/location" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    const latitude = optionalNumber(p.latitude, "latitude");
    const longitude = optionalNumber(p.longitude, "longitude");
    if (latitude === undefined || longitude === undefined) {
      throw new RequestValidationError("latitude and longitude are required.");
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 503);
    }
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    return rpcResponse(serviceClient.rpc("record_logistics_driver_location", {
      target_booking_id: requireUuid(p.bookingId, "bookingId"),
      target_driver_user_id: requesterUserId,
      target_latitude: latitude,
      target_longitude: longitude,
      target_accuracy_meters: optionalNumber(p.accuracyMeters, "accuracyMeters") ?? null,
      target_speed_meters_per_second: optionalNumber(p.speedMetersPerSecond, "speedMetersPerSecond") ?? null,
      target_heading_degrees: optionalNumber(p.headingDegrees, "headingDegrees") ?? null,
      target_recorded_at: optionalString(p.recordedAt) ?? null,
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/bookings/tracking" && request.method === "GET") {
    return rpcResponse(supabase.rpc("read_logistics_booking_tracking", {
      target_booking_id: requireUuid(url.searchParams.get("bookingId"), "bookingId"),
    }), id);
  }

  if (routePath === "/runtime/logistics/driver/milestone" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("update_logistics_driver_milestone", {
      target_booking_id: requireUuid(p.bookingId, "bookingId"),
      target_milestone: requireString(p.milestone, "milestone"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
      target_metadata: optionalRecord(p.metadata) ?? {},
    }), id);
  }

  if (routePath === "/runtime/logistics/bookings/cancel" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("cancel_logistics_booking_before_payment", {
      target_booking_id: requireUuid(p.bookingId, "bookingId"),
      target_reason: requireString(p.reason, "reason"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/bookings/accept" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("accept_logistics_booking", {
      target_booking_id: requireUuid(p.bookingId, "bookingId"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/bookings/recovery/start" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("start_logistics_recovery_booking", {
      target_booking_id: requireUuid(p.bookingId, "bookingId"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/bookings/start" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("start_logistics_booking", {
      target_booking_id: requireUuid(p.bookingId, "bookingId"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/bookings/delivery/submit" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    const deliverySubmission = requireRecord(p.deliverySubmission, "deliverySubmission");
    const recipientName = requireString(
      deliverySubmission.recipientName ?? deliverySubmission.recipient_name,
      "deliverySubmission.recipientName",
    );
    const deliveryNote = optionalString(
      deliverySubmission.deliveryNote ?? deliverySubmission.delivery_note,
    );

    return rpcResponse(supabase.rpc("submit_logistics_booking_delivery", {
      target_booking_id: requireUuid(p.bookingId, "bookingId"),
      target_delivery_submission: {
        recipient_name: recipientName,
        delivery_note: deliveryNote ?? null,
      },
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/bookings/delivery/confirm" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    const bookingId = requireUuid(p.bookingId, "bookingId");
    const idempotencyKey = requireString(p.idempotencyKey, "idempotencyKey");

    const bookingResult = await supabase.from("logistics_bookings")
      .select("id,requester_user_id,status,payment_mode")
      .eq("id", bookingId)
      .eq("requester_user_id", requesterUserId)
      .maybeSingle();
    if (bookingResult.error) return databaseError(bookingResult.error, id);
    if (!bookingResult.data) {
      return jsonResponse({ ok: false, error: "logistics_booking_not_found", requestId: id }, 404);
    }
    if (["settled", "completed_offline"].includes(bookingResult.data.status)) {
      return jsonResponse({
        ok: true,
        data: { bookingId, status: bookingResult.data.status },
        requestId: id,
      });
    }
    if (bookingResult.data.status !== "delivered") {
      return jsonResponse({
        ok: false,
        error: "delivery_not_ready_for_confirmation",
        message: "The provider must submit delivery details before you can confirm completion.",
        requestId: id,
      }, 409);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 503);
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    const result = await serviceClient.rpc("confirm_logistics_booking_delivery", {
      target_booking_id: bookingId,
      target_requester_user_id: requesterUserId,
      target_idempotency_key: idempotencyKey,
    });
    if (result.error) return databaseError(result.error, id);
    return jsonResponse({ ok: true, data: result.data, requestId: id });
  }

  if (routePath === "/runtime/logistics/bookings/pay" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    const bookingId = requireUuid(p.bookingId, "bookingId");
    const walletId = requireUuid(p.walletId, "walletId");
    const paymentIdempotencyKey = requireString(p.idempotencyKey, "idempotencyKey");

    const bookingResult = await supabase.from("logistics_bookings")
      .select("id,service_request_id,requester_user_id,payment_mode,status,currency_code,total_customer_charge,escrow_hold_id")
      .eq("id", bookingId)
      .eq("requester_user_id", requesterUserId)
      .maybeSingle();
    if (bookingResult.error) return databaseError(bookingResult.error, id);
    if (!bookingResult.data) {
      return jsonResponse({ ok: false, error: "logistics_booking_not_found", requestId: id }, 404);
    }
    const booking = bookingResult.data;

    if (booking.payment_mode !== "online_wallet") {
      return jsonResponse({
        ok: false,
        error: "wrong_payment_mode",
        message: "This booking was created for offline payment.",
        requestId: id,
      }, 409);
    }
    if (booking.status === "payment_reserved" && booking.escrow_hold_id) {
      return jsonResponse({
        ok: true,
        data: {
          bookingId,
          serviceRequestId: booking.service_request_id,
          escrowHoldId: booking.escrow_hold_id,
          status: "payment_reserved",
          currencyCode: booking.currency_code,
          totalAmount: booking.total_customer_charge,
        },
        requestId: id,
      });
    }
    if (!["awaiting_payment", "payment_processing"].includes(booking.status)) {
      return jsonResponse({
        ok: false,
        error: "booking_not_payable",
        message: "This booking is not awaiting online payment.",
        requestId: id,
      }, 409);
    }

    const walletResult = await supabase.from("wallet_accounts")
      .select("id,wallet_type,owner_entity_type,owner_entity_id,currency_code,status")
      .eq("id", walletId)
      .eq("wallet_type", "customer")
      .eq("owner_entity_type", "user")
      .eq("owner_entity_id", requesterUserId)
      .eq("currency_code", booking.currency_code)
      .eq("status", "active")
      .maybeSingle();
    if (walletResult.error) return databaseError(walletResult.error, id);
    if (!walletResult.data) {
      return jsonResponse({
        ok: false,
        error: "customer_wallet_required",
        message: "Choose your own active customer wallet in the booking currency.",
        requestId: id,
      }, 403);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 503);
    }
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);

    // The database transaction locks the booking, starts/reuses its stable
    // payment attempt, funds escrow and marks the booking funded in one call.
    // Pre-payment cancellation locks the same row and cannot race this debit.
    const reservation = await serviceClient.rpc("reserve_logistics_booking_online_payment", {
      target_booking_id: booking.id,
      target_requester_user_id: requesterUserId,
      target_customer_wallet_id: walletId,
      target_client_idempotency_key: paymentIdempotencyKey,
    });
    if (reservation.error) return databaseError(reservation.error, id);
    const result = isRecord(reservation.data) ? reservation.data : {};
    const escrowHoldId = requireUuid(result.escrow_hold_id, "escrowHoldId");
    if (result.status !== "payment_reserved") {
      return jsonResponse({
        ok: false,
        error: "payment_not_reserved",
        message: "The escrow reservation did not reach its confirmed state. Retry with the same customer wallet.",
        requestId: id,
      }, 409);
    }

    return jsonResponse({
      ok: true,
      data: {
        bookingId,
        serviceRequestId: booking.service_request_id,
        escrowHoldId,
        status: "payment_reserved",
        currencyCode: booking.currency_code,
        totalAmount: booking.total_customer_charge,
      },
      requestId: id,
    });
  }
  if (routePath === "/runtime/logistics/bookings/offline/confirm" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    const bookingId = requireUuid(p.bookingId, "bookingId");
    const walletId = requireUuid(p.walletId, "walletId");
    const paymentIdempotencyKey = requireString(p.idempotencyKey, "idempotencyKey");

    const bookingResult = await supabase.from("logistics_bookings")
      .select("id,requester_user_id,payment_mode,status,currency_code,customer_booking_fee_amount,provider_receival_fee_amount,offline_fee_transaction_id")
      .eq("id", bookingId)
      .eq("requester_user_id", requesterUserId)
      .maybeSingle();
    if (bookingResult.error) return databaseError(bookingResult.error, id);
    if (!bookingResult.data) return jsonResponse({ ok: false, error: "logistics_booking_not_found", requestId: id }, 404);
    if (bookingResult.data.payment_mode !== "offline") {
      return jsonResponse({ ok: false, error: "wrong_payment_mode", message: "This booking requires online wallet payment.", requestId: id }, 409);
    }
    if (bookingResult.data.status === "offline_payment_confirmed") {
      return jsonResponse({
        ok: true,
        data: {
          bookingId,
          status: "offline_payment_confirmed",
          feeTransactionId: bookingResult.data.offline_fee_transaction_id,
          paymentMode: "offline",
        },
        requestId: id,
      });
    }
    if (bookingResult.data.status !== "awaiting_offline_confirmation") {
      return jsonResponse({ ok: false, error: "booking_not_confirmable", message: "This booking is not awaiting offline payment confirmation.", requestId: id }, 409);
    }

    const walletResult = await supabase.from("wallet_accounts")
      .select("id,wallet_type,owner_entity_type,owner_entity_id,currency_code,status")
      .eq("id", walletId)
      .eq("wallet_type", "customer")
      .eq("owner_entity_type", "user")
      .eq("owner_entity_id", requesterUserId)
      .eq("currency_code", bookingResult.data.currency_code)
      .eq("status", "active")
      .maybeSingle();
    if (walletResult.error) return databaseError(walletResult.error, id);
    if (!walletResult.data) {
      return jsonResponse({ ok: false, error: "customer_wallet_required", message: "Choose your own active customer wallet in the booking currency.", requestId: id }, 403);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 503);
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    const confirmation = await serviceClient.rpc("confirm_logistics_offline_booking_payment", {
      target_booking_id: bookingId,
      target_requester_user_id: requesterUserId,
      target_customer_wallet_id: walletId,
      target_idempotency_key: paymentIdempotencyKey,
    });
    if (confirmation.error) return databaseError(confirmation.error, id);

    const confirmationData = isRecord(confirmation.data) ? confirmation.data : {};
    return jsonResponse({
      ok: true,
      data: {
        bookingId,
        status: confirmationData.status === "offline_payment_confirmed" ? "offline_payment_confirmed" : bookingResult.data.status,
        feeTransactionId: typeof confirmationData.fee_transaction_id === "string"
          ? confirmationData.fee_transaction_id
          : null,
        paymentMode: "offline",
      },
      requestId: id,
    });
  }

  if (routePath === "/runtime/logistics/messages" && request.method === "GET") {
    let query = supabase.from("logistics_negotiation_messages")
      .select("id,job_id,opportunity_id,organization_id,offer_id,sender_user_id,message,created_at")
      .order("created_at", { ascending: true });
    const opportunityId = optionalUuid(url.searchParams.get("opportunityId"), "opportunityId");
    if (opportunityId) query = query.eq("opportunity_id", opportunityId);
    return selectResponse(query, id);
  }

  if (routePath === "/runtime/logistics/messages" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("add_logistics_negotiation_message", {
      target_opportunity_id: requireUuid(p.opportunityId, "opportunityId"),
      target_offer_id: optionalUuid(p.offerId, "offerId"),
      target_message: requireString(p.message, "message"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/admin/categories" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("upsert_logistics_service_category", {
      target_key: requireString(p.key, "key"),
      target_display_name: requireString(p.displayName, "displayName"),
      target_parent_key: optionalString(p.parentKey),
      target_description: optionalString(p.description),
      target_status: optionalString(p.status) ?? "active",
      target_sort_order: optionalInteger(p.sortOrder, "sortOrder") ?? 100,
      target_metadata: optionalRecord(p.metadata) ?? {},
    }), id);
  }

  if (routePath === "/runtime/logistics/admin/providers/verification" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("set_logistics_provider_verification", {
      target_organization_id: requireUuid(p.organizationId, "organizationId"),
      target_decision: requireString(p.decision, "decision"),
      target_reason: requireString(p.reason, "reason"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  return jsonResponse({ ok: false, error: "route_not_found", requestId: id }, 404);
}

function createServiceClient(supabaseUrl: string, serviceRoleKey: string): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function readJsonBody(request: Request, id: string): Promise<BodyResult> {
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) {
      return { response: jsonResponse({ ok: false, error: "invalid_body", requestId: id }, 400) };
    }
    return { value: parsed };
  } catch {
    return { response: jsonResponse({ ok: false, error: "invalid_json", requestId: id }, 400) };
  }
}

async function selectResponse(query: PromiseLike<{ data: unknown; error: unknown }>, id: string): Promise<Response> {
  const { data, error } = await query;
  if (error) return databaseError(error, id);
  return jsonResponse({ ok: true, data, requestId: id });
}

async function rpcResponse(query: PromiseLike<{ data: unknown; error: unknown }>, id: string): Promise<Response> {
  const { data, error } = await query;
  if (error) return databaseError(error, id);
  return jsonResponse({ ok: true, data, requestId: id });
}

function databaseError(error: unknown, id: string): Response {
  const rawMessage = isRecord(error) && typeof error.message === "string" ? error.message : "";
  const status = rawMessage.toLowerCase().includes("permission") ? 403 : 400;
  return jsonResponse({
    ok: false,
    error: "database_operation_failed",
    message: rawMessage || "The logistics operation could not be completed.",
    requestId: id,
  }, status);
}

function isRateLimited(value: unknown): boolean {
  if (typeof value === "boolean") return !value;
  if (isRecord(value)) {
    if (typeof value.allowed === "boolean") return !value.allowed;
    if (typeof value.is_allowed === "boolean") return !value.is_allowed;
    if (typeof value.limited === "boolean") return value.limited;
  }
  return false;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): JsonRecord {
  if (!isRecord(value)) throw new RequestValidationError(`${field} must be an object.`);
  return value;
}

function optionalRecord(value: unknown): JsonRecord | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new RequestValidationError("JSON metadata must be an object.");
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 4096) {
    throw new RequestValidationError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 4096) {
    throw new RequestValidationError("Optional string field has an invalid value.");
  }
  return value.trim();
}

function requireUuid(value: unknown, field: string): string {
  const parsed = requireString(value, field);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed)) {
    throw new RequestValidationError(`${field} must be a UUID.`);
  }
  return parsed;
}

function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireUuid(value, field);
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RequestValidationError(`${field} must be a safe integer.`);
  }
  return value;
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requireInteger(value, field);
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RequestValidationError(`${field} must be a finite number.`);
  }
  return value;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new RequestValidationError("Optional boolean field is invalid.");
  return value;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== "string" || item.length > 120)) {
    throw new RequestValidationError("String array is invalid.");
  }
  return value.map((item) => (item as string).trim()).filter(Boolean);
}
