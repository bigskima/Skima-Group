import { createRequestSupabaseClient, requireAuthenticatedUser } from "../_shared/supabase-auth.ts";
import { jsonResponse, optionsResponse, requestId } from "../_shared/http.ts";

const ROUTES = new Set([
  "/health",
  "/admin/role-templates",
  "/admin/users",
  "/admin/users/revoke",
  "/admin/webhook-endpoints",
  "/admin/webhook-deliveries",
  "/admin/webhook-attempts",
  "/admin/webhooks/queue",
  "/engines/catalog",
  "/engines/currencies",
  "/engines/pricing-policies",
  "/engines/settlement-policies",
  "/engines/dispatch-policies",
  "/engines/verification-definitions",
  "/engines/notification-templates",
  "/engines/ai-task-definitions",
  "/engines/provider-adapters",
  "/runtime/catalog",
  "/runtime/catalog/units",
  "/runtime/catalog/categories",
  "/runtime/catalog/items",
  "/runtime/catalog/variants",
  "/runtime/catalog/prices",
  "/runtime/catalog/media",
  "/runtime/catalog/availability",
  "/runtime/catalog/stock-adjustments",
  "/runtime/catalog/orderability",
  "/runtime/order-actions",
  "/runtime/order-acceptance-policies",
  "/runtime/orders",
  "/runtime/orders/line-items",
  "/runtime/orders/actions",
  "/runtime/orders/assignments",
  "/runtime/orders/events",
  "/runtime/application-types",
  "/runtime/applications",
  "/runtime/applications/payload",
  "/runtime/applications/submit",
  "/runtime/applications/reviewer",
  "/runtime/applications/corrections",
  "/runtime/applications/decisions",
  "/runtime/applications/withdraw",
  "/runtime/documents/requirements",
  "/runtime/documents",
  "/runtime/documents/review",
  "/runtime/drivers",
  "/runtime/vehicles",
  "/runtime/driver-vehicle-links",
  "/runtime/organization-branches",
  "/runtime/organization-roles",
  "/runtime/organization-memberships",
  "/runtime/organization-user-roles",
  "/runtime/organization-invitations",
  "/runtime/organization-invitations/accept",
  "/runtime/organization-staff/status",
  "/runtime/organization-staff/ownership-transfer",
  "/runtime/organization-staff/events",
  "/runtime/service-requests",
  "/runtime/pricing/quotes",
  "/runtime/pricing/quotes/accept",
  "/runtime/payments/reserve",
  "/runtime/payments/deposits",
  "/runtime/payments/deposits/verify",
  "/runtime/payment-webhook-events",
  "/runtime/wallets",
  "/runtime/wallet-balances",
  "/runtime/withdrawal-beneficiaries",
  "/runtime/withdrawals",
  "/runtime/withdrawals/approve",
  "/runtime/withdrawals/transfers",
  "/runtime/order-funding",
  "/runtime/commissions/execute",
  "/runtime/commission-executions",
  "/runtime/order-settlements/execute",
  "/runtime/settlement-statements",
  "/runtime/communications/messages",
  "/runtime/communications/sync",
  "/runtime/otp/challenges",
  "/runtime/otp/verify",
  "/runtime/workflows/start",
  "/runtime/events/process",
  "/runtime/participants/assign",
  "/runtime/dispatch/select",
  "/runtime/tracking/sessions",
  "/runtime/tracking/points",
  "/runtime/verifications",
  "/runtime/notifications/queue",
  "/runtime/ai/queue",
  "/runtime/settlements/execute",
  "/runtime/escrow/status",
  "/runtime/escrow/release",
  "/runtime/escrow/refund",
  "/runtime/reconciliation/service-request",
  "/modules/catalog",
  "/modules",
  "/modules/versions",
  "/modules/versions/activate",
  "/modules/components",
  "/modules/events",
]);

Deno.serve(handleRequest);

async function handleRequest(request: Request): Promise<Response> {
  const id = requestId(request);

  try {
    if (request.method === "OPTIONS") {
      return optionsResponse();
    }

    return await handleAuthenticatedRequest(request, id);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_request",
          message: error.message,
          requestId: id,
        },
        400,
      );
    }

    console.error(JSON.stringify({
      severity: "error",
      source: "api-gateway",
      requestId: id,
      message: error instanceof Error ? error.message : "unknown error",
    }));

    return jsonResponse(
      {
        ok: false,
        error: "internal_error",
        requestId: id,
      },
      500,
    );
  }
}

async function handleAuthenticatedRequest(request: Request, id: string): Promise<Response> {
  const authResult = await requireAuthenticatedUser(request, id);

  if ("response" in authResult) {
    return authResult.response;
  }

  const url = new URL(request.url);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !anonKey) {
    return jsonResponse(
      {
        ok: false,
        error: "server_misconfigured",
        requestId: id,
      },
      500,
    );
  }

  const supabase = createRequestSupabaseClient(request, supabaseUrl, anonKey);
  const routePath = normalizeGatewayPath(url.pathname);

  const rateLimitResult = await supabase.rpc("check_rate_limit", {
    target_increment: 1,
    target_policy_key: "api.gateway.authenticated.default",
    target_subject: authResult.user.id,
  });

  if (rateLimitResult.error) {
    return databaseError(rateLimitResult.error, id);
  }

  if (isRateLimited(rateLimitResult.data)) {
    return jsonResponse(
      {
        ok: false,
        error: "rate_limited",
        requestId: id,
      },
      429,
    );
  }

  if (routePath === "/health") {
    return jsonResponse({
      ok: true,
      service: "skima-platform",
      backend: "supabase",
      gateway: "api-gateway",
      authenticated: true,
      timestamp: new Date().toISOString(),
      requestId: id,
    });
  }

  if (routePath === "/engines/catalog" && request.method === "GET") {
    return jsonResponse({
      ok: true,
      data: {
        routes: Array.from(ROUTES).filter((route) => route.startsWith("/engines/")),
      },
      requestId: id,
    });
  }

  if (routePath === "/engines/currencies" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("currency_definitions")
        .select("code,display_name,symbol,decimal_places,status,metadata")
        .order("code", { ascending: true }),
      id,
    );
  }

  if (routePath === "/engines/pricing-policies" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("pricing_policies")
        .select("id,key,display_name,pricing_mode,scope_type,scope_id,currency_code,status,version")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (routePath === "/engines/settlement-policies" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("settlement_policies")
        .select("id,key,display_name,scope_type,scope_id,status,version")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (routePath === "/engines/dispatch-policies" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("dispatch_policies")
        .select("id,key,display_name,matching_strategy,status")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (routePath === "/engines/verification-definitions" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("verification_definitions")
        .select("id,key,display_name,verification_mode,event_type_key,status")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (routePath === "/engines/notification-templates" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("notification_templates")
        .select("id,key,channel,locale,subject_template,status")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (routePath === "/engines/ai-task-definitions" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("ai_task_definitions")
        .select("id,key,display_name,task_type,provider_adapter_id,status")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (routePath === "/engines/provider-adapters" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("provider_adapters")
        .select("id,provider_kind,key,display_name,status,config")
        .in("provider_kind", [
          "payment",
          "storage",
          "maps",
          "notification",
          "ai",
          "queue",
          "cache",
          "observability",
        ])
        .order("provider_kind", { ascending: true })
        .order("key", { ascending: true }),
      id,
    );
  }

  if (routePath === "/runtime/catalog" && request.method === "GET") {
    return jsonResponse({
      ok: true,
      data: {
        routes: Array.from(ROUTES).filter((route) => route.startsWith("/runtime/")),
      },
      requestId: id,
    });
  }

  if (routePath === "/runtime/catalog/units") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("catalog_units")
          .select(
            "id,organization_id,key,display_name,unit_kind,symbol,decimal_precision,status,metadata,created_by,created_at,updated_at",
          )
          .order("key", { ascending: true }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("configure_catalog_unit", {
          target_decimal_precision: optionalInteger(payload.decimalPrecision) ?? 0,
          target_display_name: requireString(payload.displayName, "displayName"),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_organization_id: requireUuid(payload.organizationId, "organizationId"),
          target_source: optionalString(payload.source) ?? "platform.api_gateway",
          target_status: optionalString(payload.status) ?? "active",
          target_symbol: optionalString(payload.symbol),
          target_unit_key: requireString(payload.unitKey, "unitKey"),
          target_unit_kind: optionalString(payload.unitKind) ?? "quantity",
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/catalog/categories") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("catalog_categories")
          .select(
            "id,organization_id,module_id,parent_id,key,display_name,description,category_type,status,metadata,created_by,created_at,updated_at",
          )
          .order("key", { ascending: true }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("configure_catalog_category", {
          target_category_key: requireString(payload.categoryKey, "categoryKey"),
          target_category_type: optionalString(payload.categoryType) ?? "mixed",
          target_description: optionalString(payload.description),
          target_display_name: requireString(payload.displayName, "displayName"),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_module_key: optionalString(payload.moduleKey),
          target_organization_id: requireUuid(payload.organizationId, "organizationId"),
          target_parent_key: optionalString(payload.parentKey),
          target_source: optionalString(payload.source) ?? "platform.api_gateway",
          target_status: optionalString(payload.status) ?? "active",
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/catalog/items") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("catalog_items")
          .select(
            "id,organization_id,branch_id,module_id,category_id,key,item_type,display_name,description,fulfillment_methods,preparation_time_minutes,min_quantity,max_quantity,status,metadata,created_by,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("configure_catalog_item", {
          target_branch_id: optionalUuid(payload.branchId, "branchId"),
          target_category_key: optionalString(payload.categoryKey),
          target_description: optionalString(payload.description),
          target_display_name: requireString(payload.displayName, "displayName"),
          target_fulfillment_methods: optionalStringArray(payload.fulfillmentMethods) ?? [],
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_item_key: requireString(payload.itemKey, "itemKey"),
          target_item_type: requireString(payload.itemType, "itemType"),
          target_max_quantity: optionalNumber(payload.maxQuantity, "maxQuantity"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_min_quantity: optionalNumber(payload.minQuantity, "minQuantity") ?? 1,
          target_module_key: optionalString(payload.moduleKey),
          target_organization_id: requireUuid(payload.organizationId, "organizationId"),
          target_preparation_time_minutes: optionalInteger(payload.preparationTimeMinutes),
          target_source: optionalString(payload.source) ?? "platform.api_gateway",
          target_status: optionalString(payload.status) ?? "draft",
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/catalog/variants") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("catalog_item_variants")
          .select(
            "id,organization_id,branch_id,item_id,unit_id,key,display_name,sku,quantity_value,status,metadata,created_by,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("configure_catalog_variant", {
          target_display_name: requireString(payload.displayName, "displayName"),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_item_id: requireUuid(payload.itemId, "itemId"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_quantity_value: optionalNumber(payload.quantityValue, "quantityValue") ?? 1,
          target_sku: optionalString(payload.sku),
          target_source: optionalString(payload.source) ?? "platform.api_gateway",
          target_status: optionalString(payload.status) ?? "active",
          target_unit_key: optionalString(payload.unitKey),
          target_variant_key: requireString(payload.variantKey, "variantKey"),
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/catalog/prices") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("catalog_prices")
          .select(
            "id,organization_id,branch_id,item_id,variant_id,pricing_policy_id,currency_code,amount,compare_at_amount,tax_behavior,status,effective_from,effective_until,metadata,created_by,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("configure_catalog_price", {
          target_amount: requireNumber(payload.amount, "amount"),
          target_compare_at_amount: optionalNumber(payload.compareAtAmount, "compareAtAmount"),
          target_currency_code: optionalString(payload.currencyCode) ?? "NGN",
          target_effective_from: optionalString(payload.effectiveFrom),
          target_effective_until: optionalString(payload.effectiveUntil),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_item_id: requireUuid(payload.itemId, "itemId"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_pricing_policy_key: optionalString(payload.pricingPolicyKey),
          target_source: optionalString(payload.source) ?? "platform.api_gateway",
          target_status: optionalString(payload.status) ?? "active",
          target_tax_behavior: optionalString(payload.taxBehavior) ?? "exclusive",
          target_variant_id: optionalUuid(payload.variantId, "variantId"),
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/catalog/media") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("catalog_item_media")
          .select(
            "id,organization_id,branch_id,item_id,variant_id,media_asset_id,display_order,status,metadata,created_by,created_at,updated_at",
          )
          .order("display_order", { ascending: true }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("attach_catalog_item_media", {
          target_display_order: optionalInteger(payload.displayOrder) ?? 0,
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_item_id: requireUuid(payload.itemId, "itemId"),
          target_media_asset_id: requireUuid(payload.mediaAssetId, "mediaAssetId"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_source: optionalString(payload.source) ?? "platform.api_gateway",
          target_status: optionalString(payload.status) ?? "active",
          target_variant_id: optionalUuid(payload.variantId, "variantId"),
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/catalog/availability") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("catalog_availability_rules")
          .select(
            "id,organization_id,branch_id,item_id,variant_id,availability_status,schedule,stock_quantity,reserved_quantity,capacity_limit,capacity_used,status,effective_from,effective_until,metadata,created_by,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("set_catalog_availability", {
          target_availability_status: optionalString(payload.availabilityStatus) ?? "available",
          target_branch_id: optionalUuid(payload.branchId, "branchId"),
          target_capacity_limit: optionalNumber(payload.capacityLimit, "capacityLimit"),
          target_capacity_used: optionalNumber(payload.capacityUsed, "capacityUsed") ?? 0,
          target_effective_from: optionalString(payload.effectiveFrom),
          target_effective_until: optionalString(payload.effectiveUntil),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_item_id: requireUuid(payload.itemId, "itemId"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_reserved_quantity: optionalNumber(payload.reservedQuantity, "reservedQuantity") ??
            0,
          target_schedule: optionalRecord(payload.schedule) ?? {},
          target_source: optionalString(payload.source) ?? "platform.api_gateway",
          target_status: optionalString(payload.status) ?? "active",
          target_stock_quantity: optionalNumber(payload.stockQuantity, "stockQuantity"),
          target_variant_id: optionalUuid(payload.variantId, "variantId"),
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/catalog/stock-adjustments" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("adjust_catalog_stock", {
        target_availability_rule_id: requireUuid(
          payload.availabilityRuleId,
          "availabilityRuleId",
        ),
        target_delta_quantity: requireNumber(payload.deltaQuantity, "deltaQuantity"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_reason: requireString(payload.reason, "reason"),
        target_source: optionalString(payload.source) ?? "platform.api_gateway",
      }),
      id,
    );
  }

  if (routePath === "/runtime/catalog/orderability") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("catalog_orderability_checks")
          .select(
            "id,organization_id,branch_id,item_id,variant_id,price_id,availability_rule_id,requester_user_id,quantity,currency_code,status,rejection_reason,calculated_amount,metadata,created_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      const { data, error } = await supabase.rpc("validate_catalog_orderability", {
        target_branch_id: optionalUuid(payload.branchId, "branchId"),
        target_currency_code: optionalString(payload.currencyCode) ?? "NGN",
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_item_id: requireUuid(payload.itemId, "itemId"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_quantity: requireNumber(payload.quantity, "quantity"),
        target_source: optionalString(payload.source) ?? "platform.api_gateway",
        target_variant_id: optionalUuid(payload.variantId, "variantId"),
      });

      if (error) {
        return databaseError(error, id);
      }

      return jsonResponse({
        ok: true,
        data,
        requestId: id,
      });
    }
  }

  if (routePath === "/runtime/order-actions" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("order_action_definitions")
        .select(
          "id,key,display_name,scope_type,scope_id,event_type_key,actor_scope,service_request_status,line_fulfillment_status,reservation_effect,requires_reason,status,metadata",
        )
        .order("key", { ascending: true }),
      id,
    );
  }

  if (routePath === "/runtime/order-acceptance-policies" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("order_acceptance_policies")
        .select(
          "id,key,display_name,scope_type,scope_id,acceptance_mode,auto_accept_action_key,rejection_reasons,timeout_seconds,status,metadata",
        )
        .order("key", { ascending: true }),
      id,
    );
  }

  if (routePath === "/runtime/orders") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("order_records")
          .select(
            "id,service_request_id,module_id,module_version_id,organization_id,branch_id,requester_user_id,workflow_instance_id,acceptance_policy_id,status,fulfillment_method,currency_code,subtotal_amount,fee_amount,discount_amount,tax_amount,total_amount,order_payload,metadata,accepted_at,preparing_at,ready_at,fulfilled_at,completed_at,cancelled_at,failed_at,rejected_at,disputed_at,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("create_order_from_catalog", {
          target_acceptance_policy_key: optionalString(payload.acceptancePolicyKey),
          target_branch_id: optionalUuid(payload.branchId, "branchId"),
          target_currency_code: optionalString(payload.currencyCode) ?? "NGN",
          target_fulfillment_method: optionalString(payload.fulfillmentMethod),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_line_items: requireArray(payload.lineItems, "lineItems"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_module_key: requireString(payload.moduleKey, "moduleKey"),
          target_order_payload: optionalRecord(payload.orderPayload) ?? {},
          target_organization_id: requireUuid(payload.organizationId, "organizationId"),
          target_source: optionalString(payload.source) ?? "platform.api_gateway",
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/orders/line-items" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("order_line_items")
        .select(
          "id,order_id,line_number,item_id,variant_id,price_id,availability_rule_id,quantity,unit_amount,line_amount,currency_code,fulfillment_status,stock_reservation_status,item_snapshot,metadata,created_at,updated_at",
        )
        .order("line_number", { ascending: true }),
      id,
    );
  }

  if (routePath === "/runtime/orders/actions" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("process_order_action", {
        target_action_key: requireString(payload.actionKey, "actionKey"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_order_id: requireUuid(payload.orderId, "orderId"),
        target_payload: optionalRecord(payload.payload) ?? {},
        target_reason: optionalString(payload.reason),
        target_source: optionalString(payload.source) ?? "platform.api_gateway",
      }),
      id,
    );
  }

  if (routePath === "/runtime/orders/assignments") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("order_assignments")
          .select(
            "id,order_id,service_request_id,participant_role,entity_type,entity_id,status,metadata,assigned_by,assigned_at,updated_at",
          )
          .order("assigned_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("assign_order_participant", {
          target_entity_id: requireUuid(payload.entityId, "entityId"),
          target_entity_type: requireString(payload.entityType, "entityType"),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_order_id: requireUuid(payload.orderId, "orderId"),
          target_participant_role: requireString(payload.participantRole, "participantRole"),
          target_source: optionalString(payload.source) ?? "platform.api_gateway",
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/orders/events" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("order_events")
        .select(
          "id,order_id,service_request_id,workflow_instance_id,event_type_key,event_id,from_status,to_status,actor_user_id,metadata,created_at",
        )
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/runtime/application-types" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("application_type_definitions")
        .select(
          "id,key,display_name,application_category,module_id,workflow_key,document_requirement_set_id,review_policy,activation_policy,status,metadata",
        )
        .order("key", { ascending: true }),
      id,
    );
  }

  if (routePath === "/runtime/documents/requirements" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("document_requirements")
        .select(
          "id,requirement_set_id,key,display_name,description,is_required,review_required,min_count,max_count,allowed_content_types,max_byte_size,expires_after_days,status,metadata",
        )
        .order("key", { ascending: true }),
      id,
    );
  }

  if (routePath === "/runtime/documents") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("document_submissions")
          .select(
            "id,requirement_id,application_id,subject_type,subject_id,owner_user_id,organization_id,media_asset_id,status,storage_bucket,storage_path,content_type,byte_size,checksum,submitted_at,reviewed_at,reviewer_user_id,expires_at,decision_reason,metadata,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("register_document_submission", {
          target_application_id: requireUuid(payload.applicationId, "applicationId"),
          target_byte_size: optionalInteger(payload.byteSize),
          target_checksum: optionalString(payload.checksum),
          target_content_type: optionalString(payload.contentType),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_requirement_key: requireString(payload.requirementKey, "requirementKey"),
          target_source: optionalString(payload.source) ?? "platform.api_gateway",
          target_storage_bucket: requireString(payload.storageBucket, "storageBucket"),
          target_storage_path: requireString(payload.storagePath, "storagePath"),
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/documents/review" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("review_document_submission", {
        target_applicant_message: optionalString(payload.applicantMessage),
        target_decision: requireString(payload.decision, "decision"),
        target_document_submission_id: requireUuid(
          payload.documentSubmissionId,
          "documentSubmissionId",
        ),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_internal_notes: optionalString(payload.internalNotes),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/applications") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("application_records")
          .select(
            "id,application_type_id,applicant_user_id,organization_id,workflow_instance_id,assigned_reviewer_user_id,active_version,status,locked_at,submitted_at,decided_at,approved_at,rejected_at,suspended_at,withdrawn_at,activated_subject_type,activated_subject_id,metadata,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("create_application_record", {
          target_applicant_user_id: optionalUuid(payload.applicantUserId, "applicantUserId"),
          target_application_type_key: requireString(
            payload.applicationTypeKey,
            "applicationTypeKey",
          ),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_organization_id: optionalUuid(payload.organizationId, "organizationId"),
          target_payload: requireRecord(payload.payload, "payload"),
          target_source: optionalString(payload.source) ?? "platform.api_gateway",
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/applications/payload" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("update_application_payload", {
        target_application_id: requireUuid(payload.applicationId, "applicationId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_payload: requireRecord(payload.payload, "payload"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/applications/submit" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    return rpcResponse(
      supabase.rpc("submit_application", {
        target_application_id: requireUuid(body.value.applicationId, "applicationId"),
        target_idempotency_key: requireString(body.value.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(body.value.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/applications/reviewer" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("assign_application_reviewer", {
        target_application_id: requireUuid(payload.applicationId, "applicationId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_reviewer_user_id: requireUuid(payload.reviewerUserId, "reviewerUserId"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/applications/corrections" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("request_application_correction", {
        target_applicant_message: requireString(payload.applicantMessage, "applicantMessage"),
        target_application_id: requireUuid(payload.applicationId, "applicationId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_internal_notes: optionalString(payload.internalNotes),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/applications/decisions" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("decide_application_review", {
        target_application_id: requireUuid(payload.applicationId, "applicationId"),
        target_decision: requireString(payload.decision, "decision"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_reason: requireString(payload.reason, "reason"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/applications/withdraw" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("withdraw_application", {
        target_application_id: requireUuid(payload.applicationId, "applicationId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_reason: optionalString(payload.reason),
      }),
      id,
    );
  }

  if (routePath === "/runtime/drivers" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("driver_profiles")
        .select(
          "id,user_id,organization_id,operational_status,verification_status,identity_profile,license_profile,service_profile,approved_at,metadata,created_at,updated_at",
        )
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/runtime/vehicles" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("vehicles")
        .select(
          "id,organization_id,owner_user_id,vehicle_type_id,status,ownership_type,manufacturer,model,model_year,registration_number,vin,color,max_load_kg,cargo_volume_m3,passenger_capacity,fuel_type,insurance_expires_at,inspection_expires_at,roadworthiness_expires_at,capacity_profile,metadata,created_at,updated_at",
        )
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/runtime/driver-vehicle-links" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("driver_vehicle_links")
        .select(
          "id,driver_profile_id,vehicle_id,relationship_type,status,authorized_by,starts_at,ends_at,metadata,created_at,updated_at",
        )
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/runtime/organization-branches") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("organization_branches")
          .select(
            "id,organization_id,key,display_name,address,geo_location,status,metadata,created_by,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("create_organization_branch", {
          target_address: requireRecord(payload.address, "address"),
          target_branch_key: requireString(payload.branchKey, "branchKey"),
          target_display_name: requireString(payload.displayName, "displayName"),
          target_geo_location: optionalRecord(payload.geoLocation) ?? {},
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_organization_id: requireUuid(payload.organizationId, "organizationId"),
          target_source: optionalString(payload.source) ?? "platform.api_gateway",
          target_status: optionalString(payload.status) ?? "active",
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/organization-roles") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("roles")
          .select(
            "id,organization_id,key,display_name,description,status,metadata,created_by,created_at,updated_at",
          )
          .not("organization_id", "is", null)
          .order("key", { ascending: true }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("configure_organization_role", {
          target_branch_id: optionalUuid(payload.branchId, "branchId"),
          target_description: optionalString(payload.description),
          target_display_name: requireString(payload.displayName, "displayName"),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_organization_id: requireUuid(payload.organizationId, "organizationId"),
          target_permission_keys: requireStringArray(payload.permissionKeys, "permissionKeys"),
          target_role_key: requireString(payload.roleKey, "roleKey"),
          target_source: optionalString(payload.source) ?? "platform.api_gateway",
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/organization-memberships" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("organization_memberships")
        .select(
          "id,organization_id,user_id,membership_type,status,metadata,created_by,created_at,updated_at",
        )
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/runtime/organization-user-roles" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("user_roles")
        .select(
          "id,organization_id,user_id,role_id,branch_id,access_scope,status,starts_at,ends_at,created_by,created_at,updated_at",
        )
        .not("organization_id", "is", null)
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/runtime/organization-invitations") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("organization_invitations")
          .select(
            "id,organization_id,invited_email,invited_user_id,invited_by,membership_type,role_id,branch_id,status,expires_at,accepted_at,revoked_at,metadata,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("invite_organization_staff", {
          target_branch_key: optionalString(payload.branchKey),
          target_expires_at: requireString(payload.expiresAt, "expiresAt"),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_invited_email: requireString(payload.invitedEmail, "invitedEmail"),
          target_membership_type: optionalString(payload.membershipType) ?? "member",
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_organization_id: requireUuid(payload.organizationId, "organizationId"),
          target_role_key: requireString(payload.roleKey, "roleKey"),
          target_source: optionalString(payload.source) ?? "platform.api_gateway",
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/organization-invitations/accept" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("accept_organization_invitation", {
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_invitation_id: requireUuid(payload.invitationId, "invitationId"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/organization-staff/status" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("set_organization_staff_status", {
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_organization_id: requireUuid(payload.organizationId, "organizationId"),
        target_reason: requireString(payload.reason, "reason"),
        target_status: requireString(payload.status, "status"),
        target_user_id: requireUuid(payload.userId, "userId"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/organization-staff/ownership-transfer" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("transfer_organization_ownership", {
        target_from_user_id: requireUuid(payload.fromUserId, "fromUserId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_organization_id: requireUuid(payload.organizationId, "organizationId"),
        target_to_user_id: requireUuid(payload.toUserId, "toUserId"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/organization-staff/events" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("organization_staff_events")
        .select(
          "id,organization_id,branch_id,invitation_id,role_id,actor_user_id,subject_user_id,event_type_key,from_status,to_status,metadata,created_at",
        )
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/runtime/service-requests") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("service_requests")
          .select(
            "id,module_id,module_version_id,requester_user_id,organization_id,workflow_instance_id,active_quote_id,escrow_hold_id,status,request_payload,participants,metadata,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("create_module_service_request", {
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_module_key: requireString(payload.moduleKey, "moduleKey"),
          target_organization_id: optionalUuid(payload.organizationId, "organizationId"),
          target_request_payload: requireRecord(payload.requestPayload, "requestPayload"),
          target_source: optionalString(payload.source) ?? "platform.api_gateway",
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/pricing/quotes") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("price_quotes")
          .select(
            "id,service_request_id,pricing_policy_id,module_id,currency_code,status,subtotal_amount,fee_amount,discount_amount,tax_amount,total_amount,pricing_context,calculation_breakdown,expires_at,accepted_at,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("calculate_price_quote", {
          target_currency_code: optionalString(payload.currencyCode) ?? "NGN",
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_module_key: requireString(payload.moduleKey, "moduleKey"),
          target_pricing_context: optionalRecord(payload.pricingContext) ?? {},
          target_pricing_policy_key: optionalString(payload.pricingPolicyKey),
          target_service_request_id: requireUuid(payload.serviceRequestId, "serviceRequestId"),
          target_source: optionalString(payload.source) ?? "platform.pricing_engine",
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/pricing/quotes/accept" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("accept_price_quote", {
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_price_quote_id: requireUuid(payload.priceQuoteId, "priceQuoteId"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/payments/reserve" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("create_escrow_hold", {
        target_customer_wallet_id: requireUuid(payload.customerWalletId, "customerWalletId"),
        target_escrow_wallet_id: requireUuid(payload.escrowWalletId, "escrowWalletId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_service_request_id: requireUuid(payload.serviceRequestId, "serviceRequestId"),
        target_source: optionalString(payload.source) ?? "platform.escrow_engine",
      }),
      id,
    );
  }

  if (routePath === "/runtime/wallets" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("wallet_accounts")
        .select(
          "id,wallet_type,owner_entity_type,owner_entity_id,currency_code,status,source,metadata,created_at,updated_at",
        )
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/runtime/wallet-balances" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("wallet_balances")
        .select("wallet_id,currency_code,balance")
        .order("wallet_id", { ascending: true }),
      id,
    );
  }

  if (routePath === "/runtime/payments/deposits") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("payment_deposit_requests")
          .select(
            "id,wallet_id,customer_user_id,provider_adapter_id,transaction_id,reversal_transaction_id,currency_code,amount,status,provider_reference,checkout_url,source,metadata,initialized_at,verified_at,failed_at,reversed_at,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("initialize_wallet_deposit", {
          target_amount: requireNumber(payload.amount, "amount"),
          target_currency_code: optionalString(payload.currencyCode) ?? "NGN",
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_provider_adapter_key: optionalString(payload.providerAdapterKey) ??
            "provider.payment.sandbox",
          target_source: optionalString(payload.source) ?? "platform.payment_engine",
          target_wallet_id: optionalUuid(payload.walletId, "walletId"),
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/payments/deposits/verify" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("verify_wallet_deposit", {
        target_deposit_request_id: requireUuid(payload.depositRequestId, "depositRequestId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/payment-webhook-events" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("payment_webhook_events")
        .select(
          "id,deposit_request_id,provider_adapter_id,event_type,provider_reference,signature_verified,status,payload,source,metadata,created_at",
        )
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/runtime/withdrawal-beneficiaries") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("withdrawal_beneficiaries")
          .select(
            "id,owner_user_id,wallet_id,provider_adapter_id,beneficiary_type,bank_code,account_number_last4,account_name,provider_recipient_code,status,source,metadata,verified_at,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("configure_withdrawal_beneficiary", {
          target_account_name: requireString(payload.accountName, "accountName"),
          target_account_number: requireString(payload.accountNumber, "accountNumber"),
          target_bank_code: optionalString(payload.bankCode),
          target_beneficiary_type: optionalString(payload.beneficiaryType) ?? "bank_account",
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_provider_adapter_key: optionalString(payload.providerAdapterKey) ??
            "provider.payment.sandbox",
          target_source: optionalString(payload.source) ?? "platform.withdrawal_engine",
          target_wallet_id: requireUuid(payload.walletId, "walletId"),
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/withdrawals") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("withdrawal_requests")
          .select(
            "id,wallet_id,beneficiary_id,provider_adapter_id,reserve_transaction_id,reversal_transaction_id,currency_code,amount,fee_amount,total_debit_amount,status,provider_reference,source,metadata,requested_by,approved_by,requested_at,approved_at,processed_at,failed_at,reversed_at,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("request_wallet_withdrawal", {
          target_amount: requireNumber(payload.amount, "amount"),
          target_beneficiary_id: requireUuid(payload.beneficiaryId, "beneficiaryId"),
          target_fee_amount: optionalNumber(payload.feeAmount, "feeAmount") ?? 0,
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_source: optionalString(payload.source) ?? "platform.withdrawal_engine",
          target_wallet_id: requireUuid(payload.walletId, "walletId"),
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/withdrawals/approve" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("approve_wallet_withdrawal", {
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_source: optionalString(payload.source) ?? "platform.withdrawal_engine",
        target_withdrawal_request_id: requireUuid(
          payload.withdrawalRequestId,
          "withdrawalRequestId",
        ),
      }),
      id,
    );
  }

  if (routePath === "/runtime/withdrawals/transfers") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("transfer_executions")
          .select(
            "id,withdrawal_request_id,provider_adapter_id,provider_execution_log_id,status,provider_reference,response_payload,source,idempotency_key,metadata,created_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("process_wallet_withdrawal_transfer", {
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_provider_reference: optionalString(payload.providerReference),
          target_provider_status: requireString(payload.providerStatus, "providerStatus"),
          target_response_payload: optionalRecord(payload.responsePayload) ?? {},
          target_source: optionalString(payload.source) ?? "platform.withdrawal_engine",
          target_withdrawal_request_id: requireUuid(
            payload.withdrawalRequestId,
            "withdrawalRequestId",
          ),
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/order-funding" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("fund_order_from_wallet", {
        target_customer_wallet_id: requireUuid(payload.customerWalletId, "customerWalletId"),
        target_escrow_wallet_id: optionalUuid(payload.escrowWalletId, "escrowWalletId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_order_id: requireUuid(payload.orderId, "orderId"),
        target_source: optionalString(payload.source) ?? "platform.payment_engine",
      }),
      id,
    );
  }

  if (routePath === "/runtime/commissions/execute" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("execute_driver_commission", {
        target_base_amount: optionalNumber(payload.baseAmount, "baseAmount"),
        target_commission_policy_key: optionalString(payload.commissionPolicyKey) ??
          "commission.driver.percentage.default",
        target_driver_wallet_id: requireUuid(payload.driverWalletId, "driverWalletId"),
        target_escrow_hold_id: requireUuid(payload.escrowHoldId, "escrowHoldId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_order_id: requireUuid(payload.orderId, "orderId"),
        target_source: optionalString(payload.source) ?? "platform.commission_engine",
      }),
      id,
    );
  }

  if (routePath === "/runtime/commission-executions" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("commission_executions")
        .select(
          "id,service_request_id,order_id,escrow_hold_id,driver_wallet_id,commission_policy_id,transaction_id,currency_code,amount,status,policy_snapshot,source,idempotency_key,metadata,created_at,updated_at",
        )
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/runtime/order-settlements/execute" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("execute_order_business_settlement", {
        target_business_wallet_id: requireUuid(payload.businessWalletId, "businessWalletId"),
        target_escrow_hold_id: requireUuid(payload.escrowHoldId, "escrowHoldId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_order_id: requireUuid(payload.orderId, "orderId"),
        target_platform_fee_amount:
          optionalNumber(payload.platformFeeAmount, "platformFeeAmount") ??
            0,
        target_platform_fee_wallet_id: optionalUuid(
          payload.platformFeeWalletId,
          "platformFeeWalletId",
        ),
        target_source: optionalString(payload.source) ?? "platform.settlement_engine",
      }),
      id,
    );
  }

  if (routePath === "/runtime/settlement-statements" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("settlement_statements")
        .select(
          "id,organization_id,service_request_id,order_id,escrow_hold_id,settlement_execution_id,currency_code,gross_amount,platform_fee_amount,net_amount,status,period_start,period_end,source,idempotency_key,metadata,created_at,updated_at",
        )
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/runtime/communications/messages") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("communication_messages")
          .select(
            "id,notification_message_id,provider_adapter_id,channel,purpose,recipient_entity_type,recipient_entity_id,recipient_address,status,payload,source,idempotency_key,metadata,queued_at,sent_at,delivered_at,failed_at,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("queue_communication_message", {
          target_channel: requireString(payload.channel, "channel"),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_payload: optionalRecord(payload.payload) ?? {},
          target_provider_adapter_key: optionalString(payload.providerAdapterKey) ??
            "provider.communication.sandbox",
          target_purpose: requireString(payload.purpose, "purpose"),
          target_recipient_address: optionalString(payload.recipientAddress),
          target_recipient_entity_id: optionalUuid(payload.recipientEntityId, "recipientEntityId"),
          target_recipient_entity_type: requireString(
            payload.recipientEntityType,
            "recipientEntityType",
          ),
          target_source: optionalString(payload.source) ?? "platform.communication_engine",
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/communications/sync" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    return rpcResponse(
      supabase.rpc("sync_communication_message_statuses", {
        target_limit: optionalInteger(body.value.limit) ?? 100,
      }),
      id,
    );
  }

  if (routePath === "/runtime/otp/challenges") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("otp_challenges")
          .select(
            "id,user_id,communication_message_id,purpose,channel,recipient_address,status,expires_at,max_attempts,attempt_count,verified_at,source,idempotency_key,metadata,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      return rpcResponse(
        supabase.rpc("request_otp_challenge", {
          target_channel: requireString(payload.channel, "channel"),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_max_attempts: optionalInteger(payload.maxAttempts) ?? 5,
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_purpose: requireString(payload.purpose, "purpose"),
          target_recipient_address: requireString(payload.recipientAddress, "recipientAddress"),
          target_source: optionalString(payload.source) ?? "platform.otp_engine",
          target_ttl_seconds: optionalInteger(payload.ttlSeconds) ?? 600,
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/otp/verify" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("verify_otp_challenge", {
        target_challenge_id: requireUuid(payload.challengeId, "challengeId"),
        target_code: requireString(payload.code, "code"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/workflows/start" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("start_service_request_workflow", {
        target_context: optionalRecord(payload.context) ?? {},
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_service_request_id: requireUuid(payload.serviceRequestId, "serviceRequestId"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/events/process" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("process_service_request_event", {
        target_event_type_key: requireString(payload.eventTypeKey, "eventTypeKey"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_payload: optionalRecord(payload.payload) ?? {},
        target_service_request_id: requireUuid(payload.serviceRequestId, "serviceRequestId"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/participants/assign" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("assign_service_request_participant", {
        target_entity_id: requireUuid(payload.entityId, "entityId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_participant_role: requireString(payload.participantRole, "participantRole"),
        target_service_request_id: requireUuid(payload.serviceRequestId, "serviceRequestId"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/dispatch/select" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("dispatch_service_request", {
        target_candidate_limit: optionalInteger(payload.candidateLimit) ?? 5,
        target_dispatch_policy_key: optionalString(payload.dispatchPolicyKey),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_service_request_id: requireUuid(payload.serviceRequestId, "serviceRequestId"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/tracking/sessions" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("start_tracking_session", {
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_provider_adapter_id: optionalUuid(payload.providerAdapterId, "providerAdapterId"),
        target_source: optionalString(payload.source) ?? "platform.tracking_engine",
        target_subject_id: requireUuid(payload.subjectId, "subjectId"),
        target_subject_type: requireString(payload.subjectType, "subjectType"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/tracking/points" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("record_tracking_point", {
        target_accuracy_meters: optionalNumber(payload.accuracyMeters, "accuracyMeters"),
        target_heading_degrees: optionalNumber(payload.headingDegrees, "headingDegrees"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_latitude: requireNumber(payload.latitude, "latitude"),
        target_longitude: requireNumber(payload.longitude, "longitude"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_recorded_at: optionalString(payload.recordedAt),
        target_speed_meters_per_second: optionalNumber(
          payload.speedMetersPerSecond,
          "speedMetersPerSecond",
        ),
        target_tracking_session_id: requireUuid(payload.trackingSessionId, "trackingSessionId"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/verifications" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    const verificationResult = await supabase.rpc("record_verification_event", {
      target_definition_key: requireString(payload.definitionKey, "definitionKey"),
      target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
      target_location: optionalRecord(payload.location) ?? {},
      target_occurred_at: optionalString(payload.occurredAt) ?? new Date().toISOString(),
      target_payload: optionalRecord(payload.payload) ?? {},
      target_purpose: requireString(payload.purpose, "purpose"),
      target_result: optionalString(payload.result) ?? "passed",
      target_scanned_entity_id: optionalUuid(payload.scannedEntityId, "scannedEntityId"),
      target_scanned_entity_type: requireString(payload.scannedEntityType, "scannedEntityType"),
      target_source: optionalString(payload.source) ?? "platform.verification_engine",
    });

    if (verificationResult.error) {
      return databaseError(verificationResult.error, id);
    }

    const serviceRequestId = optionalUuid(payload.serviceRequestId, "serviceRequestId");
    const workflowEventTypeKey = optionalString(payload.workflowEventTypeKey);

    if (!serviceRequestId || !workflowEventTypeKey) {
      return jsonResponse({
        ok: true,
        id: verificationResult.data,
        requestId: id,
      });
    }

    const eventResult = await supabase.rpc("process_service_request_event", {
      target_event_type_key: workflowEventTypeKey,
      target_idempotency_key: `${requireString(payload.idempotencyKey, "idempotencyKey")}:workflow`,
      target_payload: {
        verificationEventId: verificationResult.data,
      },
      target_service_request_id: serviceRequestId,
    });

    if (eventResult.error) {
      return databaseError(eventResult.error, id);
    }

    return jsonResponse({
      ok: true,
      id: verificationResult.data,
      eventId: eventResult.data,
      requestId: id,
    });
  }

  if (routePath === "/runtime/notifications/queue" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("queue_notification_message", {
        target_channel: requireString(payload.channel, "channel"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_payload: optionalRecord(payload.payload) ?? {},
        target_provider_adapter_id: optionalUuid(payload.providerAdapterId, "providerAdapterId"),
        target_recipient_address: optionalString(payload.recipientAddress),
        target_recipient_entity_id: optionalUuid(payload.recipientEntityId, "recipientEntityId"),
        target_recipient_entity_type: requireString(
          payload.recipientEntityType,
          "recipientEntityType",
        ),
        target_source: optionalString(payload.source) ?? "platform.notification_engine",
        target_template_key: optionalString(payload.templateKey),
      }),
      id,
    );
  }

  if (routePath === "/runtime/ai/queue" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("queue_ai_task_run", {
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_input: optionalRecord(payload.input) ?? {},
        target_source: optionalString(payload.source) ?? "platform.ai_engine",
        target_subject_id: optionalUuid(payload.subjectId, "subjectId"),
        target_subject_type: requireString(payload.subjectType, "subjectType"),
        target_task_key: requireString(payload.taskKey, "taskKey"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/settlements/execute" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("execute_service_request_settlement", {
        target_distribution: requireArray(payload.distribution, "distribution"),
        target_escrow_hold_id: requireUuid(payload.escrowHoldId, "escrowHoldId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_service_request_id: requireUuid(payload.serviceRequestId, "serviceRequestId"),
        target_source: optionalString(payload.source) ?? "platform.settlement_engine",
      }),
      id,
    );
  }

  if (routePath === "/runtime/escrow/status" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("update_escrow_hold_status", {
        target_escrow_hold_id: requireUuid(payload.escrowHoldId, "escrowHoldId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_status: requireString(payload.status, "status"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/escrow/release" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("release_escrow_hold", {
        target_distribution: requireArray(payload.distribution, "distribution"),
        target_escrow_hold_id: requireUuid(payload.escrowHoldId, "escrowHoldId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_source: optionalString(payload.source) ?? "platform.escrow_engine",
      }),
      id,
    );
  }

  if (routePath === "/runtime/escrow/refund" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("refund_escrow_hold", {
        target_escrow_hold_id: requireUuid(payload.escrowHoldId, "escrowHoldId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_refund_wallet_id: requireUuid(payload.refundWalletId, "refundWalletId"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/reconciliation/service-request" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    return rpcResponse(
      supabase.rpc("reconcile_service_request_financials", {
        target_service_request_id: requireUuid(body.value.serviceRequestId, "serviceRequestId"),
      }),
      id,
    );
  }

  if (routePath === "/modules/catalog" && request.method === "GET") {
    return jsonResponse({
      ok: true,
      data: {
        routes: Array.from(ROUTES).filter((route) => route.startsWith("/modules")),
      },
      requestId: id,
    });
  }

  if (routePath === "/modules") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("business_modules")
          .select("id,key,display_name,description,status,metadata,created_at,updated_at")
          .order("key", { ascending: true }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      const { data, error } = await supabase.rpc("configure_business_module", {
        target_description: optionalString(payload.description),
        target_display_name: requireString(payload.displayName, "displayName"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_module_key: requireString(payload.moduleKey, "moduleKey"),
        target_status: optionalString(payload.status) ?? "draft",
      });

      if (error) {
        return databaseError(error, id);
      }

      return jsonResponse({
        ok: true,
        id: data,
        requestId: id,
      });
    }
  }

  if (routePath === "/modules/versions") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("business_module_versions")
          .select(
            "id,module_id,version,status,manifest,activated_at,retired_at,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      const { data, error } = await supabase.rpc("configure_business_module_version", {
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_manifest: optionalRecord(payload.manifest) ?? {},
        target_module_key: requireString(payload.moduleKey, "moduleKey"),
        target_version: requireInteger(payload.version, "version"),
      });

      if (error) {
        return databaseError(error, id);
      }

      return jsonResponse({
        ok: true,
        id: data,
        requestId: id,
      });
    }
  }

  if (routePath === "/modules/versions/activate" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    const { data, error } = await supabase.rpc("activate_business_module_version", {
      target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
      target_module_key: requireString(payload.moduleKey, "moduleKey"),
      target_version: requireInteger(payload.version, "version"),
    });

    if (error) {
      return databaseError(error, id);
    }

    return jsonResponse({
      ok: true,
      id: data,
      requestId: id,
    });
  }

  if (routePath === "/modules/components") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("business_module_components")
          .select(
            "id,module_version_id,component_type,component_key,reference_key,is_required,config,status,created_at,updated_at",
          )
          .order("component_type", { ascending: true })
          .order("component_key", { ascending: true }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      const { data, error } = await supabase.rpc("configure_business_module_component", {
        target_component_key: requireString(payload.componentKey, "componentKey"),
        target_component_type: requireString(payload.componentType, "componentType"),
        target_config: optionalRecord(payload.config) ?? {},
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_is_required: optionalBoolean(payload.isRequired) ?? true,
        target_module_version_id: requireString(payload.moduleVersionId, "moduleVersionId"),
        target_reference_key: optionalString(payload.referenceKey),
        target_status: optionalString(payload.status) ?? "active",
      });

      if (error) {
        return databaseError(error, id);
      }

      return jsonResponse({
        ok: true,
        id: data,
        requestId: id,
      });
    }
  }

  if (routePath === "/modules/events" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("business_module_events")
        .select("id,module_id,module_version_id,event_type,metadata,created_at")
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/admin/webhook-endpoints") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("webhook_endpoints")
          .select(
            "id,organization_id,url,event_type_keys,signing_secret_ref,delivery_config,status,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      const { data, error } = await supabase
        .from("webhook_endpoints")
        .insert({
          delivery_config: optionalRecord(payload.deliveryConfig) ?? {},
          event_type_keys: optionalStringArray(payload.eventTypeKeys) ?? [],
          organization_id: optionalUuid(payload.organizationId, "organizationId"),
          signing_secret_ref: requireString(payload.signingSecretRef, "signingSecretRef"),
          status: optionalString(payload.status) ?? "active",
          url: requireHttpsUrl(payload.url, "url"),
        })
        .select("id")
        .single();

      if (error) {
        return databaseError(error, id);
      }

      return jsonResponse({
        ok: true,
        id: data.id,
        requestId: id,
      });
    }
  }

  if (routePath === "/admin/webhook-deliveries" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("webhook_deliveries")
        .select(
          "id,endpoint_id,event_id,status,attempt_count,response_status,next_attempt_at,last_error,delivered_at,failed_at,metadata,created_at,updated_at",
        )
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/admin/webhook-attempts" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("webhook_delivery_attempts")
        .select(
          "id,delivery_id,endpoint_id,event_id,attempt_number,status,response_status,error_message,provider_execution_log_id,created_at",
        )
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/admin/webhooks/queue" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    return rpcResponse(
      supabase.rpc("queue_webhook_deliveries", {
        target_event_id: requireUuid(body.value.eventId, "eventId"),
        target_idempotency_key: requireString(body.value.idempotencyKey, "idempotencyKey"),
      }),
      id,
    );
  }

  if (routePath === "/admin/role-templates") {
    if (request.method === "GET") {
      const { data, error } = await supabase
        .from("platform_admin_role_templates")
        .select("id,key,display_name,description,permission_keys,status,is_system,metadata")
        .order("key", { ascending: true });

      if (error) {
        return databaseError(error, id);
      }

      return jsonResponse({
        ok: true,
        data,
        requestId: id,
      });
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      const { data, error } = await supabase.rpc("configure_platform_admin_role", {
        target_description: optionalString(payload.description),
        target_display_name: requireString(payload.displayName, "displayName"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_permission_keys: requireStringArray(payload.permissionKeys, "permissionKeys"),
        target_role_key: requireString(payload.roleKey, "roleKey"),
        target_status: optionalString(payload.status) ?? "active",
      });

      if (error) {
        return databaseError(error, id);
      }

      return jsonResponse({
        ok: true,
        id: data,
        requestId: id,
      });
    }
  }

  if (routePath === "/admin/users") {
    if (request.method === "GET") {
      const { data, error } = await supabase
        .from("platform_admins")
        .select("id,user_id,primary_role_id,admin_kind,title,status,metadata,created_at,updated_at")
        .order("created_at", { ascending: false });

      if (error) {
        return databaseError(error, id);
      }

      return jsonResponse({
        ok: true,
        data,
        requestId: id,
      });
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      const { data, error } = await supabase.rpc("configure_platform_admin", {
        admin_metadata: optionalRecord(payload.metadata) ?? {},
        admin_title: optionalString(payload.title),
        target_role_key: requireString(payload.roleKey, "roleKey"),
        target_user_id: requireString(payload.userId, "userId"),
      });

      if (error) {
        return databaseError(error, id);
      }

      return jsonResponse({
        ok: true,
        id: data,
        requestId: id,
      });
    }
  }

  if (routePath === "/admin/users/revoke" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const { error } = await supabase.rpc("revoke_platform_admin", {
      target_user_id: requireString(body.value.userId, "userId"),
    });

    if (error) {
      return databaseError(error, id);
    }

    return jsonResponse({
      ok: true,
      requestId: id,
    });
  }

  return jsonResponse(
    {
      ok: false,
      error: "route_not_found",
      route: routePath,
      rawRoute: url.pathname,
      availableRoutes: Array.from(ROUTES),
      requestId: id,
    },
    404,
  );
}

type JsonBodyResult =
  | { readonly value: Readonly<Record<string, unknown>> }
  | { readonly response: Response };

class RequestValidationError extends Error {
  override readonly name = "RequestValidationError";
}

interface SelectQuery {
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
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

function isRateLimited(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return (value as { readonly allowed?: unknown }).allowed === false;
}

function normalizeGatewayPath(pathname: string): string {
  if (pathname === "/api-gateway") {
    return "/health";
  }

  if (pathname.startsWith("/api-gateway/")) {
    return pathname.slice("/api-gateway".length);
  }

  return pathname;
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

function requireHttpsUrl(value: unknown, fieldName: string): string {
  const url = requireString(value, fieldName);

  if (!url.startsWith("https://")) {
    throw new RequestValidationError(`${fieldName} must be an HTTPS URL.`);
  }

  return url;
}

function requireInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new RequestValidationError(`${fieldName} must be an integer.`);
  }

  return value;
}

function optionalInteger(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requireInteger(value, "optional integer field");
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

function optionalBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "boolean") {
    throw new RequestValidationError("optional boolean field must be a boolean.");
  }

  return value;
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

function requireArray(value: unknown, fieldName: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new RequestValidationError(`${fieldName} must be a JSON array.`);
  }

  return value;
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
