import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.110.9";

import { createRequestSupabaseClient, requireAuthenticatedUser } from "../_shared/supabase-auth.ts";
import { jsonResponse, optionsResponse, requestId } from "../_shared/http.ts";

const ROUTES = new Set([
  "/health",
  "/admin/permissions",
  "/admin/organizations",
  "/admin/role-templates",
  "/admin/profiles",
  "/admin/profiles/status",
  "/admin/users",
  "/admin/users/revoke",
  "/admin/content/placements",
  "/admin/content/publications",
  "/admin/content/publications/state",
  "/admin/financial-policies",
  "/admin/financial-policies/history",
  "/admin/financial-policies/resolve",
  "/admin/financial-policies/submit",
  "/admin/financial-policies/review",
  "/admin/financial-policies/activate",
  "/admin/financial-policies/deactivate",
  "/admin/financial-policies/rollback",
  "/admin/system/overview",
  "/admin/system/health",
  "/admin/system/jobs",
  "/admin/system/jobs/action",
  "/admin/system/logs",
  "/admin/system/errors",
  "/admin/system/audit",
  "/admin/system/configuration",
  "/admin/system/job-queues",
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
  "/lpg/catalog",
  "/lpg/config",
  "/lpg/workspace-access",
  "/lpg/locations",
  "/lpg/cylinders",
  "/lpg/cylinders/name",
  "/lpg/cylinders/media",
  "/lpg/cylinders/history",
  "/lpg/quotes",
  "/lpg/orders",
  "/lpg/orders/reserve-payment",
  "/lpg/orders/active",
  "/lpg/orders/dispatch",
  "/lpg/orders/accept-assignment",
  "/lpg/orders/actions",
  "/lpg/orders/delivery-challenge",
  "/lpg/orders/settle-station",
  "/lpg/orders/execute-driver-commission",
  "/lpg/orders/refund",
  "/lpg/orders/financial-summary",
  "/lpg/stations",
  "/lpg/stations/activate",
  "/lpg/stations/runtime",
  "/lpg/stations/catalog-prices",
  "/lpg/stations/settings",
  "/lpg/stations/capacity-adjustments",
  "/lpg/jobs",
  "/lpg/inspections",
  "/lpg/scans",
  "/lpg/refills/confirm",
  "/lpg/driver-locations",
  "/lpg/safety-incidents",
  "/lpg/maps/autocomplete",
  "/lpg/maps/geocode",
  "/lpg/maps/reverse-geocode",
  "/lpg/maps/route-estimate",
  "/runtime/catalog",
  "/runtime/session-context",
  "/runtime/profile/avatar",
  "/runtime/catalog/units",
  "/runtime/catalog/categories",
  "/runtime/catalog/items",
  "/runtime/catalog/variants",
  "/runtime/catalog/prices",
  "/runtime/catalog/media",
  "/runtime/catalog/availability",
  "/runtime/catalog/stock-adjustments",
  "/runtime/catalog/orderability",
  "/runtime/media/upload-sessions",
  "/runtime/media/read-sessions",
  "/runtime/media/assets",
  "/runtime/media/entity-links",
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
  "/runtime/vehicle-types",
  "/runtime/vehicles",
  "/runtime/driver-vehicle-links",
  "/runtime/organization-branches",
  "/runtime/organization-roles",
  "/runtime/organization-memberships",
  "/runtime/organization-user-roles",
  "/runtime/organization-invitations",
  "/runtime/organization-invitations/accept",
  "/runtime/organization-staff/directory",
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
  "/runtime/otp/delivery",
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
  "/runtime/ai/process",
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

  if (routePath === "/runtime/session-context" && request.method === "GET") {
    return resolveSessionContext(supabase, authResult.user, id);
  }

  if (routePath === "/runtime/profile/avatar") {
    if (request.method === "POST") {
      const body = await readJsonBody(request, id);
      if ("response" in body) return body.response;
      return rpcResponse(
        supabase.rpc("set_profile_avatar_media", {
          target_media_asset_id: requireUuid(body.value.mediaAssetId, "mediaAssetId"),
        }),
        id,
      );
    }

    if (request.method === "DELETE") {
      const previous = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", authResult.user.id)
        .maybeSingle();

      if (previous.error) return databaseError(previous.error, id);

      const avatarValue = stringOrNull(getRecordValue(previous.data, "avatar_url"));
      const assetId = avatarValue && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(avatarValue)
        ? avatarValue
        : null;
      const clearResult = await supabase.rpc("clear_profile_avatar_media");
      if (clearResult.error) return databaseError(clearResult.error, id);

      if (assetId) {
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!serviceRoleKey) {
          return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
        }

        const asset = await supabase
          .from("media_assets")
          .select("id,storage_bucket,storage_path")
          .eq("id", assetId)
          .eq("owner_user_id", authResult.user.id)
          .maybeSingle();

        if (asset.error) return databaseError(asset.error, id);
        if (asset.data) {
          const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
          const bucket = requireString(getRecordValue(asset.data, "storage_bucket"), "storageBucket");
          const path = requireString(getRecordValue(asset.data, "storage_path"), "storagePath");
          const removal = await serviceClient.storage.from(bucket).remove([path]);
          if (removal.error) return databaseError(removal.error, id);
          const archive = await serviceClient
            .from("media_assets")
            .update({ status: "deleted", updated_at: new Date().toISOString() })
            .eq("id", assetId);
          if (archive.error) return databaseError(archive.error, id);
        }
      }

      return jsonResponse({ ok: true, id: assetId, requestId: id });
    }
  }

  if (routePath === "/admin/financial-policies") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("financial_policy_versions")
          .select(
            "id,version,lifecycle_status,organization_id,module_id,service_key,geography_type,geography_key,currency_code,priority,configuration,effective_from,effective_until,change_reason,validation_snapshot,based_on_version_id,supersedes_version_id,rollback_of_version_id,submitted_by,submitted_at,approved_by,approved_at,activated_by,activated_at,deactivated_by,deactivated_at,created_by,created_at,updated_at,financial_policy_definitions!inner(id,key,display_name,policy_family,approval_required,allow_partner_delegation,status,metadata)",
          )
          .order("created_at", { ascending: false }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);
      if ("response" in body) return body.response;
      const payload = body.value;

      return rpcResponse(
        supabase.rpc("create_financial_policy_version", {
          target_allow_partner_delegation: optionalBoolean(payload.allowPartnerDelegation) ?? false,
          target_approval_required: optionalBoolean(payload.approvalRequired) ?? true,
          target_based_on_version_id: optionalUuid(payload.basedOnVersionId, "basedOnVersionId"),
          target_change_reason: requireString(payload.changeReason, "changeReason"),
          target_configuration: requireRecord(payload.configuration, "configuration"),
          target_currency_code: requireString(payload.currencyCode, "currencyCode"),
          target_display_name: requireString(payload.displayName, "displayName"),
          target_effective_from: requireString(payload.effectiveFrom, "effectiveFrom"),
          target_effective_until: optionalString(payload.effectiveUntil),
          target_geography_key: optionalString(payload.geographyKey),
          target_geography_type: optionalString(payload.geographyType) ?? "global",
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_module_key: optionalString(payload.moduleKey),
          target_organization_id: optionalUuid(payload.organizationId, "organizationId"),
          target_policy_family: requireString(payload.policyFamily, "policyFamily"),
          target_policy_key: requireString(payload.policyKey, "policyKey"),
          target_priority: optionalInteger(payload.priority) ?? 100,
          target_rollback_of_version_id: optionalUuid(payload.rollbackOfVersionId, "rollbackOfVersionId"),
          target_service_key: optionalString(payload.serviceKey),
          target_supersedes_version_id: optionalUuid(payload.supersedesVersionId, "supersedesVersionId"),
        }),
        id,
      );
    }
  }

  if (routePath === "/admin/financial-policies/history" && request.method === "GET") {
    const policyVersionId = optionalUuid(url.searchParams.get("policyVersionId"), "policyVersionId");
    let query = supabase
      .from("financial_policy_events")
      .select("id,policy_version_id,event_type,actor_user_id,previous_state,new_state,reason,created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (policyVersionId) {
      query = query.eq("policy_version_id", policyVersionId);
    }

    return selectRecords(
      query,
      id,
    );
  }

  if (routePath === "/admin/financial-policies/resolve" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcDataResponse(
      supabase.rpc("resolve_financial_policy", {
        target_at: optionalString(payload.at) ?? new Date().toISOString(),
        target_currency_code: requireString(payload.currencyCode, "currencyCode"),
        target_geography_key: optionalString(payload.geographyKey),
        target_geography_type: optionalString(payload.geographyType) ?? "global",
        target_module_key: optionalString(payload.moduleKey),
        target_organization_id: optionalUuid(payload.organizationId, "organizationId"),
        target_policy_key: requireString(payload.policyKey, "policyKey"),
        target_service_key: optionalString(payload.serviceKey),
      }),
      id,
    );
  }

  if (routePath === "/admin/financial-policies/submit" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    return rpcResponse(
      supabase.rpc("submit_financial_policy_version", {
        target_idempotency_key: requireString(body.value.idempotencyKey, "idempotencyKey"),
        target_policy_version_id: requireUuid(body.value.policyVersionId, "policyVersionId"),
        target_reason: requireString(body.value.reason, "reason"),
      }),
      id,
    );
  }

  if (routePath === "/admin/financial-policies/review" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    return rpcResponse(
      supabase.rpc("review_financial_policy_version", {
        target_decision: requireString(body.value.decision, "decision"),
        target_idempotency_key: requireString(body.value.idempotencyKey, "idempotencyKey"),
        target_policy_version_id: requireUuid(body.value.policyVersionId, "policyVersionId"),
        target_reason: requireString(body.value.reason, "reason"),
      }),
      id,
    );
  }

  if (routePath === "/admin/financial-policies/activate" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    return rpcResponse(
      supabase.rpc("activate_financial_policy_version", {
        target_idempotency_key: requireString(body.value.idempotencyKey, "idempotencyKey"),
        target_policy_version_id: requireUuid(body.value.policyVersionId, "policyVersionId"),
        target_reason: requireString(body.value.reason, "reason"),
      }),
      id,
    );
  }

  if (routePath === "/admin/financial-policies/deactivate" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    return rpcResponse(
      supabase.rpc("deactivate_financial_policy_version", {
        target_idempotency_key: requireString(body.value.idempotencyKey, "idempotencyKey"),
        target_policy_version_id: requireUuid(body.value.policyVersionId, "policyVersionId"),
        target_reason: requireString(body.value.reason, "reason"),
      }),
      id,
    );
  }

  if (routePath === "/admin/financial-policies/rollback" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    return rpcResponse(
      supabase.rpc("rollback_financial_policy_version", {
        target_active_version_id: requireUuid(body.value.activeVersionId, "activeVersionId"),
        target_effective_from: requireString(body.value.effectiveFrom, "effectiveFrom"),
        target_idempotency_key: requireString(body.value.idempotencyKey, "idempotencyKey"),
        target_reason: requireString(body.value.reason, "reason"),
        target_restore_version_id: requireUuid(body.value.restoreVersionId, "restoreVersionId"),
      }),
      id,
    );
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

  if (routePath === "/lpg/catalog" && request.method === "GET") {
    const pricingResult = await supabase
      .from("lpg_refill_pricing")
      .select(
        "id,station_branch_id,currency_code,price_per_kg,min_kg,max_kg,status,effective_from,effective_until",
      )
      .eq("status", "active")
      .order("effective_from", { ascending: false });

    if (pricingResult.error) {
      return databaseError(pricingResult.error, id);
    }

    const stationsResult = await supabase
      .from("lpg_station_branches")
      .select(
        "id,organization_id,branch_id,display_name,formatted_address,latitude,longitude,service_radius_meters,operating_hours,supported_cylinder_sizes_kg,refill_capacity_kg,current_available_kg,availability_status,approval_status,compliance_status,metadata",
      )
      .eq("approval_status", "approved")
      .eq("compliance_status", "approved")
      .order("display_name", { ascending: true });

    if (stationsResult.error) {
      return databaseError(stationsResult.error, id);
    }

    return jsonResponse({
      ok: true,
      data: {
        pricing: Array.isArray(pricingResult.data) ? pricingResult.data : [],
        stations: Array.isArray(stationsResult.data) ? stationsResult.data : [],
      },
      requestId: id,
    });
  }

  if (routePath === "/lpg/config") {
    if (request.method === "GET") {
      return rpcDataResponse(supabase.rpc("read_lpg_runtime_config"), id);
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      const configType = requireString(payload.configType, "configType");

      if (configType === "operationPolicy") {
        return rpcResponse(
          supabase.rpc("configure_lpg_operation_policy", {
            target_display_name: requireString(payload.displayName, "displayName"),
            target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
            target_metadata: optionalRecord(payload.metadata) ?? {},
            target_policy: requireRecord(payload.policy, "policy"),
            target_policy_key: requireString(payload.policyKey, "policyKey"),
            target_policy_kind: requireString(payload.policyKind, "policyKind"),
            target_priority: optionalInteger(payload.priority) ?? 100,
            target_source: optionalString(payload.source) ?? "skima.lpg.config_api",
          }),
          id,
        );
      }

      if (configType === "cylinderTypeProfile") {
        return rpcResponse(
          supabase.rpc("configure_lpg_cylinder_type_profile", {
            target_display_name: requireString(payload.displayName, "displayName"),
            target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
            target_key: requireString(payload.key, "key"),
            target_max_capacity_kg: requireNumber(payload.maxCapacityKg, "maxCapacityKg"),
            target_metadata: optionalRecord(payload.metadata) ?? {},
            target_refill_tolerance_kg: optionalNumber(
              payload.refillToleranceKg,
              "refillToleranceKg",
            ) ?? 0,
            target_size_kg: requireNumber(payload.sizeKg, "sizeKg"),
            target_source: optionalString(payload.source) ?? "skima.lpg.config_api",
          }),
          id,
        );
      }

      if (configType === "pricing") {
        return rpcResponse(
          supabase.rpc("configure_lpg_refill_pricing", {
            target_currency_code: optionalString(payload.currencyCode) ?? "NGN",
            target_delivery_base_fee: 0,
            target_driver_commission_amount: 0,
            target_effective_from: optionalString(payload.effectiveFrom),
            target_effective_until: optionalString(payload.effectiveUntil),
            target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
            target_max_kg: optionalNumber(payload.maxKg, "maxKg") ?? 999999999.999,
            target_metadata: optionalRecord(payload.metadata) ?? {},
            target_min_kg: optionalNumber(payload.minKg, "minKg") ?? 0.001,
            target_platform_fee_amount: 0,
            target_price_per_kg: requireNumber(payload.pricePerKg, "pricePerKg"),
            target_source: optionalString(payload.source) ?? "skima.lpg.pricing_api",
            target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
            target_tax_rate_percent: 0,
          }),
          id,
        );
      }

      if (configType === "stationPrice") {
        if (payload.itemId) {
          return rpcResponse(
            supabase.rpc("configure_lpg_station_catalog_price", {
              target_effective_from: optionalString(payload.effectiveFrom) ?? new Date().toISOString(),
              target_effective_until: optionalString(payload.effectiveUntil),
              target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
              target_item_id: requireUuid(payload.itemId, "itemId"),
              target_metadata: optionalRecord(payload.metadata) ?? {},
              target_price_per_kg: requireNumber(payload.pricePerKg, "pricePerKg"),
              target_source: optionalString(payload.source) ?? "skima.lpg.station_catalog_price",
              target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
            }),
            id,
          );
        }

        return rpcResponse(
          supabase.rpc("configure_lpg_station_price", {
            target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
            target_metadata: optionalRecord(payload.metadata) ?? {},
            target_price_per_kg: requireNumber(payload.pricePerKg, "pricePerKg"),
            target_source: optionalString(payload.source) ?? "skima.lpg.station_price",
            target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
          }),
          id,
        );
      }

      throw new RequestValidationError("configType is not supported.");
    }
  }

  if (routePath === "/lpg/workspace-access" && request.method === "GET") {
    return resolveLpgMobileWorkspaceAccess(supabase, authResult.user, id);
  }

  if (routePath === "/lpg/stations") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("lpg_station_branches")
          .select(
            "id,organization_id,branch_id,display_name,formatted_address,latitude,longitude,service_radius_meters,operating_hours,supported_cylinder_sizes_kg,refill_capacity_kg,current_available_kg,availability_status,approval_status,compliance_status,metadata,created_at,updated_at",
          )
          .order("display_name", { ascending: true }),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      return lpgStationActivationResponse(supabase, body.value, id);
    }
  }

  if (routePath === "/lpg/stations/activate" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    return lpgStationActivationResponse(supabase, body.value, id);
  }

  if (routePath === "/lpg/stations/runtime" && request.method === "GET") {
    return rpcDataResponse(
      supabase.rpc("read_lpg_station_runtime", {
        target_limit: optionalIntegerQuery(url.searchParams.get("limit")) ?? 100,
        target_station_branch_id: optionalUuid(
          url.searchParams.get("stationBranchId"),
          "stationBranchId",
        ),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/catalog-prices" && request.method === "GET") {
    return rpcDataResponse(
      supabase.rpc("read_lpg_station_catalog_prices", {
        target_station_branch_id: optionalUuid(
          url.searchParams.get("stationBranchId"),
          "stationBranchId",
        ),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/settings" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("update_lpg_station_settings", {
        target_availability_status: optionalString(payload.availabilityStatus),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_operating_hours: optionalRecord(payload.operatingHours),
        target_source: optionalString(payload.source) ?? "skima.lpg.station_settings",
        target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/capacity-adjustments" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("adjust_lpg_station_capacity", {
        target_adjustment_kg: requireNumber(payload.adjustmentKg, "adjustmentKg"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_reason_key: requireString(payload.reasonKey, "reasonKey"),
        target_source: optionalString(payload.source) ?? "skima.lpg.station_capacity",
        target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/jobs" && request.method === "GET") {
    const lpgOrderId = url.searchParams.get("lpgOrderId");
    if (lpgOrderId) {
      return rpcDataResponse(
        supabase.rpc("read_lpg_job_details", {
          target_lpg_order_id: requireUuid(lpgOrderId, "lpgOrderId"),
        }),
        id,
      );
    }
    return rpcDataResponse(
      supabase.rpc("read_lpg_jobs", {
        target_limit: optionalIntegerQuery(url.searchParams.get("limit")) ?? 50,
        target_queue: url.searchParams.get("queue"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/locations") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("lpg_customer_locations")
          .select(
            "id,label,formatted_address,latitude,longitude,accuracy_meters,landmark,delivery_instructions,contact_name,contact_phone,verification_status,status,provider_source,provider_place_id,metadata,created_at,updated_at",
          )
          .neq("status", "deleted")
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
        supabase.rpc("create_lpg_customer_location", {
          target_accuracy_meters: optionalNumber(payload.accuracyMeters, "accuracyMeters"),
          target_contact_name: optionalString(payload.contactName),
          target_contact_phone: optionalString(payload.contactPhone),
          target_delivery_instructions: optionalString(payload.deliveryInstructions),
          target_formatted_address: requireString(payload.formattedAddress, "formattedAddress"),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_label: requireString(payload.label, "label"),
          target_landmark: optionalString(payload.landmark),
          target_latitude: requireNumber(payload.latitude, "latitude"),
          target_longitude: requireNumber(payload.longitude, "longitude"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_provider_place_id: optionalString(payload.providerPlaceId),
          target_provider_source: optionalString(payload.providerSource),
          target_source: optionalString(payload.source) ?? "skima.lpg.location_api",
        }),
        id,
      );
    }
  }

  if (routePath === "/lpg/cylinders") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("lpg_cylinders")
          .select(
            "id,public_reference,display_name,cylinder_identifier,qr_payload,barcode_payload,size_kg,max_capacity_kg,manufacturer,brand,colour,serial_number,manufactured_at,last_inspection_at,next_inspection_at,condition_status,valve_type,ownership_proof_asset_id,ownership_proof_media_asset_id,image_asset_ids,status,safety_restriction,notes,metadata,created_at,updated_at",
          )
          .neq("status", "deactivated")
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
      return rpcResponseWithPublicReference(
        supabase.rpc("register_customer_lpg_cylinder", {
          target_brand: optionalString(payload.brand),
          target_colour: optionalString(payload.colour),
          target_condition_status: optionalString(payload.conditionStatus) ?? "unknown",
          target_display_name: requireString(payload.displayName, "displayName"),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_image_asset_ids: optionalStringArray(payload.imageAssetIds) ?? [],
          target_manufacturer: optionalString(payload.manufacturer),
          target_max_capacity_kg: requireNumber(payload.maxCapacityKg, "maxCapacityKg"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_serial_number: optionalString(payload.serialNumber),
          target_size_kg: requireNumber(payload.sizeKg, "sizeKg"),
          target_source: optionalString(payload.source) ?? "skima.lpg.customer_cylinder_registration",
        }),
        id,
        supabase,
        "lpg_cylinders",
      );
    }
  }

  if (routePath === "/lpg/cylinders/name" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    return rpcResponse(
      supabase.rpc("set_lpg_cylinder_display_name", {
        target_cylinder_id: requireUuid(body.value.cylinderId, "cylinderId"),
        target_display_name: requireString(body.value.displayName, "displayName"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/cylinders/media" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("attach_lpg_cylinder_media", {
        target_cylinder_id: requireUuid(payload.cylinderId, "cylinderId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_media_asset_id: requireUuid(payload.mediaAssetId, "mediaAssetId"),
        target_media_role: optionalString(payload.mediaRole) ?? "image",
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_source: optionalString(payload.source) ?? "skima.lpg.mobile",
      }),
      id,
    );
  }

  if (routePath === "/lpg/cylinders/history" && request.method === "GET") {
    const cylinderId = url.searchParams.get("cylinderId");

    if (cylinderId) {
      return selectRecords(
        supabase
          .from("lpg_cylinder_history")
          .select(
            "id,cylinder_id,event_type,lpg_order_id,station_branch_id,driver_profile_id,kilograms_filled,observations,location,created_at",
          )
          .eq("cylinder_id", requireUuid(cylinderId, "cylinderId"))
          .order("created_at", { ascending: false }),
        id,
      );
    }

    return selectRecords(
      supabase
        .from("lpg_cylinder_history")
        .select(
          "id,cylinder_id,event_type,lpg_order_id,station_branch_id,driver_profile_id,kilograms_filled,observations,location,created_at",
        )
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/lpg/quotes") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("lpg_refill_quotes")
          .select(
            "id,public_reference,service_request_id,price_quote_id,cylinder_id,pickup_location_id,delivery_location_id,station_branch_id,pricing_id,requested_kg,quoted_kg,currency_code,lpg_amount,delivery_fee_amount,platform_fee_amount,tax_amount,driver_commission_amount,total_amount,status,expires_at,breakdown,financial_policy_snapshot,metadata,created_at,updated_at",
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
      const stationBranchId = requireUuid(payload.stationBranchId, "stationBranchId");
      const pickupLocationId = requireUuid(payload.pickupLocationId, "pickupLocationId");
      const deliveryLocationId = requireUuid(payload.deliveryLocationId, "deliveryLocationId");
      const routeSnapshotResult = await buildLpgCommercialRouteSnapshot(
        supabase,
        pickupLocationId,
        deliveryLocationId,
        stationBranchId,
        id,
      );

      if ("response" in routeSnapshotResult) {
        return routeSnapshotResult.response;
      }

      return rpcResponseWithPublicReference(
        supabase.rpc("create_lpg_refill_quote_from_commercial_snapshot", {
          target_cylinder_id: requireUuid(payload.cylinderId, "cylinderId"),
          target_delivery_instructions: optionalString(payload.deliveryInstructions),
          target_delivery_location_id: deliveryLocationId,
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_pickup_location_id: pickupLocationId,
          target_preferred_time: optionalString(payload.preferredTime),
          target_requested_kg: requireNumber(payload.requestedKg, "requestedKg"),
          target_route_snapshot: routeSnapshotResult.data,
          target_source: optionalString(payload.source) ?? "skima.lpg.quote_api",
          target_station_branch_id: stationBranchId,
        }),
        id,
        supabase,
        "lpg_refill_quotes",
      );
    }
  }

  if (routePath === "/lpg/orders") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("lpg_refill_orders")
          .select(
            "id,public_reference,lpg_refill_quote_id,service_request_id,price_quote_id,cylinder_id,pickup_location_id,delivery_location_id,station_branch_id,driver_profile_id,vehicle_id,tracking_session_id,escrow_hold_id,currency_code,requested_kg,quoted_kg,actual_kg,total_amount,station_amount,delivery_fee_amount,platform_fee_amount,driver_commission_amount,status,payment_status,assignment_status,financial_policy_snapshot,metadata,created_at,updated_at",
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
      return rpcResponseWithPublicReference(
        supabase.rpc("create_lpg_refill_order", {
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_lpg_refill_quote_id: requireUuid(payload.lpgRefillQuoteId, "lpgRefillQuoteId"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_source: optionalString(payload.source) ?? "skima.lpg.order_api",
        }),
        id,
        supabase,
        "lpg_refill_orders",
      );
    }
  }

  if (routePath === "/lpg/orders/reserve-payment" && request.method === "POST") {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      return jsonResponse(
        {
          ok: false,
          error: "server_misconfigured",
          requestId: id,
        },
        500,
      );
    }

    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);

    return lpgPaymentReservationResponse(
      serviceClient.rpc("reserve_lpg_refill_order_payment", {
        target_actor_user_id: authResult.user.id,
        target_customer_wallet_id: optionalUuid(payload.customerWalletId, "customerWalletId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_lpg_order_id: requireUuid(payload.lpgOrderId, "lpgOrderId"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_source: optionalString(payload.source) ?? "skima.lpg.payment_api",
      }),
      id,
      serviceClient,
    );
  }

  if (routePath === "/lpg/orders/active" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("lpg_refill_orders")
        .select(
          "id,public_reference,lpg_refill_quote_id,service_request_id,price_quote_id,cylinder_id,pickup_location_id,delivery_location_id,station_branch_id,driver_profile_id,vehicle_id,tracking_session_id,escrow_hold_id,currency_code,requested_kg,quoted_kg,actual_kg,total_amount,station_amount,delivery_fee_amount,platform_fee_amount,driver_commission_amount,status,payment_status,assignment_status,financial_policy_snapshot,metadata,created_at,updated_at",
        )
        .in("status", [
          "awaiting_payment",
          "payment_reserved",
          "matching_station",
          "matching_driver",
          "driver_offered",
          "driver_accepted",
          "pickup_en_route",
          "pickup_verified",
          "station_en_route",
          "station_verified",
          "refill_in_progress",
          "refill_confirmed",
          "station_settled",
          "return_en_route",
          "delivery_verification_pending",
          "delivered",
          "disputed",
        ])
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/lpg/orders/dispatch" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    const lpgOrderId = requireUuid(payload.lpgOrderId, "lpgOrderId");
    const operationsCheck = await supabase.rpc("can_manage_lpg_operations");

    if (operationsCheck.error) {
      return databaseError(operationsCheck.error, id);
    }

    if (operationsCheck.data !== true) {
      return jsonResponse({ ok: false, error: "forbidden", requestId: id }, 403);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
    }

    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    return rpcResponse(
      serviceClient.rpc("dispatch_lpg_order", {
        target_candidate_limit: optionalInteger(payload.candidateLimit),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_lpg_order_id: lpgOrderId,
        target_source: optionalString(payload.source) ?? "skima.lpg.dispatch_api",
      }),
      id,
    );
  }

  if (routePath === "/lpg/orders/accept-assignment" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
    }

    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    return rpcResponse(
      serviceClient.rpc("accept_lpg_driver_assignment", {
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_lpg_order_id: requireUuid(payload.lpgOrderId, "lpgOrderId"),
        target_metadata: {
          ...(optionalRecord(payload.metadata) ?? {}),
          server_actor_user_id: authResult.user.id,
        },
        target_source: optionalString(payload.source) ?? "skima.lpg.driver_api",
      }),
      id,
    );
  }

  if (routePath === "/lpg/orders/actions" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("process_lpg_order_action", {
        target_action_key: requireString(payload.actionKey, "actionKey"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_lpg_order_id: requireUuid(payload.lpgOrderId, "lpgOrderId"),
        target_payload: optionalRecord(payload.payload) ?? {},
        target_source: optionalString(payload.source) ?? "skima.lpg.order_action_api",
      }),
      id,
    );
  }

  if (routePath === "/lpg/orders/delivery-challenge" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    const action = optionalString(payload.action) ?? "request";

    if (action === "request") {
      return rpcResponse(
        supabase.rpc("request_lpg_delivery_challenge", {
          target_channel: optionalString(payload.channel) ?? "in_app",
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_lpg_order_id: requireUuid(payload.lpgOrderId, "lpgOrderId"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_recipient_address: requireString(payload.recipientAddress, "recipientAddress"),
          target_source: optionalString(payload.source) ?? "skima.lpg.delivery_challenge_api",
        }),
        id,
      );
    }

    if (action === "verify") {
      return rpcResponse(
        supabase.rpc("verify_lpg_delivery_challenge", {
          target_challenge_id: requireUuid(payload.challengeId, "challengeId"),
          target_code: requireString(payload.code, "code"),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_lpg_order_id: requireUuid(payload.lpgOrderId, "lpgOrderId"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
        }),
        id,
      );
    }

    throw new RequestValidationError("delivery challenge action is not supported.");
  }

  if (routePath === "/lpg/orders/settle-station" && request.method === "POST") {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
    }

    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    return rpcResponse(
      serviceClient.rpc("settle_lpg_station_order", {
        target_actor_user_id: authResult.user.id,
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_lpg_order_id: requireUuid(payload.lpgOrderId, "lpgOrderId"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_platform_wallet_id: optionalUuid(payload.platformWalletId, "platformWalletId"),
        target_source: optionalString(payload.source) ?? "skima.lpg.station_settlement_api",
        target_station_wallet_id: optionalUuid(payload.stationWalletId, "stationWalletId"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/orders/execute-driver-commission" && request.method === "POST") {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
    }

    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    return rpcResponse(
      serviceClient.rpc("execute_lpg_driver_commission", {
        target_actor_user_id: authResult.user.id,
        target_driver_wallet_id: optionalUuid(payload.driverWalletId, "driverWalletId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_lpg_order_id: requireUuid(payload.lpgOrderId, "lpgOrderId"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_source: optionalString(payload.source) ?? "skima.lpg.driver_commission_api",
      }),
      id,
    );
  }

  if (routePath === "/lpg/orders/refund" && request.method === "POST") {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
    }

    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    return rpcResponse(
      serviceClient.rpc("refund_lpg_order_payment", {
        target_actor_user_id: authResult.user.id,
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_lpg_order_id: requireUuid(payload.lpgOrderId, "lpgOrderId"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_reason_key: optionalString(payload.reasonKey) ?? "lpg.refund.manual",
        target_refund_amount: optionalNumber(payload.refundAmount, "refundAmount"),
        target_source: optionalString(payload.source) ?? "skima.lpg.refund_api",
      }),
      id,
    );
  }

  if (routePath === "/lpg/orders/financial-summary" && request.method === "GET") {
    const lpgOrderId = requireUuid(url.searchParams.get("lpgOrderId"), "lpgOrderId");
    const accessCheck = await supabase.rpc("can_access_lpg_order", {
      target_lpg_order_id: lpgOrderId,
    });

    if (accessCheck.error) {
      return databaseError(accessCheck.error, id);
    }

    if (accessCheck.data !== true) {
      return jsonResponse({ ok: false, error: "forbidden", requestId: id }, 403);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
    }

    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    return rpcDataResponse(
      serviceClient.rpc("reconcile_lpg_order_financials", {
        target_lpg_order_id: lpgOrderId,
      }),
      id,
    );
  }

  if (routePath === "/lpg/inspections") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("lpg_cylinder_inspections")
          .select(
            "id,lpg_order_id,cylinder_id,station_branch_id,inspected_by_user_id,verification_event_id,result,evidence_media_asset_ids,observations,source,idempotency_key,created_at,updated_at",
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
        supabase.rpc("record_lpg_cylinder_inspection", {
          target_evidence_media_asset_ids: optionalStringArray(payload.evidenceMediaAssetIds) ?? [],
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_lpg_order_id: requireUuid(payload.lpgOrderId, "lpgOrderId"),
          target_observations: optionalRecord(payload.observations) ?? {},
          target_result: requireString(payload.result, "result"),
          target_source: optionalString(payload.source) ?? "skima.lpg.inspection_api",
        }),
        id,
      );
    }
  }

  if (routePath === "/lpg/scans" && request.method === "GET") {
    let query = supabase
      .from("lpg_cylinder_scans")
      .select("id,public_reference,lpg_order_id,cylinder_id,scan_type,scanned_by_user_id,driver_profile_id,station_branch_id,verification_event_id,latitude,longitude,accuracy_meters,result,payload,created_at")
      .order("created_at", { ascending: false });
    const lpgOrderId = url.searchParams.get("lpgOrderId");
    if (lpgOrderId) query = query.eq("lpg_order_id", requireUuid(lpgOrderId, "lpgOrderId"));
    return selectRecords(query, id);
  }

  if (routePath === "/lpg/scans" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponseWithPublicReference(
      supabase.rpc("record_lpg_cylinder_scan", {
        target_accuracy_meters: optionalNumber(payload.accuracyMeters, "accuracyMeters"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_latitude: optionalNumber(payload.latitude, "latitude"),
        target_longitude: optionalNumber(payload.longitude, "longitude"),
        target_lpg_order_id: requireUuid(payload.lpgOrderId, "lpgOrderId"),
        target_payload: optionalRecord(payload.payload) ?? {},
        target_scan_type: requireString(payload.scanType, "scanType"),
        target_source: optionalString(payload.source) ?? "skima.lpg.verification_api",
      }),
      id,
      supabase,
      "lpg_cylinder_scans",
    );
  }

  if (routePath === "/lpg/refills/confirm" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("confirm_lpg_refill", {
        target_actual_kg: requireNumber(payload.actualKg, "actualKg"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_lpg_order_id: requireUuid(payload.lpgOrderId, "lpgOrderId"),
        target_price_per_kg: optionalNumber(payload.pricePerKg, "pricePerKg"),
        target_safety_observations: optionalRecord(payload.safetyObservations) ?? {},
        target_source: optionalString(payload.source) ?? "skima.lpg.station_api",
      }),
      id,
    );
  }

  if (routePath === "/lpg/driver-locations") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("lpg_driver_locations")
          .select(
            "id,driver_profile_id,user_id,lpg_order_id,latitude,longitude,accuracy_meters,heading_degrees,speed_meters_per_second,online_status,recorded_at,metadata,created_at",
          )
          .order("recorded_at", { ascending: false }),
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
        supabase.rpc("record_lpg_driver_location", {
          target_accuracy_meters: optionalNumber(payload.accuracyMeters, "accuracyMeters"),
          target_driver_profile_id: requireUuid(payload.driverProfileId, "driverProfileId"),
          target_heading_degrees: optionalNumber(payload.headingDegrees, "headingDegrees"),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_latitude: requireNumber(payload.latitude, "latitude"),
          target_longitude: requireNumber(payload.longitude, "longitude"),
          target_lpg_order_id: optionalUuid(payload.lpgOrderId, "lpgOrderId"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_online_status: optionalString(payload.onlineStatus) ?? "online",
          target_recorded_at: optionalString(payload.recordedAt),
          target_source: optionalString(payload.source) ?? "skima.lpg.driver_location_api",
          target_speed_meters_per_second: optionalNumber(
            payload.speedMetersPerSecond,
            "speedMetersPerSecond",
          ),
        }),
        id,
      );
    }
  }

  if (routePath === "/lpg/safety-incidents") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("lpg_safety_incidents")
          .select(
            "id,lpg_order_id,cylinder_id,station_branch_id,driver_profile_id,incident_type,severity,status,description,metadata,created_at,updated_at",
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
        supabase.rpc("create_lpg_safety_incident", {
          target_cylinder_id: optionalUuid(payload.cylinderId, "cylinderId"),
          target_description: requireString(payload.description, "description"),
          target_driver_profile_id: optionalUuid(payload.driverProfileId, "driverProfileId"),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_incident_type: requireString(payload.incidentType, "incidentType"),
          target_lpg_order_id: optionalUuid(payload.lpgOrderId, "lpgOrderId"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_severity: optionalString(payload.severity) ?? "medium",
          target_source: optionalString(payload.source) ?? "skima.lpg.safety_api",
          target_station_branch_id: optionalUuid(payload.stationBranchId, "stationBranchId"),
        }),
        id,
      );
    }
  }

  if (routePath === "/lpg/maps/geocode" && request.method === "POST") {
    return handleMapsGeocodeRequest(request, id, supabase, supabaseUrl, "geocode");
  }

  if (routePath === "/lpg/maps/reverse-geocode" && request.method === "POST") {
    return handleMapsGeocodeRequest(request, id, supabase, supabaseUrl, "reverse_geocode");
  }

  if (routePath === "/lpg/maps/route-estimate" && request.method === "POST") {
    return handleMapsRouteEstimateRequest(request, id, supabase, supabaseUrl);
  }

  if (routePath === "/lpg/maps/autocomplete" && request.method === "POST") {
    return handleMapsAutocompleteRequest(request, id, supabase, supabaseUrl);
  }

  if (routePath === "/runtime/media/assets") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("media_assets")
          .select(
            "id,organization_id,owner_user_id,asset_type_key,storage_bucket,storage_path,content_type,byte_size,checksum,status,metadata,created_at,updated_at",
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
        supabase.rpc("register_media_asset", {
          target_asset_type_key: optionalString(payload.assetTypeKey) ?? "media.generic",
          target_byte_size: optionalInteger(payload.byteSize),
          target_checksum: optionalString(payload.checksum),
          target_content_type: optionalString(payload.contentType),
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_organization_id: optionalUuid(payload.organizationId, "organizationId"),
          target_owner_user_id: optionalUuid(payload.ownerUserId, "ownerUserId"),
          target_source: optionalString(payload.source) ?? "skima.media_registry_api",
          target_status: optionalString(payload.status) ?? "active",
          target_storage_bucket: requireString(payload.storageBucket, "storageBucket"),
          target_storage_path: requireString(payload.storagePath, "storagePath"),
        }),
        id,
      );
    }
  }

  if (routePath === "/runtime/media/entity-links" && request.method === "GET") {
    const entityType = requirePlatformKey(
      url.searchParams.get("entityType"),
      "entityType",
    );
    const entityId = requireUuid(url.searchParams.get("entityId"), "entityId");
    return selectRecords(
      supabase
        .from("entity_media_links")
        .select(
          "id,organization_id,entity_type,entity_id,media_asset_id,media_role,is_primary,display_order,status,metadata,created_at,updated_at",
        )
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .eq("status", "active")
        .order("is_primary", { ascending: false })
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/runtime/media/read-sessions" && request.method === "POST") {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
    }

    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const assetId = requireUuid(body.value.assetId, "assetId");
    requireString(body.value.idempotencyKey, "idempotencyKey");
    const assetResult = await supabase
      .from("media_assets")
      .select("id,storage_bucket,storage_path,content_type,status")
      .eq("id", assetId)
      .eq("status", "active")
      .maybeSingle();

    if (assetResult.error) {
      return databaseError(assetResult.error, id);
    }

    if (!assetResult.data) {
      return jsonResponse({ ok: false, error: "media_asset_not_found", requestId: id }, 404);
    }

    const storageBucket = requireString(
      getRecordValue(assetResult.data, "storage_bucket"),
      "storageBucket",
    );
    const storagePath = requireString(
      getRecordValue(assetResult.data, "storage_path"),
      "storagePath",
    );
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    const signedReadResult = await serviceClient.storage
      .from(storageBucket)
      .createSignedUrl(storagePath, 900);

    if (signedReadResult.error) {
      return databaseError(signedReadResult.error, id);
    }

    return jsonResponse({
      ok: true,
      data: {
        assetId,
        contentType: stringOrNull(getRecordValue(assetResult.data, "content_type")),
        expiresInSeconds: 900,
        signedUrl: signedReadResult.data.signedUrl,
      },
      requestId: id,
    });
  }

  if (routePath === "/runtime/media/upload-sessions" && request.method === "POST") {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
    }

    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    const storageBucket = optionalString(payload.storageBucket) ?? "skima-platform-media";

    if (!["skima-platform-documents", "skima-platform-media", "skima-product-content"].includes(storageBucket)) {
      throw new RequestValidationError("storageBucket must reference an approved platform bucket.");
    }

    const idempotencyKey = requireString(payload.idempotencyKey, "idempotencyKey");
    const contentType = optionalString(payload.contentType);
    const fileName = sanitizeStoragePathSegment(optionalString(payload.fileName) ?? "upload.bin");
    const storagePath = optionalString(payload.storagePath) ??
      `${authResult.user.id}/${sanitizeStoragePathSegment(idempotencyKey)}/${fileName}`;

    if (!storagePath.startsWith(`${authResult.user.id}/`)) {
      throw new RequestValidationError("storagePath must be scoped under the authenticated user id.");
    }

    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    const signedUploadResult = await serviceClient.storage
      .from(storageBucket)
      .createSignedUploadUrl(storagePath);

    if (signedUploadResult.error) {
      return databaseError(signedUploadResult.error, id);
    }

    return jsonResponse({
      ok: true,
      data: {
        contentType,
        expiresInSeconds: 7200,
        method: "PUT",
        signedUrl: signedUploadResult.data.signedUrl,
        publicUrl: createPublicStorageUrl(supabaseUrl, storageBucket, storagePath),
        storageBucket,
        storagePath,
        token: signedUploadResult.data.token,
      },
      requestId: id,
    });
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
            "id,requirement_id,application_id,subject_type,subject_id,owner_user_id,organization_id,media_asset_id,status,storage_bucket,storage_path,content_type,byte_size,checksum,submitted_at,reviewed_at,reviewer_user_id,expires_at,decision_reason,metadata,created_at,updated_at,media_assets(id,asset_type_key,storage_bucket,storage_path,content_type,byte_size,status,metadata,created_at)",
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

  if (routePath === "/runtime/applications/payload" && request.method === "GET") {
    const applicationId = requireUuid(
      url.searchParams.get("applicationId"),
      "applicationId",
    );
    return selectRecords(
      supabase
        .from("application_versions")
        .select("id,application_id,version,payload,change_summary,created_by,created_at")
        .eq("application_id", applicationId)
        .order("version", { ascending: false }),
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

  if (routePath === "/runtime/vehicle-types" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("vehicle_types")
        .select(
          "id,key,display_name,capability_schema,status,created_at,updated_at",
        )
        .eq("status", "active")
        .order("display_name", { ascending: true }),
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

  if (routePath === "/runtime/organization-staff/directory" && request.method === "GET") {
    return rpcDataResponse(
      supabase.rpc("read_organization_staff_directory", {
        target_organization_id: requireUuid(
          url.searchParams.get("organizationId"),
          "organizationId",
        ),
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
      const pricingContext = optionalRecord(payload.pricingContext) ?? {};
      const moneyPath = findAuthoritativeMoneyField(pricingContext);
      if (moneyPath) {
        throw new RequestValidationError(
          `pricingContext.${moneyPath} cannot be supplied by the client; configure financial policy in admin.`,
        );
      }

      return rpcResponse(
        supabase.rpc("calculate_price_quote", {
          target_currency_code: optionalString(payload.currencyCode) ?? "NGN",
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_module_key: requireString(payload.moduleKey, "moduleKey"),
          target_pricing_context: pricingContext,
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
            "id,public_reference,wallet_id,customer_user_id,provider_adapter_id,transaction_id,reversal_transaction_id,currency_code,amount,status,provider_reference,checkout_url,source,metadata,initialized_at,verified_at,failed_at,reversed_at,created_at,updated_at",
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
      const amount = requireNumber(payload.amount, "amount");
      const currencyCode = optionalString(payload.currencyCode) ?? "NGN";
      const providerAdapterKey = optionalString(payload.providerAdapterKey) ??
        "provider.payment.sandbox";

      if (providerAdapterKey === "provider.payment.paystack") {
        return initializePaystackDeposit({
          amount,
          currencyCode,
          customerEmail: authResult.user.email,
          id,
          payload,
          supabase,
          supabaseUrl,
        });
      }

      return rpcResponseWithPublicReference(
        supabase.rpc("initialize_wallet_deposit", {
          target_amount: amount,
          target_currency_code: currencyCode,
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_provider_adapter_key: providerAdapterKey,
          target_source: optionalString(payload.source) ?? "platform.payment_engine",
          target_wallet_id: optionalUuid(payload.walletId, "walletId"),
        }),
        id,
        supabase,
        "payment_deposit_requests",
      );
    }
  }

  if (routePath === "/runtime/payments/deposits/verify" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponseWithPublicReference(
      supabase.rpc("verify_wallet_deposit", {
        target_deposit_request_id: requireUuid(payload.depositRequestId, "depositRequestId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
      supabase,
      "payment_deposit_requests",
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
            "id,public_reference,wallet_id,beneficiary_id,provider_adapter_id,reserve_transaction_id,reversal_transaction_id,currency_code,amount,fee_amount,total_debit_amount,status,provider_reference,source,metadata,requested_by,approved_by,requested_at,approved_at,processed_at,failed_at,reversed_at,created_at,updated_at",
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
      const withdrawalAmount = requireNumber(payload.amount, "amount");
      const withdrawalWalletId = requireUuid(payload.walletId, "walletId");
      const feeResult = await supabase.rpc("calculate_withdrawal_fee_from_policy", {
        target_amount: withdrawalAmount,
        target_wallet_id: withdrawalWalletId,
      });

      if (feeResult.error) {
        return databaseError(feeResult.error, id);
      }

      const feeSnapshot = requireRecord(feeResult.data, "withdrawal fee policy result");
      const calculatedFeeAmount = requireNumber(
        feeSnapshot.calculatedFeeAmount,
        "calculated withdrawal fee",
      );
      return rpcResponseWithPublicReference(
        supabase.rpc("request_wallet_withdrawal", {
          target_amount: withdrawalAmount,
          target_beneficiary_id: requireUuid(payload.beneficiaryId, "beneficiaryId"),
          target_fee_amount: calculatedFeeAmount,
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: {
            ...(optionalRecord(payload.metadata) ?? {}),
            financialPolicySnapshot: feeSnapshot,
          },
          target_source: optionalString(payload.source) ?? "platform.withdrawal_engine",
          target_wallet_id: withdrawalWalletId,
        }),
        id,
        supabase,
        "withdrawal_requests",
      );
    }
  }

  if (routePath === "/runtime/withdrawals/approve" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponseWithPublicReference(
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
      supabase,
      "withdrawal_requests",
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
    return rpcResponseWithPublicReference(
      supabase.rpc("execute_driver_commission_from_order", {
        target_driver_wallet_id: requireUuid(payload.driverWalletId, "driverWalletId"),
        target_escrow_hold_id: requireUuid(payload.escrowHoldId, "escrowHoldId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_order_id: requireUuid(payload.orderId, "orderId"),
        target_source: optionalString(payload.source) ?? "platform.commission_engine",
      }),
      id,
      supabase,
      "commission_executions",
    );
  }

  if (routePath === "/runtime/commission-executions" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("commission_executions")
        .select(
          "id,public_reference,service_request_id,order_id,escrow_hold_id,driver_wallet_id,commission_policy_id,transaction_id,currency_code,amount,status,policy_snapshot,source,idempotency_key,metadata,created_at,updated_at",
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
    return rpcResponseWithPublicReference(
      supabase.rpc("execute_order_business_settlement_from_snapshot", {
        target_business_wallet_id: requireUuid(payload.businessWalletId, "businessWalletId"),
        target_escrow_hold_id: requireUuid(payload.escrowHoldId, "escrowHoldId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_order_id: requireUuid(payload.orderId, "orderId"),
        target_platform_fee_wallet_id: optionalUuid(
          payload.platformFeeWalletId,
          "platformFeeWalletId",
        ),
        target_source: optionalString(payload.source) ?? "platform.settlement_engine",
      }),
      id,
      supabase,
      "settlement_statements",
    );
  }

  if (routePath === "/runtime/settlement-statements" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("settlement_statements")
        .select(
          "id,public_reference,organization_id,service_request_id,order_id,escrow_hold_id,settlement_execution_id,currency_code,gross_amount,platform_fee_amount,net_amount,status,period_start,period_end,source,idempotency_key,metadata,created_at,updated_at",
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

  if (routePath === "/runtime/otp/delivery" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    const { data, error } = await supabase.rpc("fetch_in_app_otp_code", {
      target_challenge_id: requireUuid(payload.challengeId, "challengeId"),
      target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
      target_metadata: optionalRecord(payload.metadata) ?? {},
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

  if (routePath === "/runtime/tracking/sessions") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("tracking_sessions")
          .select(
            "id,subject_type,subject_id,provider_adapter_id,status,started_by,started_at,ended_at,metadata,updated_at",
          )
          .order("started_at", { ascending: false }),
        id,
      );
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "method_not_allowed", requestId: id }, 405);
    }

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

  if (routePath === "/runtime/tracking/points") {
    if (request.method === "GET") {
      const trackingSessionId = url.searchParams.get("trackingSessionId");
      let query = supabase
        .from("tracking_points")
        .select(
          "id,tracking_session_id,recorded_by,latitude,longitude,accuracy_meters,speed_meters_per_second,heading_degrees,metadata,recorded_at,created_at",
        )
        .order("recorded_at", { ascending: false })
        .limit(500);

      if (trackingSessionId) {
        query = query.eq(
          "tracking_session_id",
          requireUuid(trackingSessionId, "trackingSessionId"),
        );
      }

      return selectRecords(query, id);
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "method_not_allowed", requestId: id }, 405);
    }

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
    const taskKey = requireString(payload.taskKey, "taskKey");
    const subjectType = requireString(payload.subjectType, "subjectType");
    const subjectId = optionalUuid(payload.subjectId, "subjectId");
    const source = optionalString(payload.source) ?? "platform.ai_engine";
    const input = optionalRecord(payload.input) ?? {};
    const idempotencyKey = requireString(payload.idempotencyKey, "idempotencyKey");
    const ownedPresentation = taskKey === "ai.lpg.cylinder.presentation";
    return rpcResponse(
      ownedPresentation ? supabase.rpc("queue_owned_presentation_ai_task", {
        target_idempotency_key: idempotencyKey,
        target_input: input,
        target_source: source,
        target_subject_id: requireUuid(subjectId, "subjectId"),
        target_subject_type: subjectType,
        target_task_key: taskKey,
      }) : supabase.rpc("queue_ai_task_run", {
        target_idempotency_key: idempotencyKey,
        target_input: input,
        target_source: source,
        target_subject_id: subjectId,
        target_subject_type: subjectType,
        target_task_key: taskKey,
      }),
      id,
    );
  }

  if (routePath === "/runtime/ai/process" && request.method === "POST") {
    const workerSecret = Deno.env.get("SKIMA_WORKER_SECRET");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!workerSecret || !serviceRoleKey) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
    }
    const response = await fetch(`${supabaseUrl}/functions/v1/runtime-worker`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
        "x-skima-worker-secret": workerSecret,
      },
      body: JSON.stringify({ limit: 5, scope: "ai" }),
      signal: AbortSignal.timeout(55_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      return jsonResponse({ ok: false, error: "ai_worker_failed", details: result, requestId: id }, 502);
    }
    return jsonResponse({ ok: true, data: getRecordValue(result, "data") ?? result, requestId: id });
  }

  if (routePath === "/runtime/settlements/execute" && request.method === "POST") {
    return jsonResponse(
      {
        ok: false,
        error: "policy_controlled_route",
        message: "Settlement distributions must be executed by a governed workflow using locked order snapshots.",
        requestId: id,
      },
      403,
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
    return jsonResponse(
      {
        ok: false,
        error: "policy_controlled_route",
        message: "Escrow release distributions must be executed by governed payment, settlement, or payout workflows.",
        requestId: id,
      },
      403,
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

  if (routePath === "/admin/permissions" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("permissions")
        .select("id,key,description,risk_level,metadata,created_at,updated_at")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (routePath === "/admin/organizations") {
    if (request.method === "GET") {
      return selectRecords(
        supabase
          .from("organizations")
          .select("id,slug,legal_name,display_name,status,metadata,created_by,created_at,updated_at")
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
        supabase.rpc("configure_platform_organization", {
          target_display_name: requireString(payload.displayName, "displayName"),
          target_idempotency_key: optionalString(payload.idempotencyKey),
          target_legal_name: optionalString(payload.legalName),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_organization_id: optionalUuid(payload.organizationId, "organizationId"),
          target_slug: requireString(payload.slug, "slug"),
          target_status: optionalString(payload.status) ?? "active",
        }),
        id,
      );
    }
  }

  if (routePath === "/admin/content/placements") {
    const permissionResponse = await requireAnyPermission(supabase, id, [
      "platform.content.read",
      "platform.content.manage",
    ]);

    if (permissionResponse) {
      return permissionResponse;
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
    }

    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);

    if (request.method === "GET") {
      return selectRecords(
        serviceClient
          .from("product_content_placements")
          .select(
            "id,key,display_name,surface_key,content_kind,allowed_audiences,status,constraints,metadata,created_by,updated_by,created_at,updated_at",
          )
          .order("surface_key", { ascending: true })
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
      const managePermissionResponse = await requireAnyPermission(supabase, id, ["platform.content.manage"]);

      if (managePermissionResponse) {
        return managePermissionResponse;
      }

      return upsertResponse(
        serviceClient
          .from("product_content_placements")
          .upsert({
            allowed_audiences: optionalStringArray(payload.allowedAudiences) ?? ["public"],
            constraints: optionalRecord(payload.constraints) ?? {},
            content_kind: requireString(payload.contentKind, "contentKind"),
            display_name: requireString(payload.displayName, "displayName"),
            key: requireString(payload.key, "key"),
            metadata: optionalRecord(payload.metadata) ?? {},
            status: optionalString(payload.status) ?? "active",
            surface_key: requireString(payload.surfaceKey, "surfaceKey"),
            updated_by: authResult.user.id,
          }, { onConflict: "key" })
          .select("id")
          .single(),
        id,
      );
    }
  }

  if (routePath === "/admin/content/publications") {
    const permissionResponse = await requireAnyPermission(supabase, id, [
      "platform.content.read",
      "platform.content.manage",
    ]);

    if (permissionResponse) {
      return permissionResponse;
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
    }

    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);

    if (request.method === "GET") {
      return selectRecords(
        serviceClient
          .from("product_content_publications")
          .select(
            "id,publication_key,placement_key,organization_id,module_key,audience_keys,country_codes,regions,cities,title,body,accessibility_label,cta_label,cta_action,media_asset_id,priority,revision,status,starts_at,ends_at,published_at,metadata,created_by,updated_by,created_at,updated_at",
          )
          .order("updated_at", { ascending: false })
          .limit(150),
        id,
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      const organizationId = optionalUuid(payload.organizationId, "organizationId");
      const managePermissionResponse = await requireAnyPermission(supabase, id, ["platform.content.manage"], organizationId);

      if (managePermissionResponse) {
        return managePermissionResponse;
      }

      return configureContentPublicationResponse(serviceClient, payload, authResult.user, id);
    }
  }

  if (routePath === "/admin/content/publications/state" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
    }

    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    const publicationId = requireUuid(body.value.publicationId, "publicationId");
    const publicationResult = await serviceClient
      .from("product_content_publications")
      .select("id,organization_id,metadata,published_at")
      .eq("id", publicationId)
      .maybeSingle();

    if (publicationResult.error) {
      return databaseError(publicationResult.error, id);
    }

    if (!publicationResult.data) {
      return jsonResponse({ ok: false, error: "not_found", requestId: id }, 404);
    }

    const organizationId = stringOrNull(getRecordValue(publicationResult.data, "organization_id"));
    const managePermissionResponse = await requireAnyPermission(supabase, id, ["platform.content.manage"], organizationId);

    if (managePermissionResponse) {
      return managePermissionResponse;
    }

    const targetStatus = requireString(body.value.status, "status");
    const reason = optionalString(body.value.reason);
    const currentMetadata = requireRecordOrEmpty(getRecordValue(publicationResult.data, "metadata"));

    return upsertResponse(
      serviceClient
        .from("product_content_publications")
        .update({
          metadata: reason ? { ...currentMetadata, last_status_reason: reason } : currentMetadata,
          published_at: targetStatus === "published" && !getRecordValue(publicationResult.data, "published_at")
            ? new Date().toISOString()
            : getRecordValue(publicationResult.data, "published_at"),
          status: targetStatus,
          updated_by: authResult.user.id,
        })
        .eq("id", publicationId)
        .select("id")
        .single(),
      id,
    );
  }

  if (routePath === "/admin/system/overview" && request.method === "GET") {
    const [healthResult, jobsResult, errorsResult, auditResult] = await Promise.all([
      supabase.from("health_checks").select("id,status"),
      supabase.from("background_jobs").select("id,status"),
      supabase.from("error_reports").select("id,status,severity"),
      supabase.from("audit_logs").select("id"),
    ]);

    const failedResult = [healthResult, jobsResult, errorsResult, auditResult].find((result) => result.error);
    if (failedResult?.error) {
      return databaseError(failedResult.error, id);
    }

    return jsonResponse({
      ok: true,
      data: {
        healthChecks: Array.isArray(healthResult.data) ? healthResult.data : [],
        jobs: Array.isArray(jobsResult.data) ? jobsResult.data : [],
        errors: Array.isArray(errorsResult.data) ? errorsResult.data : [],
        auditEvents: Array.isArray(auditResult.data) ? auditResult.data.length : 0,
      },
      requestId: id,
    });
  }

  if (routePath === "/admin/system/health" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("health_checks")
        .select("id,key,status,details,checked_at,created_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(120),
      id,
    );
  }

  if (routePath === "/admin/system/jobs" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("background_jobs")
        .select(
          "id,queue_id,job_type_key,status,payload,attempts,max_attempts,run_at,locked_until,locked_by,last_error,created_by,created_at,updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(120),
      id,
    );
  }

  if (routePath === "/admin/system/jobs/action" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    return rpcResponse(
      supabase.rpc("set_background_job_status", {
        target_action: requireString(body.value.action, "action"),
        target_idempotency_key: requireString(body.value.idempotencyKey, "idempotencyKey"),
        target_job_id: requireUuid(body.value.jobId, "jobId"),
        target_reason: optionalString(body.value.reason),
      }),
      id,
    );
  }

  if (routePath === "/admin/system/logs" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("application_logs")
        .select("id,severity,source,message,context,request_id,actor_user_id,created_at")
        .order("created_at", { ascending: false })
        .limit(120),
      id,
    );
  }

  if (routePath === "/admin/system/errors" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("error_reports")
        .select(
          "id,fingerprint,severity,status,source,message,stack_trace,context,first_seen_at,last_seen_at,occurrence_count,created_at,updated_at",
        )
        .order("last_seen_at", { ascending: false })
        .limit(120),
      id,
    );
  }

  if (routePath === "/admin/system/audit" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("audit_logs")
        .select("id,actor_user_id,action,entity_type,entity_id,before_state,after_state,metadata,created_at")
        .order("created_at", { ascending: false })
        .limit(120),
      id,
    );
  }

  if (routePath === "/admin/system/configuration" && request.method === "GET") {
    const { data, error } = await supabase
      .from("configuration_entries")
      .select(
        "id,namespace,key,scope_type,scope_id,value,is_secret,status,version,effective_from,effective_until,created_by,updated_by,created_at,updated_at",
      )
      .order("namespace", { ascending: true })
      .order("key", { ascending: true })
      .limit(150);

    if (error) {
      return databaseError(error, id);
    }

    return jsonResponse({
      ok: true,
      data: (Array.isArray(data) ? data : []).map((record) => ({
        ...(record as Record<string, unknown>),
        value: (record as { readonly is_secret?: unknown }).is_secret === true ? { redacted: true } :
          (record as { readonly value?: unknown }).value,
      })),
      requestId: id,
    });
  }

  if (routePath === "/admin/system/job-queues" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("job_queues")
        .select("id,key,status,concurrency_limit,retry_policy,created_by,created_at,updated_at")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (routePath === "/admin/role-templates") {
    if (request.method === "GET") {
      const { data, error } = await supabase
        .from("platform_admin_role_templates")
        .select("id,role_id,key,display_name,description,permission_keys,status,is_system,metadata")
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

  if (routePath === "/admin/profiles" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("profiles")
        .select("id,display_name,avatar_url,status,metadata,created_at,updated_at")
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/admin/profiles/status" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    return rpcResponse(
      supabase.rpc("set_profile_status", {
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_reason: requireString(payload.reason, "reason"),
        target_status: requireString(payload.status, "status"),
        target_user_id: requireUuid(payload.userId, "userId"),
      }),
      id,
    );
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

interface InitializePaystackDepositParams {
  readonly amount: number;
  readonly currencyCode: string;
  readonly customerEmail?: string;
  readonly id: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly supabase: SupabaseClient;
  readonly supabaseUrl: string;
}

interface PaystackInitializeResponse {
  readonly status?: unknown;
  readonly message?: unknown;
  readonly data?: unknown;
}

interface GatewayProviderExecutionInput {
  readonly errorMessage: string | null;
  readonly idempotencyKey: string;
  readonly operationKey: string;
  readonly providerKind?: "payment" | "storage" | "maps" | "notification" | "ai" | "queue" | "cache" | "observability";
  readonly providerAdapterKey: string;
  readonly requestPayload: Readonly<Record<string, unknown>>;
  readonly responsePayload: Readonly<Record<string, unknown>>;
  readonly status: "succeeded" | "failed";
}

interface SessionRoleRow {
  readonly id: string;
  readonly organization_id: string | null;
  readonly branch_id: string | null;
  readonly role_id: string;
  readonly status: string;
  readonly access_scope: Readonly<Record<string, unknown>>;
}

interface SessionPermissionLinkRow {
  readonly role_id: string;
  readonly permission_id: string;
}

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

async function resolveLpgMobileWorkspaceAccess(
  supabase: SupabaseClient,
  user: User,
  id: string,
): Promise<Response> {
  const driverResult = await supabase
    .from("driver_profiles")
    .select("id,verification_status,operational_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (driverResult.error) {
    return databaseError(driverResult.error, id);
  }

  const userRolesResult = await supabase
    .from("user_roles")
    .select("id,organization_id,branch_id,role_id,status")
    .eq("user_id", user.id)
    .eq("status", "active");

  if (userRolesResult.error) {
    return databaseError(userRolesResult.error, id);
  }

  const driverProfileId = stringOrNull(getRecordValue(driverResult.data, "id"));
  let driverVehicleIds: string[] = [];
  let driverCapabilityKeys: string[] = [];

  if (
    driverProfileId &&
    stringOrNull(getRecordValue(driverResult.data, "verification_status")) === "approved"
  ) {
    const linkResult = await supabase
      .from("driver_vehicle_links")
      .select("vehicle_id,starts_at,ends_at,status")
      .eq("driver_profile_id", driverProfileId)
      .eq("status", "active");

    if (linkResult.error) {
      return databaseError(linkResult.error, id);
    }

    const now = Date.now();
    const linkedVehicleIds = (Array.isArray(linkResult.data) ? linkResult.data : [])
      .filter((link) => {
        const startsAt = stringOrNull(getRecordValue(link, "starts_at"));
        const endsAt = stringOrNull(getRecordValue(link, "ends_at"));
        return (!startsAt || Date.parse(startsAt) <= now) && (!endsAt || Date.parse(endsAt) > now);
      })
      .map((link) => stringOrNull(getRecordValue(link, "vehicle_id")))
      .filter((vehicleId): vehicleId is string => vehicleId !== null);

    if (linkedVehicleIds.length > 0) {
      const vehicleResult = await supabase
        .from("vehicles")
        .select("id")
        .in("id", linkedVehicleIds)
        .eq("status", "active");

      if (vehicleResult.error) {
        return databaseError(vehicleResult.error, id);
      }

      driverVehicleIds = (Array.isArray(vehicleResult.data) ? vehicleResult.data : [])
        .map((vehicle) => stringOrNull(getRecordValue(vehicle, "id")))
        .filter((vehicleId): vehicleId is string => vehicleId !== null);
    }

    const capabilityEntityIds = [driverProfileId, ...driverVehicleIds];
    const capabilityResult = await supabase
      .from("entity_capabilities")
      .select("capability_key")
      .in("entity_id", capabilityEntityIds)
      .eq("status", "active");

    if (capabilityResult.error) {
      return databaseError(capabilityResult.error, id);
    }

    driverCapabilityKeys = Array.from(new Set(
      (Array.isArray(capabilityResult.data) ? capabilityResult.data : [])
        .map((capability) => stringOrNull(getRecordValue(capability, "capability_key")))
        .filter((key): key is string => key !== null),
    )).sort();
  }

  const userRoles = Array.isArray(userRolesResult.data) ? userRolesResult.data : [];
  const roleIds = userRoles
    .map((role) => stringOrNull(getRecordValue(role, "role_id")))
    .filter((roleId): roleId is string => roleId !== null);
  const rolesResult = roleIds.length === 0
    ? { data: [], error: null }
    : await supabase.from("roles").select("id,key").in("id", roleIds).eq("status", "active");

  if (rolesResult.error) {
    return databaseError(rolesResult.error, id);
  }

  const roleById = recordsByStringId(Array.isArray(rolesResult.data) ? rolesResult.data : []);
  const stationAssignments = userRoles.filter((assignedRole) => {
    const roleId = stringOrNull(getRecordValue(assignedRole, "role_id"));
    const roleKey = roleId ? stringOrNull(getRecordValue(roleById.get(roleId), "key")) : null;
    return roleKey?.startsWith("lpg.station.") === true;
  });
  const stationOrganizationIds = Array.from(new Set(
    stationAssignments
      .map((role) => stringOrNull(getRecordValue(role, "organization_id")))
      .filter((organizationId): organizationId is string => organizationId !== null),
  ));
  const stationResult = stationOrganizationIds.length === 0
    ? { data: [], error: null }
    : await supabase
      .from("lpg_station_branches")
      .select("id,organization_id,branch_id,approval_status,compliance_status")
      .in("organization_id", stationOrganizationIds)
      .eq("approval_status", "approved")
      .neq("compliance_status", "suspended");

  if (stationResult.error) {
    return databaseError(stationResult.error, id);
  }

  const approvedStations = Array.isArray(stationResult.data) ? stationResult.data : [];
  const approvedStationIds = approvedStations
    .map((station) => stringOrNull(getRecordValue(station, "id")))
    .filter((stationId): stationId is string => stationId !== null);
  const approvedBranchIds = approvedStations
    .map((station) => stringOrNull(getRecordValue(station, "branch_id")))
    .filter((branchId): branchId is string => branchId !== null);
  const stationRoleKeys = stationAssignments
    .map((assignedRole) => {
      const roleId = stringOrNull(getRecordValue(assignedRole, "role_id"));
      return roleId ? stringOrNull(getRecordValue(roleById.get(roleId), "key")) : null;
    })
    .filter((roleKey): roleKey is string => roleKey !== null);
  const workspaces: Array<Record<string, unknown>> = [{
    key: "customer",
    status: "active",
    subjectType: "profile",
    subjectId: user.id,
    capabilityKeys: [],
    organizationIds: [],
    branchIds: [],
  }];

  if (driverProfileId && driverVehicleIds.length > 0) {
    workspaces.push({
      key: "driver",
      status: "active",
      subjectType: "driver_profile",
      subjectId: driverProfileId,
      capabilityKeys: driverCapabilityKeys,
      organizationIds: [],
      branchIds: [],
      vehicleIds: driverVehicleIds,
    });
  }

  if (approvedStationIds.length > 0 && stationRoleKeys.length > 0) {
    workspaces.push({
      key: "station",
      status: "active",
      subjectType: "lpg_station_branch",
      subjectId: approvedStationIds[0],
      capabilityKeys: stationRoleKeys,
      organizationIds: stationOrganizationIds,
      branchIds: approvedBranchIds,
      stationIds: approvedStationIds,
    });
  }

  return jsonResponse({ ok: true, data: { workspaces }, requestId: id });
}

async function resolveSessionContext(
  supabase: SupabaseClient,
  user: User,
  id: string,
): Promise<Response> {
  const profileResult = await supabase
    .from("profiles")
    .select("id,display_name,avatar_url,status,metadata")
    .eq("id", user.id)
    .maybeSingle();

  if (profileResult.error) {
    return databaseError(profileResult.error, id);
  }

  const adminResult = await supabase
    .from("platform_admins")
    .select("id,user_id,primary_role_id,admin_kind,title,status,metadata")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (adminResult.error) {
    return databaseError(adminResult.error, id);
  }

  const membershipsResult = await supabase
    .from("organization_memberships")
    .select("id,organization_id,membership_type,status,metadata")
    .eq("user_id", user.id)
    .eq("status", "active");

  if (membershipsResult.error) {
    return databaseError(membershipsResult.error, id);
  }

  const userRolesResult = await supabase
    .from("user_roles")
    .select("id,organization_id,branch_id,role_id,status,access_scope")
    .eq("user_id", user.id)
    .eq("status", "active");

  if (userRolesResult.error) {
    return databaseError(userRolesResult.error, id);
  }

  const userRoles = Array.isArray(userRolesResult.data)
    ? userRolesResult.data as SessionRoleRow[]
    : [];
  const roleIds = Array.from(new Set(userRoles.map((role) => role.role_id)));
  const organizationIds = Array.from(
    new Set(
      (Array.isArray(membershipsResult.data) ? membershipsResult.data : [])
        .map((membership) => stringOrNull(getRecordValue(membership, "organization_id")))
        .filter((organizationId): organizationId is string => organizationId !== null),
    ),
  );

  const rolesResult = roleIds.length === 0 ? { data: [], error: null } : await supabase
    .from("roles")
    .select("id,organization_id,key,display_name,status,metadata")
    .in("id", roleIds);

  if (rolesResult.error) {
    return databaseError(rolesResult.error, id);
  }

  const rolePermissionResult = roleIds.length === 0 ? { data: [], error: null } : await supabase
    .from("role_permissions")
    .select("role_id,permission_id")
    .in("role_id", roleIds);

  if (rolePermissionResult.error) {
    return databaseError(rolePermissionResult.error, id);
  }

  const permissionLinks = Array.isArray(rolePermissionResult.data)
    ? rolePermissionResult.data as SessionPermissionLinkRow[]
    : [];
  const permissionIds = Array.from(new Set(permissionLinks.map((link) => link.permission_id)));

  const permissionsResult = permissionIds.length === 0 ? { data: [], error: null } : await supabase
    .from("permissions")
    .select("id,key,risk_level")
    .in("id", permissionIds);

  if (permissionsResult.error) {
    return databaseError(permissionsResult.error, id);
  }

  const organizationsResult = organizationIds.length === 0
    ? { data: [], error: null }
    : await supabase
      .from("organizations")
      .select("id,slug,display_name,status")
      .in("id", organizationIds);

  if (organizationsResult.error) {
    return databaseError(organizationsResult.error, id);
  }

  const roleById = recordsByStringId(Array.isArray(rolesResult.data) ? rolesResult.data : []);
  const permissionById = recordsByStringId(
    Array.isArray(permissionsResult.data) ? permissionsResult.data : [],
  );
  const permissionsByRoleId = new Map<string, string[]>();

  for (const link of permissionLinks) {
    const permission = permissionById.get(link.permission_id);
    const permissionKey = stringOrNull(getRecordValue(permission, "key"));

    if (!permissionKey) {
      continue;
    }

    permissionsByRoleId.set(link.role_id, [
      ...(permissionsByRoleId.get(link.role_id) ?? []),
      permissionKey,
    ]);
  }

  const permissionKeys = Array.from(
    new Set(
      Array.from(permissionsByRoleId.values()).flat(),
    ),
  ).sort();

  const organizationsById = recordsByStringId(
    Array.isArray(organizationsResult.data) ? organizationsResult.data : [],
  );

  return jsonResponse({
    ok: true,
    data: {
      user: {
        id: user.id,
        email: user.email ?? null,
      },
      profile: profileResult.data ?? null,
      platformAdmin: adminResult.data ?? null,
      permissions: permissionKeys,
      roles: userRoles.map((assignedRole) => {
        const role = roleById.get(assignedRole.role_id);

        return {
          id: assignedRole.id,
          roleId: assignedRole.role_id,
          key: stringOrNull(getRecordValue(role, "key")),
          displayName: stringOrNull(getRecordValue(role, "display_name")),
          organizationId: assignedRole.organization_id,
          branchId: assignedRole.branch_id,
          status: assignedRole.status,
          accessScope: assignedRole.access_scope,
          permissions: (permissionsByRoleId.get(assignedRole.role_id) ?? []).sort(),
        };
      }),
      organizations: (Array.isArray(membershipsResult.data) ? membershipsResult.data : [])
        .map((membership) => {
          const organizationId = stringOrNull(getRecordValue(membership, "organization_id"));
          const organization = organizationId ? organizationsById.get(organizationId) : null;

          return {
            membershipId: stringOrNull(getRecordValue(membership, "id")),
            organizationId,
            slug: stringOrNull(getRecordValue(organization, "slug")),
            displayName: stringOrNull(getRecordValue(organization, "display_name")),
            membershipType: stringOrNull(getRecordValue(membership, "membership_type")),
            status: stringOrNull(getRecordValue(membership, "status")),
          };
        }),
    },
    requestId: id,
  });
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

async function rpcDataResponse(query: SelectQuery, id: string): Promise<Response> {
  const { data, error } = await query;

  if (error) {
    return databaseError(error as { readonly message: string; readonly code?: string }, id);
  }

  return jsonResponse({
    ok: true,
    data,
    requestId: id,
  });
}

async function upsertResponse(query: SelectQuery, id: string): Promise<Response> {
  const { data, error } = await query;

  if (error) {
    return databaseError(error as { readonly message: string; readonly code?: string }, id);
  }

  return jsonResponse({
    ok: true,
    data,
    id: stringOrNull(getRecordValue(data, "id")) ?? undefined,
    requestId: id,
  });
}

async function requireAnyPermission(
  supabase: SupabaseClient,
  id: string,
  permissionKeys: readonly string[],
  organizationId: string | null = null,
): Promise<Response | null> {
  const results = await Promise.all(
    permissionKeys.map((permissionKey) =>
      supabase.rpc("has_permission", {
        target_organization_id: organizationId,
        target_permission: permissionKey,
      })
    ),
  );
  const failed = results.find((result) => result.error);

  if (failed?.error) {
    return databaseError(failed.error, id);
  }

  if (results.some((result) => result.data === true)) {
    return null;
  }

  return jsonResponse(
    {
      ok: false,
      error: "forbidden",
      message: "You do not have permission for this admin action.",
      requestId: id,
    },
    403,
  );
}

async function configureContentPublicationResponse(
  serviceClient: SupabaseClient,
  payload: Readonly<Record<string, unknown>>,
  user: User,
  id: string,
): Promise<Response> {
  const publicationId = optionalUuid(payload.publicationId, "publicationId");
  const publicationKey = optionalString(payload.publicationKey);
  const mediaPublicUrl = optionalString(payload.mediaPublicUrl);
  const metadata = {
    ...(optionalRecord(payload.metadata) ?? {}),
    ...(mediaPublicUrl
      ? {
        mediaPublicUrl,
        media_public_url: mediaPublicUrl,
      }
      : {}),
  };

  if (!publicationId && !publicationKey) {
    throw new RequestValidationError("publicationKey is required when creating a publication.");
  }

  const existingResult = publicationId
    ? await serviceClient
      .from("product_content_publications")
      .select("id,publication_key,revision,published_at,metadata")
      .eq("id", publicationId)
      .maybeSingle()
    : await serviceClient
      .from("product_content_publications")
      .select("id,publication_key,revision,published_at,metadata")
      .eq("publication_key", publicationKey)
      .maybeSingle();

  if (existingResult.error) {
    return databaseError(existingResult.error, id);
  }

  const status = optionalString(payload.status) ?? "draft";
  const baseRecord = {
    accessibility_label: optionalString(payload.accessibilityLabel),
    audience_keys: optionalStringArray(payload.audienceKeys) ?? ["public"],
    body: optionalString(payload.body),
    cities: optionalStringArray(payload.cities) ?? [],
    country_codes: optionalStringArray(payload.countryCodes) ?? [],
    cta_action: optionalRecord(payload.ctaAction) ?? {},
    cta_label: optionalString(payload.ctaLabel),
    ends_at: optionalString(payload.endsAt),
    media_asset_id: optionalUuid(payload.mediaAssetId, "mediaAssetId"),
    metadata: {
      ...requireRecordOrEmpty(getRecordValue(existingResult.data, "metadata")),
      ...metadata,
    },
    module_key: optionalString(payload.moduleKey),
    organization_id: optionalUuid(payload.organizationId, "organizationId"),
    placement_key: requireString(payload.placementKey, "placementKey"),
    priority: optionalInteger(payload.priority) ?? 0,
    published_at: status === "published" && !getRecordValue(existingResult.data, "published_at")
      ? new Date().toISOString()
      : getRecordValue(existingResult.data, "published_at"),
    regions: optionalStringArray(payload.regions) ?? [],
    starts_at: optionalString(payload.startsAt),
    status,
    title: optionalString(payload.title),
    updated_by: user.id,
  };

  if (existingResult.data) {
    return upsertResponse(
      serviceClient
        .from("product_content_publications")
        .update({
          ...baseRecord,
          publication_key: publicationKey ?? stringOrNull(getRecordValue(existingResult.data, "publication_key")),
          revision: (numberOrNull(getRecordValue(existingResult.data, "revision")) ?? 1) + 1,
        })
        .eq("id", requireUuid(getRecordValue(existingResult.data, "id"), "publicationId"))
        .select("id")
        .single(),
      id,
    );
  }

  return upsertResponse(
    serviceClient
      .from("product_content_publications")
      .insert({
        ...baseRecord,
        created_by: user.id,
        publication_key: requireString(publicationKey, "publicationKey"),
      })
      .select("id")
      .single(),
    id,
  );
}

function lpgStationActivationResponse(
  supabase: SupabaseClient,
  payload: Readonly<Record<string, unknown>>,
  id: string,
): Promise<Response> {
  return rpcResponse(
    supabase.rpc("activate_configured_lpg_station_branch", {
      target_application_id: optionalUuid(payload.applicationId, "applicationId"),
      target_branch_id: optionalUuid(payload.branchId, "branchId"),
      target_branch_key: optionalString(payload.branchKey),
      target_current_available_kg: optionalNumber(payload.currentAvailableKg, "currentAvailableKg"),
      target_display_name: optionalString(payload.displayName),
      target_formatted_address: optionalString(payload.formattedAddress),
      target_geofence: optionalRecord(payload.geofence) ?? {},
      target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
      target_latitude: optionalNumber(payload.latitude, "latitude"),
      target_longitude: optionalNumber(payload.longitude, "longitude"),
      target_metadata: optionalRecord(payload.metadata) ?? {},
      target_operating_hours: optionalRecord(payload.operatingHours) ?? {},
      target_organization_id: optionalUuid(payload.organizationId, "organizationId"),
      target_owner_user_id: optionalUuid(payload.ownerUserId, "ownerUserId"),
      target_refill_capacity_kg: optionalNumber(payload.refillCapacityKg, "refillCapacityKg"),
      target_source: optionalString(payload.source) ?? "skima.lpg.station_activation_api",
      target_supported_cylinder_sizes_kg: optionalNumberArray(
        payload.supportedCylinderSizesKg,
        "supportedCylinderSizesKg",
      ) ?? [],
    }),
    id,
  );
}

async function rpcResponseWithPublicReference(
  query: SelectQuery,
  id: string,
  supabase: SupabaseClient,
  tableName: string,
): Promise<Response> {
  const { data, error } = await query;

  if (error) {
    return databaseError(error as { readonly message: string; readonly code?: string }, id);
  }

  const recordId = stringOrNull(data);

  if (!recordId) {
    return databaseError({ message: "RPC did not return a record id." }, id);
  }

  const referenceResult = await supabase
    .from(tableName)
    .select("id,public_reference")
    .eq("id", recordId)
    .maybeSingle();

  if (referenceResult.error) {
    return databaseError(referenceResult.error, id);
  }

  const publicReference = stringOrNull(
    getRecordValue(referenceResult.data, "public_reference"),
  );

  if (!publicReference) {
    return databaseError(
      { message: `Public reference was not assigned for ${tableName} record ${recordId}.` },
      id,
    );
  }

  return jsonResponse({
    ok: true,
    id: recordId,
    publicReference,
    requestId: id,
  });
}

async function lpgPaymentReservationResponse(
  query: SelectQuery,
  id: string,
  supabase: SupabaseClient,
): Promise<Response> {
  const { data, error } = await query;

  if (error) {
    return databaseError(error as { readonly message: string; readonly code?: string }, id);
  }

  const lpgOrderId = stringOrNull(data);

  if (!lpgOrderId) {
    return databaseError({ message: "RPC did not return an LPG order id." }, id);
  }

  const orderResult = await supabase
    .from("lpg_refill_orders")
    .select(
      "id,public_reference,service_request_id,escrow_hold_id,currency_code,total_amount,status,payment_status",
    )
    .eq("id", lpgOrderId)
    .maybeSingle();

  if (orderResult.error) {
    return databaseError(orderResult.error, id);
  }

  const publicReference = stringOrNull(getRecordValue(orderResult.data, "public_reference"));

  if (!publicReference) {
    return databaseError(
      { message: `Public reference was not assigned for LPG order ${lpgOrderId}.` },
      id,
    );
  }

  const escrowHoldId = stringOrNull(getRecordValue(orderResult.data, "escrow_hold_id"));
  const holdResult = escrowHoldId
    ? await supabase
      .from("escrow_holds")
      .select("id,wallet_id,status,currency_code,hold_amount")
      .eq("id", escrowHoldId)
      .maybeSingle()
    : { data: null, error: null };

  if (holdResult.error) {
    return databaseError(holdResult.error, id);
  }

  return jsonResponse({
    ok: true,
    id: lpgOrderId,
    publicReference,
    data: {
      lpgOrderId,
      publicReference,
      serviceRequestId: stringOrNull(getRecordValue(orderResult.data, "service_request_id")),
      escrowHoldId,
      escrowWalletId: stringOrNull(getRecordValue(holdResult.data, "wallet_id")),
      escrowStatus: stringOrNull(getRecordValue(holdResult.data, "status")),
      currencyCode: stringOrNull(getRecordValue(orderResult.data, "currency_code")),
      totalAmount: getRecordValue(orderResult.data, "total_amount"),
      status: stringOrNull(getRecordValue(orderResult.data, "status")),
      paymentStatus: stringOrNull(getRecordValue(orderResult.data, "payment_status")),
    },
    requestId: id,
  });
}

type LpgMapsOperation = "autocomplete" | "geocode" | "reverse_geocode" | "route_estimate";

async function resolveLpgMapsProvider(
  supabase: SupabaseClient,
  id: string,
  operation: LpgMapsOperation,
): Promise<{
  policy: Record<string, unknown>;
  providerKey: string;
  response: Response | null;
}> {
  const mapsPolicyResult = await supabase.rpc("lpg_policy_config", {
    target_policy_key: "lpg.maps.phase_one",
  });

  if (mapsPolicyResult.error) {
    return { policy: {}, providerKey: "", response: databaseError(mapsPolicyResult.error, id) };
  }

  const policy = requireRecord(mapsPolicyResult.data, "LPG maps policy");
  const providerKey = requireString(policy.active_provider_key, "active_provider_key");
  const operations = Array.isArray(policy.operations)
    ? policy.operations.filter((value): value is string => typeof value === "string")
    : [];

  if (!operations.includes(operation)) {
    return {
      policy,
      providerKey,
      response: jsonResponse({ ok: false, error: "server_misconfigured", message: `The configured maps policy does not enable ${operation}.`, requestId: id }, 500),
    };
  }

  const adapterResult = await supabase
    .from("provider_adapters")
    .select("key,status,provider_kind")
    .eq("provider_kind", "maps")
    .eq("key", providerKey)
    .maybeSingle();

  if (adapterResult.error) {
    return { policy, providerKey, response: databaseError(adapterResult.error, id) };
  }

  if (!adapterResult.data || adapterResult.data.status !== "active") {
    return {
      policy,
      providerKey,
      response: jsonResponse({ ok: false, error: "server_misconfigured", message: "The configured maps provider adapter is not active.", requestId: id }, 500),
    };
  }

  return { policy, providerKey, response: null };
}

function unsupportedMapsProviderResponse(
  providerKey: string,
  operation: LpgMapsOperation,
  id: string,
): Response {
  return jsonResponse({
    ok: false,
    error: "server_misconfigured",
    message: `The configured maps adapter ${providerKey} does not implement ${operation}.`,
    requestId: id,
  }, 500);
}

function missingMapsSecretResponse(providerKey: string, id: string): Response {
  return jsonResponse({
    ok: false,
    error: "server_misconfigured",
    message: `The configured maps adapter ${providerKey} is missing its server secret.`,
    requestId: id,
  }, 500);
}

function stableStringHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clampCoordinate(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function haversineDistanceMeters(
  origin: { readonly latitude: number; readonly longitude: number },
  destination: { readonly latitude: number; readonly longitude: number },
): number {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = toRadians(destination.latitude - origin.latitude);
  const longitudeDelta = toRadians(destination.longitude - origin.longitude);
  const originLatitude = toRadians(origin.latitude);
  const destinationLatitude = toRadians(destination.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) * Math.cos(destinationLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

async function handleMapsGeocodeRequest(
  request: Request,
  id: string,
  supabase: SupabaseClient,
  supabaseUrl: string,
  operation: "geocode" | "reverse_geocode",
): Promise<Response> {
  const body = await readJsonBody(request, id);

  if ("response" in body) {
    return body.response;
  }

  const payload = body.value;
  const idempotencyKey = optionalString(payload.idempotencyKey) ??
    createGatewayIdempotencyKey(id, operation);
  const providerResult = await resolveLpgMapsProvider(supabase, id, operation);

  if (providerResult.response) {
    return providerResult.response;
  }

  const activeProviderKey = providerResult.providerKey;
  const requestPayload: Record<string, unknown> = {
    operation,
    providerAdapterKey: activeProviderKey,
  };
  let address: string | null = null;
  let latitude: number | null = null;
  let longitude: number | null = null;

  if (operation === "geocode") {
    address = requireString(payload.address, "address");
    requestPayload.address = address;
  } else {
    latitude = requireNumber(payload.latitude, "latitude");
    longitude = requireNumber(payload.longitude, "longitude");
    requestPayload.latitude = latitude;
    requestPayload.longitude = longitude;
  }

  if (activeProviderKey === "provider.maps.sandbox") {
    const originLatitude = requireNumber(
      providerResult.policy.sandbox_origin_latitude,
      "sandbox_origin_latitude",
    );
    const originLongitude = requireNumber(
      providerResult.policy.sandbox_origin_longitude,
      "sandbox_origin_longitude",
    );
    const hash = stableStringHash(address ?? `${latitude},${longitude}`);
    const resolvedLatitude = latitude ?? clampCoordinate(
      originLatitude + ((hash % 2001) - 1000) / 100000,
      -90,
      90,
    );
    const resolvedLongitude = longitude ?? clampCoordinate(
      originLongitude + ((Math.floor(hash / 2001) % 2001) - 1000) / 100000,
      -180,
      180,
    );
    const data = {
      addressComponents: null,
      formattedAddress: address ?? `Sandbox location ${resolvedLatitude.toFixed(5)}, ${resolvedLongitude.toFixed(5)}`,
      location: { latitude: resolvedLatitude, longitude: resolvedLongitude },
      locationType: "sandbox_estimate",
      operation,
      placeId: `sandbox:${stableStringHash(`${resolvedLatitude}:${resolvedLongitude}`).toString(16)}`,
      provider: "sandbox",
    };

    await maybeRecordGatewayProviderExecution(supabaseUrl, {
      errorMessage: null,
      idempotencyKey: `${idempotencyKey}:maps`,
      operationKey: `provider.maps.${operation}`,
      providerAdapterKey: activeProviderKey,
      providerKind: "maps",
      requestPayload,
      responsePayload: data,
      status: "succeeded",
    });
    return jsonResponse({ ok: true, data, requestId: id });
  }

  if (activeProviderKey !== "provider.maps.google-maps") {
    return unsupportedMapsProviderResponse(activeProviderKey, operation, id);
  }

  const googleMapsKey = Deno.env.get("GOOGLE_MAPS_API_KEY");

  if (!googleMapsKey) {
    return missingMapsSecretResponse(activeProviderKey, id);
  }

  const queryUrl = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  if (operation === "geocode") {
    queryUrl.searchParams.set("address", address ?? "");
  } else {
    queryUrl.searchParams.set("latlng", `${latitude},${longitude}`);
  }

  queryUrl.searchParams.set("key", googleMapsKey);

  const providerResponse = await fetch(queryUrl.toString());
  const responsePayload = requireRecordOrEmpty(await readProviderJson(providerResponse));
  const providerStatus = optionalString(responsePayload.status);

  if (!providerResponse.ok || providerStatus !== "OK") {
    const message = optionalString(responsePayload.error_message) ??
      optionalString(responsePayload.status) ??
      "Google Maps geocode request failed.";
    await maybeRecordGatewayProviderExecution(supabaseUrl, {
      errorMessage: message,
      idempotencyKey: `${idempotencyKey}:maps`,
      operationKey: `provider.maps.${operation}`,
      providerAdapterKey: activeProviderKey,
      providerKind: "maps",
      requestPayload,
      responsePayload: sanitizeProviderPayload(responsePayload),
      status: "failed",
    });

    return jsonResponse(
      {
        ok: false,
        error: "provider_error",
        message,
        requestId: id,
      },
      502,
    );
  }

  const results = Array.isArray(responsePayload.results) ? responsePayload.results : [];
  const firstResult = requireRecord(results[0], "Google Maps result");
  const geometry = requireRecord(firstResult.geometry, "Google Maps geometry");
  const location = requireRecord(geometry.location, "Google Maps location");
  const resolvedLatitude = requireNumber(location.lat, "Google Maps latitude");
  const resolvedLongitude = requireNumber(location.lng, "Google Maps longitude");
  const data = {
    addressComponents: readGoogleAddressComponents(firstResult),
    formattedAddress: optionalString(firstResult.formatted_address),
    location: {
      latitude: resolvedLatitude,
      longitude: resolvedLongitude,
    },
    locationType: optionalString(geometry.location_type),
    operation,
    placeId: optionalString(firstResult.place_id),
    provider: "google_maps",
  };

  await maybeRecordGatewayProviderExecution(supabaseUrl, {
    errorMessage: null,
    idempotencyKey: `${idempotencyKey}:maps`,
    operationKey: `provider.maps.${operation}`,
    providerAdapterKey: activeProviderKey,
    providerKind: "maps",
    requestPayload,
    responsePayload: data,
    status: "succeeded",
  });

  return jsonResponse({
    ok: true,
    data,
    requestId: id,
  });
}

function readGoogleAddressComponents(result: Record<string, unknown>) {
  const components = Array.isArray(result.address_components) ? result.address_components : [];
  const byType = (type: string, short = false) => {
    const component = components.find((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const types: unknown[] = Array.isArray((value as Record<string, unknown>).types)
        ? ((value as Record<string, unknown>).types as unknown[])
        : [];
      return types.includes(type);
    });
    if (!component || typeof component !== "object" || Array.isArray(component)) return null;
    return optionalString((component as Record<string, unknown>)[short ? "short_name" : "long_name"]);
  };
  const streetNumber = byType("street_number");
  const route = byType("route");
  const premise = byType("premise") ?? byType("point_of_interest") ?? byType("establishment");
  return {
    name: premise,
    street: [streetNumber, route].filter(Boolean).join(" ") || route,
    district: byType("sublocality_level_1") ?? byType("sublocality") ?? byType("neighborhood") ?? byType("administrative_area_level_2"),
    city: byType("locality") ?? byType("postal_town") ?? byType("administrative_area_level_2"),
    region: byType("administrative_area_level_1"),
    postalCode: byType("postal_code"),
    country: byType("country"),
    countryCode: byType("country", true),
  };
}

async function handleMapsRouteEstimateRequest(
  request: Request,
  id: string,
  supabase: SupabaseClient,
  supabaseUrl: string,
): Promise<Response> {
  const body = await readJsonBody(request, id);

  if ("response" in body) {
    return body.response;
  }

  const payload = body.value;
  const origin = requireCoordinate(payload.origin, "origin");
  const destination = requireCoordinate(payload.destination, "destination");
  const idempotencyKey = optionalString(payload.idempotencyKey) ??
    createGatewayIdempotencyKey(id, "route-estimate");
  const providerResult = await resolveLpgMapsProvider(supabase, id, "route_estimate");

  if (providerResult.response) {
    return providerResult.response;
  }

  const activeProviderKey = providerResult.providerKey;
  const requestPayload = {
    computeAlternativeRoutes: false,
    destination: {
      location: {
        latLng: {
          latitude: destination.latitude,
          longitude: destination.longitude,
        },
      },
    },
    origin: {
      location: {
        latLng: {
          latitude: origin.latitude,
          longitude: origin.longitude,
        },
      },
    },
    routingPreference: "TRAFFIC_AWARE",
    travelMode: "DRIVE",
  };

  if (activeProviderKey === "provider.maps.sandbox") {
    const distanceMeters = Math.round(haversineDistanceMeters(origin, destination));
    const speedKph = requireNumber(
      providerResult.policy.sandbox_route_speed_kph,
      "sandbox_route_speed_kph",
    );
    if (speedKph <= 0) {
      return jsonResponse({ ok: false, error: "server_misconfigured", message: "Sandbox route speed must be greater than zero.", requestId: id }, 500);
    }
    const durationSeconds = Math.max(1, Math.round(distanceMeters / (speedKph * 1000 / 3600)));
    const data = {
      distanceMeters,
      duration: `${durationSeconds}s`,
      encodedPolyline: null,
      operation: "route_estimate",
      provider: "sandbox",
      staticDuration: `${durationSeconds}s`,
      summary: "Deterministic sandbox estimate",
    };
    await maybeRecordGatewayProviderExecution(supabaseUrl, {
      errorMessage: null,
      idempotencyKey: `${idempotencyKey}:maps`,
      operationKey: "provider.maps.route_estimate",
      providerAdapterKey: activeProviderKey,
      providerKind: "maps",
      requestPayload,
      responsePayload: data,
      status: "succeeded",
    });
    return jsonResponse({ ok: true, data, requestId: id });
  }

  if (activeProviderKey !== "provider.maps.google-maps") {
    return unsupportedMapsProviderResponse(activeProviderKey, "route_estimate", id);
  }

  const googleMapsKey = Deno.env.get("GOOGLE_MAPS_API_KEY");

  if (!googleMapsKey) {
    return missingMapsSecretResponse(activeProviderKey, id);
  }

  const providerResponse = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    body: JSON.stringify(requestPayload),
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": googleMapsKey,
      "X-Goog-FieldMask":
        "routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline,routes.description,routes.warnings",
    },
    method: "POST",
  });
  const responsePayload = requireRecordOrEmpty(await readProviderJson(providerResponse));

  if (!providerResponse.ok) {
    const errorRecord = requireRecordOrEmpty(responsePayload.error);
    const message = optionalString(errorRecord.message) ?? "Google Maps route request failed.";
    await maybeRecordGatewayProviderExecution(supabaseUrl, {
      errorMessage: message,
      idempotencyKey: `${idempotencyKey}:maps`,
      operationKey: "provider.maps.route_estimate",
      providerAdapterKey: activeProviderKey,
      providerKind: "maps",
      requestPayload,
      responsePayload: sanitizeProviderPayload(responsePayload),
      status: "failed",
    });

    return jsonResponse(
      {
        ok: false,
        error: "provider_error",
        message,
        requestId: id,
      },
      502,
    );
  }

  const routes = Array.isArray(responsePayload.routes) ? responsePayload.routes : [];
  const route = requireRecord(routes[0], "Google Maps route");
  const polyline = requireRecordOrEmpty(route.polyline);
  const data = {
    distanceMeters: requireNumber(route.distanceMeters, "Google route distance"),
    duration: optionalString(route.duration),
    encodedPolyline: optionalString(polyline.encodedPolyline),
    operation: "route_estimate",
    provider: "google_maps",
    staticDuration: optionalString(route.staticDuration),
    summary: optionalString(route.description),
  };

  await maybeRecordGatewayProviderExecution(supabaseUrl, {
    errorMessage: null,
    idempotencyKey: `${idempotencyKey}:maps`,
    operationKey: "provider.maps.route_estimate",
    providerAdapterKey: activeProviderKey,
    providerKind: "maps",
    requestPayload,
    responsePayload: data,
    status: "succeeded",
  });

  return jsonResponse({
    ok: true,
    data,
    requestId: id,
  });
}

async function buildLpgCommercialRouteSnapshot(
  supabase: SupabaseClient,
  pickupLocationId: string,
  deliveryLocationId: string,
  stationBranchId: string,
  id: string,
): Promise<
  | { readonly data: Readonly<Record<string, unknown>> }
  | { readonly response: Response }
> {
  const [pickupResult, deliveryResult, stationResult] = await Promise.all([
    supabase
      .from("lpg_customer_locations")
      .select("id,latitude,longitude")
      .eq("id", pickupLocationId)
      .maybeSingle(),
    supabase
      .from("lpg_customer_locations")
      .select("id,latitude,longitude")
      .eq("id", deliveryLocationId)
      .maybeSingle(),
    supabase
      .from("lpg_station_branches")
      .select("id,latitude,longitude")
      .eq("id", stationBranchId)
      .eq("approval_status", "approved")
      .eq("compliance_status", "approved")
      .maybeSingle(),
  ]);

  const locationError = pickupResult.error ?? deliveryResult.error ?? stationResult.error;
  if (locationError) {
    return { response: databaseError(locationError, id) };
  }

  if (!pickupResult.data || !deliveryResult.data || !stationResult.data) {
    return {
      response: jsonResponse(
        {
          ok: false,
          error: "invalid_request",
          message: "The selected pickup, delivery, and approved station locations are required.",
          requestId: id,
        },
        400,
      ),
    };
  }

  const pickup = requireCoordinate(pickupResult.data, "pickup location");
  const station = requireCoordinate(stationResult.data, "station location");
  const delivery = requireCoordinate(deliveryResult.data, "delivery location");
  const providerResult = await resolveLpgMapsProvider(supabase, id, "route_estimate");
  if (providerResult.response) return { response: providerResult.response };

  const firstLeg = await estimateCommercialRouteLeg(pickup, station, providerResult, id);
  if ("response" in firstLeg) return firstLeg;
  const secondLeg = await estimateCommercialRouteLeg(station, delivery, providerResult, id);
  if ("response" in secondLeg) return secondLeg;

  return {
    data: {
      calculatedAt: new Date().toISOString(),
      distanceMeters: firstLeg.data.distanceMeters + secondLeg.data.distanceMeters,
      durationSeconds: firstLeg.data.durationSeconds + secondLeg.data.durationSeconds,
      legs: [
        { ...firstLeg.data, destination: "station", origin: "customer_pickup" },
        { ...secondLeg.data, destination: "customer_return", origin: "station" },
      ],
      provider: firstLeg.data.provider,
      providerAdapterKey: providerResult.providerKey,
      routeType: "customer_pickup_station_customer_return",
    },
  };
}

async function estimateCommercialRouteLeg(
  origin: { readonly latitude: number; readonly longitude: number },
  destination: { readonly latitude: number; readonly longitude: number },
  providerResult: { readonly policy: Record<string, unknown>; readonly providerKey: string },
  id: string,
): Promise<
  | { readonly data: { readonly distanceMeters: number; readonly durationSeconds: number; readonly provider: string } }
  | { readonly response: Response }
> {
  if (providerResult.providerKey === "provider.maps.sandbox") {
    const distanceMeters = Math.round(haversineDistanceMeters(origin, destination));
    const speedKph = requireNumber(
      providerResult.policy.sandbox_route_speed_kph,
      "sandbox_route_speed_kph",
    );
    return {
      data: {
        distanceMeters,
        durationSeconds: Math.max(1, Math.round(distanceMeters / (speedKph * 1000 / 3600))),
        provider: "sandbox",
      },
    };
  }

  if (providerResult.providerKey !== "provider.maps.google-maps") {
    return { response: unsupportedMapsProviderResponse(providerResult.providerKey, "route_estimate", id) };
  }

  const googleMapsKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!googleMapsKey) return { response: missingMapsSecretResponse(providerResult.providerKey, id) };

  const providerResponse = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    body: JSON.stringify({
      computeAlternativeRoutes: false,
      destination: {
        location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } },
      },
      origin: {
        location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } },
      },
      routingPreference: "TRAFFIC_AWARE",
      travelMode: "DRIVE",
    }),
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": googleMapsKey,
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
    },
    method: "POST",
  });
  const responsePayload = requireRecordOrEmpty(await readProviderJson(providerResponse));
  if (!providerResponse.ok) {
    const errorRecord = requireRecordOrEmpty(responsePayload.error);
    return {
      response: jsonResponse(
        {
          ok: false,
          error: "provider_error",
          message: optionalString(errorRecord.message) ?? "Google Maps route request failed.",
          requestId: id,
        },
        502,
      ),
    };
  }

  const routes = Array.isArray(responsePayload.routes) ? responsePayload.routes : [];
  const route = requireRecord(routes[0], "Google Maps route");
  const duration = optionalString(route.duration) ?? "0s";
  return {
    data: {
      distanceMeters: requireNumber(route.distanceMeters, "Google route distance"),
      durationSeconds: Math.max(0, Math.round(Number(duration.replace(/s$/, "")))),
      provider: "google_maps",
    },
  };
}

async function handleMapsAutocompleteRequest(
  request: Request,
  id: string,
  supabase: SupabaseClient,
  supabaseUrl: string,
): Promise<Response> {
  const body = await readJsonBody(request, id);

  if ("response" in body) {
    return body.response;
  }

  const payload = body.value;
  const input = requireString(payload.input, "input");
  const idempotencyKey = optionalString(payload.idempotencyKey) ??
    createGatewayIdempotencyKey(id, "maps-autocomplete");
  const providerResult = await resolveLpgMapsProvider(supabase, id, "autocomplete");

  if (providerResult.response) {
    return providerResult.response;
  }

  const activeProviderKey = providerResult.providerKey;
  const requestPayload: Record<string, unknown> = {
    input,
    operation: "autocomplete",
    providerAdapterKey: activeProviderKey,
  };

  if (activeProviderKey === "provider.maps.sandbox") {
    const data = {
      operation: "autocomplete",
      predictions: [
        {
          description: input,
          matchedSubstrings: [{ length: input.length, offset: 0 }],
          placeId: `sandbox:${stableStringHash(input.toLowerCase()).toString(16)}`,
          structuredFormatting: {
            mainText: input,
            secondaryText: "Sandbox location",
          },
        },
      ],
      provider: "sandbox",
    };

    await maybeRecordGatewayProviderExecution(supabaseUrl, {
      errorMessage: null,
      idempotencyKey: `${idempotencyKey}:maps`,
      operationKey: "provider.maps.autocomplete",
      providerAdapterKey: activeProviderKey,
      providerKind: "maps",
      requestPayload,
      responsePayload: data,
      status: "succeeded",
    });

    return jsonResponse({ ok: true, data, requestId: id });
  }

  if (activeProviderKey !== "provider.maps.google-maps") {
    return unsupportedMapsProviderResponse(activeProviderKey, "autocomplete", id);
  }

  const googleMapsKey = Deno.env.get("GOOGLE_MAPS_API_KEY");

  if (!googleMapsKey) {
    return missingMapsSecretResponse(activeProviderKey, id);
  }

  const countryComponent = optionalString(payload.countryComponent);
  const queryUrl = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
  queryUrl.searchParams.set("input", input);
  queryUrl.searchParams.set("key", googleMapsKey);

  if (countryComponent) {
    queryUrl.searchParams.set("components", countryComponent);
    requestPayload.countryComponent = countryComponent;
  }

  const providerResponse = await fetch(queryUrl.toString());
  const responsePayload = requireRecordOrEmpty(await readProviderJson(providerResponse));
  const providerStatus = optionalString(responsePayload.status);

  if (!providerResponse.ok || providerStatus !== "OK") {
    const message = optionalString(responsePayload.error_message) ??
      optionalString(responsePayload.status) ??
      "Google Maps autocomplete request failed.";
    await maybeRecordGatewayProviderExecution(supabaseUrl, {
      errorMessage: message,
      idempotencyKey: `${idempotencyKey}:maps`,
      operationKey: "provider.maps.autocomplete",
      providerAdapterKey: activeProviderKey,
      providerKind: "maps",
      requestPayload,
      responsePayload: sanitizeProviderPayload(responsePayload),
      status: "failed",
    });

    return jsonResponse(
      {
        ok: false,
        error: "provider_error",
        message,
        requestId: id,
      },
      502,
    );
  }

  const predictions = Array.isArray(responsePayload.predictions)
    ? responsePayload.predictions
    : [];
  const data = {
    operation: "autocomplete",
    predictions,
    provider: "google_maps",
  };

  await maybeRecordGatewayProviderExecution(supabaseUrl, {
    errorMessage: null,
    idempotencyKey: `${idempotencyKey}:maps`,
    operationKey: "provider.maps.autocomplete",
    providerAdapterKey: activeProviderKey,
    providerKind: "maps",
    requestPayload,
    responsePayload: data,
    status: "succeeded",
  });

  return jsonResponse({ ok: true, data, requestId: id });
}

async function initializePaystackDeposit(
  params: InitializePaystackDepositParams,
): Promise<Response> {
  const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!paystackSecretKey || !serviceRoleKey) {
    return jsonResponse(
      {
        ok: false,
        error: "server_misconfigured",
        message: "Paystack deposits require PAYSTACK_SECRET_KEY and SUPABASE_SERVICE_ROLE_KEY.",
        requestId: params.id,
      },
      500,
    );
  }

  if (params.currencyCode !== "NGN") {
    throw new RequestValidationError("Paystack deposits currently require NGN.");
  }

  const email = params.customerEmail ?? optionalString(params.payload.customerEmail);

  if (!email) {
    throw new RequestValidationError("A customer email is required for Paystack deposits.");
  }

  const idempotencyKey = requireString(params.payload.idempotencyKey, "idempotencyKey");
  const initializeResult = await params.supabase.rpc("initialize_wallet_deposit", {
    target_amount: params.amount,
    target_currency_code: params.currencyCode,
    target_idempotency_key: idempotencyKey,
    target_metadata: optionalRecord(params.payload.metadata) ?? {},
    target_provider_adapter_key: "provider.payment.paystack",
    target_source: optionalString(params.payload.source) ?? "platform.payment_engine",
    target_wallet_id: optionalUuid(params.payload.walletId, "walletId"),
  });

  if (initializeResult.error) {
    return databaseError(initializeResult.error, params.id);
  }

  const depositId = requireString(initializeResult.data, "deposit id");
  const serviceClient = createServiceClient(params.supabaseUrl, serviceRoleKey);
  const { data: depositRecord, error: depositError } = await serviceClient
    .from("payment_deposit_requests")
    .select("id,public_reference,wallet_id,amount,currency_code,provider_reference,metadata")
    .eq("id", depositId)
    .single();

  if (depositError) {
    return databaseError(depositError, params.id);
  }

  const depositPublicReference = stringOrNull(getRecordValue(depositRecord, "public_reference"));

  if (!depositPublicReference) {
    return databaseError(
      { message: `Public reference was not assigned for payment_deposit_requests record ${depositId}.` },
      params.id,
    );
  }

  const paystackRequestPayload = buildPaystackInitializePayload({
    amount: Number(depositRecord.amount),
    callbackUrl: optionalString(params.payload.callbackUrl) ??
      Deno.env.get("SKIMA_PAYSTACK_CALLBACK_URL") ?? null,
    currencyCode: String(depositRecord.currency_code),
    depositId,
    email,
    metadata: {
      ...(optionalRecord(params.payload.metadata) ?? {}),
      depositRequestId: depositId,
      providerAdapterKey: "provider.payment.paystack",
      walletId: depositRecord.wallet_id,
    },
    providerReference: String(depositRecord.provider_reference),
  });

  const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
    body: JSON.stringify(paystackRequestPayload),
    headers: {
      Authorization: `Bearer ${paystackSecretKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const paystackBody = await readPaystackJson(paystackResponse);

  if (!paystackResponse.ok || paystackBody.status !== true) {
    const providerMessage = typeof paystackBody.message === "string"
      ? paystackBody.message
      : "Paystack transaction initialization failed.";

    await markPaystackDepositInitializationFailed(
      serviceClient,
      depositId,
      depositRecord.metadata,
      {
        httpStatus: paystackResponse.status,
        message: providerMessage,
      },
    );
    await recordGatewayProviderExecution(serviceClient, {
      errorMessage: providerMessage,
      idempotencyKey: `${idempotencyKey}:paystack`,
      operationKey: "provider.payment.initialize",
      providerAdapterKey: "provider.payment.paystack",
      requestPayload: paystackRequestPayload,
      responsePayload: requireRecordOrEmpty(paystackBody),
      status: "failed",
    });

    return jsonResponse(
      {
        ok: false,
        error: "provider_error",
        message: providerMessage,
        requestId: params.id,
      },
      502,
    );
  }

  const paystackData = requireRecord(paystackBody.data, "Paystack data");
  const authorizationUrl = requireString(paystackData.authorization_url, "authorization_url");
  const providerReference = optionalString(paystackData.reference) ??
    String(depositRecord.provider_reference);
  const mergedMetadata = {
    ...requireRecordOrEmpty(depositRecord.metadata),
    paystack: {
      accessCode: optionalString(paystackData.access_code),
      initializedAt: new Date().toISOString(),
      reference: providerReference,
    },
  };
  const { error: updateError } = await serviceClient
    .from("payment_deposit_requests")
    .update({
      checkout_url: authorizationUrl,
      metadata: mergedMetadata,
      provider_reference: providerReference,
      updated_at: new Date().toISOString(),
    })
    .eq("id", depositId);

  if (updateError) {
    return databaseError(updateError, params.id);
  }

  await recordGatewayProviderExecution(serviceClient, {
    errorMessage: null,
    idempotencyKey: `${idempotencyKey}:paystack`,
    operationKey: "provider.payment.initialize",
    providerAdapterKey: "provider.payment.paystack",
    requestPayload: paystackRequestPayload,
    responsePayload: {
      authorizationUrl,
      reference: providerReference,
    },
    status: "succeeded",
  });

  return jsonResponse({
    ok: true,
    data: {
      checkoutUrl: authorizationUrl,
      currencyCode: String(depositRecord.currency_code),
      depositRequestId: depositId,
      providerAdapterKey: "provider.payment.paystack",
      providerReference,
      publicReference: depositPublicReference,
    },
    id: depositId,
    requestId: params.id,
  });
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

function buildPaystackInitializePayload(
  input: {
    readonly amount: number;
    readonly callbackUrl: string | null;
    readonly currencyCode: string;
    readonly depositId: string;
    readonly email: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly providerReference: string;
  },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    amount: toMinorCurrencyUnit(input.amount, "Paystack amount"),
    currency: input.currencyCode,
    email: input.email,
    metadata: input.metadata,
    reference: input.providerReference,
  };
  const callbackUrl = resolveOptionalHttpsUrl(input.callbackUrl, "callbackUrl");

  if (callbackUrl) {
    payload.callback_url = callbackUrl;
  }

  return payload;
}

function toMinorCurrencyUnit(amount: number, label: string): number {
  const minorAmount = Math.round(amount * 100);

  if (!Number.isSafeInteger(minorAmount) || minorAmount <= 0) {
    throw new RequestValidationError(`${label} must convert to a positive minor-unit integer.`);
  }

  return minorAmount;
}

function resolveOptionalHttpsUrl(value: string | null, fieldName: string): string | null {
  if (!value) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch (_error) {
    throw new RequestValidationError(`${fieldName} must be a valid URL.`);
  }

  if (url.protocol !== "https:") {
    throw new RequestValidationError(`${fieldName} must be an HTTPS URL.`);
  }

  return url.toString();
}

async function readPaystackJson(response: Response): Promise<PaystackInitializeResponse> {
  try {
    const value = await response.json();

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { message: "Paystack returned a non-object response.", status: false };
    }

    return value as PaystackInitializeResponse;
  } catch (_error) {
    return { message: "Paystack returned invalid JSON.", status: false };
  }
}

async function markPaystackDepositInitializationFailed(
  serviceClient: SupabaseClient,
  depositId: string,
  existingMetadata: unknown,
  failure: Readonly<Record<string, unknown>>,
): Promise<void> {
  await serviceClient
    .from("payment_deposit_requests")
    .update({
      checkout_url: null,
      failed_at: new Date().toISOString(),
      metadata: {
        ...requireRecordOrEmpty(existingMetadata),
        paystackInitializationFailure: failure,
      },
      status: "failed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", depositId);
}

async function recordGatewayProviderExecution(
  serviceClient: SupabaseClient,
  input: GatewayProviderExecutionInput,
): Promise<void> {
  await serviceClient.rpc("record_provider_execution", {
    target_error_message: input.errorMessage,
    target_idempotency_key: input.idempotencyKey,
    target_operation_key: input.operationKey,
    target_provider_adapter_key: input.providerAdapterKey,
    target_provider_kind: input.providerKind ?? "payment",
    target_request_payload: input.requestPayload,
    target_response_payload: input.responsePayload,
    target_status: input.status,
  });
}

async function maybeRecordGatewayProviderExecution(
  supabaseUrl: string,
  input: GatewayProviderExecutionInput,
): Promise<void> {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!serviceRoleKey) {
    return;
  }

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
  await recordGatewayProviderExecution(serviceClient, input);
}

async function readProviderJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (_error) {
    return {
      error: "invalid_json",
      status: response.status,
    };
  }
}

function sanitizeProviderPayload(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const sanitized = { ...value };

  delete sanitized.access_token;
  delete sanitized.key;
  delete sanitized.secret;

  return sanitized;
}

function createGatewayIdempotencyKey(id: string, operation: string): string {
  return `api-gateway:${operation}:${id}`;
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

function requirePlatformKey(value: unknown, fieldName: string): string {
  const key = requireString(value, fieldName);
  if (!/^[a-z][a-z0-9_.:-]{2,120}$/.test(key)) {
    throw new RequestValidationError(`${fieldName} must be a valid platform key.`);
  }

  return key;
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

function optionalIntegerQuery(value: string | null): number | null {
  if (value === null || value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new RequestValidationError("query integer field must be an integer.");
  }

  return parsed;
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

function optionalNumberArray(value: unknown, fieldName: string): number[] | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new RequestValidationError(`${fieldName} must be an array of finite numbers.`);
  }

  return value;
}

function requireCoordinate(
  value: unknown,
  fieldName: string,
): { readonly latitude: number; readonly longitude: number } {
  const record = requireRecord(value, fieldName);
  const latitude = requireNumber(record.latitude, `${fieldName}.latitude`);
  const longitude = requireNumber(record.longitude, `${fieldName}.longitude`);

  if (latitude < -90 || latitude > 90) {
    throw new RequestValidationError(`${fieldName}.latitude must be between -90 and 90.`);
  }

  if (longitude < -180 || longitude > 180) {
    throw new RequestValidationError(`${fieldName}.longitude must be between -180 and 180.`);
  }

  return { latitude, longitude };
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

function requireRecordOrEmpty(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Readonly<Record<string, unknown>>;
}

function optionalRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requireRecord(value, "optional object field");
}

function findAuthoritativeMoneyField(
  value: unknown,
  path = "",
): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = findAuthoritativeMoneyField(value[index], `${path}[${index}]`);
      if (result) return result;
    }

    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (isAuthoritativeMoneyKey(key)) {
      return path ? `${path}.${key}` : key;
    }

    const result = findAuthoritativeMoneyField(
      nestedValue,
      path ? `${path}.${key}` : key,
    );
    if (result) return result;
  }

  return null;
}

function isAuthoritativeMoneyKey(key: string): boolean {
  return /(^|_|\b)(amount|fee|price|markup|margin|rate|percent|percentage|tax|discount|total|subtotal|commission|payout|charge|surcharge)(_|$|\b)/i
    .test(key);
}

function getRecordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return (value as Readonly<Record<string, unknown>>)[key];
}

function recordsByStringId(records: readonly unknown[]): Map<string, unknown> {
  const byId = new Map<string, unknown>();

  for (const record of records) {
    const id = stringOrNull(getRecordValue(record, "id"));

    if (id) {
      byId.set(id, record);
    }
  }

  return byId;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function createPublicStorageUrl(supabaseUrl: string, storageBucket: string, storagePath: string): string {
  const safeBucket = encodeURIComponent(storageBucket);
  const safePath = storagePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${safeBucket}/${safePath}`;
}

function requireArray(value: unknown, fieldName: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new RequestValidationError(`${fieldName} must be a JSON array.`);
  }

  return value;
}

function sanitizeStoragePathSegment(value: string): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-");

  if (sanitized.length === 0 || sanitized === "." || sanitized === "..") {
    throw new RequestValidationError("storage path segment is invalid.");
  }

  return sanitized.slice(0, 120);
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
