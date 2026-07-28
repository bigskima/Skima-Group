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
  "/runtime/service-requests",
  "/runtime/pricing/quotes",
  "/runtime/pricing/quotes/accept",
  "/runtime/payments/reserve",
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

  if (url.pathname === "/health") {
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

  if (url.pathname === "/engines/catalog" && request.method === "GET") {
    return jsonResponse({
      ok: true,
      data: {
        routes: Array.from(ROUTES).filter((route) => route.startsWith("/engines/")),
      },
      requestId: id,
    });
  }

  if (url.pathname === "/engines/currencies" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("currency_definitions")
        .select("code,display_name,symbol,decimal_places,status,metadata")
        .order("code", { ascending: true }),
      id,
    );
  }

  if (url.pathname === "/engines/pricing-policies" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("pricing_policies")
        .select("id,key,display_name,pricing_mode,scope_type,scope_id,currency_code,status,version")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (url.pathname === "/engines/settlement-policies" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("settlement_policies")
        .select("id,key,display_name,scope_type,scope_id,status,version")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (url.pathname === "/engines/dispatch-policies" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("dispatch_policies")
        .select("id,key,display_name,matching_strategy,status")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (url.pathname === "/engines/verification-definitions" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("verification_definitions")
        .select("id,key,display_name,verification_mode,event_type_key,status")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (url.pathname === "/engines/notification-templates" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("notification_templates")
        .select("id,key,channel,locale,subject_template,status")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (url.pathname === "/engines/ai-task-definitions" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("ai_task_definitions")
        .select("id,key,display_name,task_type,provider_adapter_id,status")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (url.pathname === "/engines/provider-adapters" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("provider_adapters")
        .select("id,provider_kind,key,display_name,status,config")
        .in("provider_kind", [
          "payment",
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

  if (url.pathname === "/runtime/catalog" && request.method === "GET") {
    return jsonResponse({
      ok: true,
      data: {
        routes: Array.from(ROUTES).filter((route) => route.startsWith("/runtime/")),
      },
      requestId: id,
    });
  }

  if (url.pathname === "/runtime/service-requests") {
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

  if (url.pathname === "/runtime/pricing/quotes") {
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

  if (url.pathname === "/runtime/pricing/quotes/accept" && request.method === "POST") {
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

  if (url.pathname === "/runtime/payments/reserve" && request.method === "POST") {
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

  if (url.pathname === "/runtime/workflows/start" && request.method === "POST") {
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

  if (url.pathname === "/runtime/events/process" && request.method === "POST") {
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

  if (url.pathname === "/runtime/participants/assign" && request.method === "POST") {
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

  if (url.pathname === "/runtime/dispatch/select" && request.method === "POST") {
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

  if (url.pathname === "/runtime/tracking/sessions" && request.method === "POST") {
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

  if (url.pathname === "/runtime/tracking/points" && request.method === "POST") {
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

  if (url.pathname === "/runtime/verifications" && request.method === "POST") {
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

  if (url.pathname === "/runtime/notifications/queue" && request.method === "POST") {
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

  if (url.pathname === "/runtime/ai/queue" && request.method === "POST") {
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

  if (url.pathname === "/runtime/settlements/execute" && request.method === "POST") {
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

  if (url.pathname === "/runtime/escrow/status" && request.method === "POST") {
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

  if (url.pathname === "/runtime/escrow/release" && request.method === "POST") {
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

  if (url.pathname === "/runtime/escrow/refund" && request.method === "POST") {
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

  if (url.pathname === "/runtime/reconciliation/service-request" && request.method === "POST") {
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

  if (url.pathname === "/modules/catalog" && request.method === "GET") {
    return jsonResponse({
      ok: true,
      data: {
        routes: Array.from(ROUTES).filter((route) => route.startsWith("/modules")),
      },
      requestId: id,
    });
  }

  if (url.pathname === "/modules") {
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

  if (url.pathname === "/modules/versions") {
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

  if (url.pathname === "/modules/versions/activate" && request.method === "POST") {
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

  if (url.pathname === "/modules/components") {
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

  if (url.pathname === "/modules/events" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("business_module_events")
        .select("id,module_id,module_version_id,event_type,metadata,created_at")
        .order("created_at", { ascending: false }),
      id,
    );
  }

  if (url.pathname === "/admin/webhook-endpoints") {
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

  if (url.pathname === "/admin/webhook-deliveries" && request.method === "GET") {
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

  if (url.pathname === "/admin/webhook-attempts" && request.method === "GET") {
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

  if (url.pathname === "/admin/webhooks/queue" && request.method === "POST") {
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

  if (url.pathname === "/admin/role-templates") {
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

  if (url.pathname === "/admin/users") {
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

  if (url.pathname === "/admin/users/revoke" && request.method === "POST") {
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
      route: url.pathname,
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
