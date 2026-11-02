import { type SupabaseClient } from "npm:@supabase/supabase-js@2.110.9";
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

    return await handleLogisticsRequest(moduleRequest, id, supabase, routePath, url);
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
): Promise<Response> {
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
      target_legal_name: optionalString(p.legalName),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
      target_metadata: optionalRecord(p.metadata) ?? {},
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
      target_description: optionalString(p.description),
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
      .select("id,organization_id,provider_service_id,coverage_mode,geography_id,destination_geography_id,status,metadata,created_at,updated_at,service:logistics_provider_services(service_key,display_name)")
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
      target_estimated_duration_minutes: optionalInteger(p.estimatedDurationMinutes, "estimatedDurationMinutes"),
      target_terms: optionalRecord(p.terms) ?? {},
      target_expires_at: optionalString(p.expiresAt),
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
      target_estimated_duration_minutes: optionalInteger(p.estimatedDurationMinutes, "estimatedDurationMinutes"),
      target_terms: optionalRecord(p.terms) ?? {},
      target_expires_at: optionalString(p.expiresAt),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/logistics/offers/select" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const p = body.value;
    return rpcResponse(supabase.rpc("select_logistics_offer", {
      target_offer_id: requireUuid(p.offerId, "offerId"),
      target_idempotency_key: requireString(p.idempotencyKey, "idempotencyKey"),
    }), id);
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
