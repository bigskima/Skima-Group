import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.110.9";

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

type Body = Readonly<Record<string, unknown>>;

class VerificationRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("authorization");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return json({ ok: false, error: "unauthorized", requestId }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });

  const userResult = await userClient.auth.getUser();
  const user = userResult.data.user;
  if (userResult.error || !user) {
    return json({ ok: false, error: "unauthorized", requestId }, 401);
  }

  try {
    const path = verificationPath(request.url);

    if (path === "/requirements" && request.method === "GET") {
      return readRequirements(userClient, request, requestId);
    }

    if (path === "/sessions" && request.method === "POST") {
      return startSession(serviceClient, user, await readBody(request), requestId);
    }

    if (path === "/sessions/refresh" && request.method === "POST") {
      return refreshSession(serviceClient, user, await readBody(request), requestId);
    }

    if (path === "/applications/reconcile" && request.method === "POST") {
      return reconcileApplication(serviceClient, user, await readBody(request), requestId);
    }

    return json({ ok: false, error: "not_found", requestId }, 404);
  } catch (error) {
    console.error(JSON.stringify({
      severity: "error",
      source: "verification-runtime",
      requestId,
      message: error instanceof Error ? error.message : "unknown verification runtime error",
    }));

    const runtimeError = error instanceof VerificationRuntimeError
      ? error
      : new VerificationRuntimeError(
          "verification_runtime_error",
          "SKIMA could not complete this verification request.",
          500,
        );

    return json(
      {
        ok: false,
        error: runtimeError.code,
        message: runtimeError.message,
        details: runtimeError.details,
        requestId,
      },
      runtimeError.status,
    );
  }
});

function verificationPath(urlValue: string): string {
  let path = new URL(urlValue).pathname.replace(/\/+$/, "");
  const marker = "/verification-runtime";
  const index = path.indexOf(marker);
  if (index >= 0) path = path.slice(index + marker.length);
  return path || "/";
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: CORS_HEADERS });
}

async function readBody(request: Request): Promise<Body> {
  const value = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VerificationRuntimeError("invalid_request", "Request body must be a JSON object.");
  }
  return value as Body;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new VerificationRuntimeError("invalid_request", `${field} is required.`);
  }
  return value.trim();
}

async function readRequirements(
  userClient: SupabaseClient,
  request: Request,
  requestId: string,
): Promise<Response> {
  const applicationId = new URL(request.url).searchParams.get("applicationId");
  if (!applicationId) {
    throw new VerificationRuntimeError("invalid_request", "applicationId is required.");
  }

  const { data, error } = await userClient.rpc("read_application_verification_status", {
    target_application_id: applicationId,
  });
  if (error) throw databaseError(error.message);

  return json({ ok: true, data: Array.isArray(data) ? data : [], requestId });
}

async function startSession(
  serviceClient: SupabaseClient,
  user: User,
  body: Body,
  requestId: string,
): Promise<Response> {
  const applicationId = requireString(body.applicationId, "applicationId");
  const verificationKey = requireString(body.verificationKey, "verificationKey");
  const idempotencyKey = requireString(body.idempotencyKey, "idempotencyKey");

  const application = await ownedApplication(serviceClient, user.id, applicationId);
  const mapping = await applicationMapping(serviceClient, application.application_type_id, verificationKey);

  const appliesResult = await serviceClient.rpc("application_verification_mapping_applies", {
    target_mapping_id: mapping.id,
    target_application_id: applicationId,
  });
  if (appliesResult.error) throw databaseError(appliesResult.error.message);
  if (appliesResult.data !== true) {
    throw new VerificationRuntimeError(
      "verification_not_applicable",
      "This verification check does not apply to the current application.",
      409,
    );
  }

  const existing = await serviceClient
    .from("application_verification_sessions")
    .select("id,status,verification_url,provider_session_id,started_at,expires_at")
    .eq("source", "skima.verification_runtime")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing.error) throw databaseError(existing.error.message);
  if (existing.data) {
    return json({
      ok: true,
      data: sessionResponse(existing.data, verificationKey),
      requestId,
    });
  }

  const reusable = await serviceClient
    .from("application_verification_sessions")
    .select("id,status,verification_url,provider_session_id,started_at,expires_at")
    .eq("application_id", applicationId)
    .eq("application_verification_requirement_id", mapping.id)
    .in("status", ["created", "pending", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reusable.error) throw databaseError(reusable.error.message);
  if (reusable.data && !isExpired(reusable.data.expires_at)) {
    return json({
      ok: true,
      data: sessionResponse(reusable.data, verificationKey),
      requestId,
    });
  }

  const route = await activeRoute(serviceClient, mapping.verification_definition_id);
  if (!route) {
    throw new VerificationRuntimeError(
      "automatic_verification_unavailable",
      mapping.manual_fallback_allowed
        ? "Automatic verification is not configured for this check yet. Use the permitted fallback evidence."
        : "Automatic verification is temporarily unavailable for this required check.",
      409,
      { manualFallbackAllowed: mapping.manual_fallback_allowed },
    );
  }

  if (route.provider.key !== "provider.verification.didit") {
    throw new VerificationRuntimeError(
      "verification_provider_not_supported",
      "The selected verification provider is not supported by this runtime version.",
      503,
      { manualFallbackAllowed: mapping.manual_fallback_allowed },
    );
  }

  const apiKey = Deno.env.get("DIDIT_API_KEY");
  if (!apiKey) {
    throw new VerificationRuntimeError(
      "verification_provider_not_configured",
      mapping.manual_fallback_allowed
        ? "Automatic verification is not configured yet. Use the permitted fallback evidence."
        : "SKIMA verification is temporarily unavailable.",
      503,
      { manualFallbackAllowed: mapping.manual_fallback_allowed },
    );
  }

  const vendorData = verificationKey === "verification.business.registry"
    ? applicationId
    : user.id;

  const providerRequest: Record<string, unknown> = {
    workflow_id: route.workflow_ref,
    vendor_data: vendorData,
  };
  const callbackUrl = textValue(route.config?.callback_url ?? route.config?.callbackUrl);
  if (callbackUrl) providerRequest.callback = callbackUrl;

  let providerBody: Record<string, unknown>;
  try {
    providerBody = await diditRequest(
      apiKey,
      "https://verification.didit.me/v3/session/",
      {
        method: "POST",
        body: JSON.stringify(providerRequest),
      },
    );
  } catch (error) {
    await logProviderExecution(serviceClient, {
      providerAdapterId: route.provider.id,
      operationKey: "verification.session.create",
      status: "failed",
      idempotencyKey,
      requestPayload: {
        applicationId,
        verificationKey,
        workflowRef: route.workflow_ref,
      },
      responsePayload: {},
      errorMessage: error instanceof Error ? error.message : "provider request failed",
    });
    throw error;
  }

  const providerSessionId =
    textValue(providerBody.session_id) ??
    textValue(providerBody.sessionId);
  const verificationUrl =
    textValue(providerBody.url) ??
    textValue(providerBody.session_url) ??
    textValue(providerBody.sessionUrl);

  if (!providerSessionId || !verificationUrl) {
    throw new VerificationRuntimeError(
      "verification_provider_response_invalid",
      "The verification provider did not return a usable verification session.",
      502,
    );
  }

  const inserted = await serviceClient
    .from("application_verification_sessions")
    .insert({
      application_id: applicationId,
      application_verification_requirement_id: mapping.id,
      applicant_user_id: user.id,
      provider_adapter_id: route.provider.id,
      provider_session_id: providerSessionId,
      verification_url: normalizeVerificationUrl(verificationUrl),
      status: "in_progress",
      provider_status: "NOT_STARTED",
      result_summary: {
        provider: route.provider.key,
        verificationKey,
      },
      started_at: new Date().toISOString(),
      source: "skima.verification_runtime",
      idempotency_key: idempotencyKey,
    })
    .select("id,status,verification_url,provider_session_id,started_at,expires_at")
    .single();

  if (inserted.error) throw databaseError(inserted.error.message);

  await logProviderExecution(serviceClient, {
    providerAdapterId: route.provider.id,
    operationKey: "verification.session.create",
    status: "succeeded",
    idempotencyKey,
    requestPayload: {
      applicationId,
      verificationKey,
      workflowRef: route.workflow_ref,
    },
    responsePayload: {
      providerSessionId,
      created: true,
    },
  });

  return json({
    ok: true,
    data: sessionResponse(inserted.data, verificationKey),
    requestId,
  });
}

async function refreshSession(
  serviceClient: SupabaseClient,
  user: User,
  body: Body,
  requestId: string,
): Promise<Response> {
  const sessionId = requireString(body.sessionId, "sessionId");
  const idempotencyKey = requireString(body.idempotencyKey, "idempotencyKey");

  const sessionResult = await serviceClient
    .from("application_verification_sessions")
    .select(
      "id,application_id,application_verification_requirement_id,applicant_user_id,provider_adapter_id,provider_session_id,verification_url,status,provider_status,started_at,completed_at,expires_at",
    )
    .eq("id", sessionId)
    .single();

  if (sessionResult.error) throw databaseError(sessionResult.error.message);
  const session = sessionResult.data;
  if (session.applicant_user_id !== user.id) {
    throw new VerificationRuntimeError("forbidden", "This verification session belongs to another account.", 403);
  }

  if (session.status === "passed") {
    return json({
      ok: true,
      data: {
        ...sessionResponse(session, null),
        reconciliation: await reconcile(serviceClient, session.application_id, idempotencyKey),
      },
      requestId,
    });
  }

  if (!session.provider_adapter_id || !session.provider_session_id) {
    throw new VerificationRuntimeError(
      "verification_session_incomplete",
      "This verification session cannot be refreshed. Start a new verification attempt.",
      409,
    );
  }

  const providerResult = await serviceClient
    .from("provider_adapters")
    .select("id,key,status")
    .eq("id", session.provider_adapter_id)
    .single();
  if (providerResult.error) throw databaseError(providerResult.error.message);
  if (providerResult.data.status !== "active") {
    throw new VerificationRuntimeError(
      "verification_provider_unavailable",
      "The verification provider is temporarily unavailable. Your saved progress is unchanged.",
      503,
    );
  }

  if (providerResult.data.key !== "provider.verification.didit") {
    throw new VerificationRuntimeError(
      "verification_provider_not_supported",
      "The selected verification provider is not supported by this runtime version.",
      503,
    );
  }

  const apiKey = Deno.env.get("DIDIT_API_KEY");
  if (!apiKey) {
    throw new VerificationRuntimeError(
      "verification_provider_not_configured",
      "SKIMA verification is temporarily unavailable. Your saved progress is unchanged.",
      503,
    );
  }

  const decision = await diditRequest(
    apiKey,
    `https://verification.didit.me/v3/session/${encodeURIComponent(session.provider_session_id)}/decision/`,
    { method: "GET" },
  );

  const providerStatus = textValue(decision.status) ?? "UNKNOWN";
  const mappedStatus = mapDiditStatus(providerStatus);
  const completedAt = ["passed", "failed", "manual_review", "expired"].includes(mappedStatus)
    ? new Date().toISOString()
    : null;
  const safeSummary = {
    provider: providerResult.data.key,
    providerStatus,
    sessionKind: textValue(decision.session_kind) ?? undefined,
  };
  const failureMessage = mappedStatus === "failed"
    ? "The automatic check could not be approved. You can retry or use the permitted fallback evidence."
    : mappedStatus === "manual_review"
    ? "The verification provider is reviewing this check. No document upload is required unless SKIMA asks for a fallback."
    : null;

  const updated = await serviceClient
    .from("application_verification_sessions")
    .update({
      status: mappedStatus,
      provider_status: providerStatus,
      result_summary: safeSummary,
      failure_code: mappedStatus === "failed" ? "provider_declined" : null,
      failure_message: failureMessage,
      completed_at: completedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id)
    .select("id,status,verification_url,provider_session_id,started_at,completed_at,expires_at")
    .single();

  if (updated.error) throw databaseError(updated.error.message);

  const mappingResult = await serviceClient
    .from("application_verification_requirements")
    .select("verification_definition_id")
    .eq("id", session.application_verification_requirement_id)
    .single();
  if (mappingResult.error) throw databaseError(mappingResult.error.message);

  await serviceClient.from("verification_events").insert({
    definition_id: mappingResult.data.verification_definition_id,
    scanned_by: user.id,
    scanned_entity_type: "application",
    scanned_entity_id: session.application_id,
    purpose: "partner.onboarding",
    location: {},
    result: verificationEventResult(mappedStatus),
    payload: {
      applicationVerificationSessionId: session.id,
      providerStatus,
      normalizedStatus: mappedStatus,
    },
  });

  await logProviderExecution(serviceClient, {
    providerAdapterId: providerResult.data.id,
    operationKey: "verification.session.decision",
    status: "succeeded",
    idempotencyKey,
    requestPayload: {
      sessionId: session.id,
      providerSessionId: session.provider_session_id,
    },
    responsePayload: safeSummary,
  });

  const reconciliation = mappedStatus === "passed"
    ? await reconcile(serviceClient, session.application_id, idempotencyKey)
    : null;

  return json({
    ok: true,
    data: {
      ...sessionResponse(updated.data, null),
      providerStatus,
      reconciliation,
    },
    requestId,
  });
}

async function reconcileApplication(
  serviceClient: SupabaseClient,
  user: User,
  body: Body,
  requestId: string,
): Promise<Response> {
  const applicationId = requireString(body.applicationId, "applicationId");
  const idempotencyKey = requireString(body.idempotencyKey, "idempotencyKey");
  await ownedApplication(serviceClient, user.id, applicationId);
  const result = await reconcile(serviceClient, applicationId, idempotencyKey);
  return json({ ok: true, data: result, requestId });
}

async function reconcile(
  serviceClient: SupabaseClient,
  applicationId: string,
  idempotencyKey: string,
): Promise<Record<string, unknown> | null> {
  const result = await serviceClient.rpc("reconcile_application_verification", {
    target_application_id: applicationId,
    target_idempotency_key: `${idempotencyKey}:reconcile`,
  });

  if (result.error) {
    console.info(JSON.stringify({
      severity: "notice",
      source: "verification-runtime",
      applicationId,
      message: "Automatic application decision is not available yet.",
      detail: result.error.message,
    }));
    return {
      autoDecided: false,
      pending: true,
      message: "Verification is saved. Any remaining operational or manual compliance check will continue separately.",
    };
  }

  return recordValue(result.data);
}

async function ownedApplication(
  serviceClient: SupabaseClient,
  userId: string,
  applicationId: string,
): Promise<Record<string, unknown>> {
  const result = await serviceClient
    .from("application_records")
    .select("id,application_type_id,applicant_user_id,status")
    .eq("id", applicationId)
    .single();

  if (result.error) throw databaseError(result.error.message);
  if (result.data.applicant_user_id !== userId) {
    throw new VerificationRuntimeError("forbidden", "This application belongs to another account.", 403);
  }
  return result.data;
}

async function applicationMapping(
  serviceClient: SupabaseClient,
  applicationTypeId: string,
  verificationKey: string,
): Promise<Record<string, unknown>> {
  const definition = await serviceClient
    .from("verification_definitions")
    .select("id,key,status")
    .eq("key", verificationKey)
    .eq("status", "active")
    .maybeSingle();
  if (definition.error) throw databaseError(definition.error.message);
  if (!definition.data) {
    throw new VerificationRuntimeError("verification_not_found", "This verification check is not configured.", 404);
  }

  const mapping = await serviceClient
    .from("application_verification_requirements")
    .select("id,verification_definition_id,manual_fallback_allowed")
    .eq("application_type_id", applicationTypeId)
    .eq("verification_definition_id", definition.data.id)
    .eq("status", "active")
    .maybeSingle();
  if (mapping.error) throw databaseError(mapping.error.message);
  if (!mapping.data) {
    throw new VerificationRuntimeError("verification_not_applicable", "This verification check is not part of the application.", 409);
  }

  return mapping.data;
}

async function activeRoute(
  serviceClient: SupabaseClient,
  verificationDefinitionId: string,
): Promise<{
  workflow_ref: string;
  config: Record<string, unknown>;
  provider: { id: string; key: string; display_name: string };
} | null> {
  const routes = await serviceClient
    .from("verification_provider_routes")
    .select("id,provider_adapter_id,workflow_ref,priority,config")
    .eq("verification_definition_id", verificationDefinitionId)
    .eq("status", "active")
    .not("workflow_ref", "is", null)
    .order("priority", { ascending: true });

  if (routes.error) throw databaseError(routes.error.message);

  for (const route of routes.data ?? []) {
    if (!textValue(route.workflow_ref)) continue;
    const providerResult = await serviceClient
      .from("provider_adapters")
      .select("id,key,display_name,status")
      .eq("id", route.provider_adapter_id)
      .eq("provider_kind", "verification")
      .maybeSingle();
    if (providerResult.error) throw databaseError(providerResult.error.message);
    if (!providerResult.data || providerResult.data.status !== "active") continue;

    return {
      workflow_ref: route.workflow_ref,
      config: recordValue(route.config),
      provider: {
        id: providerResult.data.id,
        key: providerResult.data.key,
        display_name: providerResult.data.display_name,
      },
    };
  }

  return null;
}

async function diditRequest(
  apiKey: string,
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new VerificationRuntimeError(
      "verification_provider_unreachable",
      error instanceof Error && error.name === "TimeoutError"
        ? "The verification provider took too long to respond."
        : "The verification provider could not be reached. Try again.",
      503,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = recordValue(await response.json());
  } catch {
    throw new VerificationRuntimeError(
      "verification_provider_response_invalid",
      "The verification provider returned an unreadable response.",
      502,
    );
  }

  if (!response.ok) {
    const providerMessage = textValue(body.message) ?? textValue(body.detail);
    throw new VerificationRuntimeError(
      response.status === 401 || response.status === 403
        ? "verification_provider_authentication_failed"
        : response.status === 429
        ? "verification_provider_rate_limited"
        : "verification_provider_request_failed",
      response.status === 429
        ? "Automatic verification is temporarily busy. Try again shortly."
        : providerMessage && !providerMessage.toLowerCase().includes("api key")
        ? providerMessage
        : "The verification provider could not complete the request.",
      response.status >= 400 && response.status < 600 ? response.status : 502,
    );
  }

  return body;
}

function mapDiditStatus(value: string): string {
  const status = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (status === "APPROVED") return "passed";
  if (status === "DECLINED") return "failed";
  if (status === "IN_REVIEW") return "manual_review";
  if (["ABANDONED", "EXPIRED"].includes(status)) return "expired";
  if (["RESUBMITTED", "IN_PROGRESS", "NOT_STARTED", "AWAITING_USER", "NOT_FINISHED"].includes(status)) {
    return "in_progress";
  }
  return "pending";
}

function verificationEventResult(status: string): "pending" | "passed" | "failed" | "flagged" | "cancelled" {
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  if (status === "manual_review") return "flagged";
  if (status === "expired" || status === "cancelled") return "cancelled";
  return "pending";
}

function normalizeVerificationUrl(value: string): string {
  const normalized = value.startsWith("http://") || value.startsWith("https://")
    ? value
    : `https://${value.replace(/^\/+/, "")}`;
  const url = new URL(normalized);
  if (url.protocol !== "https:") {
    throw new VerificationRuntimeError(
      "verification_provider_response_invalid",
      "The verification provider returned an unsafe verification URL.",
      502,
    );
  }
  return url.toString();
}

function sessionResponse(
  value: Record<string, unknown>,
  verificationKey: string | null,
): Record<string, unknown> {
  return {
    id: value.id,
    verificationKey,
    status: value.status,
    verificationUrl: value.verification_url,
    providerSessionId: value.provider_session_id,
    startedAt: value.started_at,
    completedAt: value.completed_at,
    expiresAt: value.expires_at,
  };
}

function isExpired(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return false;
  const time = Date.parse(text);
  return Number.isFinite(time) && time <= Date.now();
}

async function logProviderExecution(
  serviceClient: SupabaseClient,
  input: {
    providerAdapterId: string;
    operationKey: string;
    status: "succeeded" | "failed";
    idempotencyKey: string;
    requestPayload: Record<string, unknown>;
    responsePayload: Record<string, unknown>;
    errorMessage?: string;
  },
): Promise<void> {
  const result = await serviceClient.from("provider_execution_logs").upsert(
    {
      provider_adapter_id: input.providerAdapterId,
      provider_kind: "verification",
      operation_key: input.operationKey,
      status: input.status,
      request_payload: input.requestPayload,
      response_payload: input.responsePayload,
      idempotency_key: input.idempotencyKey,
      error_message: input.errorMessage ?? null,
    },
    { onConflict: "provider_kind,operation_key,idempotency_key" },
  );

  if (result.error) {
    console.info(JSON.stringify({
      severity: "warning",
      source: "verification-runtime",
      message: "Provider execution log could not be written.",
      detail: result.error.message,
    }));
  }
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function databaseError(message: string): VerificationRuntimeError {
  return new VerificationRuntimeError("database_error", message, 500);
}
