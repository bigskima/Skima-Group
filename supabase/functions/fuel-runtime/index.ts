import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.110.9";
import { createRequestSupabaseClient, requireAuthenticatedUser } from "../_shared/supabase-auth.ts";
import { jsonResponse, optionsResponse, requestId } from "../_shared/http.ts";

type JsonBodyResult =
  | { readonly value: Readonly<Record<string, unknown>> }
  | { readonly response: Response };

interface SelectQuery {
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

class RequestValidationError extends Error {
  override readonly name = "RequestValidationError";
}

Deno.serve(async (request: Request): Promise<Response> => {
  const id = requestId(request);
  try {
    if (request.method === "OPTIONS") return optionsResponse();

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
    }

    const authResult = await requireAuthenticatedUser(request, id);
    if ("response" in authResult) return authResult.response;

    const supabase = createRequestSupabaseClient(request, supabaseUrl, anonKey);
    const rateLimitResult = await supabase.rpc("check_rate_limit", {
      target_increment: 1,
      target_policy_key: "api.gateway.authenticated.default",
      target_subject: authResult.user.id,
    });
    if (rateLimitResult.error) return databaseError(rateLimitResult.error, id);
    if (isRateLimited(rateLimitResult.data)) {
      return jsonResponse({ ok: false, error: "rate_limited", requestId: id }, 429);
    }

    const url = new URL(request.url);
    const routePath = request.headers.get("x-skima-runtime-path");
    if (!routePath || !routePath.startsWith("/runtime/fuel/") || routePath.includes("..")) {
      return jsonResponse({ ok: false, error: "route_not_found", requestId: id }, 404);
    }

    return await handleFuelRuntimeRequest(
      request,
      id,
      supabase,
      supabaseUrl,
      authResult.user,
      routePath,
      url,
    );
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return jsonResponse({ ok: false, error: "invalid_request", message: error.message, requestId: id }, 400);
    }
    console.error(JSON.stringify({
      severity: "error",
      source: "fuel-runtime",
      requestId: id,
      message: error instanceof Error ? error.message : "unknown error",
    }));
    return jsonResponse({ ok: false, error: "internal_error", requestId: id }, 500);
  }
});

async function handleFuelRuntimeRequest(
  request: Request,
  id: string,
  supabase: SupabaseClient,
  supabaseUrl: string,
  user: User,
  routePath: string,
  url: URL,
): Promise<Response> {
  const authResult = { user };
  if (routePath === "/runtime/fuel/products") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("fuel_products")
          .select("id,key,short_code,display_name,unit_code,quantity_precision,status,metadata,created_at,updated_at")
          .order("key", { ascending: true }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);
      if ("response" in body) return body.response;
      const payload = body.value;
      if (Array.isArray(payload.productKeys)) {
        const productKeys = payload.productKeys.map((value, index) =>
          requireString(value, `productKeys[${index}]`)
        );
        if (
          productKeys.length !== 3
          || new Set(productKeys).size !== 3
          || !["fuel.pms", "fuel.ago", "fuel.dpk"].every((key) => productKeys.includes(key))
        ) {
          throw new RequestValidationError("A global product toggle must include PMS, AGO and DPK exactly once.");
        }
        return rpcResponse(
          supabase.rpc("set_fuel_products_status", {
            target_product_keys: productKeys,
            target_status: requireString(payload.status, "status"),
            target_reason: optionalString(payload.reason),
            target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          }),
          id,
        );
      }
      return rpcResponse(
        supabase.rpc("set_fuel_product_status", {
          target_product_key: requireString(payload.productKey, "productKey"),
          target_status: requireString(payload.status, "status"),
          target_reason: optionalString(payload.reason),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/fuel/offers") {
    if (request.method === "GET") {
      let query = supabase
        .from("fuel_branch_product_offers")
        .select("id,organization_id,branch_id,branch:organization_branches(id,key,display_name,address,geo_location),product_key,currency_code,catalog_item_id,catalog_variant_id,price_per_litre,minimum_litres,maximum_litres,container_purchase_amount,container_rental_amount,refundable_deposit_amount,driver_delivery_fee_amount,platform_fee_amount,tax_rate_percent,fulfillment_modes,status,effective_from,effective_until,metadata,created_at,updated_at")
        .order("updated_at", { ascending: false });
      const branchId = optionalUuid(url.searchParams.get("branchId"), "branchId");
      const productKey = optionalString(url.searchParams.get("productKey"));
      if (branchId) query = query.eq("branch_id", branchId);
      if (productKey) query = query.eq("product_key", productKey);
      return selectRecords(query, id);
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);
      if ("response" in body) return body.response;
      const payload = body.value;
      return rpcResponse(
        supabase.rpc("configure_fuel_branch_product_offer", {
          target_branch_id: requireUuid(payload.branchId, "branchId"),
          target_product_key: requireString(payload.productKey, "productKey"),
          target_currency_code: optionalString(payload.currencyCode) ?? "NGN",
          target_price_per_litre: requireNumber(payload.pricePerLitre, "pricePerLitre"),
          target_minimum_litres: requireNumber(payload.minimumLitres, "minimumLitres"),
          target_maximum_litres: requireNumber(payload.maximumLitres, "maximumLitres"),
          target_container_purchase_amount: optionalNumber(payload.containerPurchaseAmount, "containerPurchaseAmount") ?? 0,
          target_container_rental_amount: optionalNumber(payload.containerRentalAmount, "containerRentalAmount") ?? 0,
          target_refundable_deposit_amount: optionalNumber(payload.refundableDepositAmount, "refundableDepositAmount") ?? 0,
          target_driver_delivery_fee_amount: optionalNumber(payload.driverDeliveryFeeAmount, "driverDeliveryFeeAmount") ?? 0,
          target_platform_fee_amount: optionalNumber(payload.platformFeeAmount, "platformFeeAmount") ?? 0,
          target_tax_rate_percent: optionalNumber(payload.taxRatePercent, "taxRatePercent") ?? 0,
          target_fulfillment_modes: optionalStringArray(payload.fulfillmentModes) ?? ["station_managed", "independent_driver", "skima_managed"],
          target_status: optionalString(payload.status) ?? "draft",
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/fuel/storage") {
    if (request.method === "GET") {
      let query = supabase
        .from("fuel_station_storage_units")
        .select("id,organization_id,branch_id,product_key,key,display_name,capacity_litres,safety_reserve_litres,physical_stock_litres,reserved_stock_litres,status,metadata,created_at,updated_at")
        .order("created_at", { ascending: false });
      const branchId = optionalUuid(url.searchParams.get("branchId"), "branchId");
      if (branchId) query = query.eq("branch_id", branchId);
      return selectRecords(query, id);
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);
      if ("response" in body) return body.response;
      const payload = body.value;
      return rpcResponse(
        supabase.rpc("configure_fuel_station_storage_unit", {
          target_organization_id: requireUuid(payload.organizationId, "organizationId"),
          target_branch_id: requireUuid(payload.branchId, "branchId"),
          target_product_key: requireString(payload.productKey, "productKey"),
          target_storage_key: requireString(payload.storageKey, "storageKey"),
          target_display_name: requireString(payload.displayName, "displayName"),
          target_capacity_litres: requireNumber(payload.capacityLitres, "capacityLitres"),
          target_safety_reserve_litres: optionalNumber(payload.safetyReserveLitres, "safetyReserveLitres") ?? 0,
          target_status: optionalString(payload.status) ?? "active",
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/fuel/storage/receive" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("receive_fuel_stock", {
        target_storage_unit_id: requireUuid(payload.storageUnitId, "storageUnitId"),
        target_quantity_litres: requireNumber(payload.quantityLitres, "quantityLitres"),
        target_reason: requireString(payload.reason, "reason"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/fuel/storage/adjust" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("adjust_fuel_stock", {
        target_storage_unit_id: requireUuid(payload.storageUnitId, "storageUnitId"),
        target_quantity_delta_litres: requireNumber(payload.quantityDeltaLitres, "quantityDeltaLitres"),
        target_reason: requireString(payload.reason, "reason"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/fuel/container-types") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("fuel_container_types")
          .select("id,key,display_name,nominal_capacity_litres,supported_product_keys,status,metadata,created_at,updated_at")
          .order("nominal_capacity_litres", { ascending: true }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);
      if ("response" in body) return body.response;
      const payload = body.value;
      return rpcResponse(
        supabase.rpc("configure_fuel_container_type", {
          target_key: requireString(payload.key, "key"),
          target_display_name: requireString(payload.displayName, "displayName"),
          target_nominal_capacity_litres: requireNumber(payload.nominalCapacityLitres, "nominalCapacityLitres"),
          target_supported_product_keys: requireStringArray(payload.supportedProductKeys, "supportedProductKeys"),
          target_status: optionalString(payload.status) ?? "draft",
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/fuel/containers") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("fuel_container_profiles")
          .select("id,asset_id,asset:assets(organization_id,owner_user_id),container_type_id,serial_number,ownership_mode,capacity_litres,status,last_inspected_at,last_inspection_result,metadata,created_at,updated_at")
          .order("created_at", { ascending: false }),
        id,
      );
    }
  }

  if (routePath === "/runtime/fuel/containers/register" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("register_fuel_container_asset", {
        target_serial_number: requireString(payload.serialNumber, "serialNumber"),
        target_container_type_id: requireUuid(payload.containerTypeId, "containerTypeId"),
        target_capacity_litres: optionalNumber(payload.capacityLitres, "capacityLitres"),
        target_organization_id: optionalUuid(payload.organizationId, "organizationId"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/fuel/container-allocations" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("fuel_container_allocations")
        .select("id,container_profile_id,order_id,order_line_item_id,product_key,station_branch_id,customer_user_id,allocated_litres,allocation_mode,status,purchase_amount,rental_amount,refundable_deposit_amount,currency_code,reserved_at,delivered_at,returned_at,received_at_station_at,closed_at,metadata,created_at,updated_at")
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/runtime/fuel/orders" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("create_fuel_order_with_quote", {
        target_branch_id: requireUuid(payload.branchId, "branchId"),
        target_product_key: requireString(payload.productKey, "productKey"),
        target_requested_litres: requireNumber(payload.requestedLitres, "requestedLitres"),
        target_container_mode: requireString(payload.containerMode, "containerMode"),
        target_container_type_key: requireString(payload.containerTypeKey, "containerTypeKey"),
        target_fulfillment_mode: requireString(payload.fulfillmentMode, "fulfillmentMode"),
        target_currency_code: optionalString(payload.currencyCode) ?? "NGN",
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_delivery_location_id: optionalUuid(payload.deliveryLocationId, "deliveryLocationId"),
        target_delivery_instructions: optionalString(payload.deliveryInstructions),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/fuel/orders/pay" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    const orderId = requireUuid(payload.orderId, "orderId");
    const walletId = requireUuid(payload.walletId, "walletId");
    const paymentIdempotencyKey = requireString(payload.idempotencyKey, "idempotencyKey");

    const orderResult = await supabase
      .from("order_records")
      .select("id,service_request_id,module_id,requester_user_id,currency_code")
      .eq("id", orderId)
      .eq("requester_user_id", authResult.user.id)
      .maybeSingle();
    if (orderResult.error) return databaseError(orderResult.error, id);
    if (!orderResult.data) return jsonResponse({ ok: false, error: "fuel_order_not_found", requestId: id }, 404);

    const moduleResult = await supabase
      .from("business_modules")
      .select("key")
      .eq("id", orderResult.data.module_id)
      .maybeSingle();
    if (moduleResult.error) return databaseError(moduleResult.error, id);
    if (moduleResult.data?.key !== "fuel") return jsonResponse({ ok: false, error: "fuel_order_not_found", requestId: id }, 404);

    const quoteResult = await supabase
      .from("fuel_order_commercial_snapshots")
      .select("id,generic_price_quote_id,currency_code,grand_total,status,valid_until")
      .eq("order_id", orderId)
      .eq("status", "accepted")
      .maybeSingle();
    if (quoteResult.error) return databaseError(quoteResult.error, id);
    if (!quoteResult.data || !quoteResult.data.generic_price_quote_id ||
        (quoteResult.data.valid_until && Date.parse(quoteResult.data.valid_until) <= Date.now())) {
      return jsonResponse({ ok: false, error: "accepted_fuel_quote_required", message: "Accept a current Fuel quote before payment.", requestId: id }, 409);
    }

    const walletResult = await supabase
      .from("wallet_accounts")
      .select("id,wallet_type,owner_entity_type,owner_entity_id,currency_code,status")
      .eq("id", walletId)
      .eq("wallet_type", "customer")
      .eq("owner_entity_type", "user")
      .eq("owner_entity_id", authResult.user.id)
      .eq("currency_code", orderResult.data.currency_code)
      .eq("status", "active")
      .maybeSingle();
    if (walletResult.error) return databaseError(walletResult.error, id);
    if (!walletResult.data) return jsonResponse({ ok: false, error: "customer_wallet_required", message: "Choose your own active wallet in the Fuel order currency.", requestId: id }, 403);

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 503);
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    const fundingResult = await serviceClient.rpc("fund_order_from_wallet", {
      target_order_id: orderId,
      target_customer_wallet_id: walletId,
      target_escrow_wallet_id: null,
      target_source: "platform.fuel.orders",
      target_idempotency_key: paymentIdempotencyKey,
      target_metadata: {
        module_key: "fuel",
        fuel_commercial_snapshot_id: quoteResult.data.id,
        generic_price_quote_id: quoteResult.data.generic_price_quote_id,
        payment_channel: "customer_wallet",
      },
    });
    if (fundingResult.error) return databaseError(fundingResult.error, id);
    return jsonResponse({
      ok: true,
      data: {
        orderId,
        serviceRequestId: orderResult.data.service_request_id,
        escrowHoldId: fundingResult.data,
        status: "payment_reserved",
        currencyCode: quoteResult.data.currency_code,
        totalAmount: quoteResult.data.grand_total,
      },
      requestId: id,
    });
  }

  if (routePath === "/runtime/fuel/driver-qualifications") {
    if (request.method === "GET") {
      let query = supabase
        .from("fuel_driver_product_qualifications")
        .select("id,driver_user_id,driver_profile_id,station_managed_driver_id,branch_id,vehicle_id,product_key,maximum_load_litres,status,approved_by,approved_at,valid_until,metadata,created_at,updated_at")
        .order("updated_at", { ascending: false });
      const branchId = optionalUuid(url.searchParams.get("branchId"), "branchId");
      const driverUserId = optionalUuid(url.searchParams.get("driverUserId"), "driverUserId");
      const productKey = optionalString(url.searchParams.get("productKey"));
      if (branchId) query = query.eq("branch_id", branchId);
      if (driverUserId) query = query.eq("driver_user_id", driverUserId);
      if (productKey) query = query.eq("product_key", productKey);
      return selectRecords(query, id);
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);
      if ("response" in body) return body.response;
      const payload = body.value;
      return rpcResponse(
        supabase.rpc("configure_fuel_driver_product_qualification", {
          target_driver_user_id: requireUuid(payload.driverUserId, "driverUserId"),
          target_driver_profile_id: optionalUuid(payload.driverProfileId, "driverProfileId"),
          target_station_managed_driver_id: optionalUuid(payload.stationManagedDriverId, "stationManagedDriverId"),
          target_branch_id: optionalUuid(payload.branchId, "branchId"),
          target_vehicle_id: requireUuid(payload.vehicleId, "vehicleId"),
          target_product_key: requireString(payload.productKey, "productKey"),
          target_maximum_load_litres: requireNumber(payload.maximumLoadLitres, "maximumLoadLitres"),
          target_status: requireString(payload.status, "status"),
          target_valid_until: optionalString(payload.validUntil),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/fuel/orders/operations" && request.method === "GET") {
    let query = supabase
      .from("fuel_order_operations")
      .select("order_id,service_request_id,product_key,station_branch_id,customer_user_id,requested_litres,filled_litres,delivered_litres,container_mode,container_count,container_type_id,fulfillment_mode,stage_key,exception_reason,station_accepted_at,filled_at,driver_assigned_at,station_handover_at,delivered_at,return_received_at,completed_at,settlement_execution_id,settlement_transaction_id,settlement_statement_id,settled_at,deposit_refund_amount,deposit_refunded_at,metadata,created_at,updated_at,order:order_records(currency_code)")
      .order("created_at", { ascending: false });
    const branchId = optionalUuid(url.searchParams.get("branchId"), "branchId");
    const orderId = optionalUuid(url.searchParams.get("orderId"), "orderId");
    const scope = optionalString(url.searchParams.get("scope"));
    if (scope === "customer") query = query.eq("customer_user_id", authResult.user.id);
    if (scope === "driver") {
      const assigned = await supabase
        .from("order_assignments")
        .select("order_id,participant_role,entity_type,entity_id,status")
        .eq("participant_role", "driver")
        .eq("status", "active");
      if (assigned.error) return databaseError(assigned.error, id);
      const resolvedOrderIds = await resolveFuelAssignedOrderIdsForUser(supabase, assigned.data ?? [], authResult.user.id);
      if (resolvedOrderIds.error) return databaseError(resolvedOrderIds.error, id);
      if (resolvedOrderIds.orderIds.length === 0) return jsonResponse({ ok: true, data: [], requestId: id });
      query = query.in("order_id", resolvedOrderIds.orderIds);
    }
    if (branchId) query = query.eq("station_branch_id", branchId);
    if (orderId) query = query.eq("order_id", orderId);
    return selectRecords(query, id);
  }

  if (routePath === "/runtime/fuel/orders/events" && request.method === "GET") {
    const orderId = optionalUuid(url.searchParams.get("orderId"), "orderId");
    let query = supabase
      .from("fuel_order_operation_events")
      .select("id,order_id,service_request_id,product_key,from_stage,to_stage,event_type_key,reason,actor_user_id,metadata,occurred_at,created_at")
      .order("occurred_at", { ascending: true });
    if (orderId) query = query.eq("order_id", orderId);
    return selectRecords(query, id);
  }

  if (routePath === "/runtime/fuel/quotes" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("create_fuel_commercial_quote", {
        target_order_id: requireUuid(payload.orderId, "orderId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/fuel/orders/stock/reserve" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    const orderId = requireUuid(payload.orderId, "orderId");
    const access = await resolveFuelOrderBranchAccess(supabase, orderId, "business.fuel.orders.process");
    if (access.error) return databaseError(access.error, id);
    if (!access.order || access.moduleKey !== "fuel") {
      return jsonResponse({ ok: false, error: "fuel_order_not_found", requestId: id }, 404);
    }
    if (!access.allowed) {
      return jsonResponse({ ok: false, error: "forbidden", message: "Fuel order processing permission is required for this station branch.", requestId: id }, 403);
    }
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 503);
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    return rpcResponse(
      serviceClient.rpc("reserve_fuel_stock", {
        target_order_id: orderId,
        target_storage_unit_id: requireUuid(payload.storageUnitId, "storageUnitId"),
        target_quantity_litres: requireNumber(payload.quantityLitres, "quantityLitres"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_expires_at: optionalString(payload.expiresAt),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/fuel/orders/stock/reserve-for-order" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    const orderId = requireUuid(payload.orderId, "orderId");
    const access = await resolveFuelOrderBranchAccess(supabase, orderId, "business.fuel.orders.process");
    if (access.error) return databaseError(access.error, id);
    if (!access.order || access.moduleKey !== "fuel") return jsonResponse({ ok: false, error: "fuel_order_not_found", requestId: id }, 404);
    if (!access.allowed) return jsonResponse({ ok: false, error: "forbidden", requestId: id }, 403);
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 503);
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    return rpcResponse(
      serviceClient.rpc("reserve_fuel_order_stock", {
        target_order_id: orderId,
        target_requested_litres: requireNumber(payload.requestedLitres, "requestedLitres"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_expires_at: optionalString(payload.expiresAt),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/fuel/orders/stock/reservations" && request.method === "GET") {
    const orderId = optionalUuid(url.searchParams.get("orderId"), "orderId");
    if (!orderId) throw new RequestValidationError("orderId is required.");
    const access = await resolveFuelOrderBranchAccess(supabase, orderId, "business.fuel.orders.read");
    if (access.error) return databaseError(access.error, id);
    const isCustomer = access.order?.requester_user_id === authResult.user.id;
    if (!access.order || access.moduleKey !== "fuel" || (!access.allowed && !isCustomer)) {
      return jsonResponse({ ok: false, error: "fuel_order_not_found", requestId: id }, 404);
    }
    return selectRecords(
      supabase
        .from("fuel_order_stock_reservations")
        .select("id,batch_id,order_id,order_line_item_id,storage_unit_id,product_key,requested_litres,reserved_litres,consumed_litres,status,expires_at,consumed_at,released_at,release_reason,created_at,updated_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true }),
      id,
    );
  }

  if (routePath === "/runtime/fuel/orders/stock/batches" && request.method === "GET") {
    const orderId = optionalUuid(url.searchParams.get("orderId"), "orderId");
    if (!orderId) throw new RequestValidationError("orderId is required.");
    const access = await resolveFuelOrderBranchAccess(supabase, orderId, "business.fuel.orders.read");
    if (access.error) return databaseError(access.error, id);
    const isCustomer = access.order?.requester_user_id === authResult.user.id;
    if (!access.order || access.moduleKey !== "fuel" || (!access.allowed && !isCustomer)) {
      return jsonResponse({ ok: false, error: "fuel_order_not_found", requestId: id }, 404);
    }
    return selectRecords(
      supabase
        .from("fuel_order_stock_reservation_batches")
        .select("id,order_id,service_request_id,branch_id,product_key,requested_litres,reserved_litres,status,source,idempotency_key,metadata,created_at,updated_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true }),
      id,
    );
  }

  if (routePath === "/runtime/fuel/orders/assign-driver" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    const orderId = requireUuid(payload.orderId, "orderId");
    const driverEntityId = requireUuid(payload.driverEntityId, "driverEntityId");
    const vehicleId = requireUuid(payload.vehicleId, "vehicleId");
    const access = await resolveFuelOrderBranchAccess(supabase, orderId, "business.fuel.orders.process");
    if (access.error) return databaseError(access.error, id);
    if (!access.order || access.moduleKey !== "fuel") return jsonResponse({ ok: false, error: "fuel_order_not_found", requestId: id }, 404);
    if (!access.allowed) return jsonResponse({ ok: false, error: "forbidden", requestId: id }, 403);

    const operation = await supabase
      .from("fuel_order_operations")
      .select("order_id,product_key,requested_litres,station_branch_id,fulfillment_mode,stage_key")
      .eq("order_id", orderId)
      .maybeSingle();
    if (operation.error) return databaseError(operation.error, id);
    if (!operation.data || operation.data.stage_key !== "ready_for_driver") {
      return jsonResponse({ ok: false, error: "fuel_order_not_ready_for_driver", requestId: id }, 409);
    }
    const operationData = operation.data;

    const qualificationQuery = supabase
      .from("fuel_driver_product_qualifications")
      .select("id,driver_user_id,driver_profile_id,station_managed_driver_id,branch_id,vehicle_id,product_key,maximum_load_litres,status,valid_until")
      .eq("vehicle_id", vehicleId)
      .eq("product_key", operationData.product_key)
      .eq("status", "approved")
      .gte("maximum_load_litres", operationData.requested_litres)
      .or(`branch_id.is.null,branch_id.eq.${operationData.station_branch_id}`)
      .or(`valid_until.is.null,valid_until.gt.${new Date().toISOString()}`);
    const qualificationResult = await qualificationQuery;
    if (qualificationResult.error) return databaseError(qualificationResult.error, id);
    const qualification = (qualificationResult.data ?? []).find((record) =>
      operationData.fulfillment_mode === "station_managed"
        ? record.station_managed_driver_id === driverEntityId && record.driver_profile_id === null
        : record.driver_profile_id === driverEntityId && record.station_managed_driver_id === null
    ) ?? null;
    if (!qualification) {
      return jsonResponse({ ok: false, error: "fuel_driver_vehicle_not_qualified", message: "This driver and vehicle are not approved for this product, branch and load.", requestId: id }, 409);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 503);
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    return rpcResponse(
      serviceClient.rpc("assign_fuel_order_driver", {
        target_order_id: orderId,
        target_driver_entity_type: "driver",
        target_driver_entity_id: driverEntityId,
        target_vehicle_id: vehicleId,
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/fuel/orders/stock/release" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    const reservationId = requireUuid(payload.reservationId, "reservationId");
    const reservation = await supabase
      .from("fuel_order_stock_reservations")
      .select("id,order_id")
      .eq("id", reservationId)
      .maybeSingle();
    if (reservation.error) return databaseError(reservation.error, id);
    if (!reservation.data) return jsonResponse({ ok: false, error: "reservation_not_found", requestId: id }, 404);
    const access = await resolveFuelOrderBranchAccess(supabase, reservation.data.order_id, "business.fuel.orders.process");
    if (access.error) return databaseError(access.error, id);
    if (!access.order || access.moduleKey !== "fuel") return jsonResponse({ ok: false, error: "fuel_order_not_found", requestId: id }, 404);
    if (!access.allowed) return jsonResponse({ ok: false, error: "forbidden", requestId: id }, 403);
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 503);
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    return rpcResponse(
      serviceClient.rpc("release_fuel_stock_reservation", {
        target_reservation_id: reservationId,
        target_reason: requireString(payload.reason, "reason"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/fuel/orders/stock/consume" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    const reservationId = requireUuid(payload.reservationId, "reservationId");
    const reservation = await supabase
      .from("fuel_order_stock_reservations")
      .select("id,order_id")
      .eq("id", reservationId)
      .maybeSingle();
    if (reservation.error) return databaseError(reservation.error, id);
    if (!reservation.data) return jsonResponse({ ok: false, error: "reservation_not_found", requestId: id }, 404);
    const access = await resolveFuelOrderBranchAccess(supabase, reservation.data.order_id, "business.fuel.orders.process");
    if (access.error) return databaseError(access.error, id);
    if (!access.order || access.moduleKey !== "fuel") return jsonResponse({ ok: false, error: "fuel_order_not_found", requestId: id }, 404);
    if (!access.allowed) return jsonResponse({ ok: false, error: "forbidden", requestId: id }, 403);
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 503);
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    return rpcResponse(
      serviceClient.rpc("consume_fuel_stock_reservation", {
        target_reservation_id: reservationId,
        target_consumed_litres: requireNumber(payload.consumedLitres, "consumedLitres"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/fuel/orders/stage" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    const orderId = requireUuid(payload.orderId, "orderId");
    const stageKey = requireString(payload.stageKey, "stageKey");
    const access = await resolveFuelOrderBranchAccess(supabase, orderId, "business.fuel.orders.process");
    if (access.error) return databaseError(access.error, id);
    if (!access.order || access.moduleKey !== "fuel") return jsonResponse({ ok: false, error: "fuel_order_not_found", requestId: id }, 404);

    const driverStages = new Set(["out_for_delivery", "delivered", "return_due", "returned_to_driver", "received_at_station"]);
    const customerStages = new Set(["completed"]);
    let allowed = access.allowed;
    if (driverStages.has(stageKey)) {
      const resolvedDriver = await resolveFuelAssignedDriver(supabase, orderId);
      if (resolvedDriver.error) return databaseError(resolvedDriver.error, id);
      allowed = Boolean(resolvedDriver.assignment && resolvedDriver.userId === authResult.user.id);
    } else if (customerStages.has(stageKey)) {
      allowed = access.order.requester_user_id === authResult.user.id;
    }
    if (!allowed) return jsonResponse({ ok: false, error: "forbidden", message: "The current user is not authorized to record this Fuel order stage.", requestId: id }, 403);

    const stageMetadata: Record<string, unknown> = { ...(optionalRecord(payload.metadata) ?? {}) };
    if (stageKey === "delivered") {
      const deliveredLitres = requireNumber(payload.deliveredLitres ?? stageMetadata.delivered_litres, "deliveredLitres");
      if (deliveredLitres <= 0) throw new RequestValidationError("deliveredLitres must be greater than zero.");
      stageMetadata.delivered_litres = deliveredLitres;
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 503);
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    return rpcResponse(
      serviceClient.rpc("record_fuel_order_stage", {
        target_order_id: orderId,
        target_stage_key: stageKey,
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_reason: optionalString(payload.reason),
        target_metadata: stageMetadata,
      }),
      id,
    );
  }

  if (routePath === "/runtime/fuel/containers/allocate" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    const orderId = requireUuid(payload.orderId, "orderId");
    const access = await resolveFuelOrderBranchAccess(supabase, orderId, "business.fuel.orders.process");
    if (access.error) return databaseError(access.error, id);
    if (!access.order || access.moduleKey !== "fuel" || !access.allowed) return jsonResponse({ ok: false, error: "forbidden", requestId: id }, 403);
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 503);
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    return rpcResponse(
      serviceClient.rpc("reserve_fuel_order_container", {
        target_order_id: orderId,
        target_container_profile_id: requireUuid(payload.containerProfileId, "containerProfileId"),
        target_allocated_litres: requireNumber(payload.allocatedLitres, "allocatedLitres"),
        target_allocation_mode: requireString(payload.allocationMode, "allocationMode"),
        target_purchase_amount: optionalNumber(payload.purchaseAmount, "purchaseAmount") ?? 0,
        target_rental_amount: optionalNumber(payload.rentalAmount, "rentalAmount") ?? 0,
        target_refundable_deposit_amount: optionalNumber(payload.refundableDepositAmount, "refundableDepositAmount") ?? 0,
        target_currency_code: optionalString(payload.currencyCode) ?? "NGN",
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/fuel/containers/handover" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    const allocationId = requireUuid(payload.allocationId, "allocationId");
    const allocation = await supabase
      .from("fuel_container_allocations")
      .select("id,order_id,station_branch_id,customer_user_id")
      .eq("id", allocationId)
      .maybeSingle();
    if (allocation.error) return databaseError(allocation.error, id);
    if (!allocation.data) return jsonResponse({ ok: false, error: "allocation_not_found", requestId: id }, 404);

    const access = await resolveFuelOrderBranchAccess(supabase, allocation.data.order_id, "business.fuel.orders.process");
    if (access.error) return databaseError(access.error, id);
    if (!access.order || access.moduleKey !== "fuel") return jsonResponse({ ok: false, error: "fuel_order_not_found", requestId: id }, 404);

    const eventKey = requireString(payload.eventKey, "eventKey");
    const resolvedDriver = await resolveFuelAssignedDriver(supabase, allocation.data.order_id);
    if (resolvedDriver.error) return databaseError(resolvedDriver.error, id);
    if (!resolvedDriver.assignment) return jsonResponse({ ok: false, error: "driver_not_assigned", requestId: id }, 409);
    const assignedDriverEntityId = stringOrNull(resolvedDriver.assignment.entity_id);
    if (!assignedDriverEntityId) return jsonResponse({ ok: false, error: "driver_identity_invalid", requestId: id }, 409);
    const isAssignedDriver = resolvedDriver.userId === authResult.user.id;
    const isStationOperator = access.allowed && allocation.data.station_branch_id === access.order.branch_id;

    let fromType = "";
    let fromId = "";
    let toType = "";
    let toId = "";
    if (eventKey === "station_filled") {
      if (!isStationOperator) return jsonResponse({ ok: false, error: "forbidden", requestId: id }, 403);
      fromType = "station"; fromId = allocation.data.station_branch_id;
      toType = "station"; toId = allocation.data.station_branch_id;
    } else if (eventKey === "handed_to_driver") {
      if (!isStationOperator) return jsonResponse({ ok: false, error: "forbidden", requestId: id }, 403);
      fromType = "station"; fromId = allocation.data.station_branch_id;
      toType = "driver"; toId = assignedDriverEntityId;
    } else if (eventKey === "delivered_to_customer") {
      if (!isAssignedDriver) return jsonResponse({ ok: false, error: "forbidden", requestId: id }, 403);
      fromType = "driver"; fromId = assignedDriverEntityId;
      toType = "customer"; toId = allocation.data.customer_user_id;
    } else if (eventKey === "returned_to_driver") {
      if (!isAssignedDriver) return jsonResponse({ ok: false, error: "forbidden", requestId: id }, 403);
      fromType = "customer"; fromId = allocation.data.customer_user_id;
      toType = "driver"; toId = assignedDriverEntityId;
    } else if (eventKey === "received_at_station") {
      if (!isAssignedDriver) return jsonResponse({ ok: false, error: "forbidden", requestId: id }, 403);
      fromType = "driver"; fromId = assignedDriverEntityId;
      toType = "station"; toId = allocation.data.station_branch_id;
    } else {
      throw new RequestValidationError("Unsupported fuel container handover event.");
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 503);
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    return rpcResponse(
      serviceClient.rpc("record_fuel_container_handover", {
        target_allocation_id: allocationId,
        target_event_key: eventKey,
        target_from_holder_type: fromType,
        target_from_holder_id: fromId,
        target_to_holder_type: toType,
        target_to_holder_id: toId,
        target_actor_user_id: authResult.user.id,
        target_measured_litres: optionalNumber(payload.measuredLitres, "measuredLitres"),
        target_verification_reference: optionalString(payload.verificationReference),
        target_note: optionalString(payload.note),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/fuel/containers/inspection" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    const allocationId = requireUuid(payload.allocationId, "allocationId");
    const allocation = await supabase
      .from("fuel_container_allocations")
      .select("id,order_id,station_branch_id")
      .eq("id", allocationId)
      .maybeSingle();
    if (allocation.error) return databaseError(allocation.error, id);
    if (!allocation.data) return jsonResponse({ ok: false, error: "allocation_not_found", requestId: id }, 404);
    const access = await resolveFuelOrderBranchAccess(supabase, allocation.data.order_id, "business.fuel.orders.process");
    if (access.error) return databaseError(access.error, id);
    if (!access.order || access.moduleKey !== "fuel" || !access.allowed) return jsonResponse({ ok: false, error: "forbidden", requestId: id }, 403);
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 503);
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    return rpcResponse(
      serviceClient.rpc("record_fuel_container_inspection", {
        target_allocation_id: allocationId,
        target_inspection_result: requireString(payload.inspectionResult, "inspectionResult"),
        target_actor_user_id: authResult.user.id,
        target_note: optionalString(payload.note) ?? "",
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }


  return jsonResponse({ ok: false, error: "route_not_found", route: routePath, requestId: id }, 404);
}

function isRateLimited(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return (value as { readonly allowed?: unknown }).allowed === false;
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

async function selectRecords(query: SelectQuery, id: string): Promise<Response> {
  const { data, error } = await query;

  if (error) {
    return databaseError(error as { readonly message: string; readonly code?: string }, id);
  }

  return jsonResponse({
    ok: true,
    data: Array.isArray(data) ? data : [],
    requestId: id,
  });
}

async function readJsonBody(request: Request, id: string): Promise<JsonBodyResult> {
  try {
    const value = await request.json();

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return invalidRequest(id, "request body must be a JSON object");
    }

    return { value: value as Readonly<Record<string, unknown>> };
  } catch (_error) {
    return invalidRequest(id, "request body must be valid JSON");
  }
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RequestValidationError(`${fieldName} is required.`);
  }

  return value;
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new RequestValidationError("optional string field must be a string.");
  }

  return value;
}

function requireUuid(value: unknown, fieldName: string): string {
  const uuid = requireString(value, fieldName);

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .exec(uuid)
  ) {
    throw new RequestValidationError(`${fieldName} must be a valid UUID.`);
  }

  return uuid;
}

function optionalUuid(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requireUuid(value, fieldName);
}

function requireStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new RequestValidationError(`${fieldName} must be an array of strings.`);
  }

  return value;
}

function optionalStringArray(value: unknown): string[] | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requireStringArray(value, "optional string array field");
}

function requireNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RequestValidationError(`${fieldName} must be a finite number.`);
  }

  return value;
}

function optionalNumber(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requireNumber(value, fieldName);
}

function requireRecord(value: unknown, fieldName: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError(`${fieldName} must be a JSON object.`);
  }

  return value as Readonly<Record<string, unknown>>;
}

function optionalRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requireRecord(value, "optional object field");
}

function getRecordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return (value as Readonly<Record<string, unknown>>)[key];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function uniqueStrings(values: readonly (string | null)[]): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function invalidRequest(requestIdValue: string, message: string): JsonBodyResult {
  return {
    response: jsonResponse(
      {
        ok: false,
        error: "invalid_request",
        message,
        requestId: requestIdValue,
      },
      400,
    ),
  };
}

function databaseError(
  error: { readonly message: string; readonly code?: string },
  id: string,
): Response {
  return jsonResponse(
    {
      ok: false,
      error: "database_error",
      code: error.code,
      message: error.message,
      requestId: id,
    },
    400,
  );
}

async function rpcResponse(query: SelectQuery, id: string): Promise<Response> {
  const { data, error } = await query;

  if (error) {
    return databaseError(error as { readonly message: string; readonly code?: string }, id);
  }

  return jsonResponse({
    ok: true,
    id: data,
    requestId: id,
  });
}


async function resolveFuelOrderBranchAccess(
  supabase: SupabaseClient,
  orderId: string,
  permissionKey: string,
): Promise<{
  readonly order: Readonly<Record<string, unknown>> | null;
  readonly moduleKey: string | null;
  readonly allowed: boolean;
  readonly error: { readonly message: string; readonly code?: string } | null;
}> {
  const orderResult = await supabase
    .from("order_records")
    .select("id,organization_id,branch_id,requester_user_id,module_id")
    .eq("id", orderId)
    .maybeSingle();

  if (orderResult.error) {
    return { order: null, moduleKey: null, allowed: false, error: orderResult.error };
  }
  if (!orderResult.data) {
    return { order: null, moduleKey: null, allowed: false, error: null };
  }

  const [moduleResult, branchPermission, platformManage, platformRead] = await Promise.all([
    supabase
      .from("business_modules")
      .select("key")
      .eq("id", orderResult.data.module_id)
      .maybeSingle(),
    supabase.rpc("has_permission_for_branch", {
      target_permission: permissionKey,
      target_organization_id: orderResult.data.organization_id,
      target_branch_id: orderResult.data.branch_id,
    }),
    supabase.rpc("can_manage_fuel_platform"),
    permissionKey.endsWith(".read")
      ? supabase.rpc("has_permission", {
        target_permission: "platform.fuel.read",
        target_organization_id: null,
      })
      : Promise.resolve({ data: false, error: null }),
  ]);

  const failed = [moduleResult, branchPermission, platformManage, platformRead]
    .find((result) => result.error);
  if (failed?.error) {
    return {
      order: orderResult.data,
      moduleKey: null,
      allowed: false,
      error: failed.error,
    };
  }

  const moduleKey = stringOrNull(moduleResult.data?.key);
  const allowed = branchPermission.data === true
    || platformManage.data === true
    || platformRead.data === true;

  return {
    order: orderResult.data,
    moduleKey,
    allowed,
    error: null,
  };
}

async function resolveFuelAssignedDriver(
  supabase: SupabaseClient,
  orderId: string,
): Promise<{
  readonly assignment: Readonly<Record<string, unknown>> | null;
  readonly userId: string | null;
  readonly error: { readonly message: string; readonly code?: string } | null;
}> {
  const assignmentResult = await supabase
    .from("order_assignments")
    .select("id,order_id,participant_role,entity_type,entity_id,status,metadata,assigned_at")
    .eq("order_id", orderId)
    .eq("participant_role", "driver")
    .eq("status", "active")
    .order("assigned_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (assignmentResult.error) {
    return { assignment: null, userId: null, error: assignmentResult.error };
  }

  const assignment = assignmentResult.data;
  if (!assignment) {
    return { assignment: null, userId: null, error: null };
  }

  const entityType = stringOrNull(assignment.entity_type);
  const entityId = stringOrNull(assignment.entity_id);
  if (!entityId) {
    return {
      assignment,
      userId: null,
      error: { message: "Active Fuel driver assignment has no entity identity.", code: "FUEL_DRIVER_IDENTITY_MISSING" },
    };
  }

  if (entityType === "user") {
    return { assignment, userId: entityId, error: null };
  }

  if (entityType !== "driver") {
    return {
      assignment,
      userId: null,
      error: { message: "Active Fuel driver assignment uses an unsupported identity type.", code: "FUEL_DRIVER_IDENTITY_INVALID" },
    };
  }

  const profileResult = await supabase
    .from("driver_profiles")
    .select("id,user_id")
    .eq("id", entityId)
    .maybeSingle();
  if (profileResult.error) {
    return { assignment, userId: null, error: profileResult.error };
  }

  if (profileResult.data?.user_id) {
    return { assignment, userId: stringOrNull(profileResult.data.user_id), error: null };
  }

  const stationDriverResult = await supabase
    .from("lpg_station_managed_drivers")
    .select("id,user_id")
    .eq("id", entityId)
    .maybeSingle();
  if (stationDriverResult.error) {
    return { assignment, userId: null, error: stationDriverResult.error };
  }

  return {
    assignment,
    userId: stringOrNull(stationDriverResult.data?.user_id),
    error: null,
  };
}

async function resolveFuelAssignedOrderIdsForUser(
  supabase: SupabaseClient,
  assignments: readonly unknown[],
  userId: string,
): Promise<{
  readonly orderIds: readonly string[];
  readonly error: { readonly message: string; readonly code?: string } | null;
}> {
  const directOrderIds: string[] = [];
  const driverIdentityIds: string[] = [];

  for (const assignment of assignments) {
    if (getRecordValue(assignment, "status") !== "active"
      || getRecordValue(assignment, "participant_role") !== "driver") {
      continue;
    }
    const orderId = stringOrNull(getRecordValue(assignment, "order_id"));
    const entityId = stringOrNull(getRecordValue(assignment, "entity_id"));
    const entityType = stringOrNull(getRecordValue(assignment, "entity_type"));
    if (!orderId || !entityId) continue;
    if (entityType === "user" && entityId === userId) directOrderIds.push(orderId);
    if (entityType === "driver") driverIdentityIds.push(entityId);
  }

  const uniqueDriverIds = uniqueStrings(driverIdentityIds);
  if (uniqueDriverIds.length === 0) {
    return { orderIds: uniqueStrings(directOrderIds), error: null };
  }

  const [profiles, stationDrivers] = await Promise.all([
    supabase.from("driver_profiles").select("id,user_id").in("id", uniqueDriverIds),
    supabase.from("lpg_station_managed_drivers").select("id,user_id").in("id", uniqueDriverIds),
  ]);
  if (profiles.error) return { orderIds: [], error: profiles.error };
  if (stationDrivers.error) return { orderIds: [], error: stationDrivers.error };

  const matchingDriverIds = new Set<string>();
  for (const driver of [...(profiles.data ?? []), ...(stationDrivers.data ?? [])]) {
    if (driver.user_id === userId && typeof driver.id === "string") {
      matchingDriverIds.add(driver.id);
    }
  }

  for (const assignment of assignments) {
    if (getRecordValue(assignment, "status") !== "active"
      || getRecordValue(assignment, "participant_role") !== "driver"
      || getRecordValue(assignment, "entity_type") !== "driver") {
      continue;
    }
    const entityId = stringOrNull(getRecordValue(assignment, "entity_id"));
    const orderId = stringOrNull(getRecordValue(assignment, "order_id"));
    if (entityId && orderId && matchingDriverIds.has(entityId)) directOrderIds.push(orderId);
  }

  return { orderIds: uniqueStrings(directOrderIds), error: null };
}
