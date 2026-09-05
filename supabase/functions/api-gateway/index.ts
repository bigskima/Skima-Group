import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.110.9";

import { createRequestSupabaseClient, requireAuthenticatedUser } from "../_shared/supabase-auth.ts";
import { jsonResponse, optionsResponse, requestId } from "../_shared/http.ts";
import {
  createLocationIqMapsAdapter,
  LocationProviderError,
  type MapsOperation,
} from "../_shared/locationiq-maps-adapter.ts";
import {
  createPaystackTransferRecipient,
  initiatePaystackTransfer,
  listPaystackBanks,
  PaystackPayoutError,
  readPaystackBalances,
  resolvePaystackBankAccount,
} from "../_shared/paystack-payouts.ts";
import {
  AiProviderRuntimeError,
  invokeAiText,
  resolveAiProviderRoute,
} from "../_shared/ai-provider-runtime.ts";

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
  "/admin/payments/bank-transfer-config",
  "/admin/revenue/provider-balance",
  "/admin/revenue/payout-context",
  "/admin/revenue/payout-banks",
  "/admin/revenue/payout-account/resolve",
  "/admin/revenue/payout-account",
  "/admin/revenue/payout",
  "/admin/revenue/payout/retry",
  "/admin/maps/location/status",
  "/admin/maps/location/providers",
  "/admin/maps/location/audit",
  "/admin/maps/location/provider",
  "/admin/ai/runtime",
  "/admin/ai/provider-route",
  "/admin/ai/provider-config",
  "/admin/ai/insight-action",
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
  "/lpg/stations/inventory",
  "/lpg/stations/inventory/report",
  "/lpg/stations/inventory/confirm",
  "/lpg/stations/inventory/adjustments",
  "/lpg/stations/inventory/configuration",
  "/lpg/stations/inventory/tanks",
  "/lpg/stations/inventory/tank-transfers",
  "/lpg/stations/inventory/manual-fallback",
  "/lpg/stations/inventory/manual-fallback/end",
  "/lpg/stations/inventory/availability",
  "/lpg/stations/inventory/operational-capacity",
  "/lpg/stations/inventory/telemetry-devices",
  "/lpg/stations/inventory/issues/unexpected-stockout",
  "/lpg/stations/inventory/providers",
  "/lpg/stations/inventory/provider-connections",
  "/lpg/stations/inventory/provider-connections/disconnect",
  "/admin/station-inventory",
  "/admin/station-inventory/policy",
  "/admin/station-inventory/reconciliation",
  "/admin/station-inventory/override",
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
  "/lpg/maps/providers/status",
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
  "/runtime/applications/activate-station",
  "/runtime/applications/activate-driver",
  "/runtime/applications/deactivate",
  "/runtime/applications/withdraw",
  "/runtime/driver-id-cards",
  "/runtime/driver-id-cards/photo",
  "/runtime/driver-id-cards/verify",
  "/runtime/documents/requirements",
  "/runtime/documents",
  "/runtime/documents/review",
  "/runtime/documents/request-replacement",
  "/runtime/media/approve-public",
  "/runtime/drivers",
  "/runtime/vehicle-types",
  "/runtime/vehicles",
  "/runtime/driver-vehicle-links",
  "/runtime/fleet-partners",
  "/runtime/vehicle-assignments",
  "/runtime/vehicle-assignments/end",
  "/runtime/vehicle-assignment-compliance",
  "/runtime/fleet-applications",
  "/runtime/fleet-applications/review",
  "/runtime/fleet-applications/resubmit",
  "/runtime/fleet-applications/documents",
  "/runtime/vehicles/lifecycle",
  "/runtime/my-vehicle",
  "/runtime/my-fleet",
  "/runtime/organization-branches",
  "/runtime/organization-roles",
  "/runtime/organization-memberships",
  "/runtime/organization-user-roles",
  "/runtime/organization-invitations",
  "/runtime/organization-invitations/accept",
  "/runtime/organization-invitations/decline",
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
  "/runtime/ai/assistant",
  "/runtime/ai/conversations",
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

    const routePath = normalizeGatewayPath(new URL(request.url).pathname);
    if (routePath === "/runtime/driver-id-cards/verify" && request.method === "GET") {
      return publicDriverIdVerificationResponse(request, id);
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

  if (routePath === "/admin/ai/runtime" && request.method === "GET") {
    return adminAiRuntimeResponse(supabase, authResult.user, supabaseUrl, id);
  }

  if (routePath === "/admin/ai/provider-route" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("set_ai_capability_provider", {
        target_capability_key: requirePlatformKey(payload.capabilityKey, "capabilityKey"),
        target_provider_adapter_key: requirePlatformKey(payload.providerAdapterKey, "providerAdapterKey"),
        target_model_key: requireString(payload.modelKey, "modelKey"),
        target_reason: requireString(payload.reason, "reason"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_route_config: optionalRecord(payload.routeConfig) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/admin/ai/provider-config" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("upsert_ai_provider_configuration", {
        target_provider_key: requirePlatformKey(payload.providerKey, "providerKey"),
        target_display_name: requireString(payload.displayName, "displayName"),
        target_transport: requireString(payload.transport, "transport"),
        target_api_base_url: optionalString(payload.apiBaseUrl),
        target_secret_ref: optionalString(payload.secretRef),
        target_status: optionalString(payload.status) ?? "inactive",
        target_config: optionalRecord(payload.config) ?? {},
        target_reason: requireString(payload.reason, "reason"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
      }),
      id,
    );
  }

  if (routePath === "/admin/ai/insight-action" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    return rpcResponse(
      supabase.rpc("acknowledge_ai_operational_insight", {
        target_insight_id: requireUuid(body.value.insightId, "insightId"),
        target_action: requireString(body.value.action, "action"),
      }),
      id,
    );
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

  if (routePath === "/lpg/stations/inventory" && request.method === "GET") {
    return rpcDataResponse(
      supabase.rpc("read_lpg_station_inventory", {
        target_limit: optionalIntegerQuery(url.searchParams.get("limit")) ?? 50,
        target_station_branch_id: optionalUuid(
          url.searchParams.get("stationBranchId"),
          "stationBranchId",
        ),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/inventory/providers" && request.method === "GET") {
    return rpcDataResponse(
      supabase.rpc("read_inventory_provider_catalog", {
        target_source_type_key: url.searchParams.get("sourceType"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/inventory/report" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("report_lpg_station_inventory", {
        target_evidence_asset_ids: optionalStringArray(payload.evidenceAssetIds) ?? [],
        target_expected_version: optionalInteger(payload.expectedVersion),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_measurement_method_key: requireString(payload.measurementMethod, "measurementMethod"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_note: optionalString(payload.note),
        target_physical_stock_kg: requireNumber(payload.physicalStockKg, "physicalStockKg"),
        target_skima_allocation_kg: optionalNumber(payload.skimaAllocationKg, "skimaAllocationKg"),
        target_source: optionalString(payload.source) ?? "skima.lpg.inventory.manual",
        target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
        target_tank_id: optionalUuid(payload.tankId, "tankId"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/inventory/confirm" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("confirm_lpg_station_inventory", {
        target_expected_version: optionalInteger(payload.expectedVersion),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_note: optionalString(payload.note),
        target_source: optionalString(payload.source) ?? "skima.lpg.inventory.confirmation",
        target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/inventory/adjustments" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("adjust_lpg_station_inventory", {
        target_adjustment_kg: requireNumber(payload.adjustmentKg, "adjustmentKg"),
        target_adjustment_type_key: requireString(payload.adjustmentType, "adjustmentType"),
        target_evidence_asset_ids: optionalStringArray(payload.evidenceAssetIds) ?? [],
        target_expected_version: optionalInteger(payload.expectedVersion),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_note: optionalString(payload.note),
        target_source: optionalString(payload.source) ?? "skima.lpg.inventory.adjustment",
        target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
        target_tank_id: optionalUuid(payload.tankId, "tankId"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/inventory/configuration" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("configure_lpg_station_inventory", {
        target_allocation_mode: optionalString(payload.allocationMode),
        target_allocation_value: optionalNumber(payload.allocationValue, "allocationValue"),
        target_fallback_source_key: optionalString(payload.fallbackSource),
        target_expected_version: optionalInteger(payload.expectedVersion),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_primary_source_key: requireString(payload.primarySource, "primarySource"),
        target_safety_reserve_mode: optionalString(payload.safetyReserveMode),
        target_safety_reserve_value: optionalNumber(payload.safetyReserveValue, "safetyReserveValue"),
        target_secondary_source_key: optionalString(payload.secondarySource),
        target_source: optionalString(payload.source) ?? "skima.lpg.inventory.configuration",
        target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
        target_tracking_mode: requireString(payload.trackingMode, "trackingMode"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/inventory/tanks" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("upsert_lpg_station_tank", {
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_inspection_status: optionalString(payload.inspectionStatus) ?? "unknown",
        target_installation_date: optionalString(payload.installationDate),
        target_maximum_safe_fill_percentage: optionalNumber(payload.maximumSafeFillPercentage, "maximumSafeFillPercentage") ?? 85,
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_minimum_safe_stock_kg: optionalNumber(payload.minimumSafeStockKg, "minimumSafeStockKg") ?? 0,
        target_rated_capacity_kg: requireNumber(payload.ratedCapacityKg, "ratedCapacityKg"),
        target_source: optionalString(payload.source) ?? "skima.lpg.inventory.tank_configuration",
        target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
        target_status: optionalString(payload.status) ?? "active",
        target_tank_code: requireString(payload.tankCode, "tankCode"),
        target_tank_id: optionalUuid(payload.tankId, "tankId"),
        target_tank_name: requireString(payload.tankName, "tankName"),
        target_telemetry_capable: optionalBoolean(payload.telemetryCapable) ?? false,
        target_usable_capacity_kg: requireNumber(payload.usableCapacityKg, "usableCapacityKg"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/inventory/tank-transfers" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("transfer_lpg_station_tank_stock", {
        target_from_tank_id: requireUuid(payload.fromTankId, "fromTankId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_note: optionalString(payload.note),
        target_quantity_kg: requireNumber(payload.quantityKg, "quantityKg"),
        target_source: optionalString(payload.source) ?? "skima.lpg.inventory.tank_transfer",
        target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
        target_to_tank_id: requireUuid(payload.toTankId, "toTankId"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/inventory/manual-fallback" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("enable_lpg_station_inventory_manual_fallback", {
        target_duration_hours: requireNumber(payload.durationHours, "durationHours"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_reason: requireString(payload.reason, "reason"),
        target_source: optionalString(payload.source) ?? "skima.lpg.inventory.manual_fallback",
        target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/inventory/provider-connections" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("configure_lpg_inventory_provider_connection", {
        target_display_name: requireString(payload.displayName, "displayName"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_provider_key: requireString(payload.providerKey, "providerKey"),
        target_settings: optionalRecord(payload.settings) ?? {},
        target_source: optionalString(payload.source) ?? "skima.lpg.inventory.provider_connection",
        target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/inventory/provider-connections/disconnect" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("disconnect_lpg_inventory_provider", {
        target_connection_public_reference: requireString(payload.connectionReference, "connectionReference"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_reason: requireString(payload.reason, "reason"),
        target_source: optionalString(payload.source) ?? "skima.lpg.inventory.provider_disconnect",
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/inventory/telemetry-devices" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("upsert_lpg_inventory_telemetry_device", {
        target_calibration: optionalRecord(payload.calibration) ?? {},
        target_connection_public_reference: requireString(payload.connectionReference, "connectionReference"),
        target_display_name: requireString(payload.displayName, "displayName"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_measurement_kind: requireString(payload.measurementKind, "measurementKind"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_provider_device_reference: requireString(payload.providerDeviceReference, "providerDeviceReference"),
        target_source: optionalString(payload.source) ?? "skima.lpg.inventory.telemetry_device",
        target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
        target_tank_public_reference: requireString(payload.tankReference, "tankReference"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/inventory/operational-capacity" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("configure_lpg_station_operational_capacity", {
        target_congestion_status: optionalString(payload.congestionStatus) ?? "normal",
        target_estimated_processing_minutes: optionalNumber(payload.estimatedProcessingMinutes, "estimatedProcessingMinutes"),
        target_expected_version: optionalInteger(payload.expectedVersion),
        target_filling_points: requireInteger(payload.fillingPoints, "fillingPoints"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_maximum_concurrent_jobs: requireInteger(payload.maximumConcurrentJobs, "maximumConcurrentJobs"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_pause_reason: optionalString(payload.pauseReason),
        target_paused_until: optionalString(payload.pausedUntil),
        target_source: optionalString(payload.source) ?? "skima.lpg.inventory.operational_capacity",
        target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/inventory/availability" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("set_lpg_station_inventory_availability", {
        target_action: requireString(payload.action, "action"),
        target_expected_version: optionalInteger(payload.expectedVersion),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_reason: optionalString(payload.reason) ?? "Station restored verified inventory availability.",
        target_source: optionalString(payload.source) ?? "skima.lpg.inventory.availability",
        target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
        target_until: optionalString(payload.until),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/inventory/manual-fallback/end" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("end_lpg_station_inventory_manual_fallback", {
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_reason: requireString(payload.reason, "reason"),
        target_source: optionalString(payload.source) ?? "skima.lpg.inventory.manual_fallback_end",
        target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/stations/inventory/issues/unexpected-stockout" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("report_lpg_inventory_unexpected_stockout", {
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_order_public_reference: optionalString(payload.orderReference),
        target_reason: requireString(payload.reason, "reason"),
        target_source: optionalString(payload.source) ?? "skima.lpg.inventory.unexpected_stockout",
        target_station_branch_id: optionalUuid(payload.stationBranchId, "stationBranchId"),
      }),
      id,
    );
  }

  if (routePath === "/admin/station-inventory" && request.method === "GET") {
    return rpcDataResponse(
      supabase.rpc("read_lpg_admin_inventory_operations", {
        target_limit: optionalIntegerQuery(url.searchParams.get("limit")) ?? 100,
        target_station_branch_id: optionalUuid(
          url.searchParams.get("stationBranchId"),
          "stationBranchId",
        ),
      }),
      id,
    );
  }

  if (routePath === "/admin/station-inventory/policy" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("configure_inventory_control_policy", {
        target_actual_fill_tolerance_kg: requireNumber(payload.actualFillToleranceKg, "actualFillToleranceKg"),
        target_alert_reminder_interval_minutes: requireInteger(payload.alertReminderIntervalMinutes, "alertReminderIntervalMinutes"),
        target_change_reason: requireString(payload.changeReason, "changeReason"),
        target_critical_stock_percentage: requireNumber(payload.criticalStockPercentage, "criticalStockPercentage"),
        target_discrepancy_tolerance_kg: requireNumber(payload.discrepancyToleranceKg, "discrepancyToleranceKg"),
        target_dispatch_blocking_interval_minutes: requireInteger(payload.dispatchBlockingIntervalMinutes, "dispatchBlockingIntervalMinutes"),
        target_expected_version: requireInteger(payload.expectedVersion, "expectedVersion"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_low_stock_percentage: requireNumber(payload.lowStockPercentage, "lowStockPercentage"),
        target_manual_confirmation_interval_minutes: requireInteger(payload.manualConfirmationIntervalMinutes, "manualConfirmationIntervalMinutes"),
        target_manual_fallback_maximum_hours: requireNumber(payload.manualFallbackMaximumHours, "manualFallbackMaximumHours"),
        target_manual_stale_interval_minutes: requireInteger(payload.manualStaleIntervalMinutes, "manualStaleIntervalMinutes"),
        target_manual_warning_interval_minutes: requireInteger(payload.manualWarningIntervalMinutes, "manualWarningIntervalMinutes"),
        target_maximum_actual_fill_overage_kg: requireNumber(payload.maximumActualFillOverageKg, "maximumActualFillOverageKg"),
        target_maximum_availability_pause_hours: requireInteger(payload.maximumAvailabilityPauseHours, "maximumAvailabilityPauseHours"),
        target_minimum_dispatch_confidence: requireString(payload.minimumDispatchConfidence, "minimumDispatchConfidence"),
        target_provider_degraded_interval_minutes: requireInteger(payload.providerDegradedIntervalMinutes, "providerDegradedIntervalMinutes"),
        target_provider_health_check_interval_minutes: requireInteger(payload.providerHealthCheckIntervalMinutes, "providerHealthCheckIntervalMinutes"),
        target_provider_offline_interval_minutes: requireInteger(payload.providerOfflineIntervalMinutes, "providerOfflineIntervalMinutes"),
        target_provider_retry_base_seconds: requireInteger(payload.providerRetryBaseSeconds, "providerRetryBaseSeconds"),
        target_provider_retry_maximum_attempts: requireInteger(payload.providerRetryMaximumAttempts, "providerRetryMaximumAttempts"),
        target_provider_sync_interval_minutes: requireInteger(payload.providerSyncIntervalMinutes, "providerSyncIntervalMinutes"),
        target_reservation_expiry_minutes: requireInteger(payload.reservationExpiryMinutes, "reservationExpiryMinutes"),
        target_safety_reserve_mode: requireString(payload.safetyReserveMode, "safetyReserveMode"),
        target_safety_reserve_value: requireNumber(payload.safetyReserveValue, "safetyReserveValue"),
        target_source_disagreement_critical_percentage: requireNumber(payload.sourceDisagreementCriticalPercentage, "sourceDisagreementCriticalPercentage"),
        target_source_disagreement_warning_percentage: requireNumber(payload.sourceDisagreementWarningPercentage, "sourceDisagreementWarningPercentage"),
        target_telemetry_stale_interval_minutes: requireInteger(payload.telemetryStaleIntervalMinutes, "telemetryStaleIntervalMinutes"),
        target_telemetry_warning_interval_minutes: requireInteger(payload.telemetryWarningIntervalMinutes, "telemetryWarningIntervalMinutes"),
        target_unexpected_stockout_reliability_penalty: requireNumber(payload.unexpectedStockoutReliabilityPenalty, "unexpectedStockoutReliabilityPenalty"),
      }),
      id,
    );
  }

  if (routePath === "/admin/station-inventory/reconciliation" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("resolve_lpg_inventory_reconciliation_case", {
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_reconciliation_public_reference: requireString(payload.reconciliationReference, "reconciliationReference"),
        target_resolution: requireString(payload.resolution, "resolution"),
        target_source: optionalString(payload.source) ?? "skima.lpg.inventory.reconciliation",
        target_status: requireString(payload.status, "status"),
      }),
      id,
    );
  }

  if (routePath === "/admin/station-inventory/override" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("apply_lpg_inventory_admin_override", {
        target_action: requireString(payload.action, "action"),
        target_expected_version: optionalInteger(payload.expectedVersion),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_reason: requireString(payload.reason, "reason"),
        target_source: optionalString(payload.source) ?? "skima.admin.inventory.override",
        target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
        target_until: optionalString(payload.until),
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
      const label = requireString(payload.label, "label").trim();
      const formattedAddress = requireString(payload.formattedAddress, "formattedAddress").trim();
      const latitude = requireNumber(payload.latitude, "latitude");
      const longitude = requireNumber(payload.longitude, "longitude");
      const accuracyMeters = optionalNumber(payload.accuracyMeters, "accuracyMeters");

      if (label.length < 2) {
        throw new RequestValidationError("label must contain at least 2 characters.");
      }
      if (formattedAddress.length < 5) {
        throw new RequestValidationError("formattedAddress must contain at least 5 characters.");
      }
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        throw new RequestValidationError("latitude and longitude must be valid coordinates.");
      }
      if (accuracyMeters !== null && accuracyMeters < 0) {
        throw new RequestValidationError("accuracyMeters cannot be negative.");
      }

      return rpcResponse(
        supabase.rpc("create_canonical_customer_location", {
          target_accuracy_meters: accuracyMeters,
          target_address: optionalRecord(payload.address) ?? {},
          target_capture_source: optionalString(payload.captureSource) ?? "DEVICE_GPS",
          target_captured_at: optionalString(payload.capturedAt),
          target_contact_name: optionalString(payload.contactName),
          target_contact_phone: optionalString(payload.contactPhone),
          target_delivery_instructions: optionalString(payload.deliveryInstructions),
          target_formatted_address: formattedAddress,
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_label: label,
          target_landmark: optionalString(payload.landmark),
          target_latitude: latitude,
          target_longitude: longitude,
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
        supabaseUrl,
        authResult.user.id,
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

  if (routePath === "/lpg/expansion-interest" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const locationIds = requireUuidArray(body.value.locationIds, "locationIds");
    if (locationIds.length === 0 || locationIds.length > 10) {
      return jsonResponse(
        { ok: false, error: "locationIds must contain between one and ten locations", requestId: id },
        400,
      );
    }

    return rpcResponse(
      supabase.rpc("record_lpg_customer_expansion_interest", {
        p_location_ids: [...new Set(locationIds)],
      }),
      id,
    );
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
        supabase.rpc("record_operational_driver_location", {
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

  if (routePath.startsWith("/admin/revenue/")) {
    const superAdminResult = await supabase.rpc("is_platform_super_admin");
    if (superAdminResult.error) return databaseError(superAdminResult.error, id);

    if (routePath === "/admin/revenue/provider-balance" && request.method === "GET") {
      const revenueRead = superAdminResult.data === true
        ? { data: true, error: null }
        : await supabase.rpc("has_permission", {
          target_permission: "platform.revenue.read",
          target_organization_id: null,
        });
      const revenueManage = superAdminResult.data === true
        ? { data: true, error: null }
        : await supabase.rpc("has_permission", {
          target_permission: "platform.revenue.manage",
          target_organization_id: null,
        });
      if (revenueRead.error) return databaseError(revenueRead.error, id);
      if (revenueManage.error) return databaseError(revenueManage.error, id);
      if (revenueRead.data !== true && revenueManage.data !== true) {
        return jsonResponse({
          ok: false,
          error: "forbidden",
          message: "SKIMA Revenue access is required.",
          requestId: id,
        }, 403);
      }

      const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
      if (!secret) {
        return jsonResponse({
          ok: true,
          data: {
            provider: "provider.payment.paystack",
            available: false,
            currencyCode: "NGN",
            balance: null,
            balanceMinor: null,
            reason: "PAYSTACK_NOT_CONFIGURED",
          },
          requestId: id,
        });
      }

      try {
        const balances = await readPaystackBalances(secret);
        const ngn = balances.find((balance) => balance.currency === "NGN") ?? null;
        return jsonResponse({
          ok: true,
          data: {
            provider: "provider.payment.paystack",
            available: Boolean(ngn),
            currencyCode: "NGN",
            balance: ngn?.balance ?? null,
            balanceMinor: ngn?.balanceMinor ?? null,
            balances,
          },
          requestId: id,
        });
      } catch (error) {
        return paystackGatewayError(error, id);
      }
    }

    if (superAdminResult.data !== true) {
      return jsonResponse({
        ok: false,
        error: "forbidden",
        message: "Only an active Super Admin can manage SKIMA revenue payouts.",
        requestId: id,
      }, 403);
    }

    if (routePath === "/admin/revenue/payout-context" && request.method === "GET") {
      return rpcDataResponse(
        supabase.rpc("read_platform_revenue_payout_context", {
          target_currency_code: url.searchParams.get("currency") ?? "NGN",
        }),
        id,
      );
    }

    if (routePath === "/admin/revenue/payout-banks" && request.method === "GET") {
      return payoutBankDirectoryResponse(supabase, id, true);
    }

    if (routePath === "/admin/revenue/payout-account/resolve" && request.method === "POST") {
      const body = await readJsonBody(request, id);
      if ("response" in body) return body.response;
      return payoutBankResolveResponse(
        supabase,
        id,
        requireString(body.value.accountNumber, "accountNumber"),
        requireString(body.value.bankCode, "bankCode"),
        true,
      );
    }

    if (routePath === "/admin/revenue/payout-account" && request.method === "POST") {
      const body = await readJsonBody(request, id);
      if ("response" in body) return body.response;
      const contextResult = await supabase.rpc("read_platform_revenue_payout_context", {
        target_currency_code: "NGN",
      });
      if (contextResult.error) return databaseError(contextResult.error, id);
      const context = requireRecord(contextResult.data, "platform revenue payout context");
      let walletId = optionalUuid(context.walletId, "SKIMA revenue wallet");
      if (!walletId) {
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!serviceRoleKey) {
          return jsonResponse({
            ok: false,
            error: "server_misconfigured",
            message: "SKIMA revenue payout setup is not configured.",
            requestId: id,
          }, 503);
        }
        const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
        const ensured = await serviceClient.rpc("ensure_platform_revenue_wallet", {
          target_currency_code: "NGN",
          target_source: "platform.revenue_payout_setup",
          target_idempotency_key: "platform-revenue:ngn",
        });
        if (ensured.error) return databaseError(ensured.error, id);
        walletId = requireUuid(ensured.data, "SKIMA revenue wallet");
      }
      return configurePaystackWithdrawalBeneficiary({
        accountNumber: requireString(body.value.accountNumber, "accountNumber"),
        bankCode: requireString(body.value.bankCode, "bankCode"),
        beneficiaryType: "bank_account",
        id,
        idempotencyKey: requireString(body.value.idempotencyKey, "idempotencyKey"),
        metadata: {
          ...(optionalRecord(body.value.metadata) ?? {}),
          payoutKind: "platform_revenue_treasury",
        },
        source: "platform.revenue_payout_beneficiary",
        supabase,
        supabaseUrl,
        walletId,
      });
    }

    if (routePath === "/admin/revenue/payout/retry" && request.method === "POST") {
      const body = await readJsonBody(request, id);
      if ("response" in body) return body.response;
      const withdrawalId = requireUuid(body.value.withdrawalRequestId, "withdrawalRequestId");
      const payoutIdempotencyKey = requireString(body.value.idempotencyKey, "idempotencyKey");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRoleKey) {
        return jsonResponse({
          ok: false,
          error: "server_misconfigured",
          message: "SKIMA payout execution is not configured.",
          requestId: id,
        }, 503);
      }

      const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
      const transferResult = await executePaystackWithdrawalTransfer(
        serviceClient,
        withdrawalId,
        `${payoutIdempotencyKey}:transfer`,
      );
      const payout = await serviceClient
        .from("withdrawal_requests")
        .select("id,public_reference,beneficiary_id,currency_code,amount,fee_amount,total_debit_amount,status,provider_reference,requested_at,approved_at,processed_at,failed_at,reversed_at")
        .eq("id", withdrawalId)
        .single();
      if (payout.error) return databaseError(payout.error, id);

      return jsonResponse({
        ok: true,
        data: {
          ...payout.data,
          transfer: transferResult,
        },
        requestId: id,
      });
    }

    if (routePath === "/admin/revenue/payout" && request.method === "POST") {
      const body = await readJsonBody(request, id);
      if ("response" in body) return body.response;
      const payoutIdempotencyKey = requireString(body.value.idempotencyKey, "idempotencyKey");
      const requestResult = await supabase.rpc("request_platform_revenue_withdrawal", {
        target_amount: requireNumber(body.value.amount, "amount"),
        target_beneficiary_id: requireUuid(body.value.beneficiaryId, "beneficiaryId"),
        target_currency_code: "NGN",
        target_idempotency_key: payoutIdempotencyKey,
        target_metadata: {
          ...(optionalRecord(body.value.metadata) ?? {}),
          requestedThrough: "admin.money_revenue",
        },
      });
      if (requestResult.error) return databaseError(requestResult.error, id);

      const withdrawalId = requireUuid(requestResult.data, "withdrawal id");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRoleKey) {
        return jsonResponse({
          ok: false,
          error: "server_misconfigured",
          message: "SKIMA payout execution is not configured.",
          requestId: id,
        }, 503);
      }
      const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
      // Approval is a Super Admin action, so execute it in the authenticated
      // request context. This preserves approved_by instead of attributing the
      // human treasury decision to the service role.
      const approveResult = await supabase.rpc("approve_wallet_withdrawal", {
        target_idempotency_key: `${payoutIdempotencyKey}:approve`,
        target_metadata: {
          payoutKind: "platform_revenue_treasury",
          requestedThrough: "admin.money_revenue",
        },
        target_source: "platform.revenue_payout",
        target_withdrawal_request_id: withdrawalId,
      });
      if (approveResult.error) return databaseError(approveResult.error, id);

      const transferResult = await executePaystackWithdrawalTransfer(
        serviceClient,
        withdrawalId,
        `${payoutIdempotencyKey}:transfer`,
      );

      const payout = await serviceClient
        .from("withdrawal_requests")
        .select("id,public_reference,beneficiary_id,currency_code,amount,fee_amount,total_debit_amount,status,provider_reference,requested_at,approved_at,processed_at,failed_at,reversed_at")
        .eq("id", withdrawalId)
        .single();
      if (payout.error) return databaseError(payout.error, id);

      return jsonResponse({
        ok: true,
        data: {
          ...payout.data,
          transfer: transferResult,
        },
        requestId: id,
      });
    }
  }

  if (
    (routePath === "/lpg/maps/providers/status" ||
      routePath === "/admin/maps/location/status" ||
      routePath === "/admin/maps/location/providers" ||
      routePath === "/admin/maps/location/audit") &&
    request.method === "GET"
  ) {
    const statusResult = await supabase.rpc("read_maps_location_status");
    if (statusResult.error) return databaseError(statusResult.error, id);
    const status = enrichMapsLocationStatus(requireRecord(statusResult.data, "maps location status"));

    if (routePath === "/admin/maps/location/status") {
      return jsonResponse({ ok: true, data: [mapsLocationStatusSummary(status)], requestId: id });
    }
    if (routePath === "/admin/maps/location/providers") {
      return jsonResponse({
        ok: true,
        data: mapsLocationProviderRecords(status),
        requestId: id,
      });
    }
    if (routePath === "/admin/maps/location/audit") {
      return jsonResponse({
        ok: true,
        data: mapsLocationAuditRecords(status),
        requestId: id,
      });
    }
    return jsonResponse({ ok: true, data: status, requestId: id });
  }

  if (routePath === "/admin/maps/location/provider" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const adminResult = await supabase.rpc("is_platform_super_admin");
    if (adminResult.error) return databaseError(adminResult.error, id);
    if (adminResult.data !== true) {
      return jsonResponse({
        ok: false,
        error: "forbidden",
        message: "Only an active Super Admin can change the location provider.",
        requestId: id,
      }, 403);
    }
    const providerKey = requireString(body.value.providerKey, "providerKey");
    if (!mapsProviderSecretConfigured(providerKey)) {
      return jsonResponse({
        ok: false,
        error: "server_misconfigured",
        message: "Configure the selected provider secret in Supabase before activating it.",
        requestId: id,
      }, 409);
    }
    return rpcResponse(
      supabase.rpc("configure_maps_provider", {
        target_idempotency_key: requireString(body.value.idempotencyKey, "idempotencyKey"),
        target_provider_key: providerKey,
        target_reason: requireString(body.value.reason, "reason"),
      }),
      id,
    );
  }

  if (routePath === "/lpg/maps/geocode" && request.method === "POST") {
    return handleMapsGeocodeRequest(
      request,
      id,
      supabase,
      supabaseUrl,
      authResult.user.id,
      "geocode",
    );
  }

  if (routePath === "/lpg/maps/reverse-geocode" && request.method === "POST") {
    return handleMapsGeocodeRequest(
      request,
      id,
      supabase,
      supabaseUrl,
      authResult.user.id,
      "reverse_geocode",
    );
  }

  if (routePath === "/lpg/maps/route-estimate" && request.method === "POST") {
    return handleMapsRouteEstimateRequest(
      request,
      id,
      supabase,
      supabaseUrl,
      authResult.user.id,
    );
  }

  if (routePath === "/lpg/maps/autocomplete" && request.method === "POST") {
    return handleMapsAutocompleteRequest(
      request,
      id,
      supabase,
      supabaseUrl,
      authResult.user.id,
    );
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
    const reviewResult = await supabase.rpc("review_document_submission", {
        target_applicant_message: optionalString(payload.applicantMessage),
        target_decision: requireString(payload.decision, "decision"),
        target_document_submission_id: requireUuid(
          payload.documentSubmissionId,
          "documentSubmissionId",
        ),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_internal_notes: optionalString(payload.internalNotes),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      });

    if (reviewResult.error) return databaseError(reviewResult.error, id);

    const noticeResult = await queueDocumentReviewNotice({
      applicantMessage: optionalString(payload.applicantMessage),
      decision: requireString(payload.decision, "decision"),
      documentSubmissionId: requireUuid(payload.documentSubmissionId, "documentSubmissionId"),
      id,
      idempotencyKey: requireString(payload.idempotencyKey, "idempotencyKey"),
      requestClient: supabase,
      supabaseUrl,
    });
    if ("response" in noticeResult) return noticeResult.response;

    return jsonResponse({ ok: true, data: reviewResult.data, id: reviewResult.data, requestId: id });
  }

  if (routePath === "/runtime/applications") {
    if (request.method === "GET") {
      return applicationsResponse(supabase, supabaseUrl, id);
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
    const correctionResult = await supabase.rpc("request_application_correction", {
        target_applicant_message: requireString(payload.applicantMessage, "applicantMessage"),
        target_application_id: requireUuid(payload.applicationId, "applicationId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_internal_notes: optionalString(payload.internalNotes),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      });

    if (correctionResult.error) return databaseError(correctionResult.error, id);

    const noticeResult = await queueApplicationCorrectionNotice({
      applicantMessage: requireString(payload.applicantMessage, "applicantMessage"),
      applicationId: requireUuid(payload.applicationId, "applicationId"),
      id,
      idempotencyKey: requireString(payload.idempotencyKey, "idempotencyKey"),
      requestClient: supabase,
      supabaseUrl,
    });
    if ("response" in noticeResult) return noticeResult.response;

    return jsonResponse({ ok: true, data: correctionResult.data, id: correctionResult.data, requestId: id });
  }

  if (routePath === "/runtime/applications/decisions" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    return applicationDecisionResponse(
      supabase,
      supabaseUrl,
      body.value,
      authResult.user,
      id,
    );
  }

  if (routePath === "/runtime/applications/activate-station" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("admin_activate_station", {
        target_application_id: requireUuid(payload.applicationId, "applicationId"),
        target_service_radius_meters: optionalInteger(payload.serviceRadiusMeters) ?? 8000,
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/applications/activate-driver" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("admin_activate_driver", {
        target_application_id: requireUuid(payload.applicationId, "applicationId"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
      }),
      id,
    );
  }

  if (routePath === "/runtime/applications/deactivate" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("admin_deactivate_partner", {
        target_application_id: requireUuid(payload.applicationId, "applicationId"),
        target_reason: optionalString(payload.reason) ?? "Administrative deactivation",
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/documents/request-replacement" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("request_document_requirement_replacement", {
        target_document_submission_id: requireUuid(payload.documentSubmissionId, "documentSubmissionId"),
        target_reason: requireString(payload.reason, "reason"),
        target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
      }),
      id,
    );
  }

  if (routePath === "/runtime/media/approve-public" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("admin_approve_public_station_media", {
        target_media_asset_id: requireUuid(payload.mediaAssetId, "mediaAssetId"),
        target_station_branch_id: requireUuid(payload.stationBranchId, "stationBranchId"),
        target_is_primary: optionalBoolean(payload.isPrimary) ?? false,
        target_display_order: optionalInteger(payload.displayOrder) ?? 0,
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

  if (routePath === "/runtime/driver-id-cards" && request.method === "GET") {
    return driverIdCardResponse(supabase, supabaseUrl, authResult.user, request, id);
  }

  if (routePath === "/runtime/driver-id-cards/photo" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    return updateDriverCardPhotoResponse(supabase, supabaseUrl, authResult.user, body.value, id);
  }

  if (routePath === "/runtime/drivers" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("driver_profiles")
        .select(
          "id,user_id,organization_id,operational_status,verification_status,identity_profile,license_profile,service_profile,approved_at,driver_display_name,public_driver_id,profile_photo_asset_id,driver_card_issued_at,driver_card_status,metadata,created_at,updated_at",
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
          "id,organization_id,owner_user_id,fleet_partner_id,vehicle_type_id,status,ownership_type,ownership_relationship,manufacturer,model,model_year,registration_number,vin,color,max_load_kg,cargo_volume_m3,passenger_capacity,fuel_type,insurance_expires_at,inspection_expires_at,roadworthiness_expires_at,capacity_profile,metadata,created_at,updated_at",
        )
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (routePath === "/runtime/fleet-partners" && request.method === "GET") {
    return selectRecords(supabase.from("fleet_partners").select("id,owner_user_id,organization_id,partner_kind,display_name,verification_status,operational_status,verified_by,verified_at,decision_reason,metadata,created_at,updated_at").order("created_at", { ascending: false }), id);
  }

  if (routePath === "/runtime/vehicle-assignment-compliance" && request.method === "GET") {
    return selectRecords(supabase.from("vehicle_assignment_compliance").select("assignment_id,driver_profile_id,vehicle_id,driver_approved,vehicle_approved,assignment_active,vehicle_documents_valid,owner_approved,warnings"), id);
  }

  if (routePath === "/runtime/my-vehicle" && request.method === "GET") {
    return rpcResponse(supabase.rpc("read_my_vehicle_workspace"), id);
  }

  if (routePath === "/runtime/my-fleet" && request.method === "GET") {
    return rpcResponse(supabase.rpc("read_my_fleet_workspace"), id);
  }

  if (routePath === "/runtime/fleet-applications" && request.method === "POST") {
    const body = await readJsonBody(request, id); if ("response" in body) return body.response;
    return rpcResponse(supabase.rpc("submit_fleet_application", {
      target_partner_kind: requireString(body.value.partnerKind, "partnerKind"),
      target_legal_name: requireString(body.value.legalName, "legalName"),
      target_registration_identifier: optionalString(body.value.registrationIdentifier),
      target_payload: optionalRecord(body.value.applicationPayload) ?? {},
      target_source: optionalString(body.value.source) ?? "skima.fleet.portal",
      target_idempotency_key: requireString(body.value.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/fleet-applications/resubmit" && request.method === "POST") {
    const body = await readJsonBody(request, id); if ("response" in body) return body.response;
    return rpcResponse(supabase.rpc("resubmit_fleet_application", { target_application_id: requireString(body.value.applicationId, "applicationId"), target_payload: optionalRecord(body.value.applicationPayload) ?? {}, target_reason: requireString(body.value.reason, "reason"), target_idempotency_key: requireString(body.value.idempotencyKey, "idempotencyKey") }), id);
  }

  if (routePath === "/runtime/fleet-applications/documents" && request.method === "POST") {
    const body = await readJsonBody(request, id); if ("response" in body) return body.response;
    return rpcResponse(supabase.rpc("link_fleet_application_document", {
      target_application_id: requireString(body.value.applicationId, "applicationId"),
      target_requirement_key: requireString(body.value.requirementKey, "requirementKey"),
      target_document_submission_id: requireString(body.value.documentSubmissionId, "documentSubmissionId"),
      target_idempotency_key: requireString(body.value.idempotencyKey, "idempotencyKey"),
    }), id);
  }

  if (routePath === "/runtime/fleet-applications/review" && request.method === "POST") {
    const body = await readJsonBody(request, id); if ("response" in body) return body.response;
    return rpcResponse(supabase.rpc("review_fleet_application", { target_application_id: requireString(body.value.applicationId, "applicationId"), target_decision: requireString(body.value.decision, "decision"), target_reason: requireString(body.value.reason, "reason"), target_idempotency_key: requireString(body.value.idempotencyKey, "idempotencyKey") }), id);
  }

  if (routePath === "/runtime/vehicles/lifecycle" && request.method === "POST") {
    const body = await readJsonBody(request, id); if ("response" in body) return body.response;
    return rpcResponse(supabase.rpc("decide_vehicle_lifecycle", { target_vehicle_id: requireString(body.value.vehicleId, "vehicleId"), target_decision: requireString(body.value.decision, "decision"), target_reason: requireString(body.value.reason, "reason"), target_idempotency_key: requireString(body.value.idempotencyKey, "idempotencyKey") }), id);
  }

  if (routePath === "/runtime/vehicle-assignments" && request.method === "POST") {
    const body = await readJsonBody(request, id); if ("response" in body) return body.response;
    return rpcResponse(supabase.rpc("assign_driver_vehicle", { target_driver_profile_id: requireString(body.value.driverProfileId, "driverProfileId"), target_vehicle_id: requireString(body.value.vehicleId, "vehicleId"), target_relationship: requireString(body.value.relationship, "relationship"), target_starts_at: optionalString(body.value.startsAt), target_metadata: optionalRecord(body.value.metadata) ?? {} }), id);
  }

  if (routePath === "/runtime/vehicle-assignments/end" && request.method === "POST") {
    const body = await readJsonBody(request, id); if ("response" in body) return body.response;
    return rpcResponse(supabase.rpc("end_driver_vehicle_assignment", { target_assignment_id: requireString(body.value.assignmentId, "assignmentId"), target_reason: requireString(body.value.reason, "reason") }), id);
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

  if (routePath === "/runtime/organization-invitations/decline" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;
    const payload = body.value;
    return rpcResponse(
      supabase.rpc("decline_organization_invitation", {
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
    return walletBalancesResponse(supabase, id);
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
      let providerAdapterKey = optionalString(payload.providerAdapterKey);
      if (!providerAdapterKey) {
        providerAdapterKey = await resolveActivePaymentProviderKey(supabase);
      }

      if (
        providerAdapterKey === "provider.payment.paystack" ||
        providerAdapterKey === "provider.payment.bank_transfer"
      ) {
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

  if (routePath === "/admin/payments/bank-transfer-config" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const payload = body.value;
    const bankName = requireString(payload.bankName, "bankName");
    const accountNumber = requireString(payload.accountNumber, "accountNumber");
    const accountName = requireString(payload.accountName, "accountName");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey ?? "");
    const { error: upsertErr } = await serviceClient
      .from("provider_adapters")
      .upsert(
        {
          provider_kind: "payment",
          key: "provider.payment.bank_transfer",
          display_name: "Direct Bank Transfer Adapter",
          status: "active",
          config: {
            bank_name: bankName,
            account_number: accountNumber,
            account_name: accountName,
            bankName,
            accountNumber,
            accountName,
            updated_at: new Date().toISOString(),
            updated_by: authResult.user.id,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "provider_kind,key" },
      );

    if (upsertErr) {
      return databaseError(upsertErr, id);
    }

    return jsonResponse({
      ok: true,
      data: {
        accountName,
        accountNumber,
        bankName,
        message: "Direct bank transfer details updated successfully.",
      },
      id: id,
      requestId: id,
    });
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
      let providerAdapterKey = optionalString(payload.providerAdapterKey);
      if (!providerAdapterKey) {
        providerAdapterKey = await resolveActivePaymentProviderKey(supabase);
      }

      if (providerAdapterKey === "provider.payment.paystack") {
        return configurePaystackWithdrawalBeneficiary({
          accountNumber: requireString(payload.accountNumber, "accountNumber"),
          bankCode: optionalString(payload.bankCode) ?? "058",
          beneficiaryType: optionalString(payload.beneficiaryType) ?? "bank_account",
          id,
          idempotencyKey: requireString(payload.idempotencyKey, "idempotencyKey"),
          metadata: optionalRecord(payload.metadata) ?? {},
          source: optionalString(payload.source) ?? "platform.withdrawal_engine",
          supabase,
          supabaseUrl,
          walletId: requireUuid(payload.walletId, "walletId"),
        });
      }

      return rpcResponse(
        supabase.rpc("configure_withdrawal_beneficiary", {
          target_account_name: optionalString(payload.accountName) ??
            `Sandbox payout account •••• ${requireString(payload.accountNumber, "accountNumber").slice(-4)}`,
          target_account_number: requireString(payload.accountNumber, "accountNumber"),
          target_bank_code: optionalString(payload.bankCode),
          target_beneficiary_type: optionalString(payload.beneficiaryType) ?? "bank_account",
          target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
          target_metadata: optionalRecord(payload.metadata) ?? {},
          target_provider_adapter_key: providerAdapterKey,
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
    const withdrawalRequestId = requireUuid(payload.withdrawalRequestId, "withdrawalRequestId");
    const approveResult = await supabase.rpc("approve_wallet_withdrawal", {
      target_idempotency_key: requireString(payload.idempotencyKey, "idempotencyKey"),
      target_metadata: optionalRecord(payload.metadata) ?? {},
      target_source: optionalString(payload.source) ?? "platform.withdrawal_engine",
      target_withdrawal_request_id: withdrawalRequestId,
    });

    if (approveResult.error) {
      return databaseError(approveResult.error, id);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY");

    if (serviceRoleKey && paystackSecretKey) {
      const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
      const { data: withdrawalRecord } = await serviceClient
        .from("withdrawal_requests")
        .select("id,public_reference,amount,fee_amount,total_debit_amount,currency_code,beneficiary_id,provider_adapter_id")
        .eq("id", withdrawalRequestId)
        .single();

      if (withdrawalRecord) {
        const { data: beneficiaryRecord } = await serviceClient
          .from("withdrawal_beneficiaries")
          .select("provider_recipient_code,metadata")
          .eq("id", withdrawalRecord.beneficiary_id)
          .single();

        const recipientCode = beneficiaryRecord?.provider_recipient_code ??
          optionalString(beneficiaryRecord?.metadata?.paystackRecipientCode);

        if (recipientCode) {
          const transferReference = `skima-wdl-${String(withdrawalRecord.id).replaceAll("-", "")}`;
          const referenceReservation = await serviceClient
            .from("withdrawal_requests")
            .update({
              provider_reference: transferReference,
              updated_at: new Date().toISOString(),
            })
            .eq("id", withdrawalRequestId);

          if (referenceReservation.error) {
            return databaseError(referenceReservation.error, id);
          }

          try {
            const transfer = await initiatePaystackTransfer(paystackSecretKey, {
              amountMajor: Number(withdrawalRecord.amount),
              recipientCode,
              reason: "SKIMA wallet withdrawal",
              reference: transferReference,
            });

            await supabase.rpc("process_wallet_withdrawal_transfer", {
              target_idempotency_key: `${payload.idempotencyKey}:transfer:${transfer.providerStatus}`,
              target_metadata: {
                automaticGatewayTransfer: true,
                principalSentToProvider: withdrawalRecord.amount,
                skimaFeeRetained: withdrawalRecord.fee_amount,
              },
              target_provider_reference: transfer.providerReference,
              target_provider_status: transfer.providerStatus,
              target_response_payload: transfer.response,
              target_source: "platform.paystack_transfer_engine",
              target_withdrawal_request_id: withdrawalRequestId,
            });
          } catch (error) {
            if (error instanceof PaystackPayoutError && error.code !== "paystack_unreachable") {
              await supabase.rpc("process_wallet_withdrawal_transfer", {
                target_idempotency_key: `${payload.idempotencyKey}:transfer:failed`,
                target_metadata: {
                  automaticGatewayTransfer: true,
                  paystackErrorCode: error.code,
                  paystackErrorMessage: error.message,
                  principalAttempted: withdrawalRecord.amount,
                  skimaFeeRetained: withdrawalRecord.fee_amount,
                },
                target_provider_reference: transferReference,
                target_provider_status: "failed",
                target_response_payload: {
                  status: false,
                  error: error.code,
                  message: error.message,
                },
                target_source: "platform.paystack_transfer_engine",
                target_withdrawal_request_id: withdrawalRequestId,
              });
            }
            // Network ambiguity remains approved for a safe retry/webhook finalization.
          }
        }
      }
    }

    const withdrawalId = requireString(approveResult.data, "withdrawal request id");
    return jsonResponse({
      data: withdrawalId,
      id: withdrawalId,
      ok: true,
      requestId: id,
    });
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

  if (routePath === "/runtime/ai/assistant" && request.method === "POST") {
    const body = await readJsonBody(request, id);
    if ("response" in body) return body.response;

    try {
      return await aiAssistantResponse({
        authUser: authResult.user,
        id,
        payload: body.value,
        requestClient: supabase,
        supabaseUrl,
      });
    } catch (error) {
      if (error instanceof RequestValidationError) throw error;

      console.error(JSON.stringify({
        severity: "error",
        source: "api-gateway.ai-assistant",
        requestId: id,
        userId: authResult.user.id,
        code: error instanceof AiProviderRuntimeError ? error.code : "assistant_failed",
        message: error instanceof Error ? error.message : "unknown error",
      }));

      if (error instanceof AiProviderRuntimeError) {
        return jsonResponse({
          ok: false,
          error: error.code,
          message: error.code === "provider_rate_limited"
            ? "SKIMA AI is busy right now. Please try again shortly."
            : "SKIMA AI is temporarily unavailable. Your account and LPG operations are unaffected.",
          requestId: id,
        }, error.code === "provider_rate_limited" ? 429 : 503);
      }

      return jsonResponse({
        ok: false,
        error: "ai_assistant_unavailable",
        message: "SKIMA AI is temporarily unavailable. Your account and LPG operations are unaffected.",
        requestId: id,
      }, 503);
    }
  }

  if (routePath === "/runtime/ai/conversations" && request.method === "GET") {
    const workspace = url.searchParams.get("workspace");
    const query = supabase
      .from("ai_conversations")
      .select("id,workspace,capability_key,title,status,last_message_at,created_at,updated_at")
      .eq("owner_user_id", authResult.user.id)
      .order("updated_at", { ascending: false })
      .limit(30);
    return selectRecords(workspace ? query.eq("workspace", workspace) : query, id);
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
    const ownedDriverCardPhoto = taskKey === "ai.driver.card_photo.enhance";
    return rpcResponse(
      ownedPresentation ? supabase.rpc("queue_owned_presentation_ai_task", {
        target_idempotency_key: idempotencyKey,
        target_input: input,
        target_source: source,
        target_subject_id: requireUuid(subjectId, "subjectId"),
        target_subject_type: subjectType,
        target_task_key: taskKey,
      }) : ownedDriverCardPhoto ? supabase.rpc("queue_owned_driver_card_photo_ai_task", {
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
  readonly providerKind?: "payment" | "storage" | "maps" | "notification" | "ai" | "queue" | "cache" | "observability" | "inventory";
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

  if (
    driverProfileId &&
    stringOrNull(getRecordValue(driverResult.data, "verification_status")) === "approved"
  ) {
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

async function applicationDecisionResponse(
  supabase: SupabaseClient,
  supabaseUrl: string,
  payload: Readonly<Record<string, unknown>>,
  user: User,
  id: string,
): Promise<Response> {
  const applicationId = requireUuid(payload.applicationId, "applicationId");
  const decision = requireString(payload.decision, "decision");
  const idempotencyKey = requireString(payload.idempotencyKey, "idempotencyKey");
  const metadata = optionalRecord(payload.metadata) ?? {};
  const reason = requireString(payload.reason, "reason");

  const decisionResult = await supabase.rpc("decide_application_review", {
    target_application_id: applicationId,
    target_decision: decision,
    target_idempotency_key: idempotencyKey,
    target_metadata: metadata,
    target_reason: reason,
  });

  if (decisionResult.error) {
    return databaseError(decisionResult.error, id);
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const effects: Record<string, unknown> = {};

  if (serviceRoleKey) {
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    const effectResult = await applyApplicationDecisionEffects({
      applicationId,
      decision,
      id,
      idempotencyKey,
      metadata,
      reviewerUserId: user.id,
      serviceClient,
      supabaseUrl,
    });

    if ("response" in effectResult) {
      return effectResult.response;
    }

    Object.assign(effects, effectResult.effects);
  }

  return jsonResponse({
    ok: true,
    data: {
      applicationId,
      effects,
    },
    id: applicationId,
    requestId: id,
  });
}

async function applyApplicationDecisionEffects(input: {
  readonly applicationId: string;
  readonly decision: string;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly reviewerUserId: string;
  readonly serviceClient: SupabaseClient;
  readonly supabaseUrl: string;
}): Promise<{ readonly effects: Readonly<Record<string, unknown>> } | { readonly response: Response }> {
  const applicationResult = await input.serviceClient
    .from("application_records")
    .select(
      "id,application_type_id,applicant_user_id,organization_id,activated_subject_type,activated_subject_id,status,approved_at,rejected_at,metadata",
    )
    .eq("id", input.applicationId)
    .maybeSingle();

  if (applicationResult.error) {
    return { response: databaseError(applicationResult.error, input.id) };
  }

  if (!applicationResult.data) {
    return {
      response: jsonResponse({
        ok: false,
        error: "application_not_found",
        requestId: input.id,
      }, 404),
    };
  }

  const applicationTypeId = requireUuid(
    getRecordValue(applicationResult.data, "application_type_id"),
    "applicationTypeId",
  );
  const applicationTypeResult = await input.serviceClient
    .from("application_type_definitions")
    .select("id,key,display_name,application_category,metadata")
    .eq("id", applicationTypeId)
    .maybeSingle();

  if (applicationTypeResult.error) {
    return { response: databaseError(applicationTypeResult.error, input.id) };
  }

  const applicationType = applicationTypeResult.data;
  const category = stringOrNull(getRecordValue(applicationType, "application_category")) ?? "generic";
  const typeKey = stringOrNull(getRecordValue(applicationType, "key")) ?? "application.generic";
  const typeName = stringOrNull(getRecordValue(applicationType, "display_name")) ??
    normalizePlainStatus(typeKey);
  const workspace = firstNonEmptyString([
    nestedString(getRecordValue(applicationType, "metadata"), ["workspace"]),
    category === "driver" ? "driver" : null,
    typeKey.includes("station") ? "station" : null,
  ]);
  const effects: Record<string, unknown> = {
    applicationCategory: category,
    applicationTypeKey: typeKey,
  };

  if (input.decision === "approved") {
    if (category === "driver") {
      const driverProfileId = await resolveApprovedDriverProfileId(
        input.serviceClient,
        applicationResult.data,
        input.id,
      );

      if ("response" in driverProfileId) {
        return driverProfileId;
      }

      if (driverProfileId.id) {
        const cardResult = await input.serviceClient.rpc("ensure_driver_card_identity", {
          target_application_id: input.applicationId,
          target_driver_profile_id: driverProfileId.id,
        });

        if (cardResult.error) {
          return { response: databaseError(cardResult.error, input.id) };
        }

        effects.driverProfileId = driverProfileId.id;
        effects.publicDriverId = cardResult.data;
      }
    }

    if (category === "business" && workspace === "station") {
      const stationActivationResult = await input.serviceClient.rpc(
        "activate_configured_lpg_station_branch",
        {
          target_application_id: input.applicationId,
          target_idempotency_key: `${input.idempotencyKey}:station-activation`,
          target_metadata: {
            ...input.metadata,
            finalApplicationDecision: true,
            reviewerUserId: input.reviewerUserId,
          },
          target_source: "skima.application.final_approval",
        },
      );

      if (stationActivationResult.error) {
        return { response: databaseError(stationActivationResult.error, input.id) };
      }

      effects.stationBranchId = stationActivationResult.data;
    }
  }

  const noticeResult = await queueApplicationDecisionNotice({
    application: applicationResult.data,
    applicationTypeKey: typeKey,
    applicationTypeName: typeName,
    decision: input.decision,
    effects,
    id: input.id,
    idempotencyKey: input.idempotencyKey,
    serviceClient: input.serviceClient,
    workspace,
  });

  if ("response" in noticeResult) {
    return noticeResult;
  }

  effects.noticeQueued = noticeResult.messageId;
  return { effects };
}

async function resolveApprovedDriverProfileId(
  serviceClient: SupabaseClient,
  application: unknown,
  id: string,
): Promise<{ readonly id: string | null } | { readonly response: Response }> {
  const activatedSubjectType = stringOrNull(getRecordValue(application, "activated_subject_type"));
  const activatedSubjectId = stringOrNull(getRecordValue(application, "activated_subject_id"));

  if (activatedSubjectType === "driver" && activatedSubjectId) {
    return { id: activatedSubjectId };
  }

  const applicantUserId = stringOrNull(getRecordValue(application, "applicant_user_id"));
  if (!applicantUserId) {
    return { id: null };
  }

  const driverResult = await serviceClient
    .from("driver_profiles")
    .select("id")
    .eq("user_id", applicantUserId)
    .maybeSingle();

  if (driverResult.error) {
    return { response: databaseError(driverResult.error, id) };
  }

  return { id: stringOrNull(getRecordValue(driverResult.data, "id")) };
}

async function queueApplicationDecisionNotice(input: {
  readonly application: unknown;
  readonly applicationTypeKey: string;
  readonly applicationTypeName: string;
  readonly decision: string;
  readonly effects: Readonly<Record<string, unknown>>;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly serviceClient: SupabaseClient;
  readonly workspace: string | null;
}): Promise<{ readonly messageId: string | null } | { readonly response: Response }> {
  const applicantUserId = stringOrNull(getRecordValue(input.application, "applicant_user_id"));
  if (!applicantUserId) {
    return { messageId: null };
  }

  const approved = input.decision === "approved";
  const workspaceLabel = input.workspace === "driver"
    ? "Driver"
    : input.workspace === "station"
    ? "Station"
    : input.applicationTypeName.replace(/\s*application\s*$/i, "");
  const title = approved
    ? `Your ${workspaceLabel} application has been approved`
    : `Your ${workspaceLabel} application was not approved`;
  const body = approved
    ? `You can now access your ${workspaceLabel} workspace.`
    : "Review the decision message and submit corrections if requested.";
  const path = approved
    ? input.workspace === "driver"
      ? "/(driver)"
      : input.workspace === "station"
      ? "/(station)"
      : "/(customer)"
    : input.workspace === "driver"
    ? "/(customer)/driver-application"
    : input.workspace === "station"
    ? "/(customer)/station-application"
    : "/(customer)";

  const messageResult = await input.serviceClient
    .from("communication_messages")
    .upsert({
      channel: "in_app",
      created_by: applicantUserId,
      idempotency_key: `${input.idempotencyKey}:application-notice`,
      metadata: {
        applicationId: stringOrNull(getRecordValue(input.application, "id")),
        applicationTypeKey: input.applicationTypeKey,
        decision: input.decision,
        effects: input.effects,
      },
      payload: {
        body,
        deepLink: path,
        path,
        route: path,
        title,
      },
      purpose: `application.${input.workspace ?? "generic"}.${approved ? "approved" : "rejected"}`,
      recipient_entity_id: applicantUserId,
      recipient_entity_type: "profile",
      source: "skima.application.review",
      status: "queued",
    }, { onConflict: "source,idempotency_key" })
    .select("id")
    .maybeSingle();

  if (messageResult.error) {
    return { response: databaseError(messageResult.error, input.id) };
  }

  return { messageId: stringOrNull(getRecordValue(messageResult.data, "id")) };
}

async function queueApplicationCorrectionNotice(input: {
  readonly applicantMessage: string;
  readonly applicationId: string;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly requestClient: SupabaseClient;
  readonly supabaseUrl: string;
}): Promise<{ readonly messageId: string | null } | { readonly response: Response }> {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const client = serviceRoleKey ? createServiceClient(input.supabaseUrl, serviceRoleKey) : input.requestClient;
  const applicationResult = await client
    .from("application_records")
    .select("id,applicant_user_id,application_type_id")
    .eq("id", input.applicationId)
    .maybeSingle();

  if (applicationResult.error) return { response: databaseError(applicationResult.error, input.id) };

  const applicantUserId = stringOrNull(getRecordValue(applicationResult.data, "applicant_user_id"));
  const applicationTypeId = stringOrNull(getRecordValue(applicationResult.data, "application_type_id"));
  if (!applicantUserId) return { messageId: null };

  const typeResult = applicationTypeId
    ? await client
      .from("application_type_definitions")
      .select("key,display_name,application_category,metadata")
      .eq("id", applicationTypeId)
      .maybeSingle()
    : { data: null, error: null };
  if (typeResult.error) return { response: databaseError(typeResult.error, input.id) };

  const workspace = workspaceFromApplicationType(typeResult.data);
  const route = applicationRouteForWorkspace(workspace);
  const typeName = stringOrNull(getRecordValue(typeResult.data, "display_name")) ??
    normalizePlainStatus(stringOrNull(getRecordValue(typeResult.data, "key")) ?? "application");
  const messageResult = await client
    .from("communication_messages")
    .upsert({
      channel: "in_app",
      created_by: applicantUserId,
      idempotency_key: `${input.idempotencyKey}:applicant-correction-notice`,
      metadata: {
        applicationId: input.applicationId,
        applicationTypeKey: stringOrNull(getRecordValue(typeResult.data, "key")),
        reviewAction: "correction_required",
      },
      payload: {
        body: input.applicantMessage,
        deepLink: route,
        path: route,
        route,
        title: `${typeName} needs an update`,
      },
      purpose: `application.${workspace ?? "generic"}.correction_required`,
      recipient_entity_id: applicantUserId,
      recipient_entity_type: "profile",
      source: "skima.application.review",
      status: "queued",
    }, { onConflict: "source,idempotency_key" })
    .select("id")
    .maybeSingle();

  if (messageResult.error) return { response: databaseError(messageResult.error, input.id) };
  return { messageId: stringOrNull(getRecordValue(messageResult.data, "id")) };
}

async function queueDocumentReviewNotice(input: {
  readonly applicantMessage: string | null;
  readonly decision: string;
  readonly documentSubmissionId: string;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly requestClient: SupabaseClient;
  readonly supabaseUrl: string;
}): Promise<{ readonly messageId: string | null } | { readonly response: Response }> {
  if (input.decision !== "correction_required" || !input.applicantMessage) {
    return { messageId: null };
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const client = serviceRoleKey ? createServiceClient(input.supabaseUrl, serviceRoleKey) : input.requestClient;
  const documentResult = await client
    .from("document_submissions")
    .select("id,application_id,requirement_id,owner_user_id,document_requirements(display_name,key)")
    .eq("id", input.documentSubmissionId)
    .maybeSingle();

  if (documentResult.error) return { response: databaseError(documentResult.error, input.id) };
  if (!documentResult.data) return { messageId: null };

  const applicationId = stringOrNull(getRecordValue(documentResult.data, "application_id"));
  const applicationResult = applicationId
    ? await client
      .from("application_records")
      .select("id,applicant_user_id,application_type_id")
      .eq("id", applicationId)
      .maybeSingle()
    : { data: null, error: null };
  if (applicationResult.error) return { response: databaseError(applicationResult.error, input.id) };

  const applicationTypeId = stringOrNull(getRecordValue(applicationResult.data, "application_type_id"));
  const typeResult = applicationTypeId
    ? await client
      .from("application_type_definitions")
      .select("key,display_name,application_category,metadata")
      .eq("id", applicationTypeId)
      .maybeSingle()
    : { data: null, error: null };
  if (typeResult.error) return { response: databaseError(typeResult.error, input.id) };

  const applicantUserId = stringOrNull(getRecordValue(applicationResult.data, "applicant_user_id")) ??
    stringOrNull(getRecordValue(documentResult.data, "owner_user_id"));
  if (!applicantUserId) return { messageId: null };

  const requirement = getRecordValue(documentResult.data, "document_requirements");
  const requirementName = stringOrNull(getRecordValue(requirement, "display_name")) ??
    normalizePlainStatus(stringOrNull(getRecordValue(requirement, "key")) ?? "Document");
  const workspace = workspaceFromApplicationType(typeResult.data);
  const route = workspace ? `/(customer)/${workspace}-documents` : "/(customer)";
  const messageResult = await client
    .from("communication_messages")
    .upsert({
      channel: "in_app",
      created_by: applicantUserId,
      idempotency_key: `${input.idempotencyKey}:document-correction-notice`,
      metadata: {
        applicationId,
        documentSubmissionId: input.documentSubmissionId,
        reviewAction: "document_correction_required",
      },
      payload: {
        body: input.applicantMessage,
        deepLink: route,
        path: route,
        route,
        title: `${requirementName} needs an update`,
      },
      purpose: `application.${workspace ?? "generic"}.document_correction_required`,
      recipient_entity_id: applicantUserId,
      recipient_entity_type: "profile",
      source: "skima.application.review",
      status: "queued",
    }, { onConflict: "source,idempotency_key" })
    .select("id")
    .maybeSingle();

  if (messageResult.error) return { response: databaseError(messageResult.error, input.id) };
  return { messageId: stringOrNull(getRecordValue(messageResult.data, "id")) };
}

async function updateDriverCardPhotoResponse(
  _supabase: SupabaseClient,
  supabaseUrl: string,
  user: User,
  payload: Readonly<Record<string, unknown>>,
  id: string,
): Promise<Response> {
  const mediaAssetId = requireUuid(payload.mediaAssetId, "mediaAssetId");
  const requestedDriverProfileId = optionalUuid(payload.driverProfileId, "driverProfileId");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!serviceRoleKey) {
    return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
  }

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
  const assetResult = await serviceClient
    .from("media_assets")
    .select("id,owner_user_id,content_type,status,metadata")
    .eq("id", mediaAssetId)
    .maybeSingle();

  if (assetResult.error) return databaseError(assetResult.error, id);

  const assetOwnerId = stringOrNull(getRecordValue(assetResult.data, "owner_user_id"));
  const contentType = stringOrNull(getRecordValue(assetResult.data, "content_type")) ?? "";
  if (!assetResult.data || assetOwnerId !== user.id || !contentType.startsWith("image/")) {
    return jsonResponse({ ok: false, error: "driver_card_photo_asset_forbidden", requestId: id }, 403);
  }

  const driverResult = await serviceClient
    .from("driver_profiles")
    .select("id,user_id,metadata")
    .eq(requestedDriverProfileId ? "id" : "user_id", requestedDriverProfileId ?? user.id)
    .maybeSingle();

  if (driverResult.error) return databaseError(driverResult.error, id);
  if (!driverResult.data || stringOrNull(getRecordValue(driverResult.data, "user_id")) !== user.id) {
    return jsonResponse({ ok: false, error: "driver_profile_not_found", requestId: id }, 404);
  }

  const driverProfileId = requireUuid(getRecordValue(driverResult.data, "id"), "driverProfileId");
  const existingMetadata = optionalRecord(getRecordValue(driverResult.data, "metadata")) ?? {};
  const updateResult = await serviceClient
    .from("driver_profiles")
    .update({
      metadata: {
        ...existingMetadata,
        driver_card_photo: {
          mediaAssetId,
          source: optionalString(payload.source) ?? "skima.lpg.mobile",
          updatedAt: new Date().toISOString(),
        },
      },
      profile_photo_asset_id: mediaAssetId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", driverProfileId)
    .select("id")
    .maybeSingle();

  if (updateResult.error) return databaseError(updateResult.error, id);

  return jsonResponse({
    ok: true,
    data: {
      driverProfileId,
      mediaAssetId,
    },
    id: driverProfileId,
    requestId: id,
  });
}

function workspaceFromApplicationType(applicationType: unknown): string | null {
  const category = stringOrNull(getRecordValue(applicationType, "application_category"));
  const key = stringOrNull(getRecordValue(applicationType, "key")) ?? "";
  const workspace = nestedString(getRecordValue(applicationType, "metadata"), ["workspace"]);

  if (category === "driver" || workspace === "driver" || key.includes(".driver.")) return "driver";
  if (workspace === "station" || key.includes(".station.")) return "station";
  return null;
}

function applicationRouteForWorkspace(workspace: string | null): string {
  if (workspace === "driver") return "/(customer)/driver-application";
  if (workspace === "station") return "/(customer)/station-application";
  return "/(customer)";
}

async function driverIdCardResponse(
  supabase: SupabaseClient,
  supabaseUrl: string,
  user: User,
  request: Request,
  id: string,
): Promise<Response> {
  const url = new URL(request.url);
  const driverProfileId = optionalUuid(url.searchParams.get("driverProfileId"), "driverProfileId");
  const driverResult = await supabase
    .from("driver_profiles")
    .select(
      "id,user_id,operational_status,verification_status,identity_profile,service_profile,approved_at,driver_display_name,public_driver_id,profile_photo_asset_id,driver_card_issued_at,driver_card_status,metadata",
    )
    .eq(driverProfileId ? "id" : "user_id", driverProfileId ?? user.id)
    .maybeSingle();

  if (driverResult.error) {
    return databaseError(driverResult.error, id);
  }

  if (!driverResult.data) {
    return jsonResponse({ ok: false, error: "driver_card_not_found", requestId: id }, 404);
  }

  if (
    !driverProfileId &&
    stringOrNull(getRecordValue(driverResult.data, "user_id")) !== user.id
  ) {
    return jsonResponse({ ok: false, error: "forbidden", requestId: id }, 403);
  }

  if (
    driverProfileId &&
    stringOrNull(getRecordValue(driverResult.data, "user_id")) !== user.id
  ) {
    const allowed = await requireAnyPermission(
      supabase,
      id,
      ["platform.drivers.read", "platform.drivers.manage", "platform.drivers.verify"],
      null,
    );
    if (allowed) return allowed;
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const serviceClient = serviceRoleKey ? createServiceClient(supabaseUrl, serviceRoleKey) : supabase;
  const cardData = await buildDriverCardData(serviceClient, supabaseUrl, driverResult.data, id);

  if ("response" in cardData) {
    return cardData.response;
  }

  return jsonResponse({ ok: true, data: cardData.data, requestId: id });
}

async function publicDriverIdVerificationResponse(request: Request, id: string): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
  }

  const url = new URL(request.url);
  const publicDriverId = url.searchParams.get("driverId")?.trim() ??
    url.searchParams.get("code")?.trim() ??
    "";

  if (!/^SKD-[A-Z0-9]{8,20}$/i.test(publicDriverId)) {
    return jsonResponse({ ok: false, error: "invalid_driver_id", requestId: id }, 400);
  }

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
  const driverResult = await serviceClient
    .from("driver_profiles")
    .select(
      "id,user_id,operational_status,verification_status,identity_profile,service_profile,approved_at,driver_display_name,public_driver_id,profile_photo_asset_id,driver_card_issued_at,driver_card_status,metadata",
    )
    .eq("public_driver_id", publicDriverId.toUpperCase())
    .maybeSingle();

  if (driverResult.error) {
    return databaseError(driverResult.error, id);
  }

  if (!driverResult.data) {
    return jsonResponse({ ok: false, error: "driver_card_not_found", requestId: id }, 404);
  }

  const cardData = await buildDriverCardData(serviceClient, supabaseUrl, driverResult.data, id);
  if ("response" in cardData) {
    return cardData.response;
  }

  const data = cardData.data;
  return jsonResponse({
    ok: true,
    data: {
      cardStatus: data.cardStatus,
      displayName: data.displayName,
      driverProfileId: data.driverProfileId,
      issuedAt: data.issuedAt,
      photoUrl: data.photoUrl,
      publicDriverId: data.publicDriverId,
      status: data.status,
      vehicleType: data.vehicleType,
      verified: data.status === "active",
    },
    requestId: id,
  });
}

async function buildDriverCardData(
  client: SupabaseClient,
  supabaseUrl: string,
  driver: unknown,
  id: string,
): Promise<{ readonly data: Record<string, unknown> } | { readonly response: Response }> {
  const driverProfileId = requireUuid(getRecordValue(driver, "id"), "driverProfileId");
  let publicDriverId = stringOrNull(getRecordValue(driver, "public_driver_id"));

  if (!publicDriverId) {
    const cardResult = await client.rpc("ensure_driver_card_identity", {
      target_application_id: null,
      target_driver_profile_id: driverProfileId,
    });

    if (cardResult.error) {
      return { response: databaseError(cardResult.error, id) };
    }

    publicDriverId = stringOrNull(cardResult.data);
  }

  const userId = stringOrNull(getRecordValue(driver, "user_id"));
  const profileResult = userId
    ? await client
      .from("profiles")
      .select("id,display_name")
      .eq("id", userId)
      .maybeSingle()
    : { data: null, error: null };

  if (profileResult.error) {
    return { response: databaseError(profileResult.error, id) };
  }

  const activeVehicle = await readDriverCardVehicle(client, driverProfileId, id);
  if ("response" in activeVehicle) {
    return activeVehicle;
  }

  const verificationStatus = stringOrNull(getRecordValue(driver, "verification_status")) ?? "unverified";
  const cardStatus = stringOrNull(getRecordValue(driver, "driver_card_status")) ??
    (verificationStatus === "approved" ? "active" : "pending");
  const status = verificationStatus === "approved" && cardStatus === "active"
    ? "active"
    : cardStatus === "suspended" || verificationStatus === "suspended"
    ? "suspended"
    : cardStatus === "revoked" || verificationStatus === "rejected"
    ? "revoked"
    : cardStatus;
  const identityProfile = getRecordValue(driver, "identity_profile");
  const serviceProfile = getRecordValue(driver, "service_profile");
  const displayName = firstNonEmptyString([
    stringOrNull(getRecordValue(driver, "driver_display_name")),
    nestedString(identityProfile, ["driverDisplayName"]),
    nestedString(identityProfile, ["driver_display_name"]),
    nestedString(identityProfile, ["fullName"]),
    nestedString(identityProfile, ["full_name"]),
    stringOrNull(getRecordValue(profileResult.data, "display_name")),
    "SKIMA Driver",
  ]);
  const photoAssetId = stringOrNull(getRecordValue(driver, "profile_photo_asset_id"));
  const photoUrl = photoAssetId ? await signedMediaAssetUrl(client, photoAssetId) : null;

  return {
    data: {
      approvedAt: stringOrNull(getRecordValue(driver, "approved_at")),
      cardStatus,
      displayName,
      driverProfileId,
      issuedAt: stringOrNull(getRecordValue(driver, "driver_card_issued_at")),
      operationalStatus: stringOrNull(getRecordValue(driver, "operational_status")) ?? "offline",
      photoAssetId,
      photoUrl,
      publicDriverId,
      serviceZones: stringArrayFromUnknown(getRecordValue(serviceProfile, "zones")),
      status,
      vehicleStatus: activeVehicle.data.status,
      vehicleType: activeVehicle.data.type,
      verificationUrl: publicDriverId ? driverVerificationUrl(supabaseUrl, publicDriverId) : null,
    },
  };
}

async function readDriverCardVehicle(
  client: SupabaseClient,
  driverProfileId: string,
  id: string,
): Promise<{ readonly data: { readonly status: string | null; readonly type: string | null } } | { readonly response: Response }> {
  const linkResult = await client
    .from("driver_vehicle_links")
    .select("vehicle_id,status")
    .eq("driver_profile_id", driverProfileId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);

  if (linkResult.error) {
    return { response: databaseError(linkResult.error, id) };
  }

  const vehicleId = stringOrNull(getRecordValue(linkResult.data?.[0], "vehicle_id"));
  if (!vehicleId) {
    return { data: { status: null, type: null } };
  }

  const vehicleResult = await client
    .from("vehicles")
    .select("id,status,vehicle_type_id")
    .eq("id", vehicleId)
    .maybeSingle();

  if (vehicleResult.error) {
    return { response: databaseError(vehicleResult.error, id) };
  }

  const vehicleTypeId = stringOrNull(getRecordValue(vehicleResult.data, "vehicle_type_id"));
  const typeResult = vehicleTypeId
    ? await client
      .from("vehicle_types")
      .select("display_name")
      .eq("id", vehicleTypeId)
      .maybeSingle()
    : { data: null, error: null };

  if (typeResult.error) {
    return { response: databaseError(typeResult.error, id) };
  }

  return {
    data: {
      status: stringOrNull(getRecordValue(vehicleResult.data, "status")),
      type: stringOrNull(getRecordValue(typeResult.data, "display_name")),
    },
  };
}

async function signedMediaAssetUrl(client: SupabaseClient, assetId: string): Promise<string | null> {
  const assetResult = await client
    .from("media_assets")
    .select("storage_bucket,storage_path,status")
    .eq("id", assetId)
    .eq("status", "active")
    .maybeSingle();

  if (assetResult.error || !assetResult.data) {
    return null;
  }

  const bucket = stringOrNull(getRecordValue(assetResult.data, "storage_bucket"));
  const path = stringOrNull(getRecordValue(assetResult.data, "storage_path"));
  if (!bucket || !path) {
    return null;
  }

  const signedResult = await client.storage.from(bucket).createSignedUrl(path, 900);
  return signedResult.error ? null : signedResult.data.signedUrl;
}

function driverVerificationUrl(supabaseUrl: string, publicDriverId: string): string {
  const base = Deno.env.get("SKIMA_DRIVER_VERIFY_BASE_URL") ??
    `${supabaseUrl.replace(/\/$/, "")}/functions/v1/api-gateway/runtime/driver-id-cards/verify`;
  const url = new URL(base);
  url.searchParams.set("driverId", publicDriverId);
  return url.toString();
}

async function applicationsResponse(
  supabase: SupabaseClient,
  supabaseUrl: string,
  id: string,
): Promise<Response> {
  const applicationResult = await supabase
    .from("application_records")
    .select(
      "id,application_type_id,applicant_user_id,organization_id,workflow_instance_id,assigned_reviewer_user_id,active_version,status,locked_at,submitted_at,decided_at,approved_at,rejected_at,suspended_at,withdrawn_at,activated_subject_type,activated_subject_id,metadata,created_at,updated_at",
    )
    .order("created_at", { ascending: false });

  if (applicationResult.error) {
    return databaseError(applicationResult.error, id);
  }

  const applications = Array.isArray(applicationResult.data) ? applicationResult.data : [];
  const applicationIds = uniqueStrings(applications.map((record) => stringOrNull(getRecordValue(record, "id"))));
  const profileIds = uniqueStrings(
    applications.flatMap((record) => [
      stringOrNull(getRecordValue(record, "applicant_user_id")),
      stringOrNull(getRecordValue(record, "assigned_reviewer_user_id")),
    ]),
  );

  const profilesById = new Map<string, unknown>();
  if (profileIds.length > 0) {
    const profileResult = await supabase
      .from("profiles")
      .select("id,display_name,avatar_url,status,metadata,created_at,updated_at")
      .in("id", profileIds);

    if (profileResult.error) {
      return databaseError(profileResult.error, id);
    }

    for (const profile of profileResult.data ?? []) {
      const profileId = stringOrNull(getRecordValue(profile, "id"));
      if (profileId) profilesById.set(profileId, profile);
    }
  }

  const avatarAssetIdsByProfileId = new Map<string, string>();
  const avatarSignedUrlByAssetId = new Map<string, string>();
  for (const [profileId, profile] of profilesById) {
    const avatarValue = stringOrNull(getRecordValue(profile, "avatar_url"));
    if (avatarValue && isUuidString(avatarValue)) {
      avatarAssetIdsByProfileId.set(profileId, avatarValue);
    }
  }

  const avatarAssetIds = uniqueStrings(Array.from(avatarAssetIdsByProfileId.values()));
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (avatarAssetIds.length > 0 && serviceRoleKey) {
    const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
    const avatarResult = await serviceClient
      .from("media_assets")
      .select("id,storage_bucket,storage_path,status")
      .in("id", avatarAssetIds)
      .eq("status", "active");

    if (!avatarResult.error) {
      for (const asset of avatarResult.data ?? []) {
        const assetId = stringOrNull(getRecordValue(asset, "id"));
        const storageBucket = stringOrNull(getRecordValue(asset, "storage_bucket"));
        const storagePath = stringOrNull(getRecordValue(asset, "storage_path"));
        if (!assetId || !storageBucket || !storagePath) continue;

        const signedResult = await serviceClient.storage
          .from(storageBucket)
          .createSignedUrl(storagePath, 900);

        if (!signedResult.error && signedResult.data?.signedUrl) {
          avatarSignedUrlByAssetId.set(assetId, signedResult.data.signedUrl);
        }
      }
    }
  }

  const avatarUrlForProfile = (profile: unknown): string | null => {
    const directAvatarUrl = stringOrNull(getRecordValue(profile, "avatar_url"));
    if (directAvatarUrl && /^https?:\/\//i.test(directAvatarUrl)) {
      return directAvatarUrl;
    }

    const profileId = stringOrNull(getRecordValue(profile, "id"));
    const assetId = profileId ? avatarAssetIdsByProfileId.get(profileId) : null;
    return assetId ? avatarSignedUrlByAssetId.get(assetId) ?? null : null;
  };

  const latestPayloadByApplicationId = new Map<string, unknown>();
  if (applicationIds.length > 0) {
    const versionResult = await supabase
      .from("application_versions")
      .select("id,application_id,version,payload,created_by,created_at")
      .in("application_id", applicationIds)
      .order("version", { ascending: false });

    if (versionResult.error) {
      return databaseError(versionResult.error, id);
    }

    for (const version of versionResult.data ?? []) {
      const applicationId = stringOrNull(getRecordValue(version, "application_id"));
      if (applicationId && !latestPayloadByApplicationId.has(applicationId)) {
        latestPayloadByApplicationId.set(applicationId, version);
      }
    }
  }

  const data = applications.map((application) => {
    const applicationId = stringOrNull(getRecordValue(application, "id"));
    const applicantUserId = stringOrNull(getRecordValue(application, "applicant_user_id"));
    const reviewerUserId = stringOrNull(getRecordValue(application, "assigned_reviewer_user_id"));
    const applicantProfile = applicantUserId ? profilesById.get(applicantUserId) : null;
    const reviewerProfile = reviewerUserId ? profilesById.get(reviewerUserId) : null;
    const latestVersion = applicationId ? latestPayloadByApplicationId.get(applicationId) : null;
    const payload = requireRecordOrEmpty(getRecordValue(latestVersion, "payload"));
    const applicantEmail = nestedString(payload, ["contact", "email"]);
    const applicantPhone = nestedString(payload, ["contact", "phone"]);
    const applicantName = firstNonEmptyString([
      nestedString(payload, ["identity", "fullName"]),
      nestedString(payload, ["identity", "full_name"]),
      nestedString(payload, ["organization", "displayName"]),
      nestedString(payload, ["organization", "display_name"]),
      stringOrNull(getRecordValue(applicantProfile, "display_name")),
      applicantEmail,
      applicantUserId,
    ]);
    const reviewerName = firstNonEmptyString([
      stringOrNull(getRecordValue(reviewerProfile, "display_name")),
      reviewerUserId,
    ]);

    return {
      ...requireRecordOrEmpty(application),
      applicant_display_name: applicantName,
      applicant_email: applicantEmail,
      applicant_phone: applicantPhone,
      applicant_profile: profileSummary(applicantProfile, avatarUrlForProfile(applicantProfile)),
      application_payload: payload,
      application_subject_name: applicationSubjectName(payload),
      latest_version: latestVersion ?? null,
      reviewer_display_name: reviewerName,
      reviewer_profile: profileSummary(reviewerProfile, avatarUrlForProfile(reviewerProfile)),
    };
  });

  return jsonResponse({ ok: true, data, requestId: id });
}

async function walletBalancesResponse(
  supabase: SupabaseClient,
  id: string,
): Promise<Response> {
  const balanceResult = await supabase
    .from("wallet_balances")
    .select("wallet_id,currency_code,balance")
    .order("wallet_id", { ascending: true });

  if (balanceResult.error) return databaseError(balanceResult.error, id);

  const balances = Array.isArray(balanceResult.data) ? balanceResult.data : [];
  const walletIds = uniqueStrings(balances.map((record) => stringOrNull(getRecordValue(record, "wallet_id"))));
  const walletsById = new Map<string, unknown>();

  if (walletIds.length > 0) {
    const walletResult = await supabase
      .from("wallet_accounts")
      .select("id,wallet_type,owner_entity_type,owner_entity_id,currency_code,status")
      .in("id", walletIds);

    if (walletResult.error) return databaseError(walletResult.error, id);

    for (const wallet of walletResult.data ?? []) {
      const walletId = stringOrNull(getRecordValue(wallet, "id"));
      if (walletId) walletsById.set(walletId, wallet);
    }
  }

  const profileIds = uniqueStrings(
    Array.from(walletsById.values()).flatMap((wallet) => {
      const ownerType = stringOrNull(getRecordValue(wallet, "owner_entity_type"));
      const ownerId = stringOrNull(getRecordValue(wallet, "owner_entity_id"));
      return ownerType === "profile" || ownerType === "customer" || ownerType === "user" ? [ownerId] : [];
    }),
  );
  const profileById = new Map<string, unknown>();
  if (profileIds.length > 0) {
    const profileResult = await supabase
      .from("profiles")
      .select("id,display_name,avatar_url,status")
      .in("id", profileIds);

    if (profileResult.error) return databaseError(profileResult.error, id);

    for (const profile of profileResult.data ?? []) {
      const profileId = stringOrNull(getRecordValue(profile, "id"));
      if (profileId) profileById.set(profileId, profile);
    }
  }

  const driverProfileIds = uniqueStrings(
    Array.from(walletsById.values()).flatMap((wallet) =>
      stringOrNull(getRecordValue(wallet, "owner_entity_type")) === "driver"
        ? [stringOrNull(getRecordValue(wallet, "owner_entity_id"))]
        : []
    ),
  );
  const driverProfileById = new Map<string, unknown>();
  if (driverProfileIds.length > 0) {
    const driverResult = await supabase
      .from("driver_profiles")
      .select("id,user_id,profiles(id,display_name,avatar_url,status)")
      .in("id", driverProfileIds);

    if (driverResult.error) return databaseError(driverResult.error, id);

    for (const driver of driverResult.data ?? []) {
      const driverId = stringOrNull(getRecordValue(driver, "id"));
      if (driverId) driverProfileById.set(driverId, driver);
    }
  }

  const stationBranchIds = uniqueStrings(
    Array.from(walletsById.values()).flatMap((wallet) =>
      stringOrNull(getRecordValue(wallet, "owner_entity_type")) === "station_branch"
        ? [stringOrNull(getRecordValue(wallet, "owner_entity_id"))]
        : []
    ),
  );
  const stationById = new Map<string, unknown>();
  if (stationBranchIds.length > 0) {
    const stationResult = await supabase
      .from("lpg_station_branches")
      .select("id,display_name,formatted_address,organization_id")
      .in("id", stationBranchIds);

    if (stationResult.error) return databaseError(stationResult.error, id);

    for (const station of stationResult.data ?? []) {
      const stationId = stringOrNull(getRecordValue(station, "id"));
      if (stationId) stationById.set(stationId, station);
    }
  }

  const data = balances.map((balance) => {
    const walletId = stringOrNull(getRecordValue(balance, "wallet_id"));
    const wallet = walletId ? walletsById.get(walletId) : null;
    const ownerType = stringOrNull(getRecordValue(wallet, "owner_entity_type"));
    const ownerId = stringOrNull(getRecordValue(wallet, "owner_entity_id"));
    const profile = ownerId ? profileById.get(ownerId) : null;
    const driver = ownerId ? driverProfileById.get(ownerId) : null;
    const driverProfile = getRecordValue(driver, "profiles");
    const station = ownerId ? stationById.get(ownerId) : null;
    const ownerName = firstNonEmptyString([
      stringOrNull(getRecordValue(profile, "display_name")),
      nestedString(driverProfile, ["display_name"]),
      stringOrNull(getRecordValue(station, "display_name")),
      ownerId,
    ]);

    return {
      ...requireRecordOrEmpty(balance),
      owner_display_name: ownerName,
      owner_entity_id: ownerId,
      owner_entity_type: ownerType,
      wallet_status: stringOrNull(getRecordValue(wallet, "status")),
      wallet_type: stringOrNull(getRecordValue(wallet, "wallet_type")),
    };
  });

  return jsonResponse({ ok: true, data, requestId: id });
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

type LpgMapsOperation = MapsOperation;

async function resolveLpgMapsProvider(
  supabase: SupabaseClient,
  id: string,
  operation: LpgMapsOperation,
): Promise<{
  policy: Record<string, unknown>;
  adapterConfig: Record<string, unknown>;
  providerKey: string;
  response: Response | null;
}> {
  const mapsPolicyResult = await supabase.rpc("lpg_policy_config", {
    target_policy_key: "lpg.maps.phase_one",
  });

  if (mapsPolicyResult.error) {
    return {
      policy: {},
      adapterConfig: {},
      providerKey: "",
      response: databaseError(mapsPolicyResult.error, id),
    };
  }

  const policy = requireRecord(mapsPolicyResult.data, "LPG maps policy");
  const providerKey = requireString(policy.active_provider_key, "active_provider_key");
  const operations = Array.isArray(policy.operations)
    ? policy.operations.filter((value): value is string => typeof value === "string")
    : [];

  if (!operations.includes(operation)) {
    return {
      policy,
      adapterConfig: {},
      providerKey,
      response: jsonResponse({ ok: false, error: "server_misconfigured", message: `The configured maps policy does not enable ${operation}.`, requestId: id }, 500),
    };
  }

  // Provider metadata is an internal platform concern and is intentionally
  // hidden from ordinary authenticated users by RLS. Resolve it with the
  // gateway's server identity after the caller-visible policy has been read.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      policy,
      adapterConfig: {},
      providerKey,
      response: jsonResponse({
        ok: false,
        error: "server_misconfigured",
        message: "The maps provider catalog cannot be resolved by the gateway.",
        requestId: id,
      }, 500),
    };
  }

  const adapterResult = await createServiceClient(supabaseUrl, serviceRoleKey)
    .from("provider_adapters")
    .select("key,status,provider_kind,config")
    .eq("provider_kind", "maps")
    .eq("key", providerKey)
    .maybeSingle();

  if (adapterResult.error) {
    return {
      policy,
      adapterConfig: {},
      providerKey,
      response: databaseError(adapterResult.error, id),
    };
  }

  if (!adapterResult.data || adapterResult.data.status !== "active") {
    return {
      policy,
      adapterConfig: {},
      providerKey,
      response: jsonResponse({ ok: false, error: "server_misconfigured", message: "The configured maps provider adapter is not active.", requestId: id }, 500),
    };
  }

  return {
    policy,
    adapterConfig: requireRecordOrEmpty(adapterResult.data.config),
    providerKey,
    response: null,
  };
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

type ResolvedMapsProvider = {
  readonly policy: Record<string, unknown>;
  readonly adapterConfig: Record<string, unknown>;
  readonly providerKey: string;
};

type MapsProviderCallResult<TData extends Record<string, unknown>> =
  | { readonly data: TData }
  | { readonly response: Response };

const mapsProviderInflight = new Map<
  string,
  Promise<{ readonly data: Record<string, unknown>; readonly latencyMs: number }>
>();

async function executeLocationIqProviderCall<TData extends Record<string, unknown>>(input: {
  readonly actorUserId: string;
  readonly cacheDescriptor: string;
  readonly cacheTtlSeconds: number;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly operation: LpgMapsOperation;
  readonly provider: ResolvedMapsProvider;
  readonly requestPayload: Record<string, unknown>;
  readonly supabase: SupabaseClient;
  readonly supabaseUrl: string;
  readonly execute: () => Promise<{ readonly data: TData; readonly latencyMs: number }>;
}): Promise<MapsProviderCallResult<TData>> {
  const userRateLimit = await consumeMapsRateLimit(
    input.supabase,
    `maps.locationiq.${input.operation}.user`,
    input.actorUserId,
    input.id,
  );
  if ("response" in userRateLimit) return userRateLimit;
  if (!userRateLimit.allowed) {
    await recordMapsRateLimit(input, "user");
    return {
      response: jsonResponse({
        ok: false,
        error: "rate_limited",
        message: "Too many location requests. Wait a moment and try again.",
        requestId: input.id,
      }, 429),
    };
  }

  const cacheKey = await mapsCacheKey(input.cacheDescriptor);
  const cacheNamespace = `platform.maps.locationiq.${input.operation}`;
  const cached = await readMapsCache(input.supabaseUrl, cacheNamespace, cacheKey);
  if (cached) {
    await maybeRecordGatewayProviderExecution(input.supabaseUrl, {
      errorMessage: null,
      idempotencyKey: `${input.idempotencyKey}:${input.id}:maps-cache-hit`,
      operationKey: `provider.maps.${input.operation}`,
      providerAdapterKey: input.provider.providerKey,
      providerKind: "maps",
      requestPayload: input.requestPayload,
      responsePayload: { ...cached, cache: "hit", latencyMs: 0 },
      status: "succeeded",
    });
    return { data: cached as TData };
  }

  const providerRateLimit = await consumeMapsRateLimit(
    input.supabase,
    "maps.locationiq.provider.daily",
    input.provider.providerKey,
    input.id,
  );
  if ("response" in providerRateLimit) return providerRateLimit;
  if (!providerRateLimit.allowed) {
    await recordMapsRateLimit(input, "provider_daily");
    await recordMapsProviderHealth(
      input.supabaseUrl,
      "degraded",
      input.operation,
      { reason: "quota_guard_reached" },
    );
    return {
      response: jsonResponse({
        ok: false,
        error: "rate_limited",
        message: "Location lookup has reached its configured usage limit. Coordinates and manual address entry are still available.",
        requestId: input.id,
      }, 429),
    };
  }

  try {
    const result = await deduplicateMapsProviderCall<TData>(cacheNamespace, cacheKey, input.execute);
    await writeMapsCache(
      input.supabaseUrl,
      cacheNamespace,
      cacheKey,
      result.data,
      input.cacheTtlSeconds,
    );
    await maybeRecordGatewayProviderExecution(input.supabaseUrl, {
      errorMessage: null,
      idempotencyKey: `${input.idempotencyKey}:${input.id}:maps`,
      operationKey: `provider.maps.${input.operation}`,
      providerAdapterKey: input.provider.providerKey,
      providerKind: "maps",
      requestPayload: input.requestPayload,
      responsePayload: { ...result.data, cache: "miss", latencyMs: result.latencyMs },
      status: "succeeded",
    });
    await recordMapsProviderHealth(
      input.supabaseUrl,
      "healthy",
      input.operation,
      { latencyMs: result.latencyMs },
    );
    return { data: result.data };
  } catch (cause) {
    const error = cause instanceof LocationProviderError
      ? cause
      : new LocationProviderError(
        "provider_unavailable",
        "The location service is temporarily unavailable.",
        503,
        true,
      );
    await maybeRecordGatewayProviderExecution(input.supabaseUrl, {
      errorMessage: error.code,
      idempotencyKey: `${input.idempotencyKey}:${input.id}:maps`,
      operationKey: `provider.maps.${input.operation}`,
      providerAdapterKey: input.provider.providerKey,
      providerKind: "maps",
      requestPayload: input.requestPayload,
      responsePayload: { cache: "miss", retryable: error.retryable },
      status: "failed",
    });
    await recordMapsProviderHealth(
      input.supabaseUrl,
      error.code === "provider_authentication_failed" ? "unhealthy" : "degraded",
      input.operation,
      { reason: error.code },
    );
    return {
      response: jsonResponse({
        ok: false,
        error: error.code,
        message: error.message,
        requestId: input.id,
      }, error.httpStatus),
    };
  }
}

async function consumeMapsRateLimit(
  supabase: SupabaseClient,
  policyKey: string,
  subject: string,
  requestId: string,
): Promise<{ readonly allowed: boolean } | { readonly response: Response }> {
  const result = await supabase.rpc("check_rate_limit", {
    target_increment: 1,
    target_policy_key: policyKey,
    target_subject: subject,
  });
  if (result.error) {
    return { response: databaseError(result.error, requestId) };
  }
  return { allowed: !isRateLimited(result.data) };
}

async function recordMapsRateLimit(
  input: {
    readonly id: string;
    readonly idempotencyKey: string;
    readonly operation: LpgMapsOperation;
    readonly provider: ResolvedMapsProvider;
    readonly requestPayload: Record<string, unknown>;
    readonly supabaseUrl: string;
  },
  scope: string,
): Promise<void> {
  await maybeRecordGatewayProviderExecution(input.supabaseUrl, {
    errorMessage: "maps_rate_limited",
    idempotencyKey: `${input.idempotencyKey}:${input.id}:maps-rate-limit`,
    operationKey: `provider.maps.${input.operation}`,
    providerAdapterKey: input.provider.providerKey,
    providerKind: "maps",
    requestPayload: input.requestPayload,
    responsePayload: { cache: "none", scope },
    status: "failed",
  });
}

function createLocationIqAdapter(provider: ResolvedMapsProvider) {
  const token = Deno.env.get("LOCATIONIQ_ACCESS_TOKEN")?.trim();
  if (!token) {
    throw new LocationProviderError(
      "provider_authentication_failed",
      "The location service is not configured yet.",
      503,
    );
  }
  return createLocationIqMapsAdapter({
    accessToken: token,
    attribution: mapsConfigString(
      provider.policy,
      "attribution",
      mapsConfigString(
        provider.adapterConfig,
        "attribution",
        "LocationIQ; OpenStreetMap contributors",
      ),
    ),
    autocompleteBaseUrl: mapsConfigString(
      provider.adapterConfig,
      "autocomplete_base_url",
      "https://api.locationiq.com/v1",
    ),
    autocompleteResultLimit: mapsConfigNumber(
      provider.policy,
      "autocomplete_result_limit",
      6,
      1,
      20,
    ),
    countryCodes: mapsConfigStringArray(provider.policy, "search_country_codes", ["ng"]),
    geocodingBaseUrl: mapsConfigString(
      provider.adapterConfig,
      "geocoding_base_url",
      "https://eu1.locationiq.com/v1",
    ),
    language: mapsConfigString(provider.policy, "search_language", "en"),
    retryCount: mapsConfigNumber(provider.policy, "provider_retry_count", 1, 0, 2),
    routingBaseUrl: mapsConfigString(
      provider.adapterConfig,
      "routing_base_url",
      "https://eu1.locationiq.com/v1",
    ),
    timeoutMs: mapsConfigNumber(
      provider.policy,
      "provider_timeout_milliseconds",
      8_000,
      1_000,
      20_000,
    ),
  });
}

async function readMapsCache(
  supabaseUrl: string,
  namespace: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) return null;
  const result = await createServiceClient(supabaseUrl, serviceRoleKey).rpc("get_cache_entry", {
    target_cache_key: key,
    target_namespace: namespace,
  });
  if (result.error || !result.data) return null;
  return requireRecordOrEmpty(result.data);
}

async function writeMapsCache(
  supabaseUrl: string,
  namespace: string,
  key: string,
  value: Record<string, unknown>,
  ttlSeconds: number,
): Promise<void> {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) return;
  await createServiceClient(supabaseUrl, serviceRoleKey).rpc("set_cache_entry", {
    target_cache_key: key,
    target_namespace: namespace,
    target_ttl_seconds: Math.max(1, Math.min(Math.round(ttlSeconds), 2_592_000)),
    target_value: value,
  });
}

async function recordMapsProviderHealth(
  supabaseUrl: string,
  status: "healthy" | "degraded" | "unhealthy",
  operation: LpgMapsOperation,
  details: Record<string, unknown>,
): Promise<void> {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) return;
  await createServiceClient(supabaseUrl, serviceRoleKey).rpc("record_health_check", {
    target_details: {
      ...details,
      operation,
      provider: "locationiq",
      secretExposedToClients: false,
    },
    target_service_key: "platform.maps.locationiq",
    target_status: status,
  });
}

async function deduplicateMapsProviderCall<TData extends Record<string, unknown>>(
  namespace: string,
  cacheKey: string,
  execute: () => Promise<{ readonly data: TData; readonly latencyMs: number }>,
): Promise<{ readonly data: TData; readonly latencyMs: number }> {
  const inflightKey = `${namespace}:${cacheKey}`;
  const existing = mapsProviderInflight.get(inflightKey);
  if (existing) {
    const result = await existing;
    return { data: result.data as TData, latencyMs: result.latencyMs };
  }
  const pending = execute() as Promise<{
    readonly data: Record<string, unknown>;
    readonly latencyMs: number;
  }>;
  mapsProviderInflight.set(inflightKey, pending);
  try {
    const result = await pending;
    return { data: result.data as TData, latencyMs: result.latencyMs };
  } finally {
    mapsProviderInflight.delete(inflightKey);
  }
}

async function mapsCacheKey(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function mapsConfigString(
  record: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  return optionalString(record[key]) ?? fallback;
}

function mapsConfigNumber(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = optionalNumber(record[key], key) ?? fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function mapsConfigStringArray(
  record: Record<string, unknown>,
  key: string,
  fallback: readonly string[],
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value)) return fallback;
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length ? strings : fallback;
}

function quantizedCoordinate(value: number, decimals: number): string {
  return value.toFixed(Math.max(3, Math.min(6, Math.round(decimals))));
}

function mapsProviderSecretConfigured(providerKey: string): boolean {
  if (providerKey === "provider.maps.locationiq") {
    return Boolean(Deno.env.get("LOCATIONIQ_ACCESS_TOKEN")?.trim());
  }
  if (providerKey === "provider.maps.google-maps") {
    return Boolean(Deno.env.get("GOOGLE_MAPS_API_KEY")?.trim());
  }
  if (providerKey === "provider.maps.mapbox") {
    return Boolean(Deno.env.get("MAPBOX_ACCESS_TOKEN")?.trim());
  }
  return providerKey === "provider.maps.sandbox";
}

function enrichMapsLocationStatus(
  status: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const activeProviderKey = optionalString(status.activeGeocoderKey);
  const providers = Array.isArray(status.providers)
    ? status.providers.flatMap((value) => {
      const provider = optionalRecord(value);
      if (!provider) return [];
      const key = optionalString(provider.key) ?? "";
      return [{ ...provider, configured: mapsProviderSecretConfigured(key) }];
    })
    : [];
  const activeConfigured = activeProviderKey
    ? mapsProviderSecretConfigured(activeProviderKey)
    : false;
  const health = requireRecordOrEmpty(status.health);
  return {
    ...status,
    activeConfigured,
    health: activeConfigured
      ? health
      : {
        ...health,
        status: "unhealthy",
        details: {
          message: "The active provider secret has not been configured in Supabase.",
          secretExposedToClients: false,
        },
      },
    providers,
  };
}

function mapsLocationStatusSummary(
  status: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const providers = Array.isArray(status.providers)
    ? status.providers.flatMap((value) => optionalRecord(value) ? [value as Record<string, unknown>] : [])
    : [];
  const activeKey = optionalString(status.activeGeocoderKey);
  const activeProvider = providers.find((provider) => optionalString(provider.key) === activeKey);
  const health = requireRecordOrEmpty(status.health);
  const metrics = requireRecordOrEmpty(status.metrics);
  const cache = requireRecordOrEmpty(status.cache);
  return {
    active_geocoder: optionalString(activeProvider?.displayName) ?? "Not configured",
    active_router: optionalString(activeProvider?.displayName) ?? "Not configured",
    provider_configuration: status.activeConfigured === true ? "Configured" : "Secret required",
    provider_health: optionalString(health.status) ?? "unknown",
    geocode_cache: Number(cache.activeEntries ?? 0) > 0 ? "healthy" : "ready",
    requests_last_24_hours: Number(metrics.requests24h ?? 0),
    successful_requests: Number(metrics.succeeded24h ?? 0),
    failed_requests: Number(metrics.failed24h ?? 0),
    cache_hits: Number(metrics.cacheHits24h ?? 0),
    rate_limit_events: Number(metrics.rateLimitEvents24h ?? 0),
    average_latency_ms: metrics.averageLatencyMs24h ?? null,
    automatic_paid_fallback: status.automaticPaidFallback === true ? "Enabled" : "Disabled",
    attribution: optionalString(status.attribution),
  };
}

function mapsLocationProviderRecords(
  status: Readonly<Record<string, unknown>>,
): readonly Record<string, unknown>[] {
  if (!Array.isArray(status.providers)) return [];
  return status.providers.flatMap((value) => {
    const provider = optionalRecord(value);
    if (!provider) return [];
    const active = provider.active === true;
    const runtimeSupported = provider.runtimeSupported === true;
    const configured = provider.configured === true;
    return [{
      provider: optionalString(provider.displayName) ?? "Location provider",
      role: active ? "Active geocoder and router" : provider.preserved === true ? "Preserved / inactive" : "Inactive",
      configuration: configured
        ? "Configured"
        : runtimeSupported
        ? "Secret required"
        : "Preserved for future integration",
      status: active && !configured ? "unhealthy" : optionalString(provider.status) ?? "inactive",
      capabilities: Array.isArray(provider.supports) ? provider.supports : [],
      last_updated: optionalString(provider.updatedAt),
    }];
  });
}

function mapsLocationAuditRecords(
  status: Readonly<Record<string, unknown>>,
): readonly Record<string, unknown>[] {
  if (!Array.isArray(status.recentChanges)) return [];
  return status.recentChanges.flatMap((value) => {
    const change = optionalRecord(value);
    if (!change) return [];
    return [{
      change: optionalString(change.action) ?? "Provider configuration changed",
      changed_by: optionalString(change.changedBy) ?? "Platform administrator",
      reason: optionalString(change.reason) ?? "No reason recorded",
      changed_at: optionalString(change.createdAt),
    }];
  });
}

async function handleMapsGeocodeRequest(
  request: Request,
  id: string,
  supabase: SupabaseClient,
  supabaseUrl: string,
  actorUserId: string,
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
    const point = requireCoordinate(payload, "location");
    latitude = point.latitude;
    longitude = point.longitude;
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

  if (activeProviderKey === "provider.maps.locationiq") {
    const reverseGridDecimals = mapsConfigNumber(
      providerResult.policy,
      "reverse_geocode_grid_decimals",
      4,
      3,
      6,
    );
    const cacheDescriptor = operation === "geocode"
      ? `${operation}:${address?.trim().toLocaleLowerCase()}`
      : `${operation}:${quantizedCoordinate(latitude ?? 0, reverseGridDecimals)}:${quantizedCoordinate(longitude ?? 0, reverseGridDecimals)}`;
    const cacheTtlSeconds = mapsConfigNumber(
      providerResult.policy,
      operation === "geocode"
        ? "geocode_cache_ttl_seconds"
        : "reverse_geocode_cache_ttl_seconds",
      604_800,
      60,
      2_592_000,
    );
    const execution = await executeLocationIqProviderCall({
      actorUserId,
      cacheDescriptor,
      cacheTtlSeconds,
      id,
      idempotencyKey,
      operation,
      provider: providerResult,
      requestPayload,
      supabase,
      supabaseUrl,
      execute: async () => {
        const adapter = createLocationIqAdapter(providerResult);
        const result = operation === "geocode"
          ? await adapter.geocode(address ?? "")
          : await adapter.reverseGeocode({
            latitude: latitude ?? 0,
            longitude: longitude ?? 0,
          });
        return { data: { ...result.data }, latencyMs: result.latencyMs };
      },
    });
    if ("response" in execution) return execution.response;
    return jsonResponse({ ok: true, data: execution.data, requestId: id });
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
  actorUserId: string,
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

  if (activeProviderKey === "provider.maps.locationiq") {
    const routeGridDecimals = mapsConfigNumber(
      providerResult.policy,
      "route_cache_grid_decimals",
      5,
      3,
      6,
    );
    const cacheDescriptor = [
      "route_estimate",
      quantizedCoordinate(origin.latitude, routeGridDecimals),
      quantizedCoordinate(origin.longitude, routeGridDecimals),
      quantizedCoordinate(destination.latitude, routeGridDecimals),
      quantizedCoordinate(destination.longitude, routeGridDecimals),
    ].join(":");
    const execution = await executeLocationIqProviderCall({
      actorUserId,
      cacheDescriptor,
      cacheTtlSeconds: mapsConfigNumber(
        providerResult.policy,
        "route_cache_ttl_seconds",
        900,
        30,
        86_400,
      ),
      id,
      idempotencyKey,
      operation: "route_estimate",
      provider: providerResult,
      requestPayload,
      supabase,
      supabaseUrl,
      execute: async () => {
        const result = await createLocationIqAdapter(providerResult).routeEstimate(origin, destination);
        return { data: { ...result.data }, latencyMs: result.latencyMs };
      },
    });
    if ("response" in execution) return execution.response;
    return jsonResponse({ ok: true, data: execution.data, requestId: id });
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
  supabaseUrl: string,
  actorUserId: string,
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

  const firstLeg = await estimateCommercialRouteLeg(
    pickup,
    station,
    providerResult,
    supabase,
    supabaseUrl,
    actorUserId,
    id,
    "pickup-to-station",
  );
  if ("response" in firstLeg) return firstLeg;
  const secondLeg = await estimateCommercialRouteLeg(
    station,
    delivery,
    providerResult,
    supabase,
    supabaseUrl,
    actorUserId,
    id,
    "station-to-customer",
  );
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
  providerResult: ResolvedMapsProvider,
  supabase: SupabaseClient,
  supabaseUrl: string,
  actorUserId: string,
  id: string,
  legKey: string,
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

  if (providerResult.providerKey === "provider.maps.locationiq") {
    const decimals = mapsConfigNumber(
      providerResult.policy,
      "route_cache_grid_decimals",
      5,
      3,
      6,
    );
    const execution = await executeLocationIqProviderCall({
      actorUserId,
      cacheDescriptor: [
        "route_estimate",
        quantizedCoordinate(origin.latitude, decimals),
        quantizedCoordinate(origin.longitude, decimals),
        quantizedCoordinate(destination.latitude, decimals),
        quantizedCoordinate(destination.longitude, decimals),
      ].join(":"),
      cacheTtlSeconds: mapsConfigNumber(
        providerResult.policy,
        "route_cache_ttl_seconds",
        900,
        30,
        86_400,
      ),
      id,
      idempotencyKey: `${id}:${legKey}`,
      operation: "route_estimate",
      provider: providerResult,
      requestPayload: { destination, legKey, origin, operation: "route_estimate" },
      supabase,
      supabaseUrl,
      execute: async () => {
        const result = await createLocationIqAdapter(providerResult).routeEstimate(origin, destination);
        return { data: { ...result.data }, latencyMs: result.latencyMs };
      },
    });
    if ("response" in execution) return execution;
    const duration = optionalString(execution.data.duration) ?? "0s";
    return {
      data: {
        distanceMeters: requireNumber(execution.data.distanceMeters, "LocationIQ route distance"),
        durationSeconds: providerDurationSeconds(duration, "LocationIQ route duration"),
        provider: "locationiq",
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
      durationSeconds: providerDurationSeconds(duration, "Google route duration"),
      provider: "google_maps",
    },
  };
}

function providerDurationSeconds(value: string, label: string): number {
  const seconds = Number(value.replace(/s$/i, ""));
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return Math.round(seconds);
}

async function handleMapsAutocompleteRequest(
  request: Request,
  id: string,
  supabase: SupabaseClient,
  supabaseUrl: string,
  actorUserId: string,
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
  const minimumCharacters = mapsConfigNumber(
    providerResult.policy,
    "autocomplete_minimum_characters",
    3,
    2,
    10,
  );
  if (input.trim().length < minimumCharacters) {
    throw new RequestValidationError(
      `input must contain at least ${minimumCharacters} characters.`,
    );
  }
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

  if (activeProviderKey === "provider.maps.locationiq") {
    const normalizedInput = input.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    const execution = await executeLocationIqProviderCall({
      actorUserId,
      cacheDescriptor: `autocomplete:${normalizedInput}`,
      cacheTtlSeconds: mapsConfigNumber(
        providerResult.policy,
        "autocomplete_cache_ttl_seconds",
        21_600,
        60,
        604_800,
      ),
      id,
      idempotencyKey,
      operation: "autocomplete",
      provider: providerResult,
      requestPayload,
      supabase,
      supabaseUrl,
      execute: async () => {
        const result = await createLocationIqAdapter(providerResult).autocomplete(input);
        return { data: { ...result.data }, latencyMs: result.latencyMs };
      },
    });
    if ("response" in execution) return execution.response;
    return jsonResponse({ ok: true, data: execution.data, requestId: id });
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
  const { data: dbBankAdapter } = await serviceClient
    .from("provider_adapters")
    .select("config")
    .eq("key", "provider.payment.bank_transfer")
    .maybeSingle();

  const dbConfig = dbBankAdapter?.config && typeof dbBankAdapter.config === "object" ? (dbBankAdapter.config as Record<string, unknown>) : {};
  const dbBankName = stringOrNull(getRecordValue(dbConfig, "bank_name")) ?? stringOrNull(getRecordValue(dbConfig, "bankName"));
  const dbAccountNumber = stringOrNull(getRecordValue(dbConfig, "account_number")) ?? stringOrNull(getRecordValue(dbConfig, "accountNumber"));
  const dbAccountName = stringOrNull(getRecordValue(dbConfig, "account_name")) ?? stringOrNull(getRecordValue(dbConfig, "accountName"));

  const serverBankName = dbBankName ?? Deno.env.get("SKIMA_DIRECT_BANK_NAME") ?? null;
  const serverAccountNumber = dbAccountNumber ?? Deno.env.get("SKIMA_DIRECT_ACCOUNT_NUMBER") ?? null;
  const serverAccountName = dbAccountName ?? Deno.env.get("SKIMA_DIRECT_ACCOUNT_NAME") ?? null;

  const mergedMetadata = {
    ...requireRecordOrEmpty(depositRecord.metadata),
    ...(serverBankName ? { bank_name: serverBankName, bankName: serverBankName } : {}),
    ...(serverAccountNumber ? { account_number: serverAccountNumber, accountNumber: serverAccountNumber } : {}),
    ...(serverAccountName ? { account_name: serverAccountName, accountName: serverAccountName } : {}),
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
      accountName: serverAccountName,
      accountNumber: serverAccountNumber,
      bankName: serverBankName,
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

interface AiAssistantParams {
  readonly authUser: User;
  readonly id: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly requestClient: SupabaseClient;
  readonly supabaseUrl: string;
}

async function aiAssistantResponse(params: AiAssistantParams): Promise<Response> {
  const workspace = requireString(params.payload.workspace, "workspace").trim().toLowerCase();
  if (!["customer", "driver", "station", "admin"].includes(workspace)) {
    throw new RequestValidationError("workspace must be customer, driver, station, or admin.");
  }

  const message = requireString(params.payload.message, "message").trim();
  if (message.length > 3000) {
    throw new RequestValidationError("message must be 3000 characters or fewer.");
  }

  const accessResult = await params.requestClient.rpc("can_access_ai_workspace", {
    target_workspace: workspace,
  });
  if (accessResult.error) {
    throw new AiProviderRuntimeError("workspace_check_failed", accessResult.error.message);
  }
  if (accessResult.data !== true) {
    return jsonResponse({
      ok: false,
      error: "forbidden",
      message: "This SKIMA AI workspace is not available for your account.",
      requestId: params.id,
    }, 403);
  }

  const capabilityResult = await params.requestClient.rpc("resolve_ai_workspace_capability", {
    target_workspace: workspace,
  });
  if (capabilityResult.error) {
    throw new AiProviderRuntimeError("capability_resolution_failed", capabilityResult.error.message);
  }
  const capabilityKey = stringOrNull(capabilityResult.data);
  if (!capabilityKey) {
    throw new AiProviderRuntimeError("ai_not_configured", "AI assistant capability is not active.");
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    throw new AiProviderRuntimeError("server_misconfigured", "AI server runtime is not configured.");
  }
  const serviceClient = createServiceClient(params.supabaseUrl, serviceRoleKey);
  const route = await resolveAiProviderRoute(serviceClient, capabilityKey);
  if (!route) {
    throw new AiProviderRuntimeError("ai_not_configured", "No active AI provider route is configured.");
  }

  const conversation = await resolveAiConversation({
    capabilityKey,
    conversationId: optionalUuid(params.payload.conversationId, "conversationId"),
    message,
    requestClient: params.requestClient,
    userId: params.authUser.id,
    workspace,
  });

  const historyResult = await params.requestClient
    .from("ai_messages")
    .select("role,content,created_at")
    .eq("conversation_id", conversation.id)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(12);
  if (historyResult.error) {
    throw new AiProviderRuntimeError("conversation_read_failed", historyResult.error.message);
  }

  const history = (Array.isArray(historyResult.data) ? historyResult.data : [])
    .slice()
    .reverse()
    .map((item) => ({
      role: stringOrNull(getRecordValue(item, "role")) === "assistant" ? "assistant" as const : "user" as const,
      content: stringOrNull(getRecordValue(item, "content")) ?? "",
    }))
    .filter((item) => item.content.length > 0);

  const userMessageResult = await params.requestClient
    .from("ai_messages")
    .insert({
      conversation_id: conversation.id,
      role: "user",
      content: message,
      metadata: { source: "skima.ai.assistant" },
    })
    .select("id")
    .single();
  if (userMessageResult.error) {
    throw new AiProviderRuntimeError("conversation_write_failed", userMessageResult.error.message);
  }

  const context = await buildAiAssistantContext(
    params.requestClient,
    params.authUser,
    workspace,
  );

  try {
    const result = await invokeAiText(route, {
      system: aiSystemPrompt(workspace),
      message,
      context,
      history,
    });

    const assistantInsert = await serviceClient.from("ai_messages").insert({
      conversation_id: conversation.id,
      role: "assistant",
      content: result.text,
      provider_adapter_key: route.providerAdapterKey,
      model_key: route.modelKey,
      metadata: {
        controlMode: route.controlMode,
        provider: route.providerDisplayName,
        providerMetadata: result.providerMetadata,
      },
    });
    if (assistantInsert.error) {
      throw new AiProviderRuntimeError("conversation_write_failed", assistantInsert.error.message);
    }

    await serviceClient
      .from("ai_conversations")
      .update({
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation.id);

    await serviceClient.from("ai_usage_events").insert({
      capability_key: capabilityKey,
      provider_adapter_key: route.providerAdapterKey,
      model_key: route.modelKey,
      user_id: params.authUser.id,
      workspace,
      conversation_id: conversation.id,
      input_units: result.inputUnits,
      output_units: result.outputUnits,
      request_count: 1,
      status: "succeeded",
      metadata: {
        transport: getRecordValue(result.providerMetadata, "transport"),
      },
    });

    return jsonResponse({
      ok: true,
      data: {
        conversationId: conversation.id,
        reply: result.text,
        capabilityKey,
        suggestions: aiWorkspaceSuggestions(workspace),
      },
      requestId: params.id,
    });
  } catch (error) {
    await serviceClient.from("ai_usage_events").insert({
      capability_key: capabilityKey,
      provider_adapter_key: route.providerAdapterKey,
      model_key: route.modelKey,
      user_id: params.authUser.id,
      workspace,
      conversation_id: conversation.id,
      request_count: 1,
      status: error instanceof AiProviderRuntimeError && error.code === "provider_rate_limited"
        ? "rate_limited"
        : "failed",
      metadata: {
        errorCode: error instanceof AiProviderRuntimeError ? error.code : "unknown",
      },
    });
    throw error;
  }
}

async function resolveAiConversation(input: {
  readonly capabilityKey: string;
  readonly conversationId: string | null;
  readonly message: string;
  readonly requestClient: SupabaseClient;
  readonly userId: string;
  readonly workspace: string;
}): Promise<{ readonly id: string }> {
  if (input.conversationId) {
    const existing = await input.requestClient
      .from("ai_conversations")
      .select("id,workspace,capability_key,status")
      .eq("id", input.conversationId)
      .eq("owner_user_id", input.userId)
      .eq("workspace", input.workspace)
      .eq("capability_key", input.capabilityKey)
      .eq("status", "active")
      .maybeSingle();

    if (existing.error) {
      throw new AiProviderRuntimeError("conversation_read_failed", existing.error.message);
    }

    const existingId = stringOrNull(getRecordValue(existing.data, "id"));
    if (!existingId) {
      throw new RequestValidationError("conversationId does not belong to this active AI workspace.");
    }
    return { id: existingId };
  }

  const title = input.message.length > 72 ? input.message.slice(0, 69).trimEnd() + "..." : input.message;
  const created = await input.requestClient
    .from("ai_conversations")
    .insert({
      owner_user_id: input.userId,
      workspace: input.workspace,
      capability_key: input.capabilityKey,
      title,
      status: "active",
      metadata: { source: "skima.ai.assistant" },
    })
    .select("id")
    .single();

  if (created.error) {
    throw new AiProviderRuntimeError("conversation_write_failed", created.error.message);
  }

  const id = stringOrNull(getRecordValue(created.data, "id"));
  if (!id) {
    throw new AiProviderRuntimeError("conversation_write_failed", "AI conversation was not created.");
  }
  return { id };
}

async function buildAiAssistantContext(
  supabase: SupabaseClient,
  user: User,
  workspace: string,
): Promise<Readonly<Record<string, unknown>>> {
  const profileResult = await supabase
    .from("profiles")
    .select("id,display_name,status")
    .eq("id", user.id)
    .maybeSingle();
  if (profileResult.error) throw new AiProviderRuntimeError("context_read_failed", profileResult.error.message);

  const base = {
    workspace,
    profile: profileResult.data ?? { id: user.id },
    generatedAt: new Date().toISOString(),
    dataPolicy: "Only facts in this context may be treated as SKIMA account facts.",
  };

  if (workspace === "customer") {
    const [orders, cylinders, locations] = await Promise.all([
      supabase
        .from("lpg_refill_orders")
        .select("id,public_reference,cylinder_id,station_branch_id,driver_profile_id,currency_code,requested_kg,quoted_kg,actual_kg,total_amount,delivery_fee_amount,platform_fee_amount,status,payment_status,assignment_status,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("lpg_cylinders")
        .select("id,public_reference,display_name,size_kg,max_capacity_kg,brand,colour,condition_status,last_inspection_at,next_inspection_at,status,safety_restriction,updated_at")
        .neq("status", "deactivated")
        .order("updated_at", { ascending: false })
        .limit(8),
      supabase
        .from("lpg_customer_locations")
        .select("id,label,formatted_address,verification_status,status,updated_at")
        .neq("status", "deleted")
        .order("updated_at", { ascending: false })
        .limit(5),
    ]);
    assertAiContextQuery(orders.error);
    assertAiContextQuery(cylinders.error);
    assertAiContextQuery(locations.error);
    return {
      ...base,
      recentOrders: orders.data ?? [],
      cylinders: cylinders.data ?? [],
      savedLocations: locations.data ?? [],
    };
  }

  if (workspace === "driver") {
    const [driver, jobs, commissions] = await Promise.all([
      supabase
        .from("driver_profiles")
        .select("id,verification_status,operational_status,updated_at")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase.rpc("read_lpg_jobs", { target_queue: "driver", target_limit: 12 }),
      supabase
        .from("commission_executions")
        .select("id,public_reference,order_id,currency_code,amount,status,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    assertAiContextQuery(driver.error);
    assertAiContextQuery(jobs.error);
    assertAiContextQuery(commissions.error);
    return {
      ...base,
      driver: driver.data ?? null,
      activeJobs: Array.isArray(jobs.data) ? jobs.data : [],
      recentEarnings: commissions.data ?? [],
    };
  }

  if (workspace === "station") {
    const [jobs, runtime] = await Promise.all([
      supabase.rpc("read_lpg_jobs", { target_queue: "station", target_limit: 15 }),
      supabase.rpc("read_lpg_station_runtime", { target_limit: 10, target_station_branch_id: null }),
    ]);
    assertAiContextQuery(jobs.error);
    assertAiContextQuery(runtime.error);
    return {
      ...base,
      activeJobs: Array.isArray(jobs.data) ? jobs.data : [],
      stationRuntime: runtime.data ?? null,
    };
  }

  if (workspace === "admin") {
    const access = await supabase.rpc("can_access_ai_workspace", { target_workspace: "admin" });
    assertAiContextQuery(access.error);
    if (access.data !== true) {
      throw new AiProviderRuntimeError("forbidden", "Admin AI access is not available.");
    }
    const [orders, applications, aiRuns, insights] = await Promise.all([
      supabase
        .from("lpg_refill_orders")
        .select("id,public_reference,status,payment_status,assignment_status,station_branch_id,driver_profile_id,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(60),
      supabase
        .from("application_records")
        .select("id,application_type_id,status,organization_id,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("ai_task_runs")
        .select("id,status,subject_type,source,created_at,started_at,completed_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("ai_operational_insights")
        .select("id,insight_key,subject_type,subject_id,severity,status,title,summary,evidence,recommended_action,first_detected_at,last_detected_at")
        .in("status", ["open", "acknowledged"])
        .order("last_detected_at", { ascending: false })
        .limit(40),
    ]);
    assertAiContextQuery(orders.error);
    assertAiContextQuery(applications.error);
    assertAiContextQuery(aiRuns.error);
    const insightRows = insights.error ? [] : insights.data ?? [];
    return {
      ...base,
      recentOrders: orders.data ?? [],
      applications: applications.data ?? [],
      aiRuns: aiRuns.data ?? [],
      operationalInsights: insightRows,
    };
  }

  return base;
}

function assertAiContextQuery(error: { readonly message?: string } | null): void {
  if (error) {
    throw new AiProviderRuntimeError(
      "context_read_failed",
      error.message ?? "SKIMA account context could not be read.",
    );
  }
}

function aiSystemPrompt(workspace: string): string {
  const roleInstruction = workspace === "customer"
    ? "Help the customer understand their LPG orders, cylinders, locations, quotes, account state and support options."
    : workspace === "driver"
    ? "Act as a driver workflow copilot. Explain active jobs, the next operational step and earnings records only from supplied context."
    : workspace === "station"
    ? "Act as a station operations assistant. Explain visible queue and station runtime information, and highlight attention items without changing them."
    : "Act as the SKIMA admin operations copilot. Summarize visible operations and exceptions, but never perform or imply an administrative action.";

  return [
    "You are Ask SKIMA, the assistive intelligence layer inside the SKIMA LPG platform.",
    roleInstruction,
    "SKIMA database state, ledger entries, pricing policies, permissions, dispatch rules, custody records and workflow states are authoritative. Never invent or overwrite them.",
    "Use supplied SKIMA account context for account-specific facts. If the requested fact is absent, say you cannot verify it from the available SKIMA data.",
    "Do not claim that a cylinder is safe based on AI or an image. For immediate LPG danger, advise the user to move away from danger and use the appropriate emergency channel.",
    "Do not claim to have changed an order, payment, wallet, dispatch assignment, inventory value, approval or permission. This assistant is read-only.",
    "Be concise, practical and use normal customer-facing language. Do not expose internal database field names unless the user explicitly asks for technical detail.",
  ].join("\n");
}

function aiWorkspaceSuggestions(workspace: string): readonly string[] {
  if (workspace === "customer") {
    return ["Where is my refill?", "Explain my latest order", "Which cylinder did I use last?"];
  }
  if (workspace === "driver") {
    return ["What do I do next?", "Summarize my active jobs", "Explain my recent earnings"];
  }
  if (workspace === "station") {
    return ["What needs attention?", "Summarize my current queue", "What work is active right now?"];
  }
  return ["What needs attention?", "Summarize current LPG operations", "Are any AI tasks failing?"];
}

async function adminAiRuntimeResponse(
  requestClient: SupabaseClient,
  user: User,
  supabaseUrl: string,
  id: string,
): Promise<Response> {
  const access = await requestClient.rpc("can_access_ai_workspace", { target_workspace: "admin" });
  if (access.error) return databaseError(access.error, id);
  if (access.data !== true) {
    return jsonResponse({ ok: false, error: "forbidden", requestId: id }, 403);
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
  }
  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
  const [capabilities, routes, providers, insights] = await Promise.all([
    serviceClient
      .from("ai_capabilities")
      .select("id,key,display_name,description,category,response_mode,control_mode,status,config,updated_at")
      .order("display_name", { ascending: true }),
    serviceClient
      .from("ai_provider_routes")
      .select("id,capability_id,provider_adapter_id,model_key,priority,status,effective_from,effective_until,config,version,updated_at")
      .order("priority", { ascending: true }),
    serviceClient
      .from("provider_adapters")
      .select("id,key,display_name,status,config,updated_at")
      .eq("provider_kind", "ai")
      .order("display_name", { ascending: true }),
    serviceClient
      .from("ai_operational_insights")
      .select("id,insight_key,subject_type,subject_id,severity,status,title,summary,evidence,recommended_action,first_detected_at,last_detected_at")
      .in("status", ["open", "acknowledged"])
      .order("severity", { ascending: false })
      .order("last_detected_at", { ascending: false })
      .limit(100),
  ]);

  if (capabilities.error) return databaseError(capabilities.error, id);
  if (routes.error) return databaseError(routes.error, id);
  if (providers.error) return databaseError(providers.error, id);

  return jsonResponse({
    ok: true,
    data: {
      capabilities: capabilities.data ?? [],
      routes: routes.data ?? [],
      providers: providers.data ?? [],
      insights: insights.error ? [] : insights.data ?? [],
      userId: user.id,
    },
    requestId: id,
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

function requireUuidArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new RequestValidationError(`${fieldName} must be an array of UUIDs.`);
  }

  return value.map((item, index) => requireUuid(item, `${fieldName}[${index}]`));
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

function nestedString(value: unknown, path: readonly string[]): string | null {
  let current: unknown = value;

  for (const key of path) {
    current = getRecordValue(current, key);
  }

  return stringOrNull(current);
}

function uniqueStrings(values: readonly (string | null)[]): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function firstNonEmptyString(values: readonly (string | null)[]): string | null {
  return values.find((value): value is string => Boolean(value?.trim())) ?? null;
}

function stringArrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function normalizePlainStatus(value: string): string {
  return value
    .split(/[_:.-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isUuidString(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function profileSummary(
  profile: unknown,
  avatarUrlOverride: string | null = null,
): Readonly<Record<string, unknown>> | null {
  const profileId = stringOrNull(getRecordValue(profile, "id"));
  if (!profileId) return null;
  const avatarValue = stringOrNull(getRecordValue(profile, "avatar_url"));

  return {
    id: profileId,
    avatarAssetId: avatarValue && isUuidString(avatarValue) ? avatarValue : null,
    avatarUrl: avatarUrlOverride ?? (avatarValue && /^https?:\/\//i.test(avatarValue) ? avatarValue : null),
    displayName: stringOrNull(getRecordValue(profile, "display_name")),
    status: stringOrNull(getRecordValue(profile, "status")),
  };
}

function applicationSubjectName(payload: Readonly<Record<string, unknown>>): string | null {
  return firstNonEmptyString([
    nestedString(payload, ["organization", "displayName"]),
    nestedString(payload, ["organization", "display_name"]),
    nestedString(payload, ["identity", "fullName"]),
    nestedString(payload, ["identity", "full_name"]),
    nestedString(payload, ["station", "formattedAddress"]),
    nestedString(payload, ["station", "formatted_address"]),
    nestedString(payload, ["service", "zone"]),
  ]);
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

async function payoutBankDirectoryResponse(
  supabase: SupabaseClient,
  id: string,
  requireSuperAdmin: boolean,
): Promise<Response> {
  if (requireSuperAdmin) {
    const admin = await supabase.rpc("is_platform_super_admin");
    if (admin.error) return databaseError(admin.error, id);
    if (admin.data !== true) {
      return jsonResponse({
        ok: false,
        error: "forbidden",
        message: "Only an active Super Admin can manage SKIMA revenue payout accounts.",
        requestId: id,
      }, 403);
    }
  }

  const providerKey = await resolveActivePaymentProviderKey(supabase);
  if (providerKey === "provider.payment.paystack") {
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (secret) {
      try {
        const banks = await listPaystackBanks(secret);
        if (banks.length > 0) {
          return jsonResponse({
            ok: true,
            data: {
              currencyCode: "NGN",
              provider: providerKey,
              source: "paystack",
              banks,
            },
            requestId: id,
          });
        }
      } catch (error) {
        if (!(error instanceof PaystackPayoutError)) throw error;
      }
    }
  }

  const directory = await supabase
    .from("currency_definitions")
    .select("metadata")
    .eq("code", "NGN")
    .eq("status", "enabled")
    .maybeSingle();
  if (directory.error) return databaseError(directory.error, id);
  const publicPayout = optionalRecord(optionalRecord(directory.data?.metadata)?.public_payout) ?? {};
  return jsonResponse({
    ok: true,
    data: {
      currencyCode: "NGN",
      provider: providerKey,
      source: "configured-fallback",
      banks: Array.isArray(publicPayout.banks) ? publicPayout.banks : [],
    },
    requestId: id,
  });
}

async function payoutBankResolveResponse(
  supabase: SupabaseClient,
  id: string,
  accountNumber: string,
  bankCode: string,
  requireSuperAdmin: boolean,
): Promise<Response> {
  if (requireSuperAdmin) {
    const admin = await supabase.rpc("is_platform_super_admin");
    if (admin.error) return databaseError(admin.error, id);
    if (admin.data !== true) {
      return jsonResponse({
        ok: false,
        error: "forbidden",
        message: "Only an active Super Admin can manage SKIMA revenue payout accounts.",
        requestId: id,
      }, 403);
    }
  }

  const providerKey = await resolveActivePaymentProviderKey(supabase);
  if (providerKey !== "provider.payment.paystack") {
    return jsonResponse({
      ok: true,
      data: {
        accountName: `Sandbox payout account •••• ${accountNumber.slice(-4)}`,
        accountNumber,
        bankCode,
        provider: providerKey,
        verified: true,
      },
      requestId: id,
    });
  }

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) {
    return jsonResponse({
      ok: false,
      error: "payment_provider_unavailable",
      message: "Paystack payouts are not configured.",
      requestId: id,
    }, 503);
  }

  try {
    const resolved = await resolvePaystackBankAccount(secret, accountNumber, bankCode);
    return jsonResponse({
      ok: true,
      data: {
        ...resolved,
        provider: providerKey,
        verified: true,
      },
      requestId: id,
    });
  } catch (error) {
    return paystackGatewayError(error, id);
  }
}

function paystackGatewayError(error: unknown, id: string): Response {
  if (error instanceof PaystackPayoutError) {
    return jsonResponse({
      ok: false,
      error: error.code,
      message: error.message,
      requestId: id,
    }, error.status);
  }
  throw error;
}

async function executePaystackWithdrawalTransfer(
  serviceClient: SupabaseClient,
  withdrawalId: string,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  const withdrawal = await serviceClient
    .from("withdrawal_requests")
    .select("id,public_reference,amount,fee_amount,beneficiary_id,provider_adapter_id,status,source")
    .eq("id", withdrawalId)
    .single();
  if (withdrawal.error || !withdrawal.data) {
    throw new RequestValidationError(withdrawal.error?.message ?? "Withdrawal was not found.");
  }
  if (withdrawal.data.source !== "platform.revenue_payout") {
    throw new RequestValidationError("Only SKIMA revenue treasury payouts can use this transfer path.");
  }
  if (withdrawal.data.status === "succeeded" || withdrawal.data.status === "processing") {
    return {
      provider: "provider.payment.paystack",
      status: withdrawal.data.status,
      providerReference: withdrawal.data.public_reference ?? withdrawalId,
      retryable: false,
    };
  }
  if (withdrawal.data.status !== "approved") {
    throw new RequestValidationError("Only an approved SKIMA revenue payout can be retried.");
  }

  const adapter = await serviceClient
    .from("provider_adapters")
    .select("key")
    .eq("id", withdrawal.data.provider_adapter_id)
    .single();
  if (adapter.error || !adapter.data) {
    throw new RequestValidationError(adapter.error?.message ?? "Payment provider was not found.");
  }

  if (adapter.data.key !== "provider.payment.paystack") {
    const sandboxReference = String(withdrawal.data.public_reference ?? withdrawalId);
    const sandbox = await serviceClient.rpc("process_wallet_withdrawal_transfer", {
      target_idempotency_key: `${idempotencyKey}:sandbox`,
      target_metadata: { automaticGatewayTransfer: true },
      target_provider_reference: sandboxReference,
      target_provider_status: "succeeded",
      target_response_payload: { sandbox: true },
      target_source: "platform.revenue_payout",
      target_withdrawal_request_id: withdrawalId,
    });
    if (sandbox.error) throw new RequestValidationError(sandbox.error.message);
    return { provider: adapter.data.key, status: "succeeded", providerReference: sandboxReference };
  }

  const beneficiary = await serviceClient
    .from("withdrawal_beneficiaries")
    .select("provider_recipient_code,status")
    .eq("id", withdrawal.data.beneficiary_id)
    .single();
  if (beneficiary.error || !beneficiary.data?.provider_recipient_code || beneficiary.data.status !== "verified") {
    throw new RequestValidationError("A verified Paystack payout account is required.");
  }

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) throw new RequestValidationError("Paystack payouts are not configured.");
  const reference = `skima-wdl-${withdrawalId.replaceAll("-", "")}`;
  const referenceReservation = await serviceClient
    .from("withdrawal_requests")
    .update({
      provider_reference: reference,
      updated_at: new Date().toISOString(),
    })
    .eq("id", withdrawalId);
  if (referenceReservation.error) {
    throw new RequestValidationError(referenceReservation.error.message);
  }

  try {
    const transfer = await initiatePaystackTransfer(secret, {
      amountMajor: Number(withdrawal.data.amount),
      recipientCode: beneficiary.data.provider_recipient_code,
      reason: "SKIMA revenue withdrawal",
      reference,
    });
    const processed = await serviceClient.rpc("process_wallet_withdrawal_transfer", {
      target_idempotency_key: `${idempotencyKey}:${transfer.providerStatus}`,
      target_metadata: {
        payoutKind: "platform_revenue_treasury",
        principalSentToProvider: withdrawal.data.amount,
        skimaFeeRetained: withdrawal.data.fee_amount,
      },
      target_provider_reference: transfer.providerReference,
      target_provider_status: transfer.providerStatus,
      target_response_payload: transfer.response,
      target_source: "platform.revenue_payout",
      target_withdrawal_request_id: withdrawalId,
    });
    if (processed.error) throw new RequestValidationError(processed.error.message);
    return {
      provider: "provider.payment.paystack",
      status: transfer.providerStatus,
      providerReference: transfer.providerReference,
    };
  } catch (error) {
    if (error instanceof PaystackPayoutError && error.code === "paystack_unreachable") {
      return {
        provider: "provider.payment.paystack",
        status: "approved",
        retryable: true,
        message: error.message,
      };
    }

    if (error instanceof PaystackPayoutError) {
      const failed = await serviceClient.rpc("process_wallet_withdrawal_transfer", {
        target_idempotency_key: `${idempotencyKey}:failed`,
        target_metadata: {
          payoutKind: "platform_revenue_treasury",
          paystackErrorCode: error.code,
          paystackErrorMessage: error.message,
        },
        target_provider_reference: reference,
        target_provider_status: "failed",
        target_response_payload: {
          status: false,
          error: error.code,
          message: error.message,
        },
        target_source: "platform.revenue_payout",
        target_withdrawal_request_id: withdrawalId,
      });
      if (failed.error) throw new RequestValidationError(failed.error.message);
      return {
        provider: "provider.payment.paystack",
        status: "failed",
        providerReference: reference,
        message: error.message,
      };
    }
    throw error;
  }
}

async function resolveActivePaymentProviderKey(supabase: SupabaseClient): Promise<string> {
  const result = await supabase.rpc("resolve_active_payment_provider");
  if (result.error) {
    throw new Error(`Payment provider selection is unavailable: ${result.error.message}`);
  }
  return requireString(result.data, "active payment provider");
}

async function configurePaystackWithdrawalBeneficiary(params: {
  readonly accountNumber: string;
  readonly bankCode: string;
  readonly beneficiaryType: string;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly source: string;
  readonly supabase: SupabaseClient;
  readonly supabaseUrl: string;
  readonly walletId: string;
}): Promise<Response> {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY");

  if (!serviceRoleKey || !paystackSecretKey) {
    return jsonResponse({
      ok: false,
      error: "payment_provider_unavailable",
      message: "Paystack payouts are not configured.",
      requestId: params.id,
    }, 503);
  }

  try {
    const resolved = await resolvePaystackBankAccount(
      paystackSecretKey,
      params.accountNumber,
      params.bankCode,
    );
    const recipient = await createPaystackTransferRecipient(paystackSecretKey, resolved);

    const configureResult = await params.supabase.rpc("configure_withdrawal_beneficiary", {
      target_account_name: resolved.accountName,
      target_account_number: resolved.accountNumber,
      target_bank_code: resolved.bankCode,
      target_beneficiary_type: params.beneficiaryType,
      target_idempotency_key: params.idempotencyKey,
      target_metadata: {
        ...params.metadata,
        accountNameSource: "paystack.bank.resolve",
        resolvedAt: new Date().toISOString(),
      },
      target_provider_adapter_key: "provider.payment.paystack",
      target_source: params.source,
      target_wallet_id: params.walletId,
    });

    if (configureResult.error) {
      return databaseError(configureResult.error, params.id);
    }

    const beneficiaryId = requireString(configureResult.data, "beneficiary id");
    const serviceClient = createServiceClient(params.supabaseUrl, serviceRoleKey);
    const update = await serviceClient
      .from("withdrawal_beneficiaries")
      .update({
        account_name: resolved.accountName,
        metadata: {
          ...params.metadata,
          accountNameSource: "paystack.bank.resolve",
          paystackRecipientCode: recipient.recipientCode,
          paystackRecipientId: recipient.recipientId,
        },
        provider_recipient_code: recipient.recipientCode,
        status: "verified",
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", beneficiaryId);

    if (update.error) {
      return databaseError(update.error, params.id);
    }

    return jsonResponse({
      data: {
        id: beneficiaryId,
        accountName: resolved.accountName,
        accountNumberLast4: resolved.accountNumber.slice(-4),
        bankCode: resolved.bankCode,
        status: "verified",
      },
      id: beneficiaryId,
      ok: true,
      requestId: params.id,
    });
  } catch (error) {
    if (error instanceof PaystackPayoutError) {
      return jsonResponse({
        ok: false,
        error: error.code,
        message: error.message,
        requestId: params.id,
      }, error.status);
    }
    throw error;
  }
}
