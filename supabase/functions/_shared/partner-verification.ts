import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2.110.9";

export type VerificationBody = Readonly<Record<string, unknown>>;

export class VerificationRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function readPartnerVerificationRequirements(
  userClient: SupabaseClient,
  applicationId: string,
): Promise<unknown[]> {
  if (!applicationId.trim()) {
    throw new VerificationRuntimeError("invalid_request", "applicationId is required.");
  }

  const { data, error } = await userClient.rpc("read_application_verification_status", {
    target_application_id: applicationId,
  });
  if (error) throw databaseError(error.message);
  return Array.isArray(data) ? data : [];
}

export async function startPartnerVerificationSession(
  serviceClient: SupabaseClient,
  user: User,
  body: VerificationBody,
): Promise<Record<string, unknown>> {
  const applicationId = requireString(body.applicationId, "applicationId");
  const verificationKey = requireString(body.verificationKey, "verificationKey");
  const idempotencyKey = requireString(body.idempotencyKey, "idempotencyKey");

  const application = await ownedApplication(serviceClient, user.id, applicationId);
  const applicationTypeId = textValue(application.application_type_id);
  if (!applicationTypeId) {
    throw new VerificationRuntimeError(
      "verification_application_invalid",
      "The application type could not be resolved for verification.",
      409,
    );
  }

  const mapping = await applicationMapping(
    serviceClient,
    applicationTypeId,
    verificationKey,
  );
  const mappingMetadata = recordValue(mapping.metadata);
  const providerAudience = textValue(
    mappingMetadata.provider_audience ?? mappingMetadata.providerAudience,
  );

  const appliesResult = await serviceClient.rpc(
    "application_verification_mapping_applies",
    {
      target_mapping_id: mapping.id,
      target_application_id: applicationId,
    },
  );
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
    .select("id,status,verification_url,provider_session_id,started_at,completed_at,expires_at")
    .eq("source", "skima.verification_runtime")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing.error) throw databaseError(existing.error.message);
  if (existing.data) return sessionResponse(existing.data, verificationKey);

  const reusable = await serviceClient
    .from("application_verification_sessions")
    .select("id,status,verification_url,provider_session_id,started_at,completed_at,expires_at")
    .eq("application_id", applicationId)
    .eq("application_verification_requirement_id", requireString(mapping.id, "verification mapping id"))
    .in("status", ["created", "pending", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reusable.error) throw databaseError(reusable.error.message);
  if (reusable.data && !isExpired(reusable.data.expires_at)) {
    return sessionResponse(reusable.data, verificationKey);
  }

  const verificationDefinitionId = textValue(mapping.verification_definition_id);
  if (!verificationDefinitionId) {
    throw new VerificationRuntimeError(
      "verification_configuration_invalid",
      "The verification definition could not be resolved.",
      500,
    );
  }

  const route = await activeRoute(serviceClient, verificationDefinitionId);
  const manualFallbackAllowed = mapping.manual_fallback_allowed === true;

  if (!route) {
    throw new VerificationRuntimeError(
      "automatic_verification_unavailable",
      manualFallbackAllowed
        ? "Automatic verification is not configured for this check yet. Use the permitted fallback evidence."
        : "Automatic verification is temporarily unavailable for this required check.",
      409,
      { manualFallbackAllowed },
    );
  }

  if (providerAudience && !routeAllowsAudience(route.config, providerAudience)) {
    throw new VerificationRuntimeError(
      "verification_audience_not_supported",
      "This verification route is not enabled for the current applicant role.",
      409,
      { manualFallbackAllowed, providerAudience },
    );
  }

  if (route.provider.key !== "provider.verification.didit") {
    throw new VerificationRuntimeError(
      "verification_provider_not_supported",
      "The selected verification provider is not supported by this runtime version.",
      503,
      { manualFallbackAllowed },
    );
  }

  const apiKey = resolveEdgeSecret("DIDIT_API_KEY");
  if (!apiKey) {
    throw new VerificationRuntimeError(
      "verification_provider_not_configured",
      manualFallbackAllowed
        ? "Automatic verification is not configured yet. Use the permitted fallback evidence."
        : "SKIMA verification is temporarily unavailable.",
      503,
      { manualFallbackAllowed },
    );
  }

  const vendorData = verificationKey === "verification.business.registry"
    ? applicationId
    : user.id;

  const providerRequest: Record<string, unknown> = {
    workflow_id: route.workflow_ref,
    vendor_data: vendorData,
    metadata: {
      skima_application_id: applicationId,
      verification_key: verificationKey,
      verification_scope: verificationKey === "verification.business.registry" ? "station_kyb" : "partner_kyc",
      ...(providerAudience ? { skima_partner_role: providerAudience } : {}),
    },
  };
  const callbackUrl = textValue(route.config.callback_url ?? route.config.callbackUrl);
  if (callbackUrl) {
    providerRequest.callback = callbackUrl;
    providerRequest.callback_method =
      textValue(route.config.callback_method ?? route.config.callbackMethod) ?? "both";
  }

  let providerBody: Record<string, unknown>;
  let providerWorkflowRef = route.workflow_ref;
  try {
    const providerResult = await createDiditSessionWithWorkflowRecovery({
      apiKey,
      serviceClient,
      route,
      providerRequest,
      verificationKey,
      idempotencyKey,
    });
    providerBody = providerResult.body;
    providerWorkflowRef = providerResult.workflowRef;
  } catch (error) {
    const runtimeError = error instanceof VerificationRuntimeError ? error : null;
    await logProviderExecution(serviceClient, {
      providerAdapterId: route.provider.id,
      operationKey: "verification.session.create",
      status: "failed",
      idempotencyKey,
      requestPayload: {
        applicationId,
        verificationKey,
        workflowRef: providerWorkflowRef,
      },
      responsePayload: runtimeError?.details ?? {},
      errorMessage: error instanceof Error ? error.message : "provider request failed",
    });

    if (
      runtimeError?.code === "verification_provider_credits_exhausted" &&
      shouldPauseVerificationRouteForCreditFailure(verificationKey, route.config)
    ) {
      // Personal KYC remains retryable because the free-tier route should not be
      // permanently disabled by a balance/workflow mismatch. Paid KYB routes may
      // pause to avoid repeatedly presenting an unavailable automatic path.
      await pauseVerificationRoute(
        serviceClient,
        route.id,
        route.config,
      );
    }

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
    .select("id,status,verification_url,provider_session_id,started_at,completed_at,expires_at")
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

  return sessionResponse(inserted.data, verificationKey);
}

export async function refreshPartnerVerificationSession(
  serviceClient: SupabaseClient,
  user: User,
  body: VerificationBody,
): Promise<Record<string, unknown>> {
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
    throw new VerificationRuntimeError(
      "forbidden",
      "This verification session belongs to another account.",
      403,
    );
  }

  if (session.status === "passed") {
    return {
      ...sessionResponse(session, null),
      reconciliation: await reconcile(
        serviceClient,
        requireString(session.application_id, "application id"),
        idempotencyKey,
      ),
    };
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

  const apiKey = resolveEdgeSecret("DIDIT_API_KEY");
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

  const eventInsert = await serviceClient.from("verification_events").insert({
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
  if (eventInsert.error) {
    console.info(JSON.stringify({
      severity: "warning",
      source: "partner-verification",
      message: "Verification event could not be written.",
      detail: eventInsert.error.message,
    }));
  }

  await logProviderExecution(serviceClient, {
    providerAdapterId: requireString(providerResult.data.id, "provider adapter id"),
    operationKey: "verification.session.decision",
    status: "succeeded",
    idempotencyKey,
    requestPayload: {
      sessionId: session.id,
      providerSessionId: session.provider_session_id,
    },
    responsePayload: safeSummary,
  });

  const applicationId = requireString(session.application_id, "application id");
  const reconciliation = mappedStatus === "passed"
    ? await reconcile(serviceClient, applicationId, idempotencyKey)
    : null;

  return {
    ...sessionResponse(updated.data, null),
    providerStatus,
    reconciliation,
  };
}

export async function reconcilePartnerVerificationApplication(
  serviceClient: SupabaseClient,
  user: User,
  body: VerificationBody,
): Promise<Record<string, unknown>> {
  const applicationId = requireString(body.applicationId, "applicationId");
  const idempotencyKey = requireString(body.idempotencyKey, "idempotencyKey");
  await ownedApplication(serviceClient, user.id, applicationId);
  return (await reconcile(serviceClient, applicationId, idempotencyKey)) ?? {};
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
      source: "partner-verification",
      applicationId,
      message: "Automatic application decision is not available yet.",
      detail: result.error.message,
    }));
    return {
      applicationId,
      autoDecided: false,
      pending: true,
      message: "Verification is saved. Any remaining operational or manual compliance check will continue separately.",
    };
  }

  return {
    applicationId,
    ...recordValue(result.data),
  };
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
    throw new VerificationRuntimeError(
      "forbidden",
      "This application belongs to another account.",
      403,
    );
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
    throw new VerificationRuntimeError(
      "verification_not_found",
      "This verification check is not configured.",
      404,
    );
  }

  const mapping = await serviceClient
    .from("application_verification_requirements")
    .select("id,verification_definition_id,manual_fallback_allowed,metadata")
    .eq("application_type_id", applicationTypeId)
    .eq("verification_definition_id", definition.data.id)
    .eq("status", "active")
    .maybeSingle();

  if (mapping.error) throw databaseError(mapping.error.message);
  if (!mapping.data) {
    throw new VerificationRuntimeError(
      "verification_not_applicable",
      "This verification check is not part of the application.",
      409,
    );
  }
  return mapping.data;
}

function resolveEdgeSecret(name: string): string | null {
  const environmentValue = Deno.env.get(name)?.trim();
  return environmentValue || null;
}

async function activeRoute(
  serviceClient: SupabaseClient,
  verificationDefinitionId: string,
): Promise<ActiveVerificationRoute | null> {
  const routes = await serviceClient
    .from("verification_provider_routes")
    .select("id,provider_adapter_id,workflow_ref,priority,config")
    .eq("verification_definition_id", verificationDefinitionId)
    .eq("status", "active")
    .not("workflow_ref", "is", null)
    .order("priority", { ascending: true });

  if (routes.error) throw databaseError(routes.error.message);

  for (const route of routes.data ?? []) {
    const workflowRef = textValue(route.workflow_ref);
    if (!workflowRef) continue;

    const providerResult = await serviceClient
      .from("provider_adapters")
      .select("id,key,display_name,status")
      .eq("id", route.provider_adapter_id)
      .eq("provider_kind", "verification")
      .maybeSingle();

    if (providerResult.error) throw databaseError(providerResult.error.message);
    if (!providerResult.data || providerResult.data.status !== "active") continue;

    return {
      id: requireString(route.id, "verification route id"),
      workflow_ref: workflowRef,
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

type ActiveVerificationRoute = {
  id: string;
  workflow_ref: string;
  config: Record<string, unknown>;
  provider: { id: string; key: string; display_name: string };
};

function routeAllowsAudience(
  routeConfig: Record<string, unknown>,
  audience: string,
): boolean {
  const configured = Array.isArray(routeConfig.audience)
    ? routeConfig.audience.map(textValue).filter((value): value is string => Boolean(value))
    : [];
  if (configured.length === 0 || configured.includes(audience)) return true;

  const aliasMap = recordValue(
    routeConfig.providerAudienceAliases ?? routeConfig.provider_audience_aliases,
  );
  const directAliases = Array.isArray(aliasMap[audience])
    ? (aliasMap[audience] as unknown[])
        .map(textValue)
        .filter((value): value is string => Boolean(value))
    : [];
  if (directAliases.some((alias) => configured.includes(alias))) return true;

  return Object.entries(aliasMap).some(([configuredAlias, values]) => {
    if (!configured.includes(configuredAlias) || !Array.isArray(values)) return false;
    return values.some((value) => textValue(value) === audience);
  });
}

async function createDiditSessionWithWorkflowRecovery(input: {
  apiKey: string;
  serviceClient: SupabaseClient;
  route: ActiveVerificationRoute;
  providerRequest: Record<string, unknown>;
  verificationKey: string;
  idempotencyKey: string;
}): Promise<{ body: Record<string, unknown>; workflowRef: string }> {
  try {
    return {
      body: await diditRequest(
        input.apiKey,
        "https://verification.didit.me/v3/session/",
        { method: "POST", body: JSON.stringify(input.providerRequest) },
      ),
      workflowRef: input.route.workflow_ref,
    };
  } catch (error) {
    if (!shouldRecoverDiditWorkflow(error, input.route.config)) throw error;

    const recovered = await resolveDiditWorkflow(input.apiKey, input.route.config);
    if (!recovered) throw error;

    const recoveredRequest = {
      ...input.providerRequest,
      workflow_id: recovered.uuid,
    };
    const body = await diditRequest(
      input.apiKey,
      "https://verification.didit.me/v3/session/",
      { method: "POST", body: JSON.stringify(recoveredRequest) },
    );

    if (input.route.config.workflowRecoveryPersistResolvedRef === true) {
      await persistRecoveredDiditWorkflow(
        input.serviceClient,
        input.route,
        recovered,
      );
    }

    await logProviderExecution(input.serviceClient, {
      providerAdapterId: input.route.provider.id,
      operationKey: "verification.workflow.recovered",
      status: "succeeded",
      idempotencyKey: input.idempotencyKey + ":workflow-recovery",
      requestPayload: {
        verificationKey: input.verificationKey,
        previousWorkflowRef: input.route.workflow_ref,
      },
      responsePayload: {
        workflowRef: recovered.uuid,
        workflowLabel: recovered.label,
        source: recovered.source,
      },
    });

    return { body, workflowRef: recovered.uuid };
  }
}

function shouldRecoverDiditWorkflow(
  error: unknown,
  routeConfig: Record<string, unknown>,
): boolean {
  if (routeConfig.workflowRecoveryEnabled !== true) return false;
  if (!(error instanceof VerificationRuntimeError)) return false;
  if (error.code !== "verification_provider_request_failed") return false;
  if (error.details.providerHttpStatus !== 400) return false;

  const message = textValue(error.details.providerMessage)?.toLowerCase() ?? "";
  return (
    message.includes("workflow") &&
    (
      message.includes("invalid") ||
      message.includes("not found") ||
      message.includes("does not exist") ||
      message.includes("unknown")
    )
  );
}

async function resolveDiditWorkflow(
  apiKey: string,
  routeConfig: Record<string, unknown>,
): Promise<{ uuid: string; label: string; source: string } | null> {
  const workflows = await listDiditWorkflows(apiKey);
  const eligible = workflows.filter((workflow) => {
    if (workflow.is_archived === true) return false;
    const type = textValue(workflow.workflow_type)?.toLowerCase();
    return !type || type === "kyc" || type === "user" || type === "identity";
  });
  if (eligible.length === 0) return null;

  const configuredLabel = textValue(
    routeConfig.workflow_label ?? routeConfig.workflowLabel,
  );
  if (routeConfig.workflowRecoveryPreferConfiguredLabel === true && configuredLabel) {
    const labelMatch = eligible.find(
      (workflow) => textValue(workflow.workflow_label)?.toLowerCase() === configuredLabel.toLowerCase(),
    );
    const uuid = textValue(labelMatch?.uuid);
    if (labelMatch && uuid) {
      return {
        uuid,
        label: textValue(labelMatch.workflow_label) ?? configuredLabel,
        source: "configured_label",
      };
    }
  }

  if (routeConfig.freeTierEligible === true) {
    const freeLabelMatch = eligible.find((workflow) =>
      textValue(workflow.workflow_label)?.toLowerCase().includes("free")
    );
    const uuid = textValue(freeLabelMatch?.uuid);
    if (freeLabelMatch && uuid) {
      return {
        uuid,
        label: textValue(freeLabelMatch.workflow_label) ?? "Free KYC",
        source: "free_label",
      };
    }
  }

  if (routeConfig.workflowRecoveryAllowDefaultKyc === true) {
    const defaultWorkflow = eligible.find((workflow) => workflow.is_default === true);
    const uuid = textValue(defaultWorkflow?.uuid);
    if (defaultWorkflow && uuid) {
      return {
        uuid,
        label: textValue(defaultWorkflow.workflow_label) ?? "Default KYC",
        source: "default_kyc",
      };
    }
  }

  if (eligible.length === 1) {
    const uuid = textValue(eligible[0].uuid);
    if (uuid) {
      return {
        uuid,
        label: textValue(eligible[0].workflow_label) ?? "KYC",
        source: "only_eligible_kyc",
      };
    }
  }

  return null;
}

async function listDiditWorkflows(
  apiKey: string,
): Promise<Record<string, unknown>[]> {
  let response: Response;
  try {
    response = await fetch("https://verification.didit.me/v3/workflows/", {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new VerificationRuntimeError(
      "verification_provider_unreachable",
      error instanceof Error && error.name === "TimeoutError"
        ? "The verification provider took too long to respond while resolving the KYC workflow."
        : "The verification provider could not be reached while resolving the KYC workflow.",
      503,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new VerificationRuntimeError(
      "verification_provider_response_invalid",
      "The verification provider returned an unreadable workflow response.",
      502,
    );
  }

  if (!response.ok) {
    const providerBody = recordValue(body);
    const providerMessage = extractProviderErrorMessage(providerBody);
    throw new VerificationRuntimeError(
      response.status === 401 || response.status === 403
        ? "verification_provider_authentication_failed"
        : response.status === 429
        ? "verification_provider_rate_limited"
        : "verification_provider_request_failed",
      providerMessage ?? "The verification provider could not list available KYC workflows.",
      response.status >= 400 && response.status < 600 ? response.status : 502,
      {
        providerHttpStatus: response.status,
        providerMessage: safeProviderMessage(providerMessage),
      },
    );
  }

  if (!Array.isArray(body)) {
    throw new VerificationRuntimeError(
      "verification_provider_response_invalid",
      "The verification provider returned an invalid workflow list.",
      502,
    );
  }

  return body.map(recordValue).filter((workflow) => textValue(workflow.uuid));
}

async function persistRecoveredDiditWorkflow(
  serviceClient: SupabaseClient,
  route: ActiveVerificationRoute,
  workflow: { uuid: string; label: string; source: string },
): Promise<void> {
  const recoveredAt = new Date().toISOString();
  const result = await serviceClient
    .from("verification_provider_routes")
    .update({
      workflow_ref: workflow.uuid,
      config: {
        ...route.config,
        providerWorkflowStatus: "available",
        providerWorkflowRecoveredAt: recoveredAt,
        providerWorkflowRecoveredFrom: route.workflow_ref,
        providerWorkflowRecoveredLabel: workflow.label,
        providerWorkflowRecoverySource: workflow.source,
      },
      updated_at: recoveredAt,
    })
    .eq("id", route.id)
    .eq("status", "active");

  if (result.error) {
    console.info(JSON.stringify({
      severity: "warning",
      source: "partner-verification",
      routeId: route.id,
      message: "Recovered Didit workflow could not be persisted; this request will still continue.",
      detail: result.error.message,
    }));
  }
}

function extractProviderErrorMessage(body: Record<string, unknown>): string | null {
  const direct =
    textValue(body.message) ??
    textValue(body.detail) ??
    textValue(body.description) ??
    textValue(body.error) ??
    textValue(recordValue(body.error).message) ??
    textValue(recordValue(body.error).detail);
  if (direct) return direct.slice(0, 500);

  for (const [field, value] of Object.entries(body)) {
    const nested = flattenProviderErrorValue(value);
    if (nested) return (field + ": " + nested).slice(0, 500);
  }
  return null;
}

function flattenProviderErrorValue(value: unknown, depth = 0): string | null {
  if (depth > 2) return null;
  const text = textValue(value);
  if (text) return text;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = flattenProviderErrorValue(item, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  const record = recordValue(value);
  for (const nestedValue of Object.values(record)) {
    const nested = flattenProviderErrorValue(nestedValue, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function safeProviderMessage(value: string | null): string | null {
  if (!value) return null;
  return value.toLowerCase().includes("api key") ? null : value;
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
    const providerMessage = extractProviderErrorMessage(body);
    const providerCode =
      textValue(body.code) ??
      textValue(body.error_code) ??
      textValue(body.errorCode) ??
      textValue(recordValue(body.error).code);
    const providerRequestId =
      response.headers.get("x-request-id")?.trim() ||
      response.headers.get("request-id")?.trim() ||
      response.headers.get("x-correlation-id")?.trim() ||
      null;
    const normalizedProviderMessage = providerMessage?.toLowerCase() ?? "";
    const creditsExhausted =
      normalizedProviderMessage.includes("not enough credits") ||
      normalizedProviderMessage.includes("insufficient credits") ||
      (
        normalizedProviderMessage.includes("credit") &&
        normalizedProviderMessage.includes("top up")
      );

    throw new VerificationRuntimeError(
      creditsExhausted
        ? "verification_provider_credits_exhausted"
        : response.status === 401 || response.status === 403
        ? "verification_provider_authentication_failed"
        : response.status === 429
        ? "verification_provider_rate_limited"
        : "verification_provider_request_failed",
      creditsExhausted
        ? "This Didit workflow requires billable credits. SKIMA can retry after the workflow or balance is corrected, and the accepted fallback evidence remains available."
        : response.status === 429
        ? "Automatic verification is temporarily busy. Try again shortly."
        : safeProviderMessage(providerMessage)
        ? safeProviderMessage(providerMessage)!
        : "The verification provider could not complete the request.",
      response.status >= 400 && response.status < 600 ? response.status : 502,
      {
        providerHttpStatus: response.status,
        providerCode,
        providerRequestId,
        providerMessage: safeProviderMessage(providerMessage),
      },
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
  if (
    ["RESUBMITTED", "IN_PROGRESS", "NOT_STARTED", "AWAITING_USER", "NOT_FINISHED"]
      .includes(status)
  ) {
    return "in_progress";
  }
  return "pending";
}

function verificationEventResult(
  status: string,
): "pending" | "passed" | "failed" | "flagged" | "cancelled" {
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
    providerStatus: value.provider_status ?? null,
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

function shouldPauseVerificationRouteForCreditFailure(
  verificationKey: string,
  routeConfig: Record<string, unknown>,
): boolean {
  if (verificationKey === "verification.person.identity") return false;
  return (
    textValue(routeConfig.launchMode) === "assisted_kyb" ||
    textValue(routeConfig.workflow_kind)?.toUpperCase() === "KYB"
  );
}

async function pauseVerificationRoute(
  serviceClient: SupabaseClient,
  routeId: string,
  routeConfig: Record<string, unknown>,
): Promise<void> {
  const result = await serviceClient
    .from("verification_provider_routes")
    .update({
      status: "paused",
      config: {
        ...routeConfig,
        runtimePauseReason: "provider_credits_exhausted",
        runtimePausedAt: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", routeId)
    .eq("status", "active");

  if (result.error) {
    console.info(JSON.stringify({
      severity: "warning",
      source: "partner-verification",
      routeId,
      message: "The failing verification route could not be paused after a provider-credit failure.",
      detail: result.error.message,
    }));
  }
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
      source: "partner-verification",
      message: "Provider execution log could not be written.",
      detail: result.error.message,
    }));
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new VerificationRuntimeError("invalid_request", `${field} is required.`);
  }
  return value.trim();
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
